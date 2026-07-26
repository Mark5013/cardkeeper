export const WEEKLY_MARKET_MOVER_LIMIT = 9;
export const WEEKLY_MARKET_MOVER_MIN_CURRENT_MINOR = 1_000;
export const WEEKLY_MARKET_MOVER_MIN_GAIN_MINOR = 100;

export type WeeklyMarketMoverCandidate = {
  cardId: string;
  name: string;
  number: string;
  setId: string;
  setName: string;
  imageSmallUrl: string | null;
  imageLargeUrl: string | null;
  printing: string;
  printingLabel: string;
  currentAmountMinor: number;
  previousAmountMinor: number;
  periodStart: string;
  periodEnd: string;
};

export type WeeklyMarketMover = WeeklyMarketMoverCandidate & {
  currentPriceUsd: number;
  previousPriceUsd: number;
  priceChangeUsd: number;
  percentageChange: number;
};

export function selectWeeklyMarketMovers(
  candidates: WeeklyMarketMoverCandidate[],
  limit = WEEKLY_MARKET_MOVER_LIMIT,
): WeeklyMarketMover[] {
  const safeLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, WEEKLY_MARKET_MOVER_LIMIT) : 0;
  if (safeLimit === 0) return [];

  const ranked = candidates.flatMap((candidate) => {
    if (
      !candidate.cardId ||
      !candidate.setId ||
      !Number.isSafeInteger(candidate.currentAmountMinor) ||
      !Number.isSafeInteger(candidate.previousAmountMinor) ||
      candidate.currentAmountMinor < WEEKLY_MARKET_MOVER_MIN_CURRENT_MINOR ||
      candidate.previousAmountMinor <= 0
    ) {
      return [];
    }

    const priceChangeMinor = candidate.currentAmountMinor - candidate.previousAmountMinor;
    if (priceChangeMinor < WEEKLY_MARKET_MOVER_MIN_GAIN_MINOR) return [];

    return [
      {
        ...candidate,
        currentPriceUsd: candidate.currentAmountMinor / 100,
        previousPriceUsd: candidate.previousAmountMinor / 100,
        priceChangeUsd: priceChangeMinor / 100,
        percentageChange: (priceChangeMinor / candidate.previousAmountMinor) * 100,
      },
    ];
  });

  ranked.sort(
    (left, right) =>
      right.percentageChange - left.percentageChange ||
      right.priceChangeUsd - left.priceChangeUsd ||
      left.cardId.localeCompare(right.cardId, "en") ||
      left.printing.localeCompare(right.printing, "en"),
  );

  const selected: WeeklyMarketMover[] = [];
  const selectedCardIds = new Set<string>();

  for (const mover of ranked) {
    if (selectedCardIds.has(mover.cardId)) continue;
    selectedCardIds.add(mover.cardId);
    selected.push(mover);
    if (selected.length === safeLimit) break;
  }

  return selected;
}
