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

export function getCardPrintingOptions(card: PokemonTcgCard): CardPrintingOption[] {
  const prices = Object.entries(card.tcgplayer?.prices ?? {});

  if (prices.length === 0) {
    return [{ value: "normal", label: "Normal", price: null }];
  }

  return prices.map(([printing, price]) => {
    const value = normalizePrinting(printing);
    return { value, label: formatPrinting(value), price };
  });
}
