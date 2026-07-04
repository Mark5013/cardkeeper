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
import { formatPrinting } from "@/lib/pokemon-tcg/printing";
import type { SetCardSort } from "@/lib/catalog/set-card-sort";

export type CardPriceHistoryPoint = {
  observedAt: string;
  amountUsd: number;
};

export type CardPriceHistorySeries = {
  printing: string;
  label: string;
  points: CardPriceHistoryPoint[];
};

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
    updatedAt: row.updatedAt.toISOString(),
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
  const conditions = [eq(cards.languageCode, "en")];

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
}) {
  const whereSearch = localSearchConditions(input);
  const offset = (input.page - 1) * input.pageSize;
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(cards)
    .innerJoin(cardSets, eq(cards.setId, cardSets.id))
    .where(whereSearch);
  const totalCount = totalRow?.count ?? 0;

  if (totalCount === 0) {
    return { rows: [], totalCount };
  }

  const rows = await db
    .select({ card: cards, set: cardSets })
    .from(cards)
    .innerJoin(cardSets, eq(cards.setId, cardSets.id))
    .where(whereSearch)
    .orderBy(
      asc(cards.name),
      sql`case when ${cards.number} ~ '^[0-9]+' then substring(${cards.number} from '^[0-9]+')::integer else null end asc nulls last`,
      asc(cards.number),
      asc(cards.providerId),
    )
    .limit(input.pageSize)
    .offset(offset);

  return { rows, totalCount };
}

async function queryLocalClosestMatches(input: {
  name: string;
  normalizedNumber: string | null;
  page: number;
  pageSize: number;
}) {
  const normalizedName = normalizeSearchText(input.name);
  const offset = (input.page - 1) * input.pageSize;
  const similarityScore = sql<number>`greatest(
    similarity(${normalizedCardNameSql()}, ${normalizedName}),
    word_similarity(${normalizedCardNameSql()}, ${normalizedName})
  )`;
  const whereClosest = and(
    eq(cards.languageCode, "en"),
    input.normalizedNumber ? sql`lower(${cards.number}) = ${input.normalizedNumber}` : undefined,
    sql`${normalizedCardNameSql()} % ${normalizedName}`,
  );

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(cards)
    .innerJoin(cardSets, eq(cards.setId, cardSets.id))
    .where(whereClosest);
  const totalCount = totalRow?.count ?? 0;

  if (totalCount === 0) {
    return { rows: [], totalCount };
  }

  const rows = await db
    .select({ card: cards, set: cardSets })
    .from(cards)
    .innerJoin(cardSets, eq(cards.setId, cardSets.id))
    .where(whereClosest)
    .orderBy(
      sql`${similarityScore} desc`,
      asc(cards.name),
      sql`case when ${cards.number} ~ '^[0-9]+' then substring(${cards.number} from '^[0-9]+')::integer else null end asc nulls last`,
      asc(cards.number),
      asc(cards.providerId),
    )
    .limit(input.pageSize)
    .offset(offset);

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
  const pricesByCardId = new Map<string, number>();

  if (uniqueCardIds.length === 0) return pricesByCardId;

  const priceRows = await db
    .select({
      cardId: cardVariants.cardId,
      amountMinor: currentPrices.amountMinor,
    })
    .from(currentPrices)
    .innerJoin(cardVariants, eq(currentPrices.cardVariantId, cardVariants.id))
    .where(
      and(
        eq(currentPrices.source, "tcgcsv"),
        eq(currentPrices.priceType, "market"),
        eq(currentPrices.currency, "USD"),
        inArray(cardVariants.cardId, uniqueCardIds),
      ),
    );

  for (const row of priceRows) {
    const amountUsd = row.amountMinor / 100;
    const existingAmount = pricesByCardId.get(row.cardId);

    if (existingAmount === undefined || amountUsd < existingAmount) {
      pricesByCardId.set(row.cardId, amountUsd);
    }
  }

  return pricesByCardId;
}

function currentMarketPriceByCardSubquery() {
  return db
    .select({
      cardId: cardVariants.cardId,
      amountMinor: sql<number>`min(${currentPrices.amountMinor})`.as("amount_minor"),
    })
    .from(currentPrices)
    .innerJoin(cardVariants, eq(currentPrices.cardVariantId, cardVariants.id))
    .where(
      and(
        eq(currentPrices.source, "tcgcsv"),
        eq(currentPrices.priceType, "market"),
        eq(currentPrices.currency, "USD"),
        eq(cardVariants.languageCode, "en"),
      ),
    )
    .groupBy(cardVariants.cardId)
    .as("current_market_price_by_card");
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
      .where(eq(cardSets.languageCode, "en"))
      .orderBy(sql`${cardSets.releaseDate} desc nulls last`, asc(cardSets.name));

    if (localSets.length > 0) {
      return localSets.map(mapSet);
    }
  } catch (error) {
    console.error("Local set catalog failed, falling back to provider", error);
  }

  return getPokemonSets();
});

export const getCatalogPokemonSet = cache(async (id: string) => {
  try {
    const [localSet] = await db
      .select()
      .from(cardSets)
      .where(and(eq(cardSets.providerId, id), eq(cardSets.languageCode, "en")))
      .limit(1);

    if (localSet) {
      return mapSet(localSet);
    }
  } catch (error) {
    console.error("Local set lookup failed, falling back to provider", { setId: id, error });
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
    const whereSet = and(eq(cardSets.providerId, input.setId), eq(cards.languageCode, "en"));
    const currentMarketPriceByCard = currentMarketPriceByCardSubquery();
    const numberSort = sql`case when ${cards.number} ~ '^[0-9]+' then substring(${cards.number} from '^[0-9]+')::integer else null end asc nulls last`;
    const tieBreakSort = [numberSort, asc(cards.number), asc(cards.name), asc(cards.providerId)];
    const orderBy =
      sort === "price-desc"
        ? [
            sql`case when ${currentMarketPriceByCard.amountMinor} is null then 1 else 0 end`,
            desc(currentMarketPriceByCard.amountMinor),
            ...tieBreakSort,
          ]
        : sort === "price-asc"
          ? [
              sql`case when ${currentMarketPriceByCard.amountMinor} is null then 1 else 0 end`,
              asc(currentMarketPriceByCard.amountMinor),
              ...tieBreakSort,
            ]
          : tieBreakSort;
    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::integer` })
      .from(cards)
      .innerJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(whereSet);

    const totalCount = totalRow?.count ?? 0;

    if (totalCount > 0) {
      const rows = await db
        .select({ card: cards, set: cardSets })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .leftJoin(currentMarketPriceByCard, eq(currentMarketPriceByCard.cardId, cards.id))
        .where(whereSet)
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset(offset);

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
    console.error("Local set cards failed, falling back to provider", {
      setId: input.setId,
      error,
    });
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
      .where(and(eq(cards.providerId, id), eq(cards.languageCode, "en")))
      .limit(1);

    if (localCard) {
      const card = await mapCardWithCurrentPrices(localCard);
      if (card) return card;
    }
  } catch (error) {
    console.error("Local card lookup failed, falling back to provider", { cardId: id, error });
  }

  return getPokemonCard(id);
});

export const getCatalogPokemonCardPriceHistory = cache(async (id: string) => {
  try {
    const rows = await db
      .select({
        printing: cardVariants.printing,
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
          eq(cardVariants.condition, "unspecified"),
          eq(cardVariants.languageCode, "en"),
          eq(pricePoints.source, "tcgcsv"),
          eq(pricePoints.priceType, "market"),
          eq(pricePoints.currency, "USD"),
        ),
      )
      .orderBy(asc(cardVariants.printing), asc(pricePoints.observedAt));

    const seriesByPrinting = new Map<string, CardPriceHistoryPoint[]>();

    for (const row of rows) {
      const points = seriesByPrinting.get(row.printing) ?? [];
      points.push({
        observedAt: row.observedAt.toISOString(),
        amountUsd: row.amountMinor / 100,
      });
      seriesByPrinting.set(row.printing, points);
    }

    return Array.from(seriesByPrinting, ([printing, points]) => ({
      printing,
      label: formatPrinting(printing),
      points,
    }));
  } catch (error) {
    console.error("Local card price history failed", { cardId: id, error });
    return [];
  }
});

export async function searchCatalogPokemonCards(input: {
  query: string;
  mode?: "search" | "suggest";
  page?: number;
  pageSize?: number;
}): Promise<CardSearchPayload> {
  const parsedQuery = parseCardSearchQuery(input.query);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? (input.mode === "suggest" ? 6 : 20);
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
    });

    if (localResult.totalCount === 0 && nameTokens.length > 0) {
      localResult = await queryLocalSearchPage({
        name: parsedQuery.name,
        nameTokens,
        normalizedNumber,
        strategy: "tokens",
        page,
        pageSize,
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
        totalPages: Math.ceil(localResult.totalCount / pageSize),
      };
    }

    if (parsedQuery.name) {
      const closestResult = await queryLocalClosestMatches({
        name: parsedQuery.name,
        normalizedNumber,
        page,
        pageSize,
      });

      if (closestResult.totalCount > 0) {
        return {
          cards: await mapCardSearchRows(closestResult.rows),
          totalCount: closestResult.totalCount,
          matchType: "closest",
          parsedQuery,
          page,
          pageSize,
          totalPages: Math.ceil(closestResult.totalCount / pageSize),
        };
      }
    }
  } catch (error) {
    console.error("Local card search failed, falling back to provider", error);
  }

  return searchPokemonCards(input);
}
