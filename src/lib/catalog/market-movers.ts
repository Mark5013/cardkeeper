import "server-only";

import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import {
  selectWeeklyMarketMovers,
  type WeeklyMarketMover,
  type WeeklyMarketMoverCandidate,
  WEEKLY_MARKET_MOVER_MIN_CURRENT_MINOR,
  WEEKLY_MARKET_MOVER_MIN_GAIN_MINOR,
} from "@/lib/catalog/market-movers-core";
import { isTrustedTcgcsvHistoryDay } from "@/lib/catalog/tcgcsv-history-trust";
import { logError, measureDbQuery } from "@/lib/observability";
import { formatCardPrinting } from "@/lib/pokemon-tcg/printing";

type WeeklyMarketMoverRow = {
  cardId: string;
  name: string;
  number: string;
  setId: string;
  setName: string;
  imageSmallUrl: string | null;
  imageLargeUrl: string | null;
  printing: string;
  currentAmountMinor: string | number;
  previousAmountMinor: string | number;
  periodStart: string | Date;
  periodEnd: string | Date;
};

function parseMinorAmount(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatUtcDay(value: string | Date) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function mapMarketMoverRow(row: WeeklyMarketMoverRow): WeeklyMarketMoverCandidate | null {
  if (
    !isTrustedTcgcsvHistoryDay(
      row.cardId,
      row.printing,
      formatUtcDay(row.periodStart),
    )
  ) {
    return null;
  }

  const currentAmountMinor = parseMinorAmount(row.currentAmountMinor);
  const previousAmountMinor = parseMinorAmount(row.previousAmountMinor);

  if (currentAmountMinor === null || previousAmountMinor === null) return null;

  return {
    cardId: row.cardId,
    name: row.name,
    number: row.number,
    setId: row.setId,
    setName: row.setName,
    imageSmallUrl: row.imageSmallUrl,
    imageLargeUrl: row.imageLargeUrl,
    printing: row.printing,
    printingLabel: formatCardPrinting(row.printing, row.setId),
    currentAmountMinor,
    previousAmountMinor,
    periodStart: formatUtcDay(row.periodStart),
    periodEnd: formatUtcDay(row.periodEnd),
  };
}

const getCachedWeeklyMarketMovers = unstable_cache(
  async () => {
    const rows = await measureDbQuery(
      "db.weekly_market_movers",
      () =>
        db.execute<WeeklyMarketMoverRow>(sql`
          with anchor as (
            select max((observed_at at time zone 'UTC')::date) as current_on
            from current_prices
            where source = 'tcgcsv'
              and price_type = 'market'
              and currency = 'USD'
          ),
          scored as (
            select
              card.provider_id as "cardId",
              card.name,
              card.number,
              set_row.provider_id as "setId",
              set_row.name as "setName",
              card.image_small_url as "imageSmallUrl",
              card.image_large_url as "imageLargeUrl",
              variant.printing,
              current_price.amount_minor as "currentAmountMinor",
              prior.amount_minor as "previousAmountMinor",
              anchor.current_on - 7 as "periodStart",
              anchor.current_on as "periodEnd",
              ((current_price.amount_minor - prior.amount_minor) * 100.0 / prior.amount_minor)
                as percentage_change
            from current_prices current_price
            cross join anchor
            inner join card_variants variant
              on variant.id = current_price.card_variant_id
            inner join price_series series
              on series.card_variant_id = variant.id
              and series.source = current_price.source
              and series.price_type = current_price.price_type
              and series.currency = current_price.currency
            inner join cards card on card.id = variant.card_id
            inner join card_sets set_row on set_row.id = card.set_id
            cross join lateral (
              select
                series.amounts_minor[position] as amount_minor
              from generate_subscripts(series.observed_on, 1, true) as position
              where series.observed_on[position] <= anchor.current_on - 7
              limit 1
            ) prior
            where current_price.source = 'tcgcsv'
              and current_price.price_type = 'market'
              and current_price.currency = 'USD'
              and variant.condition = 'unspecified'
              and variant.language_code = 'en'
              and card.language_code = 'en'
              and card.is_active = true
              and set_row.language_code = 'en'
              and set_row.is_active = true
              and (
                select count(distinct external_ref.ref_value)
                from card_variant_external_refs external_ref
                where external_ref.card_variant_id = variant.id
                  and external_ref.source = 'tcgplayer'
                  and external_ref.ref_type = 'product_id'
                  and external_ref.ref_value ~ '^[1-9][0-9]{0,14}$'
                  and coalesce(
                    external_ref.metadata ->> 'tcgcsvMappingStatus',
                    ''
                  ) <> 'stale'
              ) = 1
              and not exists (
                select 1
                from card_variant_external_refs invalid_ref
                where invalid_ref.card_variant_id = variant.id
                  and invalid_ref.source = 'tcgplayer'
                  and invalid_ref.ref_type = 'product_id'
                  and (
                    invalid_ref.ref_value !~ '^[1-9][0-9]{0,14}$'
                    or invalid_ref.metadata ->> 'tcgcsvMappingStatus' = 'stale'
                  )
              )
              and current_price.amount_minor >= ${WEEKLY_MARKET_MOVER_MIN_CURRENT_MINOR}
              and prior.amount_minor > 0
              and current_price.amount_minor - prior.amount_minor >=
                ${WEEKLY_MARKET_MOVER_MIN_GAIN_MINOR}
          )
          select
            "cardId",
            name,
            number,
            "setId",
            "setName",
            "imageSmallUrl",
            "imageLargeUrl",
            printing,
            "currentAmountMinor",
            "previousAmountMinor",
            "periodStart",
            "periodEnd"
          from scored
          order by percentage_change desc,
            ("currentAmountMinor" - "previousAmountMinor") desc,
            "cardId"
        `),
      {},
    );

    return selectWeeklyMarketMovers(
      rows.flatMap((row) => {
        const candidate = mapMarketMoverRow(row);
        return candidate ? [candidate] : [];
      }),
    );
  },
  ["weekly-market-movers-v3"],
  { revalidate: 3_600, tags: ["weekly-market-movers"] },
);

export async function getWeeklyMarketMovers(): Promise<WeeklyMarketMover[]> {
  try {
    return await getCachedWeeklyMarketMovers();
  } catch (error) {
    logError("db.weekly_market_movers.failed", error);
    return [];
  }
}
