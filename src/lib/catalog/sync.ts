import "server-only";

import { db } from "@/db";
import { cardSets, cards, cardVariants } from "@/db/schema";
import type { CardCondition } from "@/lib/collection/options";
import type { PokemonTcgCard } from "@/lib/pokemon-tcg/types";

export async function ensureCardVariant(input: {
  card: PokemonTcgCard;
  printing: string;
  condition: CardCondition;
}) {
  const now = new Date();

  return db.transaction(async (transaction) => {
    const [set] = await transaction
      .insert(cardSets)
      .values({
        providerId: input.card.set.id,
        languageCode: "en",
        name: input.card.set.name,
        series: input.card.set.series,
        printedTotal: input.card.set.printedTotal,
        total: input.card.set.total,
        releaseDate: input.card.set.releaseDate,
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
        languageCode: "en",
        name: input.card.name,
        number: input.card.number,
        supertype: input.card.supertype,
        subtypes: input.card.subtypes,
        rarity: input.card.rarity,
        artist: input.card.artist,
        imageSmallUrl: input.card.images.small,
        imageLargeUrl: input.card.images.large,
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
          providerData: input.card as unknown as Record<string, unknown>,
          updatedAt: now,
        },
      })
      .returning({ id: cards.id });

    const [variant] = await transaction
      .insert(cardVariants)
      .values({
        cardId: card.id,
        printing: input.printing,
        condition: input.condition,
        languageCode: "en",
      })
      .onConflictDoUpdate({
        target: [
          cardVariants.cardId,
          cardVariants.printing,
          cardVariants.condition,
          cardVariants.languageCode,
        ],
        set: { updatedAt: now },
      })
      .returning({ id: cardVariants.id });

    if (!variant) throw new Error("Unable to create card variant.");

    return variant.id;
  });
}
