export const BASE_SET_PROVIDER_ID = "base1";
export const BASE_SET_SHADOWLESS_NAME = "Base Set (Shadowless)";
export const BASE_SET_UNLIMITED_PROVIDER_ID = "base1-unlimited";
export const BASE_SET_UNLIMITED_NAME = "Base Set (Unlimited)";
export const BASE_SET_TCGCSV_GROUP_ID = 604;
export const BASE_SET_SHADOWLESS_TCGCSV_GROUP_ID = 1663;

const SHADOWLESS_SUFFIX = " (Shadowless)";
const BASE_SET_PRODUCT_NAME_ALIASES = new Map([
  ["base1-8", ["Machamp - 8/102", "Machamp - 8/102 (Base Set Shadowless)"]],
  ["base1-55", ["Nidoran M"]],
  ["base1-73", ["Imposter Professor Oak"]],
]);

export function getShadowlessCardName(value) {
  const name = getBaseCardName(value);
  return `${name}${SHADOWLESS_SUFFIX}`;
}

export function getBaseCardName(value) {
  const name = String(value ?? "").trim();
  return name.endsWith(SHADOWLESS_SUFFIX) ? name.slice(0, -SHADOWLESS_SUFFIX.length) : name;
}

export function getUnlimitedCardProviderId(shadowlessProviderId) {
  return `${shadowlessProviderId}-unlimited`;
}

export function getTcgplayerHighResolutionImageUrl(imageUrl) {
  return String(imageUrl ?? "").replace(/_200w\.jpg$/i, "_in_1000x1000.jpg");
}

export function applyBaseSetSetOverrides(set) {
  if (set?.id !== BASE_SET_PROVIDER_ID) return set;
  return { ...set, name: BASE_SET_SHADOWLESS_NAME };
}

export function applyBaseSetCardOverrides(card) {
  if (card?.set?.id !== BASE_SET_PROVIDER_ID) return card;

  const nextCard = {
    ...card,
    name: getShadowlessCardName(card.name),
    set: {
      ...card.set,
      name: BASE_SET_SHADOWLESS_NAME,
    },
  };
  delete nextCard.tcgplayer;
  return nextCard;
}

export function createUnlimitedProviderCard({ shadowlessCard, product }) {
  const baseName = getBaseCardName(shadowlessCard.name);
  const smallImageUrl = String(product.imageUrl ?? "").trim();

  return {
    ...shadowlessCard,
    id: getUnlimitedCardProviderId(shadowlessCard.id),
    name: baseName,
    images: {
      small: smallImageUrl,
      large: getTcgplayerHighResolutionImageUrl(smallImageUrl),
    },
    set: {
      ...shadowlessCard.set,
      id: BASE_SET_UNLIMITED_PROVIDER_ID,
      name: BASE_SET_UNLIMITED_NAME,
    },
    tcgplayer: {
      url: product.url,
      updatedAt: "",
      prices: {},
    },
  };
}

export function buildCanonicalProductMappings(cards, products) {
  const productsByIdentity = new Map();

  for (const product of products) {
    const cardNumber = normalizeCollectorNumber(getExtendedDataValue(product, "Number"));
    const productName = normalizeIdentityText(product.name);
    if (!cardNumber || !productName) continue;

    const key = `${cardNumber}:${productName}`;
    const matches = productsByIdentity.get(key) ?? [];
    matches.push(product);
    productsByIdentity.set(key, matches);
  }

  const mappings = new Map();
  const errors = [];

  for (const card of cards) {
    const cardNumber = normalizeCollectorNumber(card.number);
    const providerId = String(card.provider_id ?? card.id);
    const cardName = getBaseCardName(card.name);
    const candidateNames = [cardName, ...(BASE_SET_PRODUCT_NAME_ALIASES.get(providerId) ?? [])];
    const matches = candidateNames.flatMap(
      (candidateName) =>
        productsByIdentity.get(`${cardNumber}:${normalizeIdentityText(candidateName)}`) ?? [],
    );
    const uniqueMatches = [...new Map(matches.map((product) => [product.productId, product])).values()];

    if (uniqueMatches.length !== 1) {
      errors.push(
        `${providerId} (${cardName} #${card.number}) matched ${uniqueMatches.length} canonical products`,
      );
      continue;
    }

    mappings.set(providerId, uniqueMatches[0]);
  }

  return { mappings, errors };
}

export function normalizeTcgcsvPrinting(value) {
  return String(value ?? "normal")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function getExtendedDataValue(product, name) {
  return String(
    product?.extendedData?.find((entry) => entry.name === name)?.value ?? "",
  ).trim();
}

function normalizeCollectorNumber(value) {
  const leadingNumber = String(value ?? "").trim().split("/")[0];
  if (!/^\d+$/.test(leadingNumber)) return leadingNumber.toLowerCase();
  return String(Number(leadingNumber));
}

function normalizeIdentityText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
