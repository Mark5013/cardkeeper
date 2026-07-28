import nextEnv from "@next/env";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import postgres from "postgres";

import { buildDatabaseOnlyMissingPriceManifest } from "./lib/tcgcsv-missing-price-audit.mjs";

const { loadEnvConfig } = nextEnv;
const DEFAULT_OUTPUT_DIRECTORY = ".artifacts/tcgcsv";

loadEnvConfig(process.cwd());

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required to audit missing TCGCSV prices.",
  );
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

try {
  const snapshot = await readDatabaseSnapshot();
  const manifest = buildDatabaseOnlyMissingPriceManifest(snapshot);
  const outputPath = getOutputPath(manifest);
  const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;

  await writeImmutableManifest(outputPath, serializedManifest);
  printSummary(manifest, outputPath);
} finally {
  await sql.end();
}

function parseArgs(args) {
  const parsed = {
    databaseOnly: false,
    outputPath: null,
  };

  for (const arg of args) {
    if (arg === "--database-only") {
      parsed.databaseOnly = true;
    } else if (arg.startsWith("--output=")) {
      parsed.outputPath = arg.slice("--output=".length).trim();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.databaseOnly) {
    throw new Error(
      "--database-only is required. Provider-cache auditing has not been enabled yet.",
    );
  }

  if (parsed.outputPath === "") {
    throw new Error("--output=<workspace-relative JSON file> cannot be empty.");
  }

  return parsed;
}

async function readDatabaseSnapshot() {
  return sql.begin(async (transaction) => {
    await transaction`
      set transaction isolation level repeatable read, read only
    `;

    const activeCardRows = await transaction`
      select
        card.id,
        card.provider_id,
        card.name,
        card.number,
        card.set_id,
        card.updated_at,
        card_set.provider_id as set_provider_id,
        card_set.name as set_name,
        card_set.updated_at as set_updated_at,
        array(
          select provider_finish.key
          from jsonb_object_keys(
            coalesce(
              card.provider_data -> 'tcgplayer' -> 'prices',
              '{}'::jsonb
            )
          ) as provider_finish(key)
          order by provider_finish.key
        ) as provider_finish_keys
      from cards as card
      inner join card_sets as card_set on card_set.id = card.set_id
      where card.is_active = true
        and card_set.is_active = true
        and card.language_code = 'en'
        and card_set.language_code = 'en'
      order by card_set.provider_id, card.provider_id
    `;
    const variantRows = await transaction`
      select
        variant.id,
        variant.card_id,
        variant.printing,
        variant.condition,
        variant.language_code,
        variant.external_variant_id,
        variant.created_at,
        variant.updated_at,
        (
          select count(*)::integer
          from collection_items as collection_item
          where collection_item.card_variant_id = variant.id
        ) as collection_item_count,
        (
          select count(*)::integer
          from collection_quantity_history as quantity_history
          where quantity_history.card_variant_id = variant.id
        ) as quantity_history_count,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', external_ref.id,
                'productId', external_ref.ref_value,
                'metadata', external_ref.metadata,
                'createdAt', external_ref.created_at,
                'updatedAt', external_ref.updated_at
              )
              order by external_ref.ref_value, external_ref.id
            )
            from card_variant_external_refs as external_ref
            where external_ref.card_variant_id = variant.id
              and external_ref.source = 'tcgplayer'
              and external_ref.ref_type = 'product_id'
          ),
          '[]'::jsonb
        ) as tcgplayer_product_refs,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'priceType', price.price_type,
                'currency', price.currency,
                'amountMinor', price.amount_minor,
                'observedAt', price.observed_at,
                'updatedAt', price.updated_at
              )
              order by price.price_type, price.currency
            )
            from current_prices as price
            where price.card_variant_id = variant.id
              and price.source = 'tcgcsv'
          ),
          '[]'::jsonb
        ) as tcgcsv_current_prices,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'priceType', series.price_type,
                'currency', series.currency,
                'observationCount', cardinality(series.observed_on),
                'firstObservedOn', series.observed_on[1],
                'latestObservedOn',
                  series.observed_on[cardinality(series.observed_on)],
                'updatedAt', series.updated_at
              )
              order by series.price_type, series.currency
            )
            from price_series as series
            where series.card_variant_id = variant.id
              and series.source = 'tcgcsv'
          ),
          '[]'::jsonb
        ) as tcgcsv_price_series
      from card_variants as variant
      inner join cards as card on card.id = variant.card_id
      inner join card_sets as card_set on card_set.id = card.set_id
      where card.is_active = true
        and card_set.is_active = true
        and card.language_code = 'en'
        and card_set.language_code = 'en'
        and variant.language_code = 'en'
      order by variant.card_id, variant.printing, variant.condition, variant.id
    `;

    const activeCards = activeCardRows.map((row) => ({
      id: String(row.id),
      name: row.name,
      number: row.number,
      providerFinishKeys: row.provider_finish_keys ?? [],
      providerId: row.provider_id,
      setId: String(row.set_id),
      setName: row.set_name,
      setProviderId: row.set_provider_id,
      updatedAt: row.updated_at,
      setUpdatedAt: row.set_updated_at,
    }));
    const localVariants = variantRows.map((row) => ({
      cardId: String(row.card_id),
      collectionItemCount: row.collection_item_count,
      condition: row.condition,
      createdAt: row.created_at,
      externalVariantId: row.external_variant_id,
      id: String(row.id),
      languageCode: row.language_code,
      printing: row.printing,
      quantityHistoryCount: row.quantity_history_count,
      tcgcsvCurrentPrices: row.tcgcsv_current_prices ?? [],
      tcgcsvPriceSeries: row.tcgcsv_price_series ?? [],
      tcgplayerProductRefs: row.tcgplayer_product_refs ?? [],
      updatedAt: row.updated_at,
    }));
    const relevantTimestamps = [
      ...activeCards.flatMap((card) => [
        card.updatedAt,
        card.setUpdatedAt,
      ]),
      ...localVariants.flatMap((variant) => [
        variant.createdAt,
        variant.updatedAt,
        ...variant.tcgplayerProductRefs.flatMap((ref) => [
          ref.createdAt,
          ref.updatedAt,
        ]),
        ...variant.tcgcsvCurrentPrices.flatMap((price) => [
          price.observedAt,
          price.updatedAt,
        ]),
        ...variant.tcgcsvPriceSeries.map((series) => series.updatedAt),
      ]),
    ];
    const marketObservedTimestamps = localVariants.flatMap((variant) =>
      variant.tcgcsvCurrentPrices
        .filter(
          (price) =>
            price.priceType === "market" && price.currency === "USD",
        )
        .map((price) => price.observedAt),
    );

    return {
      activeCards,
      databaseSnapshotAt: getLatestTimestamp(relevantTimestamps),
      latestTcgcsvMarketObservedAt: getLatestTimestamp(
        marketObservedTimestamps,
      ),
      localVariants,
    };
  });
}

function getLatestTimestamp(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  return timestamps[0] ?? null;
}

function getOutputPath(manifest) {
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    assertPathInsideWorkspace(outputPath);
    return outputPath;
  }

  const buildDate =
    manifest.latestTcgcsvMarketObservedAt?.slice(0, 10) ??
    "no-current-build";
  const filename =
    `tcgcsv-missing-price-gaps-${buildDate}-` +
    `${manifest.manifestFingerprint.slice(0, 12)}.json`;

  return resolve(DEFAULT_OUTPUT_DIRECTORY, filename);
}

function assertPathInsideWorkspace(path) {
  const relativePath = relative(process.cwd(), path);

  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("The audit output path must be inside the workspace.");
  }
}

async function writeImmutableManifest(path, contents) {
  assertPathInsideWorkspace(path);
  await mkdir(dirname(path), { recursive: true });

  try {
    await writeFile(path, contents, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;

    const existingContents = await readFile(path, "utf8");
    if (existingContents !== contents) {
      throw new Error(
        `Refusing to overwrite a different audit manifest at ${relative(
          process.cwd(),
          path,
        )}.`,
      );
    }
  }
}

function printSummary(manifest, outputPath) {
  const summary = manifest.summary;
  const classifications = summary.finishGapClassifications;

  console.log(
    `TCGCSV database-only missing-price audit: ${summary.pricedVisibleFinishes.toLocaleString()}/${summary.visibleFinishes.toLocaleString()} visible finishes priced across ${summary.activeEnglishCards.toLocaleString()} active English cards.`,
  );
  console.log(
    `${summary.finishGaps.toLocaleString()} finish gaps: ${classifications.multiple_product_refs.toLocaleString()} multiple refs, ${classifications.missing_local_variant.toLocaleString()} missing variants, ${classifications.missing_product_ref.toLocaleString()} missing refs, ${classifications.trusted_singleton_without_current_market.toLocaleString()} trusted singleton refs without current market values, ${classifications.untrusted_product_ref.toLocaleString()} other untrusted refs.`,
  );
  console.log(
    `${summary.cardsWithoutTrustedCurrentPrice.toLocaleString()} cards have no trusted current price; ${summary.cardsWithPartialPriceCoverage.toLocaleString()} have partial finish coverage; ${summary.unpricedCardsWithoutVisibleFinish.toLocaleString()} unpriced cards have neither a provider-advertised finish nor a trusted local finish.`,
  );
  console.log(
    `Provider requests: ${manifest.providerRequests.count}. Manifest: ${relative(
      process.cwd(),
      outputPath,
    )}`,
  );
}
