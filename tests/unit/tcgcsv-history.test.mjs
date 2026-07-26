import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCompatibleTcgcsvHistoryMappingFingerprint,
  assertCompatibleTcgcsvHistoryStageMappingPolicy,
  buildHistoricalPriceRecords,
  buildHistoricalPriceRecordsByGroup,
  createProductVariantMappings,
  createTcgcsvHistoryMappingFingerprint,
  getNightlyTcgcsvGroupOrder,
  normalizeTcgcsvPrinting,
  selectChangedPriceRecords,
  TCGCSV_HISTORY_MAPPING_POLICY_VERSION,
} from "../../scripts/lib/tcgcsv-history-core.mjs";

test("normalizes TCGCSV printing names consistently with the nightly refresh", () => {
  assert.equal(normalizeTcgcsvPrinting("Reverse Holofoil"), "reverse_holofoil");
  assert.equal(normalizeTcgcsvPrinting("1st Edition Holofoil"), "1st_edition_holofoil");
});

test("orders groups by the nightly refresh's newest-first published date", () => {
  assert.deepEqual(
    getNightlyTcgcsvGroupOrder([
      { categoryId: 3, groupId: 1701, publishedOn: "2016-02-03T00:00:00" },
      { categoryId: 1, groupId: 9999, publishedOn: "2030-01-01T00:00:00" },
      { categoryId: 3, groupId: 1938, publishedOn: "2026-07-17T20:00:05Z" },
    ]),
    ["1938", "1701"],
  );
});

test("maps product and printing identities to existing card variants", () => {
  const mappings = createProductVariantMappings([
    { product_id: "100", card_variant_id: "normal-variant", printing: "normal" },
    { product_id: "100", card_variant_id: "holo-variant", printing: "holofoil" },
  ]);
  const result = buildHistoricalPriceRecords({
    mappings,
    observedAt: new Date("2024-02-08T00:00:00.000Z"),
    priceRows: [
      { productId: 100, subTypeName: "Normal", marketPrice: 1.25 },
      { productId: 100, subTypeName: "Holofoil", marketPrice: 4.5 },
      { productId: 100, subTypeName: "Reverse Holofoil", marketPrice: 3 },
    ],
  });

  assert.deepEqual(
    result.records.map((row) => [row.card_variant_id, row.amount_minor]),
    [
      ["normal-variant", 125],
      ["holo-variant", 450],
    ],
  );
  assert.equal(result.stats.mappedMarketRows, 2);
  assert.equal(result.stats.unmatchedMarketRows, 1);
});

test("maps reviewed qualified products from archived Holofoil rows", () => {
  const mappings = createProductVariantMappings([
    {
      product_id: "100",
      card_variant_id: "poke-ball-variant",
      printing: "poke_ball_holofoil",
    },
    {
      product_id: "200",
      card_variant_id: "master-ball-variant",
      printing: "master_ball_holofoil",
    },
    {
      product_id: "300",
      card_variant_id: "holiday-calendar-variant",
      printing: "holiday_calendar_holofoil",
    },
  ]);
  const result = buildHistoricalPriceRecords({
    mappings,
    observedAt: new Date("2024-02-08T00:00:00.000Z"),
    priceRows: [
      { productId: 100, subTypeName: "Holofoil", marketPrice: 2.5 },
      { productId: 200, subTypeName: "Holofoil", marketPrice: 8 },
      { productId: 300, subTypeName: "Holofoil", marketPrice: 14.75 },
    ],
  });

  assert.deepEqual(Array.from(mappings), [
    ["100:holofoil", ["poke-ball-variant"]],
    ["200:holofoil", ["master-ball-variant"]],
    ["300:holofoil", ["holiday-calendar-variant"]],
  ]);
  assert.deepEqual(
    result.records.map((row) => [row.card_variant_id, row.amount_minor]),
    [
      ["poke-ball-variant", 250],
      ["master-ball-variant", 800],
      ["holiday-calendar-variant", 1475],
    ],
  );
  assert.equal(result.stats.mappedMarketRows, 3);
  assert.equal(result.stats.unmatchedMarketRows, 0);
});

test("requires independent Holofoil subtype evidence for qualified products", () => {
  const mappings = createProductVariantMappings([
    {
      product_id: "100",
      card_variant_id: "poke-ball-variant",
      printing: "poke_ball_holofoil",
    },
  ]);
  const result = buildHistoricalPriceRecords({
    mappings,
    observedAt: new Date("2024-02-08T00:00:00.000Z"),
    priceRows: [
      { productId: 100, subTypeName: "Normal", marketPrice: 2.5 },
      { productId: 100, subTypeName: "Reverse Holofoil", marketPrice: 3 },
    ],
  });

  assert.deepEqual(result.records, []);
  assert.equal(result.stats.mappedMarketRows, 0);
  assert.equal(result.stats.unmatchedMarketRows, 2);
});

test("excludes variants without exactly one valid positive numeric product reference", () => {
  const mappings = createProductVariantMappings([
    { product_id: "100", card_variant_id: "eligible", printing: "normal" },
    { product_id: "200", card_variant_id: "multiple", printing: "normal" },
    { product_id: "201", card_variant_id: "multiple", printing: "normal" },
    { product_id: "300", card_variant_id: "mixed", printing: "normal" },
    { product_id: "not-numeric", card_variant_id: "mixed", printing: "normal" },
    { product_id: "0", card_variant_id: "zero", printing: "normal" },
    { product_id: "-1", card_variant_id: "negative", printing: "normal" },
    { product_id: "1234567890123456", card_variant_id: "unsafe", printing: "normal" },
    { product_id: "400", card_variant_id: "duplicate", printing: "normal" },
    { product_id: "400", card_variant_id: "duplicate", printing: "normal" },
  ]);

  assert.deepEqual(Array.from(mappings), [["100:normal", ["eligible"]]]);
});

test("drops a variant rather than combining distinct mapped products", () => {
  const result = buildHistoricalPriceRecords({
    mappings: new Map([
      ["100:holofoil", ["variant"]],
      ["200:holofoil", ["variant"]],
    ]),
    observedAt: new Date("2024-02-08T00:00:00.000Z"),
    priceRows: [
      { productId: 100, subTypeName: "Holofoil", marketPrice: 10 },
      { productId: 200, subTypeName: "Holofoil", marketPrice: 14 },
    ],
  });

  assert.deepEqual(result.records, []);
});

test("uses the last price row when the same product is repeated", () => {
  const mappings = createProductVariantMappings([
    { product_id: "100", card_variant_id: "variant", printing: "holofoil" },
  ]);
  const result = buildHistoricalPriceRecords({
    mappings,
    observedAt: new Date("2024-02-08T00:00:00.000Z"),
    priceRows: [
      { productId: 100, subTypeName: "Holofoil", marketPrice: 10 },
      { productId: 100, subTypeName: "Holofoil", marketPrice: 14 },
    ],
  });

  assert.equal(result.records[0].amount_minor, 1400);
});

test("drops distinct product collisions that occur across nightly groups", () => {
  const result = buildHistoricalPriceRecordsByGroup({
    mappings: new Map([
      ["100:holofoil", ["variant"]],
      ["300:holofoil", ["variant"]],
    ]),
    observedAt: new Date("2024-02-08T00:00:00.000Z"),
    groupOrder: ["base-group", "supplemental-group"],
    priceRowsByGroup: new Map([
      ["base-group", [{ productId: 100, subTypeName: "Holofoil", marketPrice: 10 }]],
      ["supplemental-group", [{ productId: 300, subTypeName: "Holofoil", marketPrice: 5 }]],
    ]),
  });

  assert.deepEqual(result.records, []);
});

test("lets a later nightly group win when it repeats the same product", () => {
  const mappings = createProductVariantMappings([
    { product_id: "100", card_variant_id: "variant", printing: "holofoil" },
  ]);
  const result = buildHistoricalPriceRecordsByGroup({
    mappings,
    observedAt: new Date("2024-02-08T00:00:00.000Z"),
    groupOrder: ["base-group", "supplemental-group"],
    priceRowsByGroup: new Map([
      ["base-group", [{ productId: 100, subTypeName: "Holofoil", marketPrice: 10 }]],
      ["supplemental-group", [{ productId: 100, subTypeName: "Holofoil", marketPrice: 5 }]],
    ]),
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].amount_minor, 500);
});

test("requires old or differently versioned history stages to be reset", () => {
  assert.doesNotThrow(() =>
    assertCompatibleTcgcsvHistoryStageMappingPolicy({
      hasExistingState: false,
      storedVersion: null,
    }),
  );
  assert.doesNotThrow(() =>
    assertCompatibleTcgcsvHistoryStageMappingPolicy({
      hasExistingState: true,
      storedVersion: TCGCSV_HISTORY_MAPPING_POLICY_VERSION,
    }),
  );
  assert.throws(
    () =>
      assertCompatibleTcgcsvHistoryStageMappingPolicy({
        hasExistingState: true,
        storedVersion: null,
      }),
    /--reset-stage/,
  );
  assert.throws(
    () =>
      assertCompatibleTcgcsvHistoryStageMappingPolicy({
        hasExistingState: true,
        storedVersion: "older-policy",
      }),
    /--reset-stage/,
  );
});

test("creates a deterministic fingerprint for the exact history mapping snapshot", () => {
  const first = createTcgcsvHistoryMappingFingerprint([
    { product_id: "200", card_variant_id: "variant-b", printing: "Holofoil" },
    { product_id: "100", card_variant_id: "variant-a", printing: "Normal" },
  ]);
  const reordered = createTcgcsvHistoryMappingFingerprint([
    { product_id: "100", card_variant_id: "variant-a", printing: "normal" },
    { product_id: "200", card_variant_id: "variant-b", printing: "holofoil" },
  ]);

  assert.equal(first, reordered);
  assert.notEqual(
    first,
    createTcgcsvHistoryMappingFingerprint([
      { product_id: "100", card_variant_id: "variant-a", printing: "normal" },
      { product_id: "201", card_variant_id: "variant-b", printing: "holofoil" },
    ]),
  );
  assert.notEqual(
    first,
    createTcgcsvHistoryMappingFingerprint([
      { product_id: "100", card_variant_id: "variant-a", printing: "normal" },
      { product_id: "200", card_variant_id: "variant-c", printing: "holofoil" },
    ]),
  );
  assert.notEqual(
    first,
    createTcgcsvHistoryMappingFingerprint([
      { product_id: "100", card_variant_id: "variant-a", printing: "normal" },
      { product_id: "200", card_variant_id: "variant-b", printing: "reverse_holofoil" },
    ]),
  );
});

test("requires a history stage to retain its exact mapping fingerprint", () => {
  assert.doesNotThrow(() =>
    assertCompatibleTcgcsvHistoryMappingFingerprint({
      currentFingerprint: "current",
      hasExistingState: false,
      storedFingerprint: null,
    }),
  );
  assert.doesNotThrow(() =>
    assertCompatibleTcgcsvHistoryMappingFingerprint({
      currentFingerprint: "current",
      hasExistingState: true,
      storedFingerprint: "current",
    }),
  );
  assert.throws(
    () =>
      assertCompatibleTcgcsvHistoryMappingFingerprint({
        currentFingerprint: "current",
        hasExistingState: true,
        storedFingerprint: null,
      }),
    /--reset-stage/,
  );
  assert.throws(
    () =>
      assertCompatibleTcgcsvHistoryMappingFingerprint({
        currentFingerprint: "current",
        hasExistingState: true,
        storedFingerprint: "older",
      }),
    /--reset-stage/,
  );
});

test("keeps only prices that changed from the preceding processed day", () => {
  const previousAmounts = new Map();
  const firstDay = selectChangedPriceRecords(
    [
      { card_variant_id: "charizard", amount_minor: 100 },
      { card_variant_id: "venusaur", amount_minor: 50 },
    ],
    previousAmounts,
  );
  const secondDay = selectChangedPriceRecords(
    [
      { card_variant_id: "charizard", amount_minor: 100 },
      { card_variant_id: "venusaur", amount_minor: 51 },
    ],
    previousAmounts,
  );

  assert.equal(firstDay.length, 2);
  assert.deepEqual(secondDay.map((row) => row.card_variant_id), ["venusaur"]);
  assert.equal(previousAmounts.get("charizard"), 100);
  assert.equal(previousAmounts.get("venusaur"), 51);
});
