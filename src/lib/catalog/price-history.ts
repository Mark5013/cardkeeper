export type PriceHistoryPoint = {
  observedAt: string;
  amountUsd: number;
};

export type DailyPriceHistoryPoint = PriceHistoryPoint & {
  timestamp: number;
  isRecorded: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function getUtcDayTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function expandDailyPricePoints(sourcePoints: PriceHistoryPoint[]) {
  const recordedPointsByDay = new Map<number, PriceHistoryPoint>();

  for (const point of sourcePoints) {
    const timestamp = getUtcDayTimestamp(point.observedAt);

    if (timestamp === null) continue;

    const existingPoint = recordedPointsByDay.get(timestamp);

    if (!existingPoint || new Date(point.observedAt).getTime() >= new Date(existingPoint.observedAt).getTime()) {
      recordedPointsByDay.set(timestamp, point);
    }
  }

  const recordedDays = Array.from(recordedPointsByDay.keys()).sort((first, second) => first - second);

  if (recordedDays.length === 0) return [];

  const chartPoints: DailyPriceHistoryPoint[] = [];
  const firstDay = recordedDays[0];
  const lastDay = recordedDays[recordedDays.length - 1];
  let latestAmountUsd: number | null = null;

  for (let timestamp = firstDay; timestamp <= lastDay; timestamp += DAY_MS) {
    const recordedPoint = recordedPointsByDay.get(timestamp);

    if (recordedPoint) latestAmountUsd = recordedPoint.amountUsd;
    if (latestAmountUsd === null) continue;

    chartPoints.push({
      observedAt: new Date(timestamp).toISOString(),
      timestamp,
      amountUsd: latestAmountUsd,
      isRecorded: Boolean(recordedPoint),
    });
  }

  return chartPoints;
}
