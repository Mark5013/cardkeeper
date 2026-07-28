export const TCGCSV_PRODUCT_CATEGORIES = Object.freeze({
  3: Object.freeze({ categoryId: 3, languageCode: "en", importCards: false }),
  85: Object.freeze({ categoryId: 85, languageCode: "ja", importCards: true }),
});

const DIGITAL_PRODUCT_PATTERN =
  /\b(code card|online code|digital code|ptcgo|pokemon tcg live)\b/i;

export function getExtendedDataValue(product, name) {
  const entry = product?.extendedData?.find(
    (candidate) => candidate?.name === name,
  );
  return typeof entry?.value === "string" ? entry.value.trim() : "";
}

export function classifyTcgcsvProduct(product) {
  const number = getExtendedDataValue(product, "Number");
  const rarity = getExtendedDataValue(product, "Rarity");
  const cardText = getExtendedDataValue(product, "CardText");
  const searchable = `${product?.name ?? ""} ${rarity} ${cardText}`;

  if (DIGITAL_PRODUCT_PATTERN.test(searchable)) return "excluded";
  if (
    number ||
    rarity ||
    getExtendedDataValue(product, "HP") ||
    getExtendedDataValue(product, "Stage") ||
    getExtendedDataValue(product, "CardType")
  ) {
    return "card";
  }
  return "sealed";
}

export function normalizeTcgcsvPrinting(value) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  return normalized || "normal";
}

export function getJapaneseProviderSetId(groupId) {
  return `tcgplayer-85-${groupId}`;
}

export function getJapaneseProviderCardId(productId) {
  return `tcgplayer-85-${productId}`;
}

export function getCardNumber(product) {
  return (
    getExtendedDataValue(product, "Number") ||
    `Unnumbered-${product.productId}`
  );
}

export function getCardNumberDenominator(number) {
  const match = String(number).match(/\/\s*(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

export function getCardSupertype(product) {
  const stage = getExtendedDataValue(product, "Stage");
  const cardType = getExtendedDataValue(product, "CardType");

  if (stage || getExtendedDataValue(product, "HP")) return "Pokémon";
  if (/energy/i.test(cardType) || /\benergy\b/i.test(product?.name ?? "")) {
    return "Energy";
  }
  if (/trainer/i.test(cardType)) return "Trainer";
  return "Pokémon card";
}

export function getCardSubtypes(product) {
  const stage = getExtendedDataValue(product, "Stage");
  return stage ? [stage] : [];
}

export function getCardTypes(product) {
  const cardType = getExtendedDataValue(product, "CardType");
  if (!cardType || /trainer|energy/i.test(cardType)) return [];
  return [cardType];
}

export function buildPriceRows(prices) {
  const fields = [
    ["low", "lowPrice"],
    ["mid", "midPrice"],
    ["high", "highPrice"],
    ["market", "marketPrice"],
    ["direct_low", "directLowPrice"],
  ];

  return fields.flatMap(([priceType, field]) => {
    const value = prices?.[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return [];
    }

    return [{ priceType, amountMinor: Math.round(value * 100) }];
  });
}

export function groupPricesByProduct(prices) {
  const grouped = new Map();

  for (const price of prices ?? []) {
    const productId = String(price.productId);
    const rows = grouped.get(productId) ?? [];
    rows.push(price);
    grouped.set(productId, rows);
  }

  return grouped;
}

export function buildProviderCard({ group, product, productPrices, observedAt }) {
  const providerSetId = getJapaneseProviderSetId(group.groupId);
  const providerCardId = getJapaneseProviderCardId(product.productId);
  const number = getCardNumber(product);
  const prices = Object.fromEntries(
    productPrices.map((row) => [
      normalizeTcgcsvPrinting(row.subTypeName),
      Object.fromEntries(
        buildPriceRows(row).map(({ priceType, amountMinor }) => [
          priceType === "direct_low" ? "directLow" : priceType,
          amountMinor / 100,
        ]),
      ),
    ]),
  );
  const imageUrl = product.imageUrl ?? "";

  return {
    id: providerCardId,
    name: product.name,
    number,
    rarity: getExtendedDataValue(product, "Rarity") || undefined,
    supertype: getCardSupertype(product),
    subtypes: getCardSubtypes(product),
    hp: getExtendedDataValue(product, "HP") || undefined,
    types: getCardTypes(product),
    images: {
      small: imageUrl,
      large: imageUrl,
    },
    languageCode: "ja",
    set: {
      id: providerSetId,
      languageCode: "ja",
      name: group.name,
      series: "Pokémon Japan",
      releaseDate: group.publishedOn?.slice(0, 10) ?? "",
      updatedAt: group.modifiedOn ?? observedAt.toISOString(),
    },
    tcgplayer: {
      url: product.url ?? "",
      updatedAt: observedAt.toISOString().slice(0, 10),
      prices,
    },
    tcgcsv: product,
  };
}
