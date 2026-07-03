import "server-only";

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

type CollectionRow = {
  id: string;
  card_variant_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
  card_variants: {
    id: string;
    printing: string;
    condition: string;
    cards: {
      provider_id: string;
      name: string;
      number: string;
      image_small_url: string | null;
      provider_data: Record<string, unknown> | null;
      card_sets: {
        provider_id: string;
        name: string;
      } | null;
    } | null;
  } | null;
};

type CollectionPageInput = {
  page?: number;
  pageSize?: number;
};

const DEFAULT_COLLECTION_PAGE_SIZE = 24;

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

  const supabase = await createClient();
  const { page, pageSize } = normalizeCollectionPage(input);
  const from = pageSize === null ? null : (page - 1) * pageSize;
  const to = pageSize === null || from === null ? null : from + pageSize - 1;
  let query = supabase
    .from("collection_items")
    .select(
      `
        id,
        card_variant_id,
        quantity,
        created_at,
        updated_at,
        card_variants (
          id,
          printing,
          condition,
          cards (
            provider_id,
            name,
            number,
            image_small_url,
            provider_data,
            card_sets (
              provider_id,
              name
            )
          )
        )
      `,
      { count: "exact" },
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (from !== null && to !== null) {
    query = query.range(from, to);
  }

  const { data, error, count } = await query.returns<CollectionRow[]>();

  if (error) {
    console.error("Failed to load collection", { code: error.code });
    throw new Error("Unable to load the collection.");
  }

  if (data.length === 0) {
    return emptyCollectionSummary({ page, pageSize });
  }

  const items = data.flatMap((item) => {
    const variant = item.card_variants;
    const card = variant?.cards;
    const set = card?.card_sets;
    if (!variant || !card || !set) return [];

    const providerCard = card.provider_data as unknown as PokemonTcgCard | null;
    const price = providerCard
      ? getCardPrintingOptions(providerCard).find((option) => option.value === variant.printing)?.price
      : null;
    const unitPriceUsd = price?.market ?? price?.mid ?? price?.low ?? null;
    const estimatedValueUsd =
      unitPriceUsd === null ? null : (Math.round(unitPriceUsd * 100) * item.quantity) / 100;

    return [
      {
        id: item.id,
        cardVariantId: item.card_variant_id,
        providerCardId: card.provider_id,
        cardName: card.name,
        cardNumber: card.number,
        providerSetId: set.provider_id,
        setName: set.name,
        imageSmallUrl: card.image_small_url,
        printing: variant.printing,
        condition: variant.condition,
        quantity: item.quantity,
        unitPriceUsd,
        estimatedValueUsd,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      },
    ];
  });

  const totalItems = count ?? items.length;
  const effectivePageSize = pageSize ?? Math.max(totalItems, DEFAULT_COLLECTION_PAGE_SIZE);

  return {
    items,
    uniqueCards: new Set(items.map((item) => item.providerCardId)).size,
    uniqueVariants: items.length,
    totalCopies: items.reduce((total, item) => total + item.quantity, 0),
    estimatedValueUsd: items.reduce(
      (total, item) => total + (item.estimatedValueUsd ?? 0),
      0,
    ),
    unpricedVariants: items.filter((item) => item.unitPriceUsd === null).length,
    page,
    pageSize: effectivePageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / effectivePageSize),
    hasNextPage: page * effectivePageSize < totalItems,
  };
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
