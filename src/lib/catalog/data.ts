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
} from "@/lib/pokemon-tcg/client";
import type {
  CardSearchResult,
  PokemonTcgCard,
  PokemonTcgPrice,
  PokemonTcgSet,
  SetCardsPayload,
} from "@/lib/pokemon-tcg/types";

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
