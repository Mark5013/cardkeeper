import "server-only";

import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getCardPrintingOptions } from "@/lib/pokemon-tcg/printing";
import type { PokemonTcgCard } from "@/lib/pokemon-tcg/types";

import type { CollectionSummaryDto } from "./types";
import type { OwnedCardVariantDto } from "./types";

export async function getCurrentCollection(): Promise<CollectionSummaryDto | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collection_items")
    .select("id, card_variant_id, quantity, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load collection", { code: error.code });
    throw new Error("Unable to load the collection.");
  }

  if (data.length === 0) {
    return {
      items: [],
      uniqueCards: 0,
      uniqueVariants: 0,
      totalCopies: 0,
      estimatedValueUsd: 0,
      unpricedVariants: 0,
    };
  }

  const { data: variants, error: variantsError } = await supabase
    .from("card_variants")
    .select("id, card_id, printing, condition")
    .in("id", data.map((item) => item.card_variant_id));

  if (variantsError) {
    console.error("Failed to load collection variants", { code: variantsError.code });
    throw new Error("Unable to load the collection.");
  }

  const { data: cards, error: cardsError } = await supabase
    .from("cards")
    .select("id, provider_id, set_id, name, number, image_small_url, provider_data")
    .in("id", variants.map((variant) => variant.card_id));

  if (cardsError) {
    console.error("Failed to load collection cards", { code: cardsError.code });
    throw new Error("Unable to load the collection.");
  }

  const { data: sets, error: setsError } = await supabase
    .from("card_sets")
    .select("id, name")
    .in("id", cards.map((card) => card.set_id));

  if (setsError) {
    console.error("Failed to load collection sets", { code: setsError.code });
    throw new Error("Unable to load the collection.");
  }

  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const setsById = new Map(sets.map((set) => [set.id, set]));

  const items = data.flatMap((item) => {
    const variant = variantsById.get(item.card_variant_id);
    const card = variant ? cardsById.get(variant.card_id) : null;
    const set = card ? setsById.get(card.set_id) : null;

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
