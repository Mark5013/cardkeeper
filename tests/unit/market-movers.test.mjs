import assert from "node:assert/strict";
import test from "node:test";

import {
  selectWeeklyMarketMovers,
  WEEKLY_MARKET_MOVER_LIMIT,
} from "../../src/lib/catalog/market-movers-core.ts";

function candidate(overrides = {}) {
  return {
    cardId: "card-1",
    name: "Pikachu",
    number: "1",
    setId: "set-1",
    setName: "Test Set",
    imageSmallUrl: "small.jpg",
    imageLargeUrl: "large.jpg",
    printing: "normal",
    printingLabel: "Normal",
    currentAmountMinor: 2_000,
    previousAmountMinor: 1_000,
    periodStart: "2026-07-17",
    periodEnd: "2026-07-24",
    ...overrides,
  };
}

test("requires a $10 current price and at least a $1 weekly gain", () => {
  const movers = selectWeeklyMarketMovers([
    candidate({ cardId: "under-price", currentAmountMinor: 999, previousAmountMinor: 100 }),
    candidate({ cardId: "under-gain", currentAmountMinor: 1_500, previousAmountMinor: 1_401 }),
    candidate({ cardId: "no-baseline", previousAmountMinor: 0 }),
    candidate({ cardId: "qualifies", currentAmountMinor: 1_000, previousAmountMinor: 900 }),
  ]);

  assert.deepEqual(movers.map((mover) => mover.cardId), ["qualifies"]);
  assert.equal(movers[0].currentPriceUsd, 10);
  assert.equal(movers[0].priceChangeUsd, 1);
});

test("ranks by percentage gain and keeps only the strongest printing for each card", () => {
  const movers = selectWeeklyMarketMovers(
    [
      candidate({
        cardId: "same-card",
        printing: "normal",
        currentAmountMinor: 3_000,
        previousAmountMinor: 2_000,
      }),
      candidate({
        cardId: "same-card",
        printing: "reverse_holofoil",
        currentAmountMinor: 2_000,
        previousAmountMinor: 1_000,
      }),
      candidate({
        cardId: "other-card",
        currentAmountMinor: 10_000,
        previousAmountMinor: 6_000,
      }),
    ],
    2,
  );

  assert.deepEqual(
    movers.map(({ cardId, printing }) => ({ cardId, printing })),
    [
      { cardId: "same-card", printing: "reverse_holofoil" },
      { cardId: "other-card", printing: "normal" },
    ],
  );
});

test("preserves prepared printing labels and never exceeds the homepage limit", () => {
  const movers = selectWeeklyMarketMovers(
    Array.from({ length: WEEKLY_MARKET_MOVER_LIMIT + 3 }, (_, index) =>
      candidate({
        cardId: `base-card-${index}`,
        setId: "base1",
        printing: "unlimited_holofoil",
        printingLabel: "Shadowless Holofoil",
        currentAmountMinor: 3_000 + index,
      }),
    ),
    50,
  );

  assert.equal(movers.length, WEEKLY_MARKET_MOVER_LIMIT);
  assert.equal(movers[0].printingLabel, "Shadowless Holofoil");
});
