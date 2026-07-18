import assert from "node:assert/strict";
import test from "node:test";

import {
  expandDailyPricePoints,
  filterDailyPricePointsByRange,
} from "../../src/lib/catalog/price-history.ts";

test("carries the latest recorded price across missing UTC days", () => {
  const points = expandDailyPricePoints([
    { observedAt: "2026-07-10T20:05:44.000Z", amountUsd: 728.31 },
    { observedAt: "2026-07-13T20:05:32.000Z", amountUsd: 773.51 },
    { observedAt: "2026-07-17T20:05:11.000Z", amountUsd: 729.08 },
  ]);

  assert.equal(points.length, 8);
  assert.deepEqual(
    points.map((point) => ({
      date: point.observedAt.slice(0, 10),
      amountUsd: point.amountUsd,
      isRecorded: point.isRecorded,
    })),
    [
      { date: "2026-07-10", amountUsd: 728.31, isRecorded: true },
      { date: "2026-07-11", amountUsd: 728.31, isRecorded: false },
      { date: "2026-07-12", amountUsd: 728.31, isRecorded: false },
      { date: "2026-07-13", amountUsd: 773.51, isRecorded: true },
      { date: "2026-07-14", amountUsd: 773.51, isRecorded: false },
      { date: "2026-07-15", amountUsd: 773.51, isRecorded: false },
      { date: "2026-07-16", amountUsd: 773.51, isRecorded: false },
      { date: "2026-07-17", amountUsd: 729.08, isRecorded: true },
    ],
  );
});

test("uses the latest recorded value when a UTC day has multiple observations", () => {
  const points = expandDailyPricePoints([
    { observedAt: "2026-07-10T10:00:00.000Z", amountUsd: 10 },
    { observedAt: "2026-07-10T20:00:00.000Z", amountUsd: 12 },
  ]);

  assert.equal(points.length, 1);
  assert.equal(points[0].amountUsd, 12);
  assert.equal(points[0].isRecorded, true);
});

test("ignores invalid observation timestamps", () => {
  assert.deepEqual(expandDailyPricePoints([{ observedAt: "invalid", amountUsd: 10 }]), []);
});

test("limits the chart to seven inclusive UTC days for the one-week range", () => {
  const points = expandDailyPricePoints([
    { observedAt: "2026-07-01T00:00:00.000Z", amountUsd: 10 },
    { observedAt: "2026-07-18T00:00:00.000Z", amountUsd: 12 },
  ]);
  const filtered = filterDailyPricePointsByRange(points, "1w");

  assert.equal(filtered.length, 7);
  assert.equal(filtered[0].observedAt.slice(0, 10), "2026-07-12");
  assert.equal(filtered[0].amountUsd, 10);
  assert.equal(filtered.at(-1).observedAt.slice(0, 10), "2026-07-18");
});

test("uses calendar-month boundaries and clamps shorter target months", () => {
  const points = expandDailyPricePoints([
    { observedAt: "2026-01-01T00:00:00.000Z", amountUsd: 10 },
    { observedAt: "2026-03-31T00:00:00.000Z", amountUsd: 12 },
  ]);
  const filtered = filterDailyPricePointsByRange(points, "1m");

  assert.equal(filtered[0].observedAt.slice(0, 10), "2026-02-28");
  assert.equal(filtered.at(-1).observedAt.slice(0, 10), "2026-03-31");
});

test("returns the complete expanded history for the maximum range", () => {
  const points = expandDailyPricePoints([
    { observedAt: "2024-02-08T00:00:00.000Z", amountUsd: 10 },
    { observedAt: "2026-07-18T00:00:00.000Z", amountUsd: 12 },
  ]);

  assert.equal(filterDailyPricePointsByRange(points, "max"), points);
});
