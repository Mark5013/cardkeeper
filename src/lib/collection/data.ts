import "server-only";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { cards, cardSets, cardVariants, collectionItems, currentPrices } from "@/db/schema";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getCardPrintingOptions } from "@/lib/pokemon-tcg/printing";
import type { PokemonTcgCard } from "@/lib/pokemon-tcg/types";

import type { CollectionSummaryDto } from "./types";
import type { OwnedCardVariantDto } from "./types";

type SetProgressRow = {
  card_variants: {
    cards: {
      provider_id: string;
      card_sets: {
        provider_id: string;
      } | null;
    } | null;
  } | null;
};

type CollectionPageInput = {
  page?: number;
  pageSize?: number;
  query?: string;
  setIds?: string[];
  sort?: CollectionSortOption;
};

const DEFAULT_COLLECTION_PAGE_SIZE = 24;
const COLLECTION_SORT_OPTIONS = ["created-desc", "created-asc", "price-desc", "price-asc"] as const;

export type CollectionSortOption = (typeof COLLECTION_SORT_OPTIONS)[number];

function isCollectionSortOption(value: string | undefined): value is CollectionSortOption {
  return COLLECTION_SORT_OPTIONS.some((option) => option === value);
}

export function normalizeCollectionSort(value: string | undefined): CollectionSortOption {
  return isCollectionSortOption(value) ? value : "created-desc";
}

function normalizeCollectionPage(input?: CollectionPageInput) {
  const inputPage = input?.page;
  const inputPageSize = input?.pageSize;
  const page = Number.isInteger(inputPage) && inputPage && inputPage > 0 ? inputPage : 1;
  const pageSize =
    Number.isInteger(inputPageSize) && inputPageSize && inputPageSize > 0
      ? Math.min(inputPageSize, 60)
      : null;

  return { page, pageSize };
}

function normalizeCollectionFilterText(value: string | undefined) {
  return value?.trim().slice(0, 100) ?? "";
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function emptyCollectionSummary(input?: { page?: number; pageSize?: number | null }) {
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? DEFAULT_COLLECTION_PAGE_SIZE;

  return {
    items: [],
    uniqueCards: 0,
    uniqueVariants: 0,
    totalCopies: 0,
    estimatedValueUsd: 0,
    unpricedVariants: 0,
    page,
    pageSize,
    totalItems: 0,
    totalPages: 0,
    hasNextPage: false,
  };
}

export async function getCurrentSetCollectionProgress(): Promise<Map<string, number> | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("collection_items")
    .select(
      `
        card_variants (
          cards (
            provider_id,
            card_sets (
              provider_id
            )
          )
        )
      `,
    )
    .eq("user_id", user.id)
    .returns<SetProgressRow[]>();

  if (error) {
    console.error("Failed to load set collection progress", { code: error.code });
    throw new Error("Unable to load set collection progress.");
  }

  if (rows.length === 0) return new Map();

  const uniqueCardIdsBySet = new Map<string, Set<string>>();

  for (const row of rows) {
    const card = row.card_variants?.cards;
    const providerSetId = card?.card_sets?.provider_id;
    const providerCardId = card?.provider_id;
    if (!providerSetId || !providerCardId) continue;

    const uniqueCardIds = uniqueCardIdsBySet.get(providerSetId) ?? new Set<string>();
    uniqueCardIds.add(providerCardId);
    uniqueCardIdsBySet.set(providerSetId, uniqueCardIds);
  }

  return new Map(
    Array.from(uniqueCardIdsBySet, ([providerSetId, uniqueCardIds]) => [
      providerSetId,
      uniqueCardIds.size,
    ]),
  );
}

export async function getCurrentCollection(
  input?: CollectionPageInput,
): Promise<CollectionSummaryDto | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const { page, pageSize } = normalizeCollectionPage(input);
  const filterText = normalizeCollectionFilterText(input?.query);
  const setIds = input?.setIds?.filter(Boolean) ?? [];
  const sort = input?.sort ?? "created-desc";
  const conditions = [eq(collectionItems.userId, user.id)];

  if (filterText.length > 0) {
    const likePattern = `%${escapeLikePattern(filterText)}%`;
    conditions.push(
      or(
        ilike(cards.name, likePattern),
        ilike(cards.number, likePattern),
        ilike(cardSets.name, likePattern),
      )!,
    );
  }

  if (setIds.length > 0) {
    conditions.push(inArray(cardSets.providerId, setIds));
  }

  const whereCollection = and(...conditions);

  let rows;

  try {
    rows = await db
      .select({
        item: collectionItems,
        variant: cardVariants,
        card: cards,
        set: cardSets,
      })
      .from(collectionItems)
      .innerJoin(cardVariants, eq(collectionItems.cardVariantId, cardVariants.id))
      .innerJoin(cards, eq(cardVariants.cardId, cards.id))
      .innerJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(whereCollection)
      .orderBy(
        sort === "created-asc" ? asc(collectionItems.createdAt) : desc(collectionItems.createdAt),
        asc(cards.name),
        sql`case when ${cards.number} ~ '^[0-9]+' then substring(${cards.number} from '^[0-9]+')::integer else null end asc nulls last`,
        asc(cards.number),
        asc(collectionItems.id),
      );
  } catch (error) {
    console.error("Failed to load collection", error);
    throw new Error("Unable to load the collection.");
  }

  if (rows.length === 0) {
    return emptyCollectionSummary({ page, pageSize });
  }

  const currentMarketPrices = await getCurrentMarketPricesByVariantId(
    rows.map(({ variant }) => variant.id),
  );
  const allItems = rows.map(({ item, variant, card, set }) => {
    const providerCard = card.providerData as unknown as PokemonTcgCard | null;
    const price = providerCard
      ? getCardPrintingOptions(providerCard).find((option) => option.value === variant.printing)?.price
      : null;
    const unitPriceUsd =
      currentMarketPrices.get(variant.id) ?? price?.market ?? price?.mid ?? price?.low ?? null;
    const estimatedValueUsd =
      unitPriceUsd === null ? null : (Math.round(unitPriceUsd * 100) * item.quantity) / 100;

    return {
      id: item.id,
      cardVariantId: item.cardVariantId,
      providerCardId: card.providerId,
      cardName: card.name,
      cardNumber: card.number,
      providerSetId: set.providerId,
      setName: set.name,
      imageSmallUrl: card.imageSmallUrl,
      printing: variant.printing,
      condition: variant.condition,
      quantity: item.quantity,
      unitPriceUsd,
      estimatedValueUsd,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  });

  const sortedItems =
    sort === "price-desc" || sort === "price-asc"
      ? [...allItems].sort((left, right) => {
          if (left.unitPriceUsd === null && right.unitPriceUsd === null) {
            return left.cardName.localeCompare(right.cardName, "en", { sensitivity: "base" });
          }
          if (left.unitPriceUsd === null) return 1;
          if (right.unitPriceUsd === null) return -1;

          const priceDelta = left.unitPriceUsd - right.unitPriceUsd;
          if (priceDelta !== 0) return sort === "price-asc" ? priceDelta : -priceDelta;
          return left.cardName.localeCompare(right.cardName, "en", { sensitivity: "base" });
        })
      : allItems;

  const totalItems = sortedItems.length;
  const effectivePageSize = pageSize ?? Math.max(totalItems, DEFAULT_COLLECTION_PAGE_SIZE);
  const pageStart = pageSize === null ? 0 : (page - 1) * effectivePageSize;
  const pageEnd = pageSize === null ? sortedItems.length : pageStart + effectivePageSize;
  const items = sortedItems.slice(pageStart, pageEnd);

  return {
    items,
    uniqueCards: new Set(sortedItems.map((item) => item.providerCardId)).size,
    uniqueVariants: sortedItems.length,
    totalCopies: sortedItems.reduce((total, item) => total + item.quantity, 0),
    estimatedValueUsd: sortedItems.reduce(
      (total, item) => total + (item.estimatedValueUsd ?? 0),
      0,
    ),
    unpricedVariants: sortedItems.filter((item) => item.unitPriceUsd === null).length,
    page,
    pageSize: effectivePageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / effectivePageSize),
    hasNextPage: page * effectivePageSize < totalItems,
  };
}

async function getCurrentMarketPricesByVariantId(variantIds: string[]) {
  const uniqueVariantIds = Array.from(new Set(variantIds));
  const pricesByVariantId = new Map<string, number>();

  if (uniqueVariantIds.length === 0) return pricesByVariantId;

  const priceRows = await db
    .select({
      cardVariantId: currentPrices.cardVariantId,
      amountMinor: currentPrices.amountMinor,
    })
    .from(currentPrices)
    .where(
      and(
        eq(currentPrices.source, "tcgcsv"),
        eq(currentPrices.priceType, "market"),
        eq(currentPrices.currency, "USD"),
        inArray(currentPrices.cardVariantId, uniqueVariantIds),
      ),
    );

  for (const row of priceRows) {
    pricesByVariantId.set(row.cardVariantId, row.amountMinor / 100);
  }

  return pricesByVariantId;
}

export async function getOwnedCardVariants(
  providerCardId: string,
): Promise<OwnedCardVariantDto[] | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("id")
    .eq("provider_id", providerCardId)
    .eq("language_code", "en")
    .maybeSingle();

  if (cardError) {
    console.error("Failed to find local card", { code: cardError.code });
    throw new Error("Unable to load collection status.");
  }

  if (!card) return [];

  const { data: variants, error: variantsError } = await supabase
    .from("card_variants")
    .select("id, printing, condition")
    .eq("card_id", card.id);

  if (variantsError) {
    console.error("Failed to load local card variants", { code: variantsError.code });
    throw new Error("Unable to load collection status.");
  }

  if (variants.length === 0) return [];

  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  const { data: items, error: itemsError } = await supabase
    .from("collection_items")
    .select("card_variant_id, quantity")
    .in("card_variant_id", variants.map((variant) => variant.id));

  if (itemsError) {
    console.error("Failed to load owned card variants", { code: itemsError.code });
    throw new Error("Unable to load collection status.");
  }

  return items.flatMap((item) => {
    const variant = variantsById.get(item.card_variant_id);
    if (!variant) return [];

    return [
      {
        variantId: variant.id,
        printing: variant.printing,
        condition: variant.condition,
        quantity: item.quantity,
      },
    ];
  });
}
