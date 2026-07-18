export type PriceHistoryPoint = {
  observedAt: string;
  amountUsd: number;
};

export type DailyPriceHistoryPoint = PriceHistoryPoint & {
  timestamp: number;
  isRecorded: boolean;
};

export type PriceHistoryRange = "1w" | "1m" | "3m" | "6m" | "1y" | "2y" | "max";

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

export function filterDailyPricePointsByRange(
  points: DailyPriceHistoryPoint[],
  range: PriceHistoryRange,
) {
  if (range === "max" || points.length === 0) return points;

  const latestTimestamp = points[points.length - 1].timestamp;
  const startTimestamp =
    range === "1w"
      ? latestTimestamp - 6 * DAY_MS
      : subtractUtcMonths(latestTimestamp, {
          "1m": 1,
          "3m": 3,
          "6m": 6,
          "1y": 12,
          "2y": 24,
        }[range]);

  return points.filter((point) => point.timestamp >= startTimestamp);
}

export function calculatePriceChangePercentage(points: PriceHistoryPoint[]) {
  if (points.length < 2) return null;

  const startingAmount = points[0].amountUsd;
  const latestAmount = points[points.length - 1].amountUsd;

  if (!Number.isFinite(startingAmount) || !Number.isFinite(latestAmount) || startingAmount <= 0) {
    return null;
  }

  return ((latestAmount - startingAmount) / startingAmount) * 100;
}

function subtractUtcMonths(timestamp: number, months: number) {
  const source = new Date(timestamp);
  const absoluteMonth = source.getUTCFullYear() * 12 + source.getUTCMonth() - months;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12;
  const targetMonthLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return Date.UTC(
    targetYear,
    targetMonth,
    Math.min(source.getUTCDate(), targetMonthLastDay),
  );
}
