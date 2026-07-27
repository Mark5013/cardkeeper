import { createHash } from "node:crypto";

export const TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS = Object.freeze({
  MISSING_LOCAL_VARIANT: "missing_local_variant",
  MISSING_PRODUCT_REF: "missing_product_ref",
  MULTIPLE_PRODUCT_REFS: "multiple_product_refs",
  TRUSTED_SINGLETON_WITHOUT_CURRENT_MARKET:
    "trusted_singleton_without_current_market",
  UNTRUSTED_PRODUCT_REF: "untrusted_product_ref",
});

export const TCGCSV_MISSING_PRICE_CARD_CLASSIFICATIONS = Object.freeze({
  NO_VISIBLE_FINISH: "no_provider_finish_or_trusted_local_finish",
});

const VALID_TCGPLAYER_PRODUCT_ID = /^[1-9]\d{0,14}$/;

export function normalizeProviderPrinting(value) {
  return String(value ?? "normal")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function summarizeTcgplayerProductRefs(productRefs) {
  const refs = [...(productRefs ?? [])].sort(compareProductRefs);
  const productIds = [
    ...new Set(
      refs
        .map((ref) => String(ref.productId ?? "").trim())
        .filter(Boolean),
    ),
  ].sort(compareProductIds);
  const trustedProductIds = [
    ...new Set(
      refs
        .filter(
          (ref) =>
            VALID_TCGPLAYER_PRODUCT_ID.test(
              String(ref.productId ?? "").trim(),
            ) && ref.metadata?.tcgcsvMappingStatus !== "stale",
        )
        .map((ref) => String(ref.productId).trim()),
    ),
  ].sort(compareProductIds);
  const invalidRefs = refs.filter((ref) => {
    const productId = String(ref.productId ?? "").trim();

    return (
      !VALID_TCGPLAYER_PRODUCT_ID.test(productId) ||
      ref.metadata?.tcgcsvMappingStatus === "stale"
    );
  });

  return {
    invalidRefCount: invalidRefs.length,
    isTrustedSingleton:
      productIds.length === 1 &&
      trustedProductIds.length === 1 &&
      invalidRefs.length === 0,
    productIds,
    trustedProductIds,
  };
}

export function classifyMissingPriceFinish({ variant }) {
  if (!variant) {
    return TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS.MISSING_LOCAL_VARIANT;
  }

  const refs = summarizeTcgplayerProductRefs(variant.tcgplayerProductRefs);

  if (refs.productIds.length === 0) {
    return TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS.MISSING_PRODUCT_REF;
  }

  if (refs.productIds.length > 1) {
    return TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS.MULTIPLE_PRODUCT_REFS;
  }

  if (!refs.isTrustedSingleton) {
    return TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS.UNTRUSTED_PRODUCT_REF;
  }

  if (!hasTcgcsvCurrentMarket(variant)) {
    return TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS
      .TRUSTED_SINGLETON_WITHOUT_CURRENT_MARKET;
  }

  return null;
}

export function buildDatabaseOnlyMissingPriceManifest({
  activeCards,
  databaseSnapshotAt,
  localVariants,
  latestTcgcsvMarketObservedAt,
}) {
  const variantsByCardId = groupVariantsByCardId(localVariants);
  const cards = [];
  const pricedCardIds = new Set();
  const cardsWithFinishGaps = new Set();
  const finishGapSetIds = new Set();
  const whollyUnpricedSetIds = new Set();
  const gapCounts = Object.fromEntries(
    Object.values(TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS).map(
      (classification) => [classification, 0],
    ),
  );
  let visibleFinishCount = 0;
  let pricedFinishCount = 0;
  let unpricedCardsWithoutVisibleFinish = 0;

  for (const card of [...activeCards].sort(compareCards)) {
    const cardVariants = (variantsByCardId.get(String(card.id)) ?? [])
      .map(normalizeVariant)
      .sort(compareVariants);
    const providerAdvertisedFinishes = [
      ...new Set(card.providerFinishKeys ?? []),
    ]
      .map((providerKey) => ({
        printing: normalizeProviderPrinting(providerKey),
        providerKey,
      }))
      .sort(compareProviderFinishes);
    const trustedLocalPrintings = new Set(
      cardVariants
        .filter(
          (variant) =>
            variant.condition === "unspecified" &&
            variant.languageCode === "en" &&
            summarizeTcgplayerProductRefs(
              variant.tcgplayerProductRefs,
            ).isTrustedSingleton,
        )
        .map((variant) => variant.printing),
    );
    const replacedProviderPrintings = new Set(
      [...trustedLocalPrintings]
        .map(getQualifiedPrintingSourcePrinting)
        .filter(
          (sourcePrinting) =>
            sourcePrinting &&
            !trustedLocalPrintings.has(sourcePrinting),
        ),
    );
    const visibleFinishes = new Map();

    for (const providerFinish of providerAdvertisedFinishes) {
      if (replacedProviderPrintings.has(providerFinish.printing)) {
        continue;
      }

      const visibleFinish =
        visibleFinishes.get(providerFinish.printing) ??
        createVisibleFinish(providerFinish.printing);
      visibleFinish.providerKeys.push(providerFinish.providerKey);
      visibleFinishes.set(providerFinish.printing, visibleFinish);
    }

    for (const variant of cardVariants) {
      if (
        variant.condition !== "unspecified" ||
        variant.languageCode !== "en" ||
        !summarizeTcgplayerProductRefs(variant.tcgplayerProductRefs)
          .isTrustedSingleton
      ) {
        continue;
      }

      const visibleFinish =
        visibleFinishes.get(variant.printing) ??
        createVisibleFinish(variant.printing);
      visibleFinishes.set(variant.printing, visibleFinish);
    }

    const finishGaps = [];
    let hasTrustedCurrentPrice = false;

    for (const visibleFinish of [...visibleFinishes.values()].sort(
      (left, right) => left.printing.localeCompare(right.printing, "en"),
    )) {
      visibleFinishCount += 1;
      const variant =
        cardVariants.find(
          (candidate) =>
            candidate.printing === visibleFinish.printing &&
            candidate.condition === "unspecified" &&
            candidate.languageCode === "en",
        ) ?? null;
      const classification = classifyMissingPriceFinish({ variant });

      if (classification === null) {
        pricedFinishCount += 1;
        hasTrustedCurrentPrice = true;
        continue;
      }

      gapCounts[classification] += 1;
      cardsWithFinishGaps.add(String(card.id));
      finishGapSetIds.add(String(card.setId));
      const refSummary = summarizeTcgplayerProductRefs(
        variant?.tcgplayerProductRefs,
      );

      finishGaps.push({
        classification,
        hasTcgcsvCurrentMarket: variant
          ? hasTcgcsvCurrentMarket(variant)
          : false,
        hasTcgcsvMarketSeries: variant
          ? hasTcgcsvMarketSeries(variant)
          : false,
        printing: visibleFinish.printing,
        productIds: refSummary.productIds,
        providerAdvertised: visibleFinish.providerKeys.length > 0,
        providerPrintingKeys: [...visibleFinish.providerKeys].sort((left, right) =>
          left.localeCompare(right, "en"),
        ),
        trustedProductId: refSummary.isTrustedSingleton
          ? refSummary.trustedProductIds[0]
          : null,
        variantId: variant?.id ?? null,
      });
    }

    if (hasTrustedCurrentPrice) {
      pricedCardIds.add(String(card.id));
    } else {
      whollyUnpricedSetIds.add(String(card.setId));
    }

    const cardGapClassification =
      !hasTrustedCurrentPrice && visibleFinishes.size === 0
        ? TCGCSV_MISSING_PRICE_CARD_CLASSIFICATIONS.NO_VISIBLE_FINISH
        : null;

    if (cardGapClassification) {
      unpricedCardsWithoutVisibleFinish += 1;
    }

    if (finishGaps.length > 0 || !hasTrustedCurrentPrice) {
      cards.push({
        card: {
          id: String(card.id),
          name: card.name,
          number: card.number,
          providerId: card.providerId,
        },
        cardGapClassification,
        finishGaps,
        hasTrustedCurrentPrice,
        localVariants: cardVariants,
        providerAdvertisedFinishes,
        set: {
          id: String(card.setId),
          name: card.setName,
          providerId: card.setProviderId,
        },
      });
    }
  }

  const cardsWithTrustedCurrentPrice = pricedCardIds.size;
  const summary = {
    activeEnglishCards: activeCards.length,
    cardsInManifest: cards.length,
    cardsWithFinishGaps: cardsWithFinishGaps.size,
    cardsWithPartialPriceCoverage: cards.filter(
      (card) => card.hasTrustedCurrentPrice && card.finishGaps.length > 0,
    ).length,
    cardsWithTrustedCurrentPrice,
    cardsWithoutTrustedCurrentPrice:
      activeCards.length - cardsWithTrustedCurrentPrice,
    finishGapClassifications: gapCounts,
    finishGaps: visibleFinishCount - pricedFinishCount,
    pricedVisibleFinishes: pricedFinishCount,
    setsWithFinishGaps: finishGapSetIds.size,
    setsWithWhollyUnpricedCards: whollyUnpricedSetIds.size,
    unpricedCardsWithoutVisibleFinish,
    visibleFinishes: visibleFinishCount,
  };
  const manifestBody = {
    version: 1,
    mode: "database-only",
    source: "tcgcsv",
    marketplace: "tcgplayer",
    scope: {
      cardLanguage: "en",
      currency: "USD",
      condition: "unspecified",
      priceType: "market",
    },
    databaseSnapshotAt: toIsoString(databaseSnapshotAt),
    latestTcgcsvMarketObservedAt: toIsoString(
      latestTcgcsvMarketObservedAt,
    ),
    providerRequests: {
      count: 0,
    },
    summary,
    cards,
  };
  const manifestFingerprint = createHash("sha256")
    .update(JSON.stringify(manifestBody))
    .digest("hex");

  return {
    ...manifestBody,
    manifestFingerprint,
  };
}

function createVisibleFinish(printing) {
  return {
    printing,
    providerKeys: [],
  };
}

function getQualifiedPrintingSourcePrinting(value) {
  const printing = normalizeProviderPrinting(value);

  if (printing.endsWith("_holofoil")) return "holofoil";
  if (printing.endsWith("_normal")) return "normal";

  return printing;
}

function groupVariantsByCardId(localVariants) {
  const variantsByCardId = new Map();

  for (const variant of localVariants) {
    const cardId = String(variant.cardId);
    const variants = variantsByCardId.get(cardId) ?? [];
    variants.push(variant);
    variantsByCardId.set(cardId, variants);
  }

  return variantsByCardId;
}

function normalizeVariant(variant) {
  const tcgplayerProductRefs = [...(variant.tcgplayerProductRefs ?? [])]
    .map((ref) => ({
      createdAt: toIsoString(ref.createdAt),
      id: String(ref.id),
      metadata: sortObjectKeys(ref.metadata),
      productId: String(ref.productId),
      updatedAt: toIsoString(ref.updatedAt),
    }))
    .sort(compareProductRefs);
  const tcgcsvCurrentPrices = [...(variant.tcgcsvCurrentPrices ?? [])]
    .map((price) => ({
      amountMinor: Number(price.amountMinor),
      currency: price.currency,
      observedAt: toIsoString(price.observedAt),
      priceType: price.priceType,
      updatedAt: toIsoString(price.updatedAt),
    }))
    .sort(comparePriceRows);
  const tcgcsvPriceSeries = [...(variant.tcgcsvPriceSeries ?? [])]
    .map((series) => ({
      currency: series.currency,
      firstObservedOn: toDateString(series.firstObservedOn),
      latestObservedOn: toDateString(series.latestObservedOn),
      observationCount: Number(series.observationCount),
      priceType: series.priceType,
      updatedAt: toIsoString(series.updatedAt),
    }))
    .sort(comparePriceRows);
  const refSummary = summarizeTcgplayerProductRefs(
    tcgplayerProductRefs,
  );

  return {
    id: String(variant.id),
    printing: variant.printing,
    condition: variant.condition,
    languageCode: variant.languageCode,
    externalVariantId: variant.externalVariantId ?? null,
    tcgplayerProductRefTrust: refSummary,
    tcgplayerProductRefs,
    tcgcsvCurrentPrices,
    tcgcsvPriceSeries,
    createdAt: toIsoString(variant.createdAt),
    updatedAt: toIsoString(variant.updatedAt),
  };
}

function hasTcgcsvCurrentMarket(variant) {
  return (variant.tcgcsvCurrentPrices ?? []).some(
    (price) =>
      price.priceType === "market" &&
      price.currency === "USD" &&
      Number.isFinite(Number(price.amountMinor)),
  );
}

function hasTcgcsvMarketSeries(variant) {
  return (variant.tcgcsvPriceSeries ?? []).some(
    (series) =>
      series.priceType === "market" &&
      series.currency === "USD" &&
      Number(series.observationCount) > 0,
  );
}

function toIsoString(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid audit timestamp: ${value}`);
  }

  return date.toISOString();
}

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return toIsoString(value).slice(0, 10);
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value ?? null;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, nestedValue]) => [key, sortObjectKeys(nestedValue)]),
  );
}

function compareCards(left, right) {
  return (
    String(left.setProviderId).localeCompare(
      String(right.setProviderId),
      "en",
    ) ||
    String(left.providerId).localeCompare(String(right.providerId), "en")
  );
}

function compareProviderFinishes(left, right) {
  return (
    left.printing.localeCompare(right.printing, "en") ||
    left.providerKey.localeCompare(right.providerKey, "en")
  );
}

function compareVariants(left, right) {
  return (
    left.printing.localeCompare(right.printing, "en") ||
    left.condition.localeCompare(right.condition, "en") ||
    left.languageCode.localeCompare(right.languageCode, "en") ||
    left.id.localeCompare(right.id, "en")
  );
}

function compareProductRefs(left, right) {
  return (
    compareProductIds(
      String(left.productId ?? ""),
      String(right.productId ?? ""),
    ) ||
    String(left.id ?? "").localeCompare(String(right.id ?? ""), "en")
  );
}

function compareProductIds(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (
    Number.isSafeInteger(leftNumber) &&
    Number.isSafeInteger(rightNumber) &&
    leftNumber !== rightNumber
  ) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right, "en");
}

function comparePriceRows(left, right) {
  return (
    String(left.priceType).localeCompare(String(right.priceType), "en") ||
    String(left.currency).localeCompare(String(right.currency), "en")
  );
}
