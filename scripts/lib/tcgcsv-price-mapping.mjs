export function resolveTcgcsvPriceCandidates(candidates) {
  const productIds = [
    ...new Set(
      candidates
        .map((candidate) => String(candidate.productId ?? "").trim())
        .filter(Boolean),
    ),
  ];

  if (productIds.length !== 1) {
    return {
      ambiguous: productIds.length > 1,
      amountRecords: [],
      productIds,
    };
  }

  const amountRecordsByType = new Map();

  for (const candidate of candidates) {
    for (const amountRecord of candidate.amountRecords ?? []) {
      amountRecordsByType.set(amountRecord.priceType, amountRecord);
    }
  }

  return {
    ambiguous: false,
    amountRecords: Array.from(amountRecordsByType.values()),
    productIds,
  };
}

export function resolveTcgcsvVariantProductIds({
  candidateProductIds,
  existingProductIds,
}) {
  const productIds = [
    ...new Set(
      [...existingProductIds, ...candidateProductIds]
        .map((productId) => String(productId ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const hasOnlyValidProductIds = productIds.every((productId) =>
    /^[1-9]\d{0,14}$/.test(productId),
  );

  return {
    ambiguous: productIds.length !== 1 || !hasOnlyValidProductIds,
    productIds,
  };
}
