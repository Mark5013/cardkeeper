import type { PokemonTcgCard, PokemonTcgPrice } from "./types";

export type CardPrintingOption = {
  value: string;
  label: string;
  price: PokemonTcgPrice | null;
};

export function normalizePrinting(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function formatPrinting(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatCardPrinting(value: string, providerSetId?: string) {
  const normalizedValue = normalizePrinting(value);
  const qualifiedLabels: Record<string, string> = {
    cosmos_holofoil: "Cosmos Holofoil",
    holiday_calendar_holofoil: "Holiday Calendar Holofoil",
    master_ball_holofoil: "Master Ball Pattern",
    pokemon_center_holofoil: "Pokémon Center Holofoil",
    poke_ball_holofoil: "Poké Ball Pattern",
    prerelease_holofoil: "Prerelease Holofoil",
    prerelease_staff_holofoil: "Prerelease Staff Holofoil",
    staff_holofoil: "Staff Holofoil",
    world_championships_normal: "World Championships",
    world_championships_staff_normal: "World Championships Staff",
  };

  if (qualifiedLabels[normalizedValue]) {
    return qualifiedLabels[normalizedValue];
  }

  if (providerSetId === "base1") {
    const shadowlessLabels: Record<string, string> = {
      "1st_edition": "1st Edition Shadowless",
      "1st_edition_holofoil": "1st Edition Shadowless Holofoil",
      unlimited: "Shadowless",
      unlimited_holofoil: "Shadowless Holofoil",
    };

    return shadowlessLabels[normalizedValue] ?? formatPrinting(normalizedValue);
  }

  return formatPrinting(normalizedValue);
}

export function getQualifiedPrintingSourcePrinting(value: string) {
  const printing = normalizePrinting(value);

  if (printing.endsWith("_holofoil")) return "holofoil";
  if (printing.endsWith("_normal")) return "normal";

  return printing;
}

export function getCardPrintingOptions(card: PokemonTcgCard): CardPrintingOption[] {
  const prices = Object.entries(card.tcgplayer?.prices ?? {});

  if (prices.length === 0) {
    return [{ value: "normal", label: "Normal", price: null }];
  }

  return prices.map(([printing, price]) => {
    const value = normalizePrinting(printing);
    return { value, label: formatCardPrinting(value, card.set.id), price };
  });
}
