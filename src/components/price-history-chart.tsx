"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  expandDailyPricePoints,
  filterDailyPricePointsByRange,
  type DailyPriceHistoryPoint,
  type PriceHistoryPoint,
  type PriceHistoryRange,
} from "@/lib/catalog/price-history";

type PriceHistorySeries = {
  printing: string;
  condition: string;
  label: string;
  points: PriceHistoryPoint[];
};

type ChartPoint = DailyPriceHistoryPoint & {
  dateLabel: string;
  priceLabel: string;
};

type PriceHistorySummaryProps = {
  latestPoint: ChartPoint;
  recordedPointCount: number;
  selectedSeries: PriceHistorySeries;
  chartDayCount: number;
  rangeLabel: string;
};

const PRICE_HISTORY_RANGES: { value: PriceHistoryRange; shortLabel: string; label: string }[] = [
  { value: "1w", shortLabel: "1W", label: "1 week" },
  { value: "1m", shortLabel: "1M", label: "1 month" },
  { value: "3m", shortLabel: "3M", label: "3 months" },
  { value: "6m", shortLabel: "6M", label: "6 months" },
  { value: "1y", shortLabel: "1Y", label: "1 year" },
  { value: "2y", shortLabel: "2Y", label: "2 years" },
  { value: "max", shortLabel: "Max", label: "Maximum" },
];

const DEFAULT_PRICE_HISTORY_RANGE: PriceHistoryRange = "1y";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string | number) {
  return dateFormatter.format(new Date(value));
}

function PriceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}) {
  const point = payload?.[0]?.payload;

  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm shadow-[0_14px_32px_rgb(0_0_0_/_32%)]">
      <p className="font-bold text-[var(--ink)]">{point.priceLabel}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{point.dateLabel}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {point.isRecorded ? "Recorded market value" : "Carried forward from the previous change"}
      </p>
    </div>
  );
}

function PriceHistorySummary({
  latestPoint,
  recordedPointCount,
  selectedSeries,
  chartDayCount,
  rangeLabel,
}: PriceHistorySummaryProps) {
  return (
    <aside className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Current market</p>
        <p className="mt-1.5 text-2xl font-black text-[var(--ink)]">{latestPoint.priceLabel}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">Latest snapshot: {latestPoint.dateLabel}</p>
      </div>

      <div className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
        <p className="truncate font-semibold text-[var(--ink)]" title={selectedSeries.label}>
          {selectedSeries.label}
        </p>
        <p className="mt-1">
          {rangeLabel} · {chartDayCount.toLocaleString()} chart {chartDayCount === 1 ? "day" : "days"}
        </p>
        <p className="mt-1">
          {recordedPointCount.toLocaleString()} recorded price {recordedPointCount === 1 ? "value" : "values"}
        </p>
      </div>
    </aside>
  );
}

export function PriceHistoryChart({ series }: { series: PriceHistorySeries[] }) {
  const [selectedRange, setSelectedRange] = useState<PriceHistoryRange>(DEFAULT_PRICE_HISTORY_RANGE);
  const selectedSeries = getPreferredSeries(series);
  const points = useMemo<ChartPoint[]>(() => {
    const dailyPoints = expandDailyPricePoints(selectedSeries?.points ?? []);

    return filterDailyPricePointsByRange(dailyPoints, selectedRange).map((point) => ({
      ...point,
      dateLabel: formatDate(point.timestamp),
      priceLabel: usd.format(point.amountUsd),
    }));
  }, [selectedRange, selectedSeries]);

  if (!selectedSeries || points.length === 0) {
    return (
      <div className="mt-4 grid min-h-48 place-items-center rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] p-7 text-center text-[var(--muted)]">
        No price snapshots are available for this card yet.
      </div>
    );
  }

  const minPrice = Math.min(...points.map((point) => point.amountUsd));
  const maxPrice = Math.max(...points.map((point) => point.amountUsd));
  const domainPadding = Math.max((maxPrice - minPrice) * 0.12, maxPrice * 0.08, 1);
  const latestPoint = points[points.length - 1];
  const selectedRangeLabel =
    PRICE_HISTORY_RANGES.find((range) => range.value === selectedRange)?.label ?? "Price history";
  const recordedPointCount = points.filter((point) => point.isRecorded).length;

  return (
    <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 12, right: 16, bottom: 12, left: 4 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="timestamp"
                domain={["dataMin", "dataMax"]}
                scale="time"
                tick={{ fill: "var(--muted)", fontSize: 12 }}
                tickFormatter={(value) => formatDate(Number(value))}
                tickLine={false}
                type="number"
                axisLine={{ stroke: "var(--line)" }}
                minTickGap={24}
              />
              <YAxis
                width={56}
                tick={{ fill: "var(--muted)", fontSize: 12 }}
                tickFormatter={(value) => compactUsd.format(Number(value))}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                domain={[Math.max(0, minPrice - domainPadding), maxPrice + domainPadding]}
              />
              <Tooltip
                content={<PriceTooltip />}
                cursor={{ stroke: "var(--secondary)", strokeWidth: 1.5, strokeDasharray: "4 4" }}
              />
              <Line
                dataKey="amountUsd"
                dot={false}
                activeDot={{ fill: "var(--secondary-hover)", r: 6, stroke: "var(--background)", strokeWidth: 2 }}
                isAnimationActive={false}
                name="Market price"
                stroke="var(--secondary)"
                strokeWidth={3}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 overflow-x-auto pb-1">
          <div
            aria-label="Price history range"
            className="mx-auto flex w-max gap-1 rounded-lg border border-[var(--line)] bg-[var(--background)] p-1"
            role="group"
          >
            {PRICE_HISTORY_RANGES.map((range) => {
              const isSelected = range.value === selectedRange;

              return (
                <button
                  aria-pressed={isSelected}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                    isSelected
                      ? "bg-[var(--secondary)] text-[var(--background)]"
                      : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                  }`}
                  key={range.value}
                  onClick={() => setSelectedRange(range.value)}
                  type="button"
                >
                  {range.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <PriceHistorySummary
        latestPoint={latestPoint}
        recordedPointCount={recordedPointCount}
        rangeLabel={selectedRangeLabel}
        selectedSeries={selectedSeries}
        chartDayCount={points.length}
      />
    </div>
  );
}

function getPreferredSeries(series: PriceHistorySeries[]) {
  return series.find((item) => item.condition === "unspecified") ?? series[0];
}
