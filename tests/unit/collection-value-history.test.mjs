import assert from "node:assert/strict";
import test from "node:test";

import { aggregateCollectionValueHistory } from "../../src/lib/collection/value-history.ts";

test("aggregates historical market prices using quantities effective on each day", () => {
  const points = aggregateCollectionValueHistory([
    {
      quantityChanges: [{ effectiveAt: "2026-07-10T00:00:00.000Z", quantity: 2 }],
      points: [
        { observedAt: "2026-07-10T00:00:00.000Z", amountMinor: 100 },
        { observedAt: "2026-07-12T00:00:00.000Z", amountMinor: 150 },
      ],
    },
    {
      quantityChanges: [{ effectiveAt: "2026-07-11T00:00:00.000Z", quantity: 1 }],
      points: [
        { observedAt: "2026-07-10T00:00:00.000Z", amountMinor: 500 },
        { observedAt: "2026-07-12T00:00:00.000Z", amountMinor: 400 },
      ],
    },
  ]);

  assert.deepEqual(points, [
    { observedAt: "2026-07-10T00:00:00.000Z", amountUsd: 2 },
    { observedAt: "2026-07-11T00:00:00.000Z", amountUsd: 7 },
    { observedAt: "2026-07-12T00:00:00.000Z", amountUsd: 7 },
  ]);
});

test("keeps a latest unchanged observation so chart ranges end at the current snapshot", () => {
  const points = aggregateCollectionValueHistory([
    {
      quantityChanges: [{ effectiveAt: "2026-07-10T00:00:00.000Z", quantity: 1 }],
      points: [
        { observedAt: "2026-07-10T00:00:00.000Z", amountMinor: 1250 },
        { observedAt: "2026-07-18T20:00:00.000Z", amountMinor: 1250 },
      ],
    },
  ]);

  assert.deepEqual(points, [
    { observedAt: "2026-07-10T00:00:00.000Z", amountUsd: 12.5 },
    { observedAt: "2026-07-18T00:00:00.000Z", amountUsd: 12.5 },
  ]);
});

test("uses the latest valid observation per UTC day and ignores invalid series data", () => {
  const points = aggregateCollectionValueHistory([
    {
      quantityChanges: [
        { effectiveAt: "2026-07-10T10:00:00.000Z", quantity: 1 },
        { effectiveAt: "2026-07-10T20:00:00.000Z", quantity: 3 },
      ],
      points: [
        { observedAt: "2026-07-10T10:00:00.000Z", amountMinor: 100 },
        { observedAt: "2026-07-10T20:00:00.000Z", amountMinor: 125 },
        { observedAt: "invalid", amountMinor: 500 },
        { observedAt: "2026-07-11T00:00:00.000Z", amountMinor: -1 },
      ],
    },
    {
      quantityChanges: [
        { effectiveAt: "2026-07-10T00:00:00.000Z", quantity: 0 },
        { effectiveAt: "invalid", quantity: 1 },
        { effectiveAt: "2026-07-11T00:00:00.000Z", quantity: -1 },
      ],
      points: [{ observedAt: "2026-07-10T00:00:00.000Z", amountMinor: 999 }],
    },
  ]);

  assert.deepEqual(points, [
    { observedAt: "2026-07-10T00:00:00.000Z", amountUsd: 3.75 },
  ]);
});

test("does not apply a newly added card to days before it entered the collection", () => {
  const points = aggregateCollectionValueHistory([
    {
      quantityChanges: [{ effectiveAt: "2026-07-12T15:00:00.000Z", quantity: 2 }],
      points: [
        { observedAt: "2026-07-10T00:00:00.000Z", amountMinor: 100 },
        { observedAt: "2026-07-13T00:00:00.000Z", amountMinor: 150 },
      ],
    },
  ]);

  assert.deepEqual(points, [
    { observedAt: "2026-07-12T00:00:00.000Z", amountUsd: 2 },
    { observedAt: "2026-07-13T00:00:00.000Z", amountUsd: 3 },
  ]);
});

test("applies removals and later re-additions only from their effective days onward", () => {
  const points = aggregateCollectionValueHistory([
    {
      quantityChanges: [
        { effectiveAt: "2026-07-11T00:00:00.000Z", quantity: 1 },
        { effectiveAt: "2026-07-13T00:00:00.000Z", quantity: 0 },
        { effectiveAt: "2026-07-15T00:00:00.000Z", quantity: 2 },
      ],
      points: [
        { observedAt: "2026-07-10T00:00:00.000Z", amountMinor: 500 },
        { observedAt: "2026-07-12T00:00:00.000Z", amountMinor: 600 },
        { observedAt: "2026-07-14T00:00:00.000Z", amountMinor: 700 },
      ],
    },
  ]);

  assert.deepEqual(points, [
    { observedAt: "2026-07-11T00:00:00.000Z", amountUsd: 5 },
    { observedAt: "2026-07-12T00:00:00.000Z", amountUsd: 6 },
    { observedAt: "2026-07-13T00:00:00.000Z", amountUsd: 0 },
    { observedAt: "2026-07-14T00:00:00.000Z", amountUsd: 0 },
    { observedAt: "2026-07-15T00:00:00.000Z", amountUsd: 14 },
  ]);
});
