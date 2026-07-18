export const TCGCSV_SOURCE = "tcgcsv";
export const TCGCSV_PRICE_TYPE = "market";
export const TCGCSV_CURRENCY = "USD";

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
  const mappings = new Map();

  for (const row of rows) {
    const productId = String(row.product_id ?? row.productId ?? "").trim();
    const cardVariantId = String(row.card_variant_id ?? row.cardVariantId ?? "").trim();
    const printing = normalizeTcgcsvPrinting(row.printing);

    if (!productId || !cardVariantId) continue;

    const key = getProductPrintingKey(productId, printing);
    const variantIds = mappings.get(key) ?? new Set();
    variantIds.add(cardVariantId);
    mappings.set(key, variantIds);
  }

  return new Map(Array.from(mappings, ([key, value]) => [key, Array.from(value)]));
}

export function buildHistoricalPriceRecords({ priceRows, mappings, observedAt }) {
  const amountsByVariant = new Map();
  const stats = {
    priceRowsRead: priceRows.length,
    validMarketRows: 0,
    mappedMarketRows: 0,
    unmatchedMarketRows: 0,
  };

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
      const existing = amountsByVariant.get(cardVariantId);

      amountsByVariant.set(cardVariantId, {
        amountMinor: existing
          ? Math.round((existing.amountMinor * existing.samples + amountMinor) / (existing.samples + 1))
          : amountMinor,
        samples: (existing?.samples ?? 0) + 1,
      });
    }
  }

  const records = Array.from(amountsByVariant, ([cardVariantId, value]) => ({
    card_variant_id: cardVariantId,
    source: TCGCSV_SOURCE,
    price_type: TCGCSV_PRICE_TYPE,
    currency: TCGCSV_CURRENCY,
    amount_minor: value.amountMinor,
    observed_at: observedAt,
  }));

  return { records, stats };
}

export function buildHistoricalPriceRecordsByGroup({
  priceRowsByGroup,
  groupOrder,
  mappings,
  observedAt,
}) {
  const recordsByVariant = new Map();
  const stats = {
    priceRowsRead: 0,
    validMarketRows: 0,
    mappedMarketRows: 0,
    unmatchedMarketRows: 0,
  };

  for (const groupId of groupOrder) {
    const priceRows = priceRowsByGroup.get(String(groupId)) ?? [];
    const groupResult = buildHistoricalPriceRecords({ priceRows, mappings, observedAt });

    stats.priceRowsRead += groupResult.stats.priceRowsRead;
    stats.validMarketRows += groupResult.stats.validMarketRows;
    stats.mappedMarketRows += groupResult.stats.mappedMarketRows;
    stats.unmatchedMarketRows += groupResult.stats.unmatchedMarketRows;

    for (const record of groupResult.records) {
      recordsByVariant.set(record.card_variant_id, record);
    }
  }

  return { records: Array.from(recordsByVariant.values()), stats };
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

function getProductPrintingKey(productId, printing) {
  return `${productId}:${printing}`;
}
