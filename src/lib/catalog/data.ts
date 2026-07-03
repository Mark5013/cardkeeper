import "server-only";

import { cache } from "react";
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { cards, cardSets } from "@/db/schema";
import {
  getPokemonCard,
  getPokemonCardsBySetPage,
  getPokemonSet,
  getPokemonSets,
  levenshtein,
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
    startingPriceUsd: providerCard ? getStartingMarketPrice(providerCard) : null,
    priceUpdatedAt: providerCard?.tcgplayer?.updatedAt ?? null,
  };
}

function mapCard(row: typeof cards.$inferSelect): PokemonTcgCard | null {
  const providerCard = row.providerData as unknown as PokemonTcgCard | null;

  return providerCard?.id ? providerCard : null;
}

function rankClosestCards(cardsToRank: CardSearchResult[], query: string) {
  return [...cardsToRank].sort(
    (left, right) =>
      levenshtein(normalize(query), normalize(left.name)) -
        levenshtein(normalize(query), normalize(right.name)) ||
      left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
      left.number.localeCompare(right.number, "en", { numeric: true }),
  );
}

function paginateCards(input: {
  cards: CardSearchResult[];
  page: number;
  pageSize: number;
  matchType: CardSearchPayload["matchType"];
  parsedQuery: CardSearchPayload["parsedQuery"];
}): CardSearchPayload {
  const start = (input.page - 1) * input.pageSize;
  const pageCards = input.cards.slice(start, start + input.pageSize);

  return {
    cards: pageCards,
    totalCount: input.cards.length,
    matchType: input.matchType,
    parsedQuery: input.parsedQuery,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(input.cards.length / input.pageSize),
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
}): Promise<SetCardsPayload> => {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 250;
  const offset = (page - 1) * pageSize;

  try {
    const whereSet = and(eq(cardSets.providerId, input.setId), eq(cards.languageCode, "en"));
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
        .where(whereSet)
        .orderBy(
          sql`case when ${cards.number} ~ '^[0-9]+' then substring(${cards.number} from '^[0-9]+')::integer else null end asc nulls last`,
          asc(cards.number),
          asc(cards.name),
          asc(cards.providerId),
        )
        .limit(pageSize)
        .offset(offset);

      return {
        cards: rows.map(mapCardSearchResult),
        totalCount,
        page,
        pageSize,
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
): Promise<SetCardsPayload> => {
  return getCatalogPokemonCardsBySetPage({
    setId: set.id,
    page: 1,
    pageSize: Math.max(set.total, 1),
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
      const card = mapCard(localCard);
      if (card) return card;
    }
  } catch (error) {
    console.error("Local card lookup failed, falling back to provider", { cardId: id, error });
  }

  return getPokemonCard(id);
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
        cards: localResult.rows.map(mapCardSearchResult),
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
        cards: localResult.rows.map(mapCardSearchResult),
        totalCount: localResult.totalCount,
        matchType: "matches",
        parsedQuery,
        page,
        pageSize,
        totalPages: Math.ceil(localResult.totalCount / pageSize),
      };
    }

    if (parsedQuery.name) {
      const relaxedToken = tokenizeSearchName(parsedQuery.name)
        .sort((left, right) => right.length - left.length)[0];

      if (relaxedToken) {
        const relaxedRows = await db
          .select({ card: cards, set: cardSets })
          .from(cards)
          .innerJoin(cardSets, eq(cards.setId, cardSets.id))
          .where(
            and(eq(cards.languageCode, "en"), sql`lower(${cards.name}) like ${`${relaxedToken.slice(0, 3)}%`}`),
          )
          .orderBy(asc(cards.name), asc(cards.number), asc(cards.providerId))
          .limit(250);
        const closestCards = rankClosestCards(relaxedRows.map(mapCardSearchResult), parsedQuery.name);

        return paginateCards({
          cards: closestCards,
          page,
          pageSize,
          matchType: "closest",
          parsedQuery,
        });
      }
    }
  } catch (error) {
    console.error("Local card search failed, falling back to provider", error);
  }

  return searchPokemonCards(input);
}
