import assert from "node:assert/strict";
import test from "node:test";

import {
  isTcgcsvHistoryAwaitingRebuild,
  isTrustedTcgcsvHistoryDay,
} from "../../src/lib/catalog/tcgcsv-history-trust.ts";

test("quarantines only histories that were price-contaminated", () => {
  assert.equal(isTcgcsvHistoryAwaitingRebuild("np-35", "normal"), true);
  assert.equal(isTcgcsvHistoryAwaitingRebuild("np-35", "holofoil"), false);
});

test("uses repaired observations while hiding older contaminated points", () => {
  assert.equal(
    isTrustedTcgcsvHistoryDay("np-35", "normal", "2026-07-24"),
    false,
  );
  assert.equal(
    isTrustedTcgcsvHistoryDay("np-35", "normal", "2026-07-25"),
    true,
  );
  assert.equal(
    isTrustedTcgcsvHistoryDay("np-35", "holofoil", "2024-02-08"),
    true,
  );
});
