export type CollectionValueSourcePoint = {
  observedAt: string;
  amountMinor: number;
};

export type CollectionQuantitySourcePoint = {
  effectiveAt: string;
  quantity: number;
};

export type CollectionValueSourceSeries = {
  quantityChanges: CollectionQuantitySourcePoint[];
  points: CollectionValueSourcePoint[];
};

export type CollectionValueHistoryPoint = {
  observedAt: string;
  amountUsd: number;
};

function getUtcDayTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function aggregateCollectionValueHistory(
  sourceSeries: CollectionValueSourceSeries[],
): CollectionValueHistoryPoint[] {
  const valueChangesByDay = new Map<number, number>();

  for (const series of sourceSeries) {
    const latestPointByDay = new Map<number, CollectionValueSourcePoint>();
    const latestQuantityByDay = new Map<number, CollectionQuantitySourcePoint>();

    for (const point of series.points) {
      const timestamp = getUtcDayTimestamp(point.observedAt);

      if (
        timestamp === null ||
        !Number.isSafeInteger(point.amountMinor) ||
        point.amountMinor < 0
      ) {
        continue;
      }

      const existingPoint = latestPointByDay.get(timestamp);
      if (
        !existingPoint ||
        new Date(point.observedAt).getTime() >= new Date(existingPoint.observedAt).getTime()
      ) {
        latestPointByDay.set(timestamp, point);
      }
    }

    for (const quantityChange of series.quantityChanges) {
      const timestamp = getUtcDayTimestamp(quantityChange.effectiveAt);

      if (
        timestamp === null ||
        !Number.isInteger(quantityChange.quantity) ||
        quantityChange.quantity < 0
      ) {
        continue;
      }

      const existingChange = latestQuantityByDay.get(timestamp);
      if (
        !existingChange ||
        new Date(quantityChange.effectiveAt).getTime() >=
          new Date(existingChange.effectiveAt).getTime()
      ) {
        latestQuantityByDay.set(timestamp, quantityChange);
      }
    }

    const quantityDays = Array.from(latestQuantityByDay.keys());
    if (quantityDays.length === 0) continue;

    const firstQuantityDay = Math.min(...quantityDays);
    const recordedDays = Array.from(
      new Set([...latestPointByDay.keys(), ...quantityDays]),
    ).sort(
      (first, second) => first - second,
    );
    let currentAmountMinor = 0;
    let currentQuantity = 0;
    let previousValueMinor = 0;

    for (const timestamp of recordedDays) {
      const point = latestPointByDay.get(timestamp);
      if (point) currentAmountMinor = point.amountMinor;

      const quantityChange = latestQuantityByDay.get(timestamp);
      if (quantityChange) currentQuantity = quantityChange.quantity;

      if (timestamp < firstQuantityDay) continue;

      const nextValueMinor = currentAmountMinor * currentQuantity;
      if (!Number.isSafeInteger(nextValueMinor)) continue;

      valueChangesByDay.set(
        timestamp,
        (valueChangesByDay.get(timestamp) ?? 0) + nextValueMinor - previousValueMinor,
      );
      previousValueMinor = nextValueMinor;
    }
  }

  const recordedDays = Array.from(valueChangesByDay.keys()).sort(
    (first, second) => first - second,
  );
  const history: CollectionValueHistoryPoint[] = [];
  let collectionValueMinor = 0;

  for (const timestamp of recordedDays) {
    collectionValueMinor += valueChangesByDay.get(timestamp) ?? 0;
    history.push({
      observedAt: new Date(timestamp).toISOString(),
      amountUsd: collectionValueMinor / 100,
    });
  }

  return history;
}
