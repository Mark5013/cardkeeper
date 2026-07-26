import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCardPrinting,
  normalizePrinting,
} from "../../src/lib/pokemon-tcg/printing.ts";

test("formats qualified modern-set printings with their marketplace names", () => {
  assert.equal(
    formatCardPrinting("poke_ball_holofoil"),
    "Poké Ball Pattern",
  );
  assert.equal(
    formatCardPrinting("master_ball_holofoil"),
    "Master Ball Pattern",
  );
  assert.equal(
    formatCardPrinting("holiday_calendar_holofoil"),
    "Holiday Calendar Holofoil",
  );
});

test("normalizes qualified printing labels without changing their identity", () => {
  assert.equal(
    normalizePrinting("Poke Ball Holofoil"),
    "poke_ball_holofoil",
  );
});
