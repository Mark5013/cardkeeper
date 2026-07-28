import { createHash } from "node:crypto";

import { normalizeTcgcsvPrinting } from "./tcgcsv-product-import.mjs";

export const TCGCSV_EXPANDED_HISTORY_MAPPING_POLICY_VERSION =
  "exact-category-group-product-market-v1";

export function createExpandedHistoryMappingFingerprint(rows) {
  const identities = rows
    .map(normalizeMappingRow)
    .sort(compareMappingRows);

  return createHash("sha256")
    .update(JSON.stringify(identities))
    .digest("hex");
}

export function createExpandedHistoryMappings(rows) {
  const normalizedRows = rows.map(normalizeMappingRow);
  const rowsByTarget = new Map();

  for (const row of normalizedRows) {
    const targetKey = getTargetKey(row.targetType, row.targetId);
    const candidates = rowsByTarget.get(targetKey) ?? [];
    candidates.push(row);
    rowsByTarget.set(targetKey, candidates);
  }

  const cards = new Map();
  const sealed = new Map();
  const productKinds = new Map();

  for (const candidates of rowsByTarget.values()) {
    const uniqueSources = new Map(
      candidates.map((row) => [getMappingSourceKey(row), row]),
    );

    if (uniqueSources.size !== 1) continue;

    const row = uniqueSources.values().next().value;
    const productKey = getProductKey(
      row.categoryId,
      row.groupId,
      row.productId,
    );
    const existingKind = productKinds.get(productKey);

    if (existingKind && existingKind !== row.targetType) {
      throw new Error(
        `TCGCSV product ${productKey} maps to both card and sealed targets.`,
      );
    }
    productKinds.set(productKey, row.targetType);

    const mappingKey =
      row.targetType === "card"
        ? getCardMappingKey(
            row.categoryId,
            row.groupId,
            row.productId,
            row.printing,
          )
        : productKey;
    const targetIds =
      (row.targetType === "card" ? cards : sealed).get(mappingKey) ?? [];
    targetIds.push(row.targetId);
    (row.targetType === "card" ? cards : sealed).set(mappingKey, targetIds);
  }

  return {
    cards,
    sealed,
    targetCount: new Set([
      ...Array.from(cards.values()).flat(),
      ...Array.from(sealed.values()).flat(),
    ]).size,
  };
}

export function buildExpandedHistoricalMarketRecords({
  categoryGroups,
  mappings,
}) {
  const recordsByTarget = new Map();
  const sealedEvidenceByTarget = new Map();
  const ambiguousSealedTargets = new Set();
  const stats = {
    priceRowsRead: 0,
    validMarketRows: 0,
    mappedMarketRows: 0,
    unmatchedMarketRows: 0,
    ambiguousSealedTargets: 0,
  };

  for (const { categoryId, groupId, priceRows } of categoryGroups) {
    for (const price of priceRows) {
      stats.priceRowsRead += 1;
      const amount = price?.marketPrice;

      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount < 0
      ) {
        continue;
      }

      stats.validMarketRows += 1;
      const productId = String(price.productId ?? "").trim();
      const printing = normalizeTcgcsvPrinting(price.subTypeName);
      const cardTargets =
        mappings.cards.get(
          getCardMappingKey(
            categoryId,
            groupId,
            productId,
            printing,
          ),
        ) ?? [];
      const sealedTargets =
        mappings.sealed.get(
          getProductKey(categoryId, groupId, productId),
        ) ?? [];

      if (cardTargets.length === 0 && sealedTargets.length === 0) {
        stats.unmatchedMarketRows += 1;
        continue;
      }

      stats.mappedMarketRows += 1;
      const amountMinor = Math.round(amount * 100);

      for (const targetId of cardTargets) {
        recordsByTarget.set(targetId, {
          target_id: targetId,
          amount_minor: amountMinor,
        });
      }

      for (const targetId of sealedTargets) {
        if (ambiguousSealedTargets.has(targetId)) continue;

        const evidence = `${printing}:${amountMinor}`;
        const previousEvidence = sealedEvidenceByTarget.get(targetId);

        if (
          previousEvidence !== undefined &&
          previousEvidence !== evidence
        ) {
          recordsByTarget.delete(targetId);
          ambiguousSealedTargets.add(targetId);
          continue;
        }

        sealedEvidenceByTarget.set(targetId, evidence);
        recordsByTarget.set(targetId, {
          target_id: targetId,
          amount_minor: amountMinor,
        });
      }
    }
  }

  stats.ambiguousSealedTargets = ambiguousSealedTargets.size;

  return {
    records: Array.from(recordsByTarget.values()),
    stats,
  };
}

export function selectChangedExpandedHistoryRecords(
  records,
  previousAmountsByTarget,
) {
  const changedRecords = [];

  for (const record of records) {
    const previousAmount = previousAmountsByTarget.get(record.target_id);

    if (previousAmount !== record.amount_minor) {
      changedRecords.push(record);
    }

    previousAmountsByTarget.set(record.target_id, record.amount_minor);
  }

  return changedRecords;
}

function normalizeMappingRow(row) {
  const targetType = String(
    row.target_type ?? row.targetType ?? "",
  ).trim();
  const targetId = String(row.target_id ?? row.targetId ?? "").trim();
  const categoryId = Number(row.category_id ?? row.categoryId);
  const groupId = Number(row.group_id ?? row.groupId);
  const productId = String(row.product_id ?? row.productId ?? "").trim();
  const printing =
    targetType === "card"
      ? normalizeTcgcsvPrinting(row.printing)
      : null;

  if (targetType !== "card" && targetType !== "sealed") {
    throw new Error(`Unsupported expanded-history target type: ${targetType}`);
  }
  if (!targetId) {
    throw new Error("Expanded-history mappings require a target ID.");
  }
  if (!Number.isInteger(categoryId) || !Number.isInteger(groupId)) {
    throw new Error("Expanded-history mappings require integer category and group IDs.");
  }
  if (!/^[1-9][0-9]{0,14}$/.test(productId)) {
    throw new Error(`Invalid TCGplayer product ID: ${productId}`);
  }

  return {
    targetType,
    targetId,
    categoryId,
    groupId,
    productId,
    printing,
  };
}

function compareMappingRows(left, right) {
  return (
    left.targetType.localeCompare(right.targetType, "en") ||
    left.targetId.localeCompare(right.targetId, "en") ||
    left.categoryId - right.categoryId ||
    left.groupId - right.groupId ||
    left.productId.localeCompare(right.productId, "en") ||
    String(left.printing ?? "").localeCompare(
      String(right.printing ?? ""),
      "en",
    )
  );
}

function getMappingSourceKey(row) {
  return `${row.categoryId}:${row.groupId}:${row.productId}:${row.printing ?? "*"}`;
}

function getTargetKey(targetType, targetId) {
  return `${targetType}:${targetId}`;
}

function getProductKey(categoryId, groupId, productId) {
  return `${Number(categoryId)}:${Number(groupId)}:${String(productId)}`;
}

function getCardMappingKey(
  categoryId,
  groupId,
  productId,
  printing,
) {
  return `${getProductKey(categoryId, groupId, productId)}:${normalizeTcgcsvPrinting(printing)}`;
}
