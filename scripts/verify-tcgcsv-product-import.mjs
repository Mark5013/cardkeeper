import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to verify the TCGCSV product import.");
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 20,
});

try {
  const [counts] = await sql`
    select
      (
        select count(*)::integer
        from card_sets
        where language_code = 'ja' and is_active
      ) as japanese_sets,
      (
        select count(*)::integer
        from cards
        where language_code = 'ja' and is_active
      ) as japanese_cards,
      (
        select count(*)::integer
        from card_variants
        where language_code = 'ja'
      ) as japanese_variants,
      (
        select count(*)::integer
        from current_prices as price
        inner join card_variants as variant
          on variant.id = price.card_variant_id
        where variant.language_code = 'ja'
          and price.source = 'tcgcsv'
      ) as japanese_current_prices,
      (
        select count(*)::integer
        from price_series as series
        inner join card_variants as variant
          on variant.id = series.card_variant_id
        where variant.language_code = 'ja'
          and series.source = 'tcgcsv'
      ) as japanese_price_series,
      (
        select count(*)::integer
        from price_series as series
        inner join card_variants as variant
          on variant.id = series.card_variant_id
        where variant.language_code = 'ja'
          and series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
      ) as japanese_market_price_series,
      (
        select coalesce(sum(cardinality(series.observed_on)), 0)::bigint
        from price_series as series
        inner join card_variants as variant
          on variant.id = series.card_variant_id
        where variant.language_code = 'ja'
          and series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
      ) as japanese_market_price_changes,
      (
        select min(series.observed_on[1])::text
        from price_series as series
        inner join card_variants as variant
          on variant.id = series.card_variant_id
        where variant.language_code = 'ja'
          and series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
      ) as japanese_market_price_earliest,
      (
        select max(
          series.observed_on[cardinality(series.observed_on)]
        )::text
        from price_series as series
        inner join card_variants as variant
          on variant.id = series.card_variant_id
        where variant.language_code = 'ja'
          and series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
      ) as japanese_market_price_latest,
      (
        select count(*)::integer
        from sealed_products
        where language_code = 'en' and is_active
      ) as english_sealed_products,
      (
        select count(*)::integer
        from sealed_products
        where language_code = 'ja' and is_active
      ) as japanese_sealed_products,
      (
        select count(*)::integer
        from (
          select category_id, group_id
          from sealed_products
          where language_code = 'en' and is_active
          group by category_id, group_id
        ) as sealed_set
      ) as english_sealed_sets,
      (
        select count(*)::integer
        from (
          select category_id, group_id
          from sealed_products
          where language_code = 'ja' and is_active
          group by category_id, group_id
        ) as sealed_set
      ) as japanese_sealed_sets,
      (
        select count(*)::integer
        from sealed_current_prices
        where source = 'tcgcsv'
      ) as sealed_current_prices,
      (
        select count(*)::integer
        from sealed_price_series
        where source = 'tcgcsv'
      ) as sealed_price_series,
      (
        select count(*)::integer
        from sealed_price_series as series
        inner join sealed_products as product
          on product.id = series.sealed_product_id
        where series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
          and product.category_id in (3, 85)
      ) as sealed_market_price_series,
      (
        select coalesce(sum(cardinality(series.observed_on)), 0)::bigint
        from sealed_price_series as series
        inner join sealed_products as product
          on product.id = series.sealed_product_id
        where series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
          and product.category_id in (3, 85)
      ) as sealed_market_price_changes,
      (
        select min(series.observed_on[1])::text
        from sealed_price_series as series
        inner join sealed_products as product
          on product.id = series.sealed_product_id
        where series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
          and product.category_id in (3, 85)
      ) as sealed_market_price_earliest,
      (
        select max(
          series.observed_on[cardinality(series.observed_on)]
        )::text
        from sealed_price_series as series
        inner join sealed_products as product
          on product.id = series.sealed_product_id
        where series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
          and product.category_id in (3, 85)
      ) as sealed_market_price_latest
  `;
  const [integrity] = await sql`
    select
      (
        select count(*)::integer
        from card_variants as variant
        inner join cards as card on card.id = variant.card_id
        where card.language_code = 'ja'
          and variant.language_code <> card.language_code
      ) as japanese_language_mismatches,
      (
        select count(*)::integer
        from card_variants as variant
        inner join cards as card on card.id = variant.card_id
        where card.language_code = 'ja'
          and (
            select count(distinct ref.ref_value)
            from card_variant_external_refs as ref
            where ref.card_variant_id = variant.id
              and ref.source = 'tcgplayer'
              and ref.ref_type = 'product_id'
              and ref.ref_value ~ '^[1-9][0-9]{0,14}$'
              and coalesce(ref.metadata ->> 'tcgcsvMappingStatus', '') <> 'stale'
          ) <> 1
      ) as japanese_variants_without_one_ref,
      (
        select count(*)::integer
        from price_series
        where cardinality(observed_on) <> cardinality(amounts_minor)
      ) as malformed_card_series,
      (
        select count(*)::integer
        from sealed_price_series
        where cardinality(observed_on) <> cardinality(amounts_minor)
      ) as malformed_sealed_series,
      (
        select count(*)::integer
        from price_series
        where cardinality(observed_on) <> cardinality(
          array(select distinct unnest(observed_on))
        )
      ) as duplicate_card_series_days,
      (
        select count(*)::integer
        from sealed_price_series
        where cardinality(observed_on) <> cardinality(
          array(select distinct unnest(observed_on))
        )
      ) as duplicate_sealed_series_days,
      (
        select count(*)::integer
        from price_series as series
        inner join card_variants as variant
          on variant.id = series.card_variant_id
        where variant.language_code = 'ja'
          and series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
          and exists (
            select 1
            from generate_subscripts(series.observed_on, 1)
              as indices(idx)
            where indices.idx < cardinality(series.observed_on)
              and series.observed_on[indices.idx] >=
                series.observed_on[indices.idx + 1]
          )
      ) as unordered_japanese_market_series,
      (
        select count(*)::integer
        from sealed_price_series as series
        inner join sealed_products as product
          on product.id = series.sealed_product_id
        where series.source = 'tcgcsv'
          and series.price_type = 'market'
          and series.currency = 'USD'
          and product.category_id in (3, 85)
          and exists (
            select 1
            from generate_subscripts(series.observed_on, 1)
              as indices(idx)
            where indices.idx < cardinality(series.observed_on)
              and series.observed_on[indices.idx] >=
                series.observed_on[indices.idx + 1]
          )
      ) as unordered_sealed_market_series,
      (
        select count(*)::integer
        from current_prices as price
        inner join card_variants as variant
          on variant.id = price.card_variant_id
        left join price_series as series
          on series.card_variant_id = price.card_variant_id
          and series.source = price.source
          and series.price_type = price.price_type
          and series.currency = price.currency
        where variant.language_code = 'ja'
          and price.source = 'tcgcsv'
          and price.price_type = 'market'
          and price.currency = 'USD'
          and (
            series.card_variant_id is null
            or series.amounts_minor[
              cardinality(series.amounts_minor)
            ] <> price.amount_minor
          )
      ) as japanese_current_market_mismatches,
      (
        select count(*)::integer
        from sealed_current_prices as price
        inner join sealed_products as product
          on product.id = price.sealed_product_id
        left join sealed_price_series as series
          on series.sealed_product_id = price.sealed_product_id
          and series.source = price.source
          and series.price_type = price.price_type
          and series.currency = price.currency
        where product.category_id in (3, 85)
          and price.source = 'tcgcsv'
          and price.price_type = 'market'
          and price.currency = 'USD'
          and (
            series.sealed_product_id is null
            or series.amounts_minor[
              cardinality(series.amounts_minor)
            ] <> price.amount_minor
          )
      ) as sealed_current_market_mismatches,
      (
        select count(*)::integer
        from sealed_products
        where lower(name) like '%code card%'
           or lower(coalesce(provider_data ->> 'cleanName', '')) like '%code card%'
           or exists (
             select 1
             from jsonb_array_elements(
               case
                 when jsonb_typeof(provider_data -> 'extendedData') = 'array'
                   then provider_data -> 'extendedData'
                 else '[]'::jsonb
               end
             ) as extended
             where lower(coalesce(extended ->> 'value', '')) like '%digital copy%'
                or (
                  extended ->> 'name' = 'Rarity'
                  and lower(coalesce(extended ->> 'value', '')) = 'code card'
                )
           )
      ) as digital_products_in_sealed,
      (
        select count(*)::integer
        from cards
        where language_code = 'ja'
          and (
            jsonb_typeof(provider_data) <> 'object'
            or provider_data ->> 'languageCode' <> 'ja'
          )
      ) as malformed_japanese_provider_data,
      (
        select count(*)::integer
        from cards
        where language_code = 'ja'
          and is_active
          and number like 'Unnumbered-%'
      ) as synthetic_japanese_unnumbered_numbers,
      (
        select count(*)::integer
        from (
          select category_id, group_id
          from sealed_products
          where is_active
          group by category_id, group_id
          having count(distinct language_code) <> 1
             or count(distinct group_name) <> 1
        ) as inconsistent_set
      ) as inconsistent_sealed_set_metadata
  `;
  const failures = Object.entries(integrity).filter(
    ([, value]) => Number(value) !== 0,
  );

  console.log(JSON.stringify({ counts, integrity }, null, 2));

  if (failures.length > 0) {
    throw new Error(
      `TCGCSV product import integrity checks failed: ${failures
        .map(([name, value]) => `${name}=${value}`)
        .join(", ")}`,
    );
  }
} finally {
  await sql.end();
}
