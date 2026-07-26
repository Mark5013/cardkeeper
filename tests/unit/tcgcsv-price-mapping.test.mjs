import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTcgcsvPriceCandidates,
  resolveTcgcsvVariantProductIds,
} from "../../scripts/lib/tcgcsv-price-mapping.mjs";

test("keeps observations from one physical TCGplayer product", () => {
  assert.deepEqual(
    resolveTcgcsvPriceCandidates([
      {
        productId: "88109",
        amountRecords: [{ priceType: "market", amountMinor: 24966 }],
      },
    ]),
    {
      ambiguous: false,
      amountRecords: [{ priceType: "market", amountMinor: 24966 }],
      productIds: ["88109"],
    },
  );
});

test("rejects distinct products instead of averaging their prices", () => {
  assert.deepEqual(
    resolveTcgcsvPriceCandidates([
      {
        productId: "88109",
        amountRecords: [{ priceType: "market", amountMinor: 24966 }],
      },
      {
        productId: "118882",
        amountRecords: [{ priceType: "market", amountMinor: 5498 }],
      },
    ]),
    {
      ambiguous: true,
      amountRecords: [],
      productIds: ["88109", "118882"],
    },
  );
});

test("allows repeated rows from the same product without averaging identities", () => {
  assert.deepEqual(
    resolveTcgcsvPriceCandidates([
      {
        productId: 88109,
        amountRecords: [{ priceType: "market", amountMinor: 24900 }],
      },
      {
        productId: "88109",
        amountRecords: [{ priceType: "market", amountMinor: 24966 }],
      },
    ]),
    {
      ambiguous: false,
      amountRecords: [{ priceType: "market", amountMinor: 24966 }],
      productIds: ["88109"],
    },
  );
});

test("retains one exact product identity when its current market price is absent", () => {
  assert.deepEqual(
    resolveTcgcsvPriceCandidates([
      {
        productId: "88109",
        amountRecords: [],
      },
    ]),
    {
      ambiguous: false,
      amountRecords: [],
      productIds: ["88109"],
    },
  );
});

test("rejects a new product when a variant already points at another product", () => {
  assert.deepEqual(
    resolveTcgcsvVariantProductIds({
      candidateProductIds: ["88109"],
      existingProductIds: new Set(["118882"]),
    }),
    {
      ambiguous: true,
      productIds: ["118882", "88109"],
    },
  );
});

test("accepts the same valid product across current and existing mappings", () => {
  assert.deepEqual(
    resolveTcgcsvVariantProductIds({
      candidateProductIds: [88109],
      existingProductIds: new Set(["88109"]),
    }),
    {
      ambiguous: false,
      productIds: ["88109"],
    },
  );
});

test("rejects a lone malformed product reference", () => {
  assert.equal(
    resolveTcgcsvVariantProductIds({
      candidateProductIds: [],
      existingProductIds: ["not-a-product"],
    }).ambiguous,
    true,
  );
});
