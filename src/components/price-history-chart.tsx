"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type PriceHistoryPoint = {
  observedAt: string;
  amountUsd: number;
};

type PriceHistorySeries = {
  printing: string;
  condition: string;
  label: string;
  points: PriceHistoryPoint[];
};

type ChartPoint = PriceHistoryPoint & {
  dateLabel: string;
  priceLabel: string;
};

type PriceHistorySummaryProps = {
  latestPoint: ChartPoint;
  selectedSeries: PriceHistorySeries;
  snapshotCount: number;
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

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(value: string) {
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
    </div>
  );
}

function PriceHistorySummary({
  latestPoint,
  selectedSeries,
  snapshotCount,
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
          {snapshotCount === 1
            ? "1 market price point"
            : `${snapshotCount.toLocaleString()} market price points`}
        </p>
      </div>
    </aside>
  );
}

export function PriceHistoryChart({ series }: { series: PriceHistorySeries[] }) {
  const selectedSeries = getPreferredSeries(series);
  const points = useMemo<ChartPoint[]>(() => {
    return [...(selectedSeries?.points ?? [])]
      .sort((first, second) => new Date(first.observedAt).getTime() - new Date(second.observedAt).getTime())
      .map((point) => ({
        ...point,
        dateLabel: formatDate(point.observedAt),
        priceLabel: usd.format(point.amountUsd),
      }));
  }, [selectedSeries]);

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

  return (
    <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 12, right: 16, bottom: 12, left: 4 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fill: "var(--muted)", fontSize: 12 }}
                tickLine={false}
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
                dot={{ fill: "var(--secondary)", r: 4, stroke: "var(--background)", strokeWidth: 2 }}
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
      </div>

      <PriceHistorySummary
        latestPoint={latestPoint}
        selectedSeries={selectedSeries}
        snapshotCount={points.length}
      />
    </div>
  );
}

function getPreferredSeries(series: PriceHistorySeries[]) {
  return series.find((item) => item.condition === "unspecified") ?? series[0];
}
