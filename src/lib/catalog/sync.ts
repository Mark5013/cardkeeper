import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { cardSets, cards, cardVariants } from "@/db/schema";
import { resolveCardVariant } from "@/lib/catalog/variant-resolution";
import type { CardCondition } from "@/lib/collection/options";
import { logInfo } from "@/lib/observability";
import type { PokemonTcgCard } from "@/lib/pokemon-tcg/types";

type EnsureCardVariantInput = {
  card: PokemonTcgCard;
  catalogSource: "local" | "provider";
  printing: string;
  condition: CardCondition;
};

const languageCode = "en";

export async function ensureCardVariant(input: EnsureCardVariantInput) {
  const startedAt = performance.now();
  const resolution = await resolveCardVariant({
    catalogSource: input.catalogSource,
    findLocalCardAndVariant: () => findLocalCardAndVariant(input),
    insertVariant: (cardId) => insertVariant(cardId, input),
    findVariant: (cardId) => findVariant(cardId, input),
    createCatalogFallback: () => createCatalogCardAndVariant(input),
  });

  logInfo("catalog.card_variant.resolved", {
    cardId: input.card.id,
    catalogSource: input.catalogSource,
    condition: input.condition,
    durationMs: Math.round(performance.now() - startedAt),
    path: resolution.path,
    printing: input.printing,
  });

  return resolution.id;
}

async function findLocalCardAndVariant(input: EnsureCardVariantInput) {
  const [local] = await db
    .select({
      cardId: cards.id,
      variantId: cardVariants.id,
    })
    .from(cards)
    .leftJoin(
      cardVariants,
      and(
        eq(cardVariants.cardId, cards.id),
        eq(cardVariants.printing, input.printing),
        eq(cardVariants.condition, input.condition),
        eq(cardVariants.languageCode, languageCode),
      ),
    )
    .where(
      and(
        eq(cards.providerId, input.card.id),
        eq(cards.languageCode, languageCode),
        eq(cards.isActive, true),
      ),
    )
    .limit(1);

  return local ?? null;
}

async function insertVariant(cardId: string, input: EnsureCardVariantInput) {
  const [variant] = await db
    .insert(cardVariants)
    .values({
      cardId,
      printing: input.printing,
      condition: input.condition,
      languageCode,
    })
    .onConflictDoNothing({
      target: [
        cardVariants.cardId,
        cardVariants.printing,
        cardVariants.condition,
        cardVariants.languageCode,
      ],
    })
    .returning({ id: cardVariants.id });

  return variant?.id ?? null;
}

async function findVariant(cardId: string, input: EnsureCardVariantInput) {
  const [variant] = await db
    .select({ id: cardVariants.id })
    .from(cardVariants)
    .where(
      and(
        eq(cardVariants.cardId, cardId),
        eq(cardVariants.printing, input.printing),
        eq(cardVariants.condition, input.condition),
        eq(cardVariants.languageCode, languageCode),
      ),
    )
    .limit(1);

  return variant?.id ?? null;
}

async function createCatalogCardAndVariant(input: EnsureCardVariantInput) {
  const now = new Date();
  const providerUpdatedAt = parseProviderTimestamp(input.card.set.updatedAt);

  return db.transaction(async (transaction) => {
    const [set] = await transaction
      .insert(cardSets)
      .values({
        providerId: input.card.set.id,
        languageCode,
        name: input.card.set.name,
        series: input.card.set.series,
        printedTotal: input.card.set.printedTotal,
        total: input.card.set.total,
        releaseDate: input.card.set.releaseDate,
        providerUpdatedAt,
        lastImportedAt: now,
        isActive: true,
        symbolUrl: input.card.set.images?.symbol,
        logoUrl: input.card.set.images?.logo,
      })
      .onConflictDoUpdate({
        target: [cardSets.providerId, cardSets.languageCode],
        set: {
          name: input.card.set.name,
          series: input.card.set.series,
          printedTotal: input.card.set.printedTotal,
          total: input.card.set.total,
          releaseDate: input.card.set.releaseDate,
          providerUpdatedAt,
          lastImportedAt: now,
          isActive: true,
          symbolUrl: input.card.set.images?.symbol,
          logoUrl: input.card.set.images?.logo,
          updatedAt: now,
        },
      })
      .returning({ id: cardSets.id });

    const [card] = await transaction
      .insert(cards)
      .values({
        providerId: input.card.id,
        setId: set.id,
        languageCode,
        name: input.card.name,
        number: input.card.number,
        supertype: input.card.supertype,
        subtypes: input.card.subtypes,
        rarity: input.card.rarity,
        artist: input.card.artist,
        imageSmallUrl: input.card.images.small,
        imageLargeUrl: input.card.images.large,
        lastImportedAt: now,
        isActive: true,
        providerData: input.card as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [cards.providerId, cards.languageCode],
        set: {
          setId: set.id,
          name: input.card.name,
          number: input.card.number,
          supertype: input.card.supertype,
          subtypes: input.card.subtypes,
          rarity: input.card.rarity,
          artist: input.card.artist,
          imageSmallUrl: input.card.images.small,
          imageLargeUrl: input.card.images.large,
          lastImportedAt: now,
          isActive: true,
          providerData: input.card as unknown as Record<string, unknown>,
          updatedAt: now,
        },
      })
      .returning({ id: cards.id });

    const [insertedVariant] = await transaction
      .insert(cardVariants)
      .values({
        cardId: card.id,
        printing: input.printing,
        condition: input.condition,
        languageCode,
      })
      .onConflictDoNothing({
        target: [
          cardVariants.cardId,
          cardVariants.printing,
          cardVariants.condition,
          cardVariants.languageCode,
        ],
      })
      .returning({ id: cardVariants.id });

    if (insertedVariant) return insertedVariant.id;

    const [existingVariant] = await transaction
      .select({ id: cardVariants.id })
      .from(cardVariants)
      .where(
        and(
          eq(cardVariants.cardId, card.id),
          eq(cardVariants.printing, input.printing),
          eq(cardVariants.condition, input.condition),
          eq(cardVariants.languageCode, languageCode),
        ),
      )
      .limit(1);

    if (!existingVariant) throw new Error("Unable to create card variant.");

    return existingVariant.id;
  });
}

function parseProviderTimestamp(value: string | undefined) {
  if (!value) return null;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
