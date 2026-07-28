import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCardNumber,
  isUnnumberedCardNumber,
} from "../../src/lib/pokemon-tcg/card-number.ts";

test("formats numbered cards with a collector-number prefix and set total", () => {
  assert.equal(formatCardNumber("25", 102), "#25 / 102");
  assert.equal(formatCardNumber("025/102", 102), "#025/102");
});

test("formats normalized and legacy synthetic unnumbered cards without a hash", () => {
  assert.equal(formatCardNumber("Unnumbered"), "Unnumbered");
  assert.equal(formatCardNumber("Unnumbered-617431", 10), "Unnumbered");
  assert.equal(isUnnumberedCardNumber("Unnumbered-617431"), true);
});
