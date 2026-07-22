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
  calculatePriceChangePercentage,
  DEFAULT_PRICE_HISTORY_RANGE,
  expandDailyPricePoints,
  filterDailyPricePointsByRange,
  PRICE_HISTORY_RANGES,
  type DailyPriceHistoryPoint,
  type PriceHistoryRange,
} from "@/lib/catalog/price-history";
import type { CollectionValueHistoryDto } from "@/lib/collection/types";

type ChartPoint = DailyPriceHistoryPoint & {
  dateLabel: string;
  valueLabel: string;
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percentage = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
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

function CollectionValueTooltip({
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
      <p className="font-bold text-[var(--ink)]">{point.valueLabel}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{point.dateLabel}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {point.isRecorded
          ? "Calculated from recorded market prices and collection quantities"
          : "Carried forward from the previous price or quantity change"}
      </p>
    </div>
  );
}

export function CollectionValueHistoryChart({
  history,
}: {
  history: CollectionValueHistoryDto;
}) {
  const [selectedRange, setSelectedRange] =
    useState<PriceHistoryRange>(DEFAULT_PRICE_HISTORY_RANGE);
  const points = useMemo<ChartPoint[]>(() => {
    const dailyPoints = expandDailyPricePoints(history.points);

    return filterDailyPricePointsByRange(dailyPoints, selectedRange).map((point) => ({
      ...point,
      dateLabel: formatDate(point.timestamp),
      valueLabel: usd.format(point.amountUsd),
    }));
  }, [history.points, selectedRange]);

  if (points.length === 0) {
    return (
      <div className="mt-4 grid min-h-48 place-items-center rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] p-7 text-center text-[var(--muted)]">
        No historical market prices are available for the cards in this collection yet.
      </div>
    );
  }

  const minValue = Math.min(...points.map((point) => point.amountUsd));
  const maxValue = Math.max(...points.map((point) => point.amountUsd));
  const domainPadding = Math.max((maxValue - minValue) * 0.12, maxValue * 0.08, 1);
  const latestPoint = points[points.length - 1];
  const selectedRangeLabel =
    PRICE_HISTORY_RANGES.find((range) => range.value === selectedRange)?.label ??
    "Value history";
  const valueChangePercentage = calculatePriceChangePercentage(points);
  const valueChangeLabel =
    valueChangePercentage === null
      ? "Not available"
      : `${valueChangePercentage > 0 ? "+" : ""}${percentage.format(valueChangePercentage)}%`;
  const valueChangeColor =
    valueChangePercentage === null || valueChangePercentage === 0
      ? "text-[var(--muted)]"
      : valueChangePercentage > 0
        ? "text-emerald-400"
        : "text-[var(--danger)]";

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
                width={64}
                tick={{ fill: "var(--muted)", fontSize: 12 }}
                tickFormatter={(value) => compactUsd.format(Number(value))}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                domain={[Math.max(0, minValue - domainPadding), maxValue + domainPadding]}
              />
              <Tooltip
                content={<CollectionValueTooltip />}
                cursor={{
                  stroke: "var(--secondary)",
                  strokeWidth: 1.5,
                  strokeDasharray: "4 4",
                }}
              />
              <Line
                dataKey="amountUsd"
                dot={false}
                activeDot={{
                  fill: "var(--secondary-hover)",
                  r: 6,
                  stroke: "var(--background)",
                  strokeWidth: 2,
                }}
                isAnimationActive={false}
                name="Collection value"
                stroke="var(--secondary)"
                strokeWidth={3}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 overflow-x-auto pb-1">
          <div
            aria-label="Collection value history range"
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

      <aside className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
            Current value
          </p>
          <p className="mt-1.5 text-2xl font-black text-[var(--ink)]">
            {latestPoint.valueLabel}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Latest snapshot: {latestPoint.dateLabel}
          </p>
        </div>

        <div className="mt-4 border-t border-[var(--line)] pt-3">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
            {selectedRangeLabel} change
          </p>
          <p className={`mt-1.5 text-xl font-black ${valueChangeColor}`}>
            {valueChangeLabel}
          </p>
        </div>

        <div className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
          <p className="font-semibold text-[var(--ink)]">Current holdings</p>
          <p className="mt-1">
            {selectedRangeLabel} · {points.length.toLocaleString()} chart{" "}
            {points.length === 1 ? "day" : "days"}
          </p>
          <p className="mt-1">
            {history.pricedVariants.toLocaleString()} of{" "}
            {history.totalVariants.toLocaleString()} variants valued
          </p>
        </div>
      </aside>
    </div>
  );
}
