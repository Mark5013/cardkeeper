import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPriceRows,
  classifyTcgcsvProduct,
  getCardNumberDenominator,
  normalizeTcgcsvPrinting,
} from "../../scripts/lib/tcgcsv-product-import.mjs";

test("classifies numbered products as cards", () => {
  assert.equal(
    classifyTcgcsvProduct({
      name: "Spinarak",
      extendedData: [{ name: "Number", value: "001/080" }],
    }),
    "card",
  );
});

test("classifies physical boxes as sealed and excludes code cards", () => {
  assert.equal(
    classifyTcgcsvProduct({
      name: "First Partner Illustration Collection",
      extendedData: [{ name: "UPC", value: "0196214150522" }],
    }),
    "sealed",
  );
  assert.equal(
    classifyTcgcsvProduct({
      name: "Code Card - First Partner Illustration Collection",
      extendedData: [{ name: "Rarity", value: "Code Card" }],
    }),
    "excluded",
  );
});

test("classifies unnumbered rarity-bearing products as cards", () => {
  assert.equal(
    classifyTcgcsvProduct({
      name: "Unnumbered promotional card",
      extendedData: [{ name: "Rarity", value: "Promo" }],
    }),
    "card",
  );
});

test("normalizes price subtypes to valid printing keys", () => {
  assert.equal(normalizeTcgcsvPrinting("Reverse Holofoil"), "reverse_holofoil");
  assert.equal(normalizeTcgcsvPrinting("1st Edition Holofoil"), "1st_edition_holofoil");
});

test("preserves non-null nonnegative price types in cents", () => {
  assert.deepEqual(
    buildPriceRows({
      lowPrice: 1.01,
      midPrice: 2,
      highPrice: null,
      marketPrice: 1.555,
      directLowPrice: -1,
    }),
    [
      { priceType: "low", amountMinor: 101 },
      { priceType: "mid", amountMinor: 200 },
      { priceType: "market", amountMinor: 156 },
    ],
  );
});

test("extracts a collector-number denominator", () => {
  assert.equal(getCardNumberDenominator("001/080"), 80);
  assert.equal(getCardNumberDenominator("SV-P 001"), null);
});
