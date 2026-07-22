export type CollectionValueSourcePoint = {
  observedAt: string;
  amountMinor: number;
};

export type CollectionValueSourceSeries = {
  quantity: number;
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
    if (!Number.isInteger(series.quantity) || series.quantity <= 0) continue;

    const latestPointByDay = new Map<number, CollectionValueSourcePoint>();

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

    const recordedDays = Array.from(latestPointByDay.keys()).sort(
      (first, second) => first - second,
    );
    let previousAmountMinor = 0;

    for (const timestamp of recordedDays) {
      const point = latestPointByDay.get(timestamp);
      if (!point) continue;

      const valueChangeMinor = (point.amountMinor - previousAmountMinor) * series.quantity;
      valueChangesByDay.set(
        timestamp,
        (valueChangesByDay.get(timestamp) ?? 0) + valueChangeMinor,
      );
      previousAmountMinor = point.amountMinor;
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
