import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHistoricalPriceRecords,
  buildHistoricalPriceRecordsByGroup,
  createProductVariantMappings,
  getNightlyTcgcsvGroupOrder,
  normalizeTcgcsvPrinting,
  selectChangedPriceRecords,
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

test("averages multiple TCGplayer products that collapse to one variant", () => {
  const mappings = createProductVariantMappings([
    { product_id: "100", card_variant_id: "variant", printing: "holofoil" },
    { product_id: "200", card_variant_id: "variant", printing: "holofoil" },
  ]);
  const result = buildHistoricalPriceRecords({
    mappings,
    observedAt: new Date("2024-02-08T00:00:00.000Z"),
    priceRows: [
      { productId: 100, subTypeName: "Holofoil", marketPrice: 10 },
      { productId: 200, subTypeName: "Holofoil", marketPrice: 14 },
    ],
  });

  assert.equal(result.records[0].amount_minor, 1200);
});

test("averages within a group but lets the later processed nightly group win", () => {
  const mappings = createProductVariantMappings([
    { product_id: "100", card_variant_id: "variant", printing: "holofoil" },
    { product_id: "200", card_variant_id: "variant", printing: "holofoil" },
    { product_id: "300", card_variant_id: "variant", printing: "holofoil" },
  ]);
  const result = buildHistoricalPriceRecordsByGroup({
    mappings,
    observedAt: new Date("2024-02-08T00:00:00.000Z"),
    groupOrder: ["base-group", "supplemental-group"],
    priceRowsByGroup: new Map([
      [
        "base-group",
        [
          { productId: 100, subTypeName: "Holofoil", marketPrice: 10 },
          { productId: 200, subTypeName: "Holofoil", marketPrice: 14 },
        ],
      ],
      ["supplemental-group", [{ productId: 300, subTypeName: "Holofoil", marketPrice: 5 }]],
    ]),
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].amount_minor, 500);
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
