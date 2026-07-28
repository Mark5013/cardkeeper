import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpandedHistoricalMarketRecords,
  createExpandedHistoryMappingFingerprint,
  createExpandedHistoryMappings,
  selectChangedExpandedHistoryRecords,
} from "../../scripts/lib/tcgcsv-expanded-history-core.mjs";

const mappingRows = [
  {
    targetType: "card",
    targetId: "card-normal",
    categoryId: 85,
    groupId: 100,
    productId: "500",
    printing: "Normal",
  },
  {
    targetType: "card",
    targetId: "card-holo",
    categoryId: 85,
    groupId: 100,
    productId: "500",
    printing: "Holofoil",
  },
  {
    targetType: "sealed",
    targetId: "sealed-en",
    categoryId: 3,
    groupId: 200,
    productId: "600",
  },
  {
    targetType: "sealed",
    targetId: "sealed-ja",
    categoryId: 85,
    groupId: 300,
    productId: "700",
  },
];

test("maps Japanese card finishes and sealed products by exact catalog identity", () => {
  const built = buildExpandedHistoricalMarketRecords({
    categoryGroups: [
      {
        categoryId: 85,
        groupId: 100,
        priceRows: [
          {
            productId: 500,
            subTypeName: "Normal",
            marketPrice: 1.25,
          },
          {
            productId: 500,
            subTypeName: "Holofoil",
            marketPrice: 2.5,
          },
        ],
      },
      {
        categoryId: 3,
        groupId: 200,
        priceRows: [
          {
            productId: 600,
            subTypeName: "Sealed",
            marketPrice: 30,
          },
        ],
      },
      {
        categoryId: 85,
        groupId: 300,
        priceRows: [
          {
            productId: 700,
            subTypeName: "Normal",
            marketPrice: 40,
          },
        ],
      },
    ],
    mappings: createExpandedHistoryMappings(mappingRows),
  });

  assert.deepEqual(
    built.records.sort((left, right) =>
      left.target_id.localeCompare(right.target_id),
    ),
    [
      { target_id: "card-holo", amount_minor: 250 },
      { target_id: "card-normal", amount_minor: 125 },
      { target_id: "sealed-en", amount_minor: 3000 },
      { target_id: "sealed-ja", amount_minor: 4000 },
    ],
  );
  assert.equal(built.stats.mappedMarketRows, 4);
  assert.equal(built.stats.ambiguousSealedTargets, 0);
});

test("does not cross category, group, product, or card-finish identities", () => {
  const built = buildExpandedHistoricalMarketRecords({
    categoryGroups: [
      {
        categoryId: 3,
        groupId: 100,
        priceRows: [
          {
            productId: 500,
            subTypeName: "Normal",
            marketPrice: 10,
          },
        ],
      },
      {
        categoryId: 85,
        groupId: 999,
        priceRows: [
          {
            productId: 500,
            subTypeName: "Normal",
            marketPrice: 20,
          },
        ],
      },
      {
        categoryId: 85,
        groupId: 100,
        priceRows: [
          {
            productId: 500,
            subTypeName: "Reverse Holofoil",
            marketPrice: 30,
          },
        ],
      },
    ],
    mappings: createExpandedHistoryMappings(mappingRows),
  });

  assert.deepEqual(built.records, []);
  assert.equal(built.stats.unmatchedMarketRows, 3);
});

test("fails closed when one sealed product publishes conflicting subtype evidence", () => {
  const built = buildExpandedHistoricalMarketRecords({
    categoryGroups: [
      {
        categoryId: 3,
        groupId: 200,
        priceRows: [
          {
            productId: 600,
            subTypeName: "Normal",
            marketPrice: 10,
          },
          {
            productId: 600,
            subTypeName: "Sealed",
            marketPrice: 11,
          },
        ],
      },
    ],
    mappings: createExpandedHistoryMappings(mappingRows),
  });

  assert.deepEqual(built.records, []);
  assert.equal(built.stats.ambiguousSealedTargets, 1);
});

test("accepts repeated identical sealed evidence without averaging", () => {
  const built = buildExpandedHistoricalMarketRecords({
    categoryGroups: [
      {
        categoryId: 3,
        groupId: 200,
        priceRows: [
          {
            productId: 600,
            subTypeName: "Sealed",
            marketPrice: 10,
          },
          {
            productId: 600,
            subTypeName: "Sealed",
            marketPrice: 10,
          },
        ],
      },
    ],
    mappings: createExpandedHistoryMappings(mappingRows),
  });

  assert.deepEqual(built.records, [
    { target_id: "sealed-en", amount_minor: 1000 },
  ]);
  assert.equal(built.stats.ambiguousSealedTargets, 0);
});

test("drops target mappings that do not resolve to one exact source identity", () => {
  const mappings = createExpandedHistoryMappings([
    {
      targetType: "card",
      targetId: "card",
      categoryId: 85,
      groupId: 100,
      productId: "500",
      printing: "Normal",
    },
    {
      targetType: "card",
      targetId: "card",
      categoryId: 85,
      groupId: 100,
      productId: "501",
      printing: "Normal",
    },
  ]);

  assert.equal(mappings.targetCount, 0);
});

test("fingerprints the complete expanded mapping independent of row order", () => {
  const first = createExpandedHistoryMappingFingerprint(mappingRows);
  const reordered = createExpandedHistoryMappingFingerprint(
    [...mappingRows].reverse(),
  );
  const changed = createExpandedHistoryMappingFingerprint([
    ...mappingRows.slice(0, -1),
    { ...mappingRows.at(-1), groupId: 301 },
  ]);

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("keeps only changed amounts while updating the carried state", () => {
  const previous = new Map([["one", 100]]);
  const changed = selectChangedExpandedHistoryRecords(
    [
      { target_id: "one", amount_minor: 100 },
      { target_id: "two", amount_minor: 200 },
    ],
    previous,
  );

  assert.deepEqual(changed, [
    { target_id: "two", amount_minor: 200 },
  ]);
  assert.equal(previous.get("one"), 100);
  assert.equal(previous.get("two"), 200);
});
