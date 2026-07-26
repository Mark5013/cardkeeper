import assert from "node:assert/strict";
import test from "node:test";

import { buildTcgplayerListingUrlsByPrinting } from "../../src/lib/catalog/tcgplayer-listing-urls.ts";

test("builds one listing URL for each unambiguous printing", () => {
  assert.deepEqual(
    buildTcgplayerListingUrlsByPrinting([
      { printing: "normal", productId: "88109" },
      { printing: "holofoil", productId: 88110 },
    ]),
    {
      holofoil: "https://www.tcgplayer.com/product/88110/-?Language=English",
      normal: "https://www.tcgplayer.com/product/88109/-?Language=English",
    },
  );
});

test("allows duplicate refs that identify the same product", () => {
  assert.deepEqual(
    buildTcgplayerListingUrlsByPrinting([
      { printing: "normal", productId: "88109" },
      { printing: "normal", productId: 88109 },
      { printing: "normal", productId: "88109" },
    ]),
    {
      normal: "https://www.tcgplayer.com/product/88109/-?Language=English",
    },
  );
});

test("omits an ambiguous printing while preserving unambiguous printings", () => {
  assert.deepEqual(
    buildTcgplayerListingUrlsByPrinting([
      { printing: "normal", productId: "88109" },
      { printing: "normal", productId: "118882" },
      { printing: "holofoil", productId: "88109" },
    ]),
    {
      holofoil: "https://www.tcgplayer.com/product/88109/-?Language=English",
    },
  );
});

test("fails closed for invalid or unsafe product IDs", () => {
  assert.deepEqual(
    buildTcgplayerListingUrlsByPrinting([
      { printing: "normal", productId: "88109" },
      { printing: "normal", productId: "88109/../../malicious" },
      { printing: "holofoil", productId: Number.MAX_SAFE_INTEGER + 1 },
      { printing: "reverse_holofoil", productId: "0" },
      { printing: "first_edition", productId: null },
    ]),
    {},
  );
});

test("normalizes whitespace and leading zeroes without creating ambiguity", () => {
  assert.deepEqual(
    buildTcgplayerListingUrlsByPrinting([
      { printing: " normal ", productId: " 0088109 " },
      { printing: "normal", productId: "88109" },
      { printing: "", productId: "123" },
    ]),
    {
      normal: "https://www.tcgplayer.com/product/88109/-?Language=English",
    },
  );
});
