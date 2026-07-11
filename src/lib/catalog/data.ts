import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { cards, cardSets, cardVariants, currentPrices, pricePoints } from "@/db/schema";
import {
  getPokemonCard,
  getPokemonCardsBySetPage,
  getPokemonSet,
  getPokemonSets,
  normalize,
  parseCardSearchQuery,
  searchPokemonCards,
} from "@/lib/pokemon-tcg/client";
import type {
  CardSearchPayload,
  CardSearchResult,
  PokemonTcgCard,
  PokemonTcgPrice,
  PokemonTcgSet,
  SetCardsPayload,
} from "@/lib/pokemon-tcg/types";
import { formatPrinting, getCardPrintingOptions } from "@/lib/pokemon-tcg/printing";
import { CARD_CONDITIONS } from "@/lib/collection/options";
import type { SearchCardSort } from "@/lib/catalog/search-card-sort";
import type { SetCardSort } from "@/lib/catalog/set-card-sort";
import { logError, measureDbQuery } from "@/lib/observability";

export type CardPriceHistoryPoint = {
  observedAt: string;
  amountUsd: number;
};

export type CardPriceHistorySeries = {
  printing: string;
  condition: string;
  label: string;
  points: CardPriceHistoryPoint[];
};

function formatCondition(value: string) {
  if (value === "unspecified") return "Market";
  return CARD_CONDITIONS.find((condition) => condition.value === value)?.label ?? value;
}

function normalizeCardNumber(value: string) {
  return normalize(value).replace(/^#/, "");
}

function normalizeSearchText(value: string) {
  return normalize(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenizeSearchName(value: string) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function mapSet(row: typeof cardSets.$inferSelect): PokemonTcgSet {
  return {
    id: row.providerId,
    name: row.name,
    series: row.series ?? "",
    printedTotal: row.printedTotal ?? row.total ?? 0,
    total: row.total ?? row.printedTotal ?? 0,
    releaseDate: row.releaseDate ?? "",
    updatedAt: (row.providerUpdatedAt ?? row.updatedAt).toISOString(),
    images:
      row.symbolUrl || row.logoUrl
        ? {
            symbol: row.symbolUrl ?? "",
            logo: row.logoUrl ?? "",
          }
        : undefined,
  };
}

function getStartingMarketPrice(card: PokemonTcgCard) {
  const marketPrices = Object.values(card.tcgplayer?.prices ?? {})
    .map((price: PokemonTcgPrice) => price.market)
    .filter((price): price is number => typeof price === "number");

  return marketPrices.length > 0 ? Math.min(...marketPrices) : null;
}

function mapCardSearchResult(input: {
  card: typeof cards.$inferSelect;
  set: typeof cardSets.$inferSelect;
  currentMarketPriceUsd?: number | null;
}): CardSearchResult {
  const providerCard = input.card.providerData as unknown as PokemonTcgCard | null;

  return {
    id: input.card.providerId,
    name: input.card.name,
    number: input.card.number,
    rarity: input.card.rarity ?? null,
    artist: input.card.artist ?? null,
    imageSmallUrl: input.card.imageSmallUrl ?? providerCard?.images.small ?? "",
    imageLargeUrl: input.card.imageLargeUrl ?? providerCard?.images.large ?? "",
    set: {
      id: input.set.providerId,
      name: input.set.name,
      series: input.set.series ?? "",
    },
    startingPriceUsd:
      input.currentMarketPriceUsd ?? (providerCard ? getStartingMarketPrice(providerCard) : null),
    priceUpdatedAt: providerCard?.tcgplayer?.updatedAt ?? null,
    printings: providerCard
      ? getCardPrintingOptions(providerCard)
      : [{ value: "normal", label: "Normal", price: null }],
  };
}

function mapCard(row: typeof cards.$inferSelect): PokemonTcgCard | null {
  const providerCard = row.providerData as unknown as PokemonTcgCard | null;

  return providerCard?.id ? providerCard : null;
}

async function mapCardWithCurrentPrices(row: typeof cards.$inferSelect) {
  const providerCard = mapCard(row);

  if (!providerCard) return null;

  const currentPricesByPrinting = await getCurrentPricesForCardId(row.id);

  if (currentPricesByPrinting.size === 0) return providerCard;

  const observedAt = Array.from(currentPricesByPrinting.values())
    .map((price) => price.observedAt)
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return {
    ...providerCard,
    tcgplayer: {
      url: providerCard.tcgplayer?.url ?? "",
      updatedAt: observedAt ? observedAt.toISOString().slice(0, 10) : providerCard.tcgplayer?.updatedAt ?? "",
      prices: Object.fromEntries(
        Array.from(currentPricesByPrinting, ([printing, price]) => [
          toTcgplayerPriceKey(printing),
          price.price,
        ]),
      ),
    },
  };
}

function normalizedCardNameSql() {
  return sql<string>`trim(regexp_replace(lower(${cards.name}), '[^a-z0-9]+', ' ', 'g'))`;
}

function localSearchConditions(input: {
  name: string | null;
  nameTokens: string[];
  normalizedNumber: string | null;
  strategy: "phrase" | "tokens";
}) {
  const conditions = [eq(cards.languageCode, "en"), eq(cards.isActive, true), eq(cardSets.isActive, true)];

  if (input.name && input.strategy === "phrase") {
    conditions.push(sql`${normalizedCardNameSql()} like ${`${normalizeSearchText(input.name)}%`}`);
  }

  if (input.strategy === "tokens" && input.nameTokens.length > 0) {
    const [firstToken, ...remainingTokens] = input.nameTokens;
    conditions.push(sql`${normalizedCardNameSql()} like ${`${firstToken}%`}`);

    for (const token of remainingTokens) {
      conditions.push(sql`${normalizedCardNameSql()} like ${`% ${token}%`}`);
    }
  }

  if (input.normalizedNumber) {
    conditions.push(sql`lower(${cards.number}) = ${input.normalizedNumber}`);
  }

  return and(...conditions);
}

async function queryLocalSearchPage(input: {
  name: string | null;
  nameTokens: string[];
  normalizedNumber: string | null;
  strategy: "phrase" | "tokens";
  page: number;
  pageSize: number;
  sort: SearchCardSort;
}) {
  const whereSearch = localSearchConditions(input);
  const offset = (input.page - 1) * input.pageSize;
  const relevanceOrderBy = [
    asc(cards.name),
    getCardNumberOrderSql(),
    asc(cards.number),
    asc(cards.providerId),
  ];
  const [totalRow] = await measureDbQuery(
    "db.catalog_search_count",
    () =>
      db
        .select({ count: sql<number>`count(*)::integer` })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(whereSearch),
    { strategy: input.strategy, sort: input.sort },
  );
  const totalCount = totalRow?.count ?? 0;

  if (totalCount === 0) {
    return { rows: [], totalCount };
  }

  if (input.sort === "price-desc" || input.sort === "price-asc") {
    const currentMarketPriceByCard = currentMarketPriceByCardSubquery();
    const orderBy = [
      sql`case when ${currentMarketPriceByCard.amountMinor} is null then 1 else 0 end`,
      input.sort === "price-desc" ? desc(currentMarketPriceByCard.amountMinor) : asc(currentMarketPriceByCard.amountMinor),
      ...relevanceOrderBy,
    ];

    const rows = await measureDbQuery(
      "db.catalog_search_rows",
      () =>
        db
          .select({ card: cards, set: cardSets })
          .from(cards)
          .innerJoin(cardSets, eq(cards.setId, cardSets.id))
          .leftJoin(currentMarketPriceByCard, eq(currentMarketPriceByCard.cardId, cards.id))
          .where(whereSearch)
          .orderBy(...orderBy)
          .limit(input.pageSize)
          .offset(offset),
      { strategy: input.strategy, page: input.page, pageSize: input.pageSize, sort: input.sort },
    );

    return { rows, totalCount };
  }

  const rows = await measureDbQuery(
    "db.catalog_search_rows",
    () =>
      db
        .select({ card: cards, set: cardSets })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(whereSearch)
        .orderBy(...relevanceOrderBy)
        .limit(input.pageSize)
        .offset(offset),
    { strategy: input.strategy, page: input.page, pageSize: input.pageSize, sort: input.sort },
  );

  return { rows, totalCount };
}

async function queryLocalClosestMatches(input: {
  name: string;
  normalizedNumber: string | null;
  page: number;
  pageSize: number;
  sort: SearchCardSort;
}) {
  const normalizedName = normalizeSearchText(input.name);
  const offset = (input.page - 1) * input.pageSize;
  const similarityScore = sql<number>`greatest(
    similarity(${normalizedCardNameSql()}, ${normalizedName}),
    word_similarity(${normalizedCardNameSql()}, ${normalizedName})
  )`;
  const relevanceOrderBy = [
    sql`${similarityScore} desc`,
    asc(cards.name),
    getCardNumberOrderSql(),
    asc(cards.number),
    asc(cards.providerId),
  ];
  const whereClosest = and(
    eq(cards.languageCode, "en"),
    eq(cards.isActive, true),
    eq(cardSets.isActive, true),
    input.normalizedNumber ? sql`lower(${cards.number}) = ${input.normalizedNumber}` : undefined,
    sql`${normalizedCardNameSql()} % ${normalizedName}`,
  );

  const [totalRow] = await measureDbQuery(
    "db.catalog_closest_count",
    () =>
      db
        .select({ count: sql<number>`count(*)::integer` })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(whereClosest),
    { sort: input.sort },
  );
  const totalCount = totalRow?.count ?? 0;

  if (totalCount === 0) {
    return { rows: [], totalCount };
  }

  if (input.sort === "price-desc" || input.sort === "price-asc") {
    const currentMarketPriceByCard = currentMarketPriceByCardSubquery();
    const orderBy = [
      sql`case when ${currentMarketPriceByCard.amountMinor} is null then 1 else 0 end`,
      input.sort === "price-desc" ? desc(currentMarketPriceByCard.amountMinor) : asc(currentMarketPriceByCard.amountMinor),
      ...relevanceOrderBy,
    ];

    const rows = await measureDbQuery(
      "db.catalog_closest_rows",
      () =>
        db
          .select({ card: cards, set: cardSets })
          .from(cards)
          .innerJoin(cardSets, eq(cards.setId, cardSets.id))
          .leftJoin(currentMarketPriceByCard, eq(currentMarketPriceByCard.cardId, cards.id))
          .where(whereClosest)
          .orderBy(...orderBy)
          .limit(input.pageSize)
          .offset(offset),
      { page: input.page, pageSize: input.pageSize, sort: input.sort },
    );

    return { rows, totalCount };
  }

  const rows = await measureDbQuery(
    "db.catalog_closest_rows",
    () =>
      db
        .select({ card: cards, set: cardSets })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(whereClosest)
        .orderBy(...relevanceOrderBy)
        .limit(input.pageSize)
        .offset(offset),
    { page: input.page, pageSize: input.pageSize, sort: input.sort },
  );

  return { rows, totalCount };
}

async function mapCardSearchRows(
  rows: { card: typeof cards.$inferSelect; set: typeof cardSets.$inferSelect }[],
) {
  const currentMarketPrices = await getCurrentMarketPricesByCardId(rows.map((row) => row.card.id));

  return rows.map((row) =>
    mapCardSearchResult({
      ...row,
      currentMarketPriceUsd: currentMarketPrices.get(row.card.id) ?? null,
    }),
  );
}

async function getCurrentMarketPricesByCardId(cardIds: string[]) {
  const uniqueCardIds = Array.from(new Set(cardIds));
  const pricesByCardId = new Map<string, { anyPrice: number | null; nearMintPrice: number | null }>();

  if (uniqueCardIds.length === 0) return new Map<string, number>();

  const priceRows = await measureDbQuery(
    "db.catalog_current_prices_by_card",
    () =>
      db
        .select({
          cardId: cardVariants.cardId,
          condition: cardVariants.condition,
          amountMinor: currentPrices.amountMinor,
        })
        .from(cardVariants)
        .innerJoin(currentPrices, eq(currentPrices.cardVariantId, cardVariants.id))
        .where(
          and(
            inArray(cardVariants.cardId, uniqueCardIds),
            eq(cardVariants.languageCode, "en"),
            eq(currentPrices.source, "tcgcsv"),
            eq(currentPrices.priceType, "market"),
            eq(currentPrices.currency, "USD"),
          ),
        ),
    { cardCount: uniqueCardIds.length },
  );

  for (const row of priceRows) {
    const amountUsd = row.amountMinor / 100;
    const existing = pricesByCardId.get(row.cardId) ?? {
      anyPrice: null,
      nearMintPrice: null,
    };

    if (existing.anyPrice === null || amountUsd < existing.anyPrice) {
      existing.anyPrice = amountUsd;
    }

    if (row.condition === "near_mint" && (existing.nearMintPrice === null || amountUsd < existing.nearMintPrice)) {
      existing.nearMintPrice = amountUsd;
    }

    pricesByCardId.set(row.cardId, existing);
  }

  return new Map(
    Array.from(pricesByCardId, ([cardId, prices]) => [
      cardId,
      prices.nearMintPrice ?? prices.anyPrice,
    ]).filter((entry): entry is [string, number] => entry[1] !== null),
  );
}

function currentMarketPriceByCardSubquery() {
  return db
    .select({
      cardId: cardVariants.cardId,
      amountMinor: sql<number>`coalesce(
        min(${currentPrices.amountMinor}) filter (where ${cardVariants.condition} = 'near_mint'),
        min(${currentPrices.amountMinor})
      )`.as("amount_minor"),
    })
    .from(cardVariants)
    .innerJoin(currentPrices, eq(currentPrices.cardVariantId, cardVariants.id))
    .where(
      and(
        eq(cardVariants.languageCode, "en"),
        eq(currentPrices.source, "tcgcsv"),
        eq(currentPrices.priceType, "market"),
        eq(currentPrices.currency, "USD"),
      ),
    )
    .groupBy(cardVariants.cardId)
    .as("current_market_price_by_card");
}

function currentMarketPriceBySetCardSubquery(setProviderId: string) {
  return db
    .select({
      cardId: cardVariants.cardId,
      amountMinor: sql<number>`coalesce(
        min(${currentPrices.amountMinor}) filter (where ${cardVariants.condition} = 'near_mint'),
        min(${currentPrices.amountMinor})
      )`.as("amount_minor"),
    })
    .from(cardVariants)
    .innerJoin(cards, eq(cardVariants.cardId, cards.id))
    .innerJoin(cardSets, eq(cards.setId, cardSets.id))
    .innerJoin(currentPrices, eq(currentPrices.cardVariantId, cardVariants.id))
    .where(
      and(
        eq(cardSets.providerId, setProviderId),
        eq(cardSets.isActive, true),
        eq(cards.languageCode, "en"),
        eq(cards.isActive, true),
        eq(cardVariants.languageCode, "en"),
        eq(currentPrices.source, "tcgcsv"),
        eq(currentPrices.priceType, "market"),
        eq(currentPrices.currency, "USD"),
      ),
    )
    .groupBy(cardVariants.cardId)
    .as("current_market_price_by_set_card");
}

function getCardNumberOrderSql() {
  return sql`${cards.numberSortKey} asc nulls last`;
}

async function getCurrentPricesForCardId(cardId: string) {
  const pricesByPrinting = new Map<
    string,
    { price: PokemonTcgPrice; observedAt: Date }
  >();
  const priceRows = await db
    .select({
      printing: cardVariants.printing,
      priceType: currentPrices.priceType,
      amountMinor: currentPrices.amountMinor,
      observedAt: currentPrices.observedAt,
    })
    .from(currentPrices)
    .innerJoin(cardVariants, eq(currentPrices.cardVariantId, cardVariants.id))
    .where(
      and(
        eq(cardVariants.cardId, cardId),
        eq(cardVariants.condition, "unspecified"),
        eq(cardVariants.languageCode, "en"),
        eq(currentPrices.source, "tcgcsv"),
        eq(currentPrices.currency, "USD"),
      ),
    );

  for (const row of priceRows) {
    const current = pricesByPrinting.get(row.printing) ?? {
      price: {},
      observedAt: row.observedAt,
    };
    const amountUsd = row.amountMinor / 100;

    if (row.priceType === "low") current.price.low = amountUsd;
    if (row.priceType === "mid") current.price.mid = amountUsd;
    if (row.priceType === "high") current.price.high = amountUsd;
    if (row.priceType === "market") current.price.market = amountUsd;
    if (row.priceType === "direct_low") current.price.directLow = amountUsd;
    if (row.observedAt > current.observedAt) current.observedAt = row.observedAt;

    pricesByPrinting.set(row.printing, current);
  }

  return pricesByPrinting;
}

function toTcgplayerPriceKey(printing: string) {
  return printing.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export const getCatalogPokemonSets = cache(async () => {
  try {
    const localSets = await db
      .select()
      .from(cardSets)
      .where(and(eq(cardSets.languageCode, "en"), eq(cardSets.isActive, true)))
      .orderBy(sql`${cardSets.releaseDate} desc nulls last`, asc(cardSets.name));

    if (localSets.length > 0) {
      return localSets.map(mapSet);
    }
  } catch (error) {
    logError("catalog.local_sets.failed", error);
  }

  return getPokemonSets();
});

export const getCatalogPokemonSet = cache(async (id: string) => {
  try {
    const [localSet] = await db
      .select()
      .from(cardSets)
      .where(and(eq(cardSets.providerId, id), eq(cardSets.languageCode, "en"), eq(cardSets.isActive, true)))
      .limit(1);

    if (localSet) {
      return mapSet(localSet);
    }
  } catch (error) {
    logError("catalog.local_set.failed", error, { setId: id });
  }

  return getPokemonSet(id);
});

export const getCatalogPokemonCardsBySetPage = cache(async (input: {
  setId: string;
  page?: number;
  pageSize?: number;
  sort?: SetCardSort;
}): Promise<SetCardsPayload> => {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 250;
  const sort = input.sort ?? "number-asc";
  const offset = (page - 1) * pageSize;

  try {
    const whereSet = and(
      eq(cardSets.providerId, input.setId),
      eq(cards.languageCode, "en"),
      eq(cards.isActive, true),
      eq(cardSets.isActive, true),
    );
    const tieBreakSort = [getCardNumberOrderSql(), asc(cards.number), asc(cards.name), asc(cards.providerId)];
    const [totalRow] = await measureDbQuery(
      "db.set_cards_count",
      () =>
        db
          .select({ count: sql<number>`count(*)::integer` })
          .from(cards)
          .innerJoin(cardSets, eq(cards.setId, cardSets.id))
          .where(whereSet),
      { setId: input.setId },
    );

    const totalCount = totalRow?.count ?? 0;

    if (totalCount > 0) {
      if (sort === "price-desc" || sort === "price-asc") {
        const currentMarketPriceByCard = currentMarketPriceBySetCardSubquery(input.setId);
        const orderBy = [
          sql`case when ${currentMarketPriceByCard.amountMinor} is null then 1 else 0 end`,
          sort === "price-desc" ? desc(currentMarketPriceByCard.amountMinor) : asc(currentMarketPriceByCard.amountMinor),
          ...tieBreakSort,
        ];

        const rows = await measureDbQuery(
          "db.set_cards_rows",
          () =>
            db
              .select({ card: cards, set: cardSets })
              .from(cards)
              .innerJoin(cardSets, eq(cards.setId, cardSets.id))
              .leftJoin(currentMarketPriceByCard, eq(currentMarketPriceByCard.cardId, cards.id))
              .where(whereSet)
              .orderBy(...orderBy)
              .limit(pageSize)
              .offset(offset),
          { setId: input.setId, page, pageSize, sort },
        );

        return {
          cards: await mapCardSearchRows(rows),
          totalCount,
          page,
          pageSize,
          sort,
          totalPages: Math.ceil(totalCount / pageSize),
        };
      }

      const rows = await measureDbQuery(
        "db.set_cards_rows",
        () =>
          db
            .select({ card: cards, set: cardSets })
            .from(cards)
            .innerJoin(cardSets, eq(cards.setId, cardSets.id))
            .where(whereSet)
            .orderBy(...tieBreakSort)
            .limit(pageSize)
            .offset(offset),
        { setId: input.setId, page, pageSize, sort },
      );

      return {
        cards: await mapCardSearchRows(rows),
        totalCount,
        page,
        pageSize,
        sort,
        totalPages: Math.ceil(totalCount / pageSize),
      };
    }
  } catch (error) {
    logError("catalog.local_set_cards.failed", error, { setId: input.setId });
  }

  return getPokemonCardsBySetPage(input);
});

export const getCatalogPokemonCardsBySet = cache(async (
  set: PokemonTcgSet,
  sort: SetCardSort = "number-asc",
): Promise<SetCardsPayload> => {
  return getCatalogPokemonCardsBySetPage({
    setId: set.id,
    page: 1,
    pageSize: Math.max(set.total, 1),
    sort,
  });
});

export const getCatalogPokemonCard = cache(async (id: string) => {
  try {
    const [localCard] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.providerId, id), eq(cards.languageCode, "en"), eq(cards.isActive, true)))
      .limit(1);

    if (localCard) {
      const card = await mapCardWithCurrentPrices(localCard);
      if (card) return card;
    }
  } catch (error) {
    logError("catalog.local_card.failed", error, { cardId: id });
  }

  return getPokemonCard(id);
});

export const getCatalogPokemonCardPriceHistory = cache(async (id: string) => {
  try {
    const rows = await db
      .select({
        printing: cardVariants.printing,
        condition: cardVariants.condition,
        amountMinor: pricePoints.amountMinor,
        observedAt: pricePoints.observedAt,
      })
      .from(pricePoints)
      .innerJoin(cardVariants, eq(pricePoints.cardVariantId, cardVariants.id))
      .innerJoin(cards, eq(cardVariants.cardId, cards.id))
      .where(
        and(
          eq(cards.providerId, id),
          eq(cards.languageCode, "en"),
          eq(cardVariants.languageCode, "en"),
          eq(cardVariants.condition, "unspecified"),
          eq(pricePoints.source, "tcgcsv"),
          eq(pricePoints.priceType, "market"),
          eq(pricePoints.currency, "USD"),
        ),
      )
      .orderBy(asc(cardVariants.printing), asc(cardVariants.condition), asc(pricePoints.observedAt));
    const currentRows = await db
      .select({
        printing: cardVariants.printing,
        condition: cardVariants.condition,
        amountMinor: currentPrices.amountMinor,
        observedAt: currentPrices.observedAt,
      })
      .from(currentPrices)
      .innerJoin(cardVariants, eq(currentPrices.cardVariantId, cardVariants.id))
      .innerJoin(cards, eq(cardVariants.cardId, cards.id))
      .where(
        and(
          eq(cards.providerId, id),
          eq(cards.languageCode, "en"),
          eq(cardVariants.languageCode, "en"),
          eq(cardVariants.condition, "unspecified"),
          eq(currentPrices.source, "tcgcsv"),
          eq(currentPrices.priceType, "market"),
          eq(currentPrices.currency, "USD"),
        ),
      );

    const seriesByVariant = new Map<string, CardPriceHistoryPoint[]>();

    for (const row of rows) {
      const key = `${row.printing}:${row.condition}`;
      const points = seriesByVariant.get(key) ?? [];
      points.push({
        observedAt: row.observedAt.toISOString(),
        amountUsd: row.amountMinor / 100,
      });
      seriesByVariant.set(key, points);
    }

    for (const row of currentRows) {
      const key = `${row.printing}:${row.condition}`;
      const points = seriesByVariant.get(key) ?? [];
      const latestPoint = points.at(-1);
      const latestPointTime = latestPoint ? new Date(latestPoint.observedAt).getTime() : 0;
      const currentObservedAt = row.observedAt.toISOString();

      if (!latestPoint || row.observedAt.getTime() > latestPointTime) {
        points.push({
          observedAt: currentObservedAt,
          amountUsd: row.amountMinor / 100,
        });
        seriesByVariant.set(key, points);
      }
    }

    return Array.from(seriesByVariant, ([key, points]) => {
      const [printing, condition] = key.split(":");

      return {
        printing,
        condition,
        label: `${formatPrinting(printing)} - ${formatCondition(condition)}`,
        points,
      };
    });
  } catch (error) {
    logError("catalog.local_card_price_history.failed", error, { cardId: id });
    return [];
  }
});

export async function searchCatalogPokemonCards(input: {
  query: string;
  mode?: "search" | "suggest";
  page?: number;
  pageSize?: number;
  sort?: SearchCardSort;
}): Promise<CardSearchPayload> {
  const parsedQuery = parseCardSearchQuery(input.query);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? (input.mode === "suggest" ? 6 : 20);
  const sort = input.mode === "suggest" ? "relevance" : input.sort ?? "relevance";
  const nameTokens = parsedQuery.name ? tokenizeSearchName(parsedQuery.name) : [];
  const normalizedNumber = parsedQuery.number ? normalizeCardNumber(parsedQuery.number) : null;

  if ((!parsedQuery.name || nameTokens.length === 0) && !parsedQuery.number) {
    return {
      cards: [],
      totalCount: 0,
      matchType: "closest",
      parsedQuery,
      page,
      pageSize,
      sort,
      totalPages: 0,
    };
  }

  try {
    let localResult = await queryLocalSearchPage({
      name: parsedQuery.name,
      nameTokens,
      normalizedNumber,
      strategy: "phrase",
      page,
      pageSize,
      sort,
    });

    if (localResult.totalCount === 0 && nameTokens.length > 0) {
      localResult = await queryLocalSearchPage({
        name: parsedQuery.name,
        nameTokens,
        normalizedNumber,
        strategy: "tokens",
        page,
        pageSize,
        sort,
      });
    }

    if (input.mode === "suggest" && localResult.totalCount > 0) {
      return {
        cards: await mapCardSearchRows(localResult.rows),
        totalCount: localResult.totalCount,
        matchType: "suggestions",
        parsedQuery,
        page,
        pageSize,
        sort,
        totalPages: Math.ceil(localResult.totalCount / pageSize),
      };
    }

    if (localResult.totalCount > 0) {
      return {
        cards: await mapCardSearchRows(localResult.rows),
        totalCount: localResult.totalCount,
        matchType: "matches",
        parsedQuery,
        page,
        pageSize,
        sort,
        totalPages: Math.ceil(localResult.totalCount / pageSize),
      };
    }

    if (parsedQuery.name) {
      const closestResult = await queryLocalClosestMatches({
        name: parsedQuery.name,
        normalizedNumber,
        page,
        pageSize,
        sort,
      });

      if (closestResult.totalCount > 0) {
        return {
          cards: await mapCardSearchRows(closestResult.rows),
          totalCount: closestResult.totalCount,
          matchType: "closest",
          parsedQuery,
          page,
          pageSize,
          sort,
          totalPages: Math.ceil(closestResult.totalCount / pageSize),
        };
      }
    }
  } catch (error) {
    logError("catalog.local_card_search.failed", error);
  }

  return searchPokemonCards(input);
}
