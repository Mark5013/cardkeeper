import { createHash } from "node:crypto";

import { getTcgcsvQualifiedPrintingSourcePrinting } from "./tcgcsv-qualified-printing.mjs";

export const TCGCSV_SOURCE = "tcgcsv";
export const TCGCSV_PRICE_TYPE = "market";
export const TCGCSV_CURRENCY = "USD";
export const TCGCSV_HISTORY_MAPPING_POLICY_VERSION =
  "single-positive-product-ref-qualified-printing-v4";

export function compareTcgcsvGroupsByPublishedOn(left, right) {
  return Date.parse(right.publishedOn ?? "") - Date.parse(left.publishedOn ?? "");
}

export function getNightlyTcgcsvGroupOrder(groups, categoryId = 3) {
  return groups
    .filter((group) => group.categoryId === categoryId)
    .sort(compareTcgcsvGroupsByPublishedOn)
    .map((group) => String(group.groupId));
}

export function normalizeTcgcsvPrinting(value) {
  return String(value ?? "normal")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function createProductVariantMappings(rows) {
  const candidatesByVariant = new Map();

  for (const row of rows) {
    const cardVariantId = String(row.card_variant_id ?? row.cardVariantId ?? "").trim();

    if (!cardVariantId) continue;

    const candidate = candidatesByVariant.get(cardVariantId) ?? {
      mappings: [],
      refCount: 0,
    };
    const productId = String(row.product_id ?? row.productId ?? "").trim();

    candidate.refCount += 1;
    if (isPositiveNumericProductId(productId)) {
      candidate.mappings.push({
        printing: getTcgcsvHistorySourcePrinting(row.printing),
        productId,
      });
    }
    candidatesByVariant.set(cardVariantId, candidate);
  }

  const mappings = new Map();

  for (const [cardVariantId, candidate] of candidatesByVariant) {
    if (candidate.refCount !== 1 || candidate.mappings.length !== 1) continue;

    const { printing, productId } = candidate.mappings[0];
    const key = getProductPrintingKey(productId, printing);
    const variantIds = mappings.get(key) ?? new Set();
    variantIds.add(cardVariantId);
    mappings.set(key, variantIds);
  }

  return new Map(Array.from(mappings, ([key, value]) => [key, Array.from(value)]));
}

export function buildHistoricalPriceRecords({ priceRows, mappings, observedAt }) {
  return buildHistoricalPriceRecordsFromGroups({
    mappings,
    observedAt,
    priceRowGroups: [priceRows],
  });
}

export function buildHistoricalPriceRecordsByGroup({
  priceRowsByGroup,
  groupOrder,
  mappings,
  observedAt,
}) {
  return buildHistoricalPriceRecordsFromGroups({
    mappings,
    observedAt,
    priceRowGroups: groupOrder.map(
      (groupId) => priceRowsByGroup.get(String(groupId)) ?? [],
    ),
  });
}

export function assertCompatibleTcgcsvHistoryStageMappingPolicy({
  hasExistingState,
  storedVersion,
}) {
  if (
    storedVersion === TCGCSV_HISTORY_MAPPING_POLICY_VERSION ||
    (!storedVersion && !hasExistingState)
  ) {
    return;
  }

  throw new Error(
    `The stage file uses TCGCSV history mapping policy ${storedVersion ?? "legacy/unversioned"}, but the current policy is ${TCGCSV_HISTORY_MAPPING_POLICY_VERSION}. Use --reset-stage to rebuild it.`,
  );
}

export function createTcgcsvHistoryMappingFingerprint(rows) {
  const identities = rows
    .map((row) => ({
      cardVariantId: String(
        row.card_variant_id ?? row.cardVariantId ?? "",
      ).trim(),
      printing: normalizeTcgcsvPrinting(row.printing),
      productId: String(row.product_id ?? row.productId ?? "").trim(),
    }))
    .sort(
      (left, right) =>
        left.cardVariantId.localeCompare(right.cardVariantId, "en") ||
        left.printing.localeCompare(right.printing, "en") ||
        left.productId.localeCompare(right.productId, "en"),
    );

  return createHash("sha256")
    .update(JSON.stringify(identities))
    .digest("hex");
}

export function assertCompatibleTcgcsvHistoryMappingFingerprint({
  currentFingerprint,
  hasExistingState,
  storedFingerprint,
}) {
  if (
    storedFingerprint === currentFingerprint ||
    (!storedFingerprint && !hasExistingState)
  ) {
    return;
  }

  throw new Error(
    "The TCGplayer product-ref mapping changed after this history stage was created. Use --reset-stage to rebuild it from one mapping snapshot.",
  );
}

export function selectChangedPriceRecords(records, previousAmountsByVariant) {
  const changedRecords = [];

  for (const record of records) {
    const previousAmount = previousAmountsByVariant.get(record.card_variant_id);

    if (previousAmount !== record.amount_minor) changedRecords.push(record);

    previousAmountsByVariant.set(record.card_variant_id, record.amount_minor);
  }

  return changedRecords;
}

function buildHistoricalPriceRecordsFromGroups({ priceRowGroups, mappings, observedAt }) {
  const recordsByVariant = new Map();
  const productIdsByVariant = new Map();
  const ambiguousVariantIds = new Set();
  const stats = {
    priceRowsRead: 0,
    validMarketRows: 0,
    mappedMarketRows: 0,
    unmatchedMarketRows: 0,
  };

  for (const priceRows of priceRowGroups) {
    stats.priceRowsRead += priceRows.length;

    for (const price of priceRows) {
      const amount = price.marketPrice;

      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) continue;

      stats.validMarketRows += 1;

      const productId = String(price.productId ?? "").trim();
      const printing = normalizeTcgcsvPrinting(price.subTypeName);
      const variantIds = mappings.get(getProductPrintingKey(productId, printing)) ?? [];

      if (variantIds.length === 0) {
        stats.unmatchedMarketRows += 1;
        continue;
      }

      stats.mappedMarketRows += 1;
      const amountMinor = Math.round(amount * 100);

      for (const cardVariantId of variantIds) {
        if (ambiguousVariantIds.has(cardVariantId)) continue;

        const mappedProductId = productIdsByVariant.get(cardVariantId);

        if (productIdsByVariant.has(cardVariantId) && mappedProductId !== productId) {
          recordsByVariant.delete(cardVariantId);
          ambiguousVariantIds.add(cardVariantId);
          continue;
        }

        productIdsByVariant.set(cardVariantId, productId);
        recordsByVariant.set(cardVariantId, {
          card_variant_id: cardVariantId,
          source: TCGCSV_SOURCE,
          price_type: TCGCSV_PRICE_TYPE,
          currency: TCGCSV_CURRENCY,
          amount_minor: amountMinor,
          observed_at: observedAt,
        });
      }
    }
  }

  return { records: Array.from(recordsByVariant.values()), stats };
}

function isPositiveNumericProductId(value) {
  return /^[1-9][0-9]{0,14}$/.test(value);
}

function getTcgcsvHistorySourcePrinting(value) {
  const printing = normalizeTcgcsvPrinting(value);

  return getTcgcsvQualifiedPrintingSourcePrinting(printing);
}

function getProductPrintingKey(productId, printing) {
  return `${productId}:${printing}`;
}
