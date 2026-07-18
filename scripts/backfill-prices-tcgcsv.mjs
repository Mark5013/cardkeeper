import nextEnv from "@next/env";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import postgres from "postgres";

import {
  buildHistoricalPriceRecordsByGroup,
  createProductVariantMappings,
  getNightlyTcgcsvGroupOrder,
  selectChangedPriceRecords,
} from "./lib/tcgcsv-history-core.mjs";

const { loadEnvConfig } = nextEnv;
const execFileAsync = promisify(execFile);

loadEnvConfig(process.cwd());

const TCGCSV_BASE_URL = "https://tcgcsv.com";
const EARLIEST_ARCHIVE_DATE = "2024-02-08";
const DEFAULT_REQUEST_DELAY_MS = 250;
const MINIMUM_REQUEST_DELAY_MS = 100;
const DEFAULT_MAX_RETRIES = 3;
const MAX_REQUESTS_PER_DAY = 10_000;
const SERIES_WRITE_BATCH_SIZE = 100;
const USER_AGENT =
  process.env.TCGCSV_USER_AGENT ?? "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to backfill TCGCSV prices.");
}

const requestedDates = enumerateDates(options.from, options.to);
const workingDirectory = resolve(options.tempDir ?? join(tmpdir(), "cardkeeper-tcgcsv-history"));
assertSafeWorkingDirectory(workingDirectory);
await mkdir(workingDirectory, { recursive: true });

const stagePath = options.dryRun
  ? ":memory:"
  : resolve(options.stagePath ?? join(workingDirectory, "tcgcsv-history-stage.sqlite"));

if (stagePath !== ":memory:") assertPathInsideWorkingDirectory(stagePath);
if (options.resetStage && stagePath !== ":memory:") await removeStageFiles(stagePath);

const stage = new DatabaseSync(stagePath);
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});
let lastTcgcsvRequestAt = 0;

try {
  initializeStage();
  await backfillPrices();
} finally {
  stage.close();
  await sql.end();
}

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    from: null,
    keepFiles: false,
    maxDays: null,
    maxRetries: DEFAULT_MAX_RETRIES,
    removeLegacy: false,
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
    restoreLegacyFrom: null,
    resetStage: false,
    stageOnly: false,
    stagePath: null,
    tempDir: null,
    to: null,
    verifyLegacy: false,
    verifyUpload: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--keep-files") {
      parsed.keepFiles = true;
    } else if (arg === "--remove-legacy") {
      parsed.removeLegacy = true;
    } else if (arg.startsWith("--restore-legacy-from=")) {
      parsed.restoreLegacyFrom = parseDateArgument(
        arg.slice("--restore-legacy-from=".length),
        "legacy restore start",
      );
    } else if (arg === "--reset-stage") {
      parsed.resetStage = true;
    } else if (arg === "--stage-only") {
      parsed.stageOnly = true;
    } else if (arg === "--verify-legacy") {
      parsed.verifyLegacy = true;
    } else if (arg === "--verify-upload") {
      parsed.verifyUpload = true;
    } else if (arg.startsWith("--from=")) {
      parsed.from = parseDateArgument(arg.slice("--from=".length), "from");
    } else if (arg.startsWith("--to=")) {
      parsed.to = parseDateArgument(arg.slice("--to=".length), "to");
    } else if (arg.startsWith("--max-days=")) {
      parsed.maxDays = parsePositiveInteger(arg.slice("--max-days=".length), "max days");
    } else if (arg.startsWith("--max-retries=")) {
      parsed.maxRetries = parseNonnegativeInteger(arg.slice("--max-retries=".length), "max retries");
    } else if (arg.startsWith("--request-delay-ms=")) {
      parsed.requestDelayMs = parsePositiveInteger(
        arg.slice("--request-delay-ms=".length),
        "request delay",
      );
    } else if (arg.startsWith("--stage-path=")) {
      parsed.stagePath = arg.slice("--stage-path=".length).trim();
    } else if (arg.startsWith("--temp-dir=")) {
      parsed.tempDir = arg.slice("--temp-dir=".length).trim();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.from || !parsed.to) {
    throw new Error("Both --from=YYYY-MM-DD and --to=YYYY-MM-DD are required.");
  }

  if (parsed.from < EARLIEST_ARCHIVE_DATE) {
    throw new Error(`TCGCSV archives begin on ${EARLIEST_ARCHIVE_DATE}.`);
  }

  if (parsed.to < parsed.from) {
    throw new Error("The --to date must be on or after the --from date.");
  }

  if (parsed.requestDelayMs < MINIMUM_REQUEST_DELAY_MS) {
    throw new Error(`TCGCSV requires at least ${MINIMUM_REQUEST_DELAY_MS}ms between requests.`);
  }

  if ((parsed.removeLegacy || parsed.restoreLegacyFrom) && !parsed.verifyUpload) {
    throw new Error("Legacy cleanup or restoration requires --verify-upload.");
  }

  if (parsed.removeLegacy && parsed.restoreLegacyFrom) {
    throw new Error("--remove-legacy and --restore-legacy-from cannot be used together.");
  }

  if (
    parsed.restoreLegacyFrom &&
    (parsed.restoreLegacyFrom < parsed.from || parsed.restoreLegacyFrom > parsed.to)
  ) {
    throw new Error("The legacy restore start must fall within the requested archive range.");
  }

  return parsed;
}

function parseDateArgument(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected ${label} to use YYYY-MM-DD.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Expected ${label} to be a valid calendar date.`);
  }

  return value;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }

  return parsed;
}

function parseNonnegativeInteger(value, label) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected ${label} to be a nonnegative integer.`);
  }

  return parsed;
}

function initializeStage() {
  stage.exec(`
    pragma journal_mode = wal;
    pragma synchronous = full;
    pragma foreign_keys = on;

    create table if not exists metadata (
      key text primary key,
      value text not null
    ) without rowid;

    create table if not exists variants (
      local_id integer primary key,
      variant_id text not null unique,
      previous_amount_minor integer
    );

    create table if not exists history_points (
      variant_key integer not null references variants(local_id) on delete cascade,
      observed_day integer not null,
      amount_minor integer not null check (amount_minor >= 0),
      primary key (variant_key, observed_day)
    ) without rowid;

    create table if not exists archive_imports (
      archive_date text primary key,
      price_files_read integer not null,
      price_rows_read integer not null,
      valid_market_rows integer not null,
      mapped_market_rows integer not null,
      matched_variants integer not null,
      changed_points integer not null,
      completed_at text not null
    ) without rowid;
  `);

  const storedFrom = getStageMetadata("archive_from");
  const storedTo = getStageMetadata("archive_to");

  if ((storedFrom && storedFrom !== options.from) || (storedTo && storedTo !== options.to)) {
    throw new Error(
      `The stage file belongs to ${storedFrom} through ${storedTo}. Use matching dates or --reset-stage.`,
    );
  }

  setStageMetadata("archive_from", options.from);
  setStageMetadata("archive_to", options.to);
}

async function backfillPrices() {
  const startedAt = Date.now();
  const mappingRows = await sql`
    select
      refs.ref_value as product_id,
      refs.card_variant_id,
      variants.printing
    from card_variant_external_refs refs
    inner join card_variants variants on variants.id = refs.card_variant_id
    where refs.source = 'tcgplayer'
      and refs.ref_type = 'product_id'
      and variants.condition = 'unspecified'
      and variants.language_code = 'en'
  `;

  insertStageVariants(mappingRows.map((row) => row.card_variant_id));
  const localVariantIds = loadLocalVariantIds();
  const mappings = createProductVariantMappings(
    mappingRows.flatMap((row) => {
      const localId = localVariantIds.get(row.card_variant_id);
      return localId
        ? [{ product_id: row.product_id, card_variant_id: String(localId), printing: row.printing }]
        : [];
    }),
  );
  const previousAmounts = loadPreviousAmounts();
  const completedDates = loadCompletedDates();
  assertCompletedDatesAreContiguous(completedDates);
  const pendingDates = requestedDates.filter((date) => !completedDates.has(date));
  const datesToProcess = options.maxDays ? pendingDates.slice(0, options.maxDays) : pendingDates;
  const maximumRequests = datesToProcess.length * (options.maxRetries + 1) + (datesToProcess.length ? 2 : 0);

  if (maximumRequests >= MAX_REQUESTS_PER_DAY) {
    throw new Error(
      `This run could make up to ${maximumRequests.toLocaleString()} requests, which would violate TCGCSV's under-10,000 daily request rule.`,
    );
  }

  if (datesToProcess.length > 0) {
    const latestArchiveDate = await getLatestArchiveDate();
    if (options.to > latestArchiveDate) {
      throw new Error(`TCGCSV's latest completed archive is ${latestArchiveDate}, before requested ${options.to}.`);
    }
  }
  const groupOrder = datesToProcess.length > 0 ? await getTcgcsvGroupOrder() : [];

  console.log(
    `Starting TCGCSV compressed history${options.dryRun ? " dry run" : " staging"}: ${options.from} through ${options.to}; ${completedDates.size.toLocaleString()} archives already staged, ${datesToProcess.length.toLocaleString()} to process now, ${mappings.size.toLocaleString()} product/printing mappings, ${options.requestDelayMs}ms request spacing.`,
  );

  for (const archiveDate of datesToProcess) {
    const archiveStartedAt = Date.now();
    const archivePath = await downloadArchive(archiveDate);
    const categoryDirectory = await extractPokemonPrices(archiveDate, archivePath);
    const { priceRowsByGroup, priceFilesRead } = await readPokemonPriceRows(categoryDirectory);
    const built = buildHistoricalPriceRecordsByGroup({
      priceRowsByGroup,
      groupOrder,
      mappings,
      observedAt: new Date(`${archiveDate}T00:00:00.000Z`),
    });
    const changedRecords = selectChangedPriceRecords(built.records, previousAmounts);

    stageArchive(archiveDate, changedRecords, {
      ...built.stats,
      priceFilesRead,
      matchedVariants: built.records.length,
    });

    console.log(
      `${archiveDate}: ${priceFilesRead.toLocaleString()} files, ${built.stats.mappedMarketRows.toLocaleString()}/${built.stats.validMarketRows.toLocaleString()} market rows mapped, ${built.records.length.toLocaleString()} variants, ${changedRecords.length.toLocaleString()} changes staged in ${formatDuration(Date.now() - archiveStartedAt)}.`,
    );

    if (!options.keepFiles) await cleanupArchiveFiles(archiveDate);
  }

  const stagedArchiveCount = Number(
    stage.prepare("select count(*) as count from archive_imports").get().count,
  );

  if (stagedArchiveCount < requestedDates.length) {
    console.log(
      `Staging paused after ${stagedArchiveCount.toLocaleString()}/${requestedDates.length.toLocaleString()} archives. Run the same command again to resume.`,
    );
    return;
  }

  await stageLegacyHistoryAfter(options.to, previousAmounts, localVariantIds);
  const pointCount = Number(stage.prepare("select count(*) as count from history_points").get().count);
  const seriesCount = Number(
    stage.prepare("select count(distinct variant_key) as count from history_points").get().count,
  );

  console.log(
    `Compressed stage complete: ${pointCount.toLocaleString()} changed prices across ${seriesCount.toLocaleString()} variants in ${formatDuration(Date.now() - startedAt)}.`,
  );

  if (options.verifyLegacy) {
    await verifyStageAgainstLegacyPricePoints();
    await verifyStageAgainstCurrentPrices();
  }

  if (options.verifyUpload) {
    await verifyUploadedPriceSeries({ points: pointCount, series: seriesCount });
    if (options.removeLegacy) await removeLegacyPricePoints();
    if (options.restoreLegacyFrom) await restoreLegacyPricePoints(options.restoreLegacyFrom);
    console.log(`Stage retained at ${stagePath}.`);
    return;
  }

  if (options.dryRun || options.stageOnly) {
    console.log(options.dryRun ? "Dry run complete; the database was not changed." : `Stage retained at ${stagePath}.`);
    return;
  }

  const uploadStats = await uploadPriceSeries();
  await verifyUploadedPriceSeries(uploadStats);
  setStageMetadata("uploaded_at", new Date().toISOString());
  setStageMetadata("uploaded_points", String(uploadStats.points));

  console.log(
    `Uploaded ${uploadStats.points.toLocaleString()} changed prices in ${uploadStats.series.toLocaleString()} compressed TCGCSV market series. Legacy price_points rows were preserved for verification.`,
  );
}

async function restoreLegacyPricePoints(from) {
  const baselineObservedAt = `${from}T00:00:00.000Z`;
  const baselineRows = await sql`
    insert into price_points (
      card_variant_id,
      source,
      price_type,
      currency,
      amount_minor,
      observed_at
    )
    select
      series.card_variant_id,
      series.source,
      series.price_type,
      series.currency,
      baseline.amount_minor,
      ${baselineObservedAt}::timestamptz
    from price_series series
    cross join lateral (
      select point.amount_minor
      from unnest(series.observed_on, series.amounts_minor)
        with ordinality as point(observed_on, amount_minor, ordinal)
      where point.observed_on <= ${from}::date
      order by point.observed_on desc
      limit 1
    ) baseline
    where series.source = 'tcgcsv'
      and series.price_type = 'market'
      and series.currency = 'USD'
    on conflict (card_variant_id, source, price_type, currency, observed_at) do nothing
    returning id
  `;
  const changeRows = await sql`
    insert into price_points (
      card_variant_id,
      source,
      price_type,
      currency,
      amount_minor,
      observed_at
    )
    select
      series.card_variant_id,
      series.source,
      series.price_type,
      series.currency,
      point.amount_minor,
      point.observed_on::timestamp at time zone 'UTC'
    from price_series series
    cross join lateral unnest(series.observed_on, series.amounts_minor)
      with ordinality as point(observed_on, amount_minor, ordinal)
    where series.source = 'tcgcsv'
      and series.price_type = 'market'
      and series.currency = 'USD'
      and point.observed_on > ${from}::date
      and point.observed_on <= ${options.to}::date
    on conflict (card_variant_id, source, price_type, currency, observed_at) do nothing
    returning id
  `;
  const [stats] = await sql`
    select
      count(*)::integer as rows,
      pg_size_pretty(pg_total_relation_size('price_points')) as size
    from price_points
  `;

  console.log(
    `Restored ${baselineRows.length.toLocaleString()} baseline and ${changeRows.length.toLocaleString()} changed legacy compatibility rows from ${from} through ${options.to}; price_points now has ${Number(stats.rows).toLocaleString()} rows (${stats.size}).`,
  );
}

async function removeLegacyPricePoints() {
  const [before] = await sql`
    select
      count(*)::integer as total,
      count(*) filter (
        where source = 'tcgcsv'
          and price_type = 'market'
          and currency = 'USD'
      )::integer as expected
    from price_points
  `;

  if (Number(before.total) !== Number(before.expected)) {
    throw new Error(
      `Refusing to truncate price_points: only ${Number(before.expected).toLocaleString()} of ${Number(before.total).toLocaleString()} rows are legacy TCGCSV USD market observations.`,
    );
  }

  if (Number(before.total) === 0) {
    console.log("Legacy price_points is already empty.");
    return;
  }

  await sql`truncate table price_points`;
  const [after] = await sql`select count(*)::integer as total from price_points`;

  if (Number(after.total) !== 0) {
    throw new Error("Legacy price_points truncation did not leave the table empty.");
  }

  const [sizes] = await sql`
    select
      pg_size_pretty(pg_total_relation_size('price_series')) as price_series_size,
      pg_size_pretty(pg_total_relation_size('price_points')) as price_points_size,
      pg_size_pretty(pg_database_size(current_database())) as database_size
  `;

  console.log(
    `Removed ${Number(before.total).toLocaleString()} verified legacy price_points rows. Sizes now: price_series ${sizes.price_series_size}, price_points ${sizes.price_points_size}, database ${sizes.database_size}. Recovery stage remains at ${stagePath}.`,
  );
}

async function verifyUploadedPriceSeries(expected) {
  const [stats] = await sql`
    select
      count(*)::integer as series,
      coalesce(sum(cardinality(observed_on)), 0)::bigint as points,
      min(observed_on[1])::text as earliest,
      max(observed_on[cardinality(observed_on)])::text as latest,
      count(*) filter (
        where cardinality(observed_on) <> cardinality(amounts_minor)
          or cardinality(observed_on) = 0
      )::integer as malformed
    from price_series
    where source = 'tcgcsv'
      and price_type = 'market'
      and currency = 'USD'
  `;
  const [ordering] = await sql`
    select count(*)::integer as invalid
    from price_series series
    where series.source = 'tcgcsv'
      and series.price_type = 'market'
      and series.currency = 'USD'
      and exists (
        select 1
        from generate_subscripts(series.observed_on, 1) as indices(idx)
        where idx < cardinality(series.observed_on)
          and series.observed_on[idx] >= series.observed_on[idx + 1]
      )
  `;
  const [latest] = await sql`
    select count(*)::integer as mismatches
    from price_series series
    inner join current_prices prices
      on prices.card_variant_id = series.card_variant_id
      and prices.source = series.source
      and prices.price_type = series.price_type
      and prices.currency = series.currency
    where series.source = 'tcgcsv'
      and series.price_type = 'market'
      and series.currency = 'USD'
      and prices.observed_at < ${`${addUtcDays(options.to, 1)}T00:00:00.000Z`}::timestamptz
      and series.amounts_minor[cardinality(series.amounts_minor)] <> prices.amount_minor
  `;
  const actualPoints = Number(stats.points);

  if (
    Number(stats.series) !== expected.series ||
    actualPoints !== expected.points ||
    Number(stats.malformed) !== 0 ||
    Number(ordering.invalid) !== 0 ||
    Number(latest.mismatches) !== 0 ||
    stats.earliest !== options.from ||
    stats.latest !== options.to
  ) {
    throw new Error(
      `Uploaded price_series failed verification: ${JSON.stringify({ ...stats, invalidOrder: Number(ordering.invalid), latestMismatches: Number(latest.mismatches) })}`,
    );
  }

  console.log(
    `Upload verification passed: ${Number(stats.series).toLocaleString()} aligned, ordered series containing ${actualPoints.toLocaleString()} changes from ${stats.earliest} through ${stats.latest}; latest values match current_prices.`,
  );
}

async function verifyStageAgainstLegacyPricePoints() {
  const legacyRows = await sql`
    select
      card_variant_id,
      amount_minor,
      to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD') as observed_on
    from price_points
    where source = 'tcgcsv'
      and price_type = 'market'
      and currency = 'USD'
      and observed_at < ${`${addUtcDays(options.to, 1)}T00:00:00.000Z`}::timestamptz
    order by card_variant_id, observed_at
  `;

  if (legacyRows.length === 0) {
    console.log("Legacy verification skipped: no TCGCSV price_points rows remain.");
    return;
  }

  const legacyStart = legacyRows.reduce(
    (earliest, row) => (String(row.observed_on) < earliest ? String(row.observed_on) : earliest),
    String(legacyRows[0].observed_on),
  );
  const comparisonStart = legacyStart > options.from ? legacyStart : options.from;

  if (comparisonStart > options.to) {
    throw new Error(`Legacy TCGCSV price_points do not overlap ${options.from} through ${options.to}.`);
  }

  const stageRows = stage
    .prepare(`
      select variants.variant_id, history_points.observed_day, history_points.amount_minor
      from history_points
      inner join variants on variants.local_id = history_points.variant_key
      where history_points.observed_day <= ?
      order by variants.variant_id, history_points.observed_day
    `)
    .all(toObservedDay(options.to));
  const stageEvents = groupPriceEvents(
    stageRows.map((row) => ({
      amountMinor: Number(row.amount_minor),
      observedOn: fromObservedDay(Number(row.observed_day)),
      variantId: String(row.variant_id),
    })),
  );
  const legacyEvents = groupPriceEvents(
    legacyRows.map((row) => ({
      amountMinor: Number(row.amount_minor),
      observedOn: String(row.observed_on),
      variantId: String(row.card_variant_id),
    })),
  );
  const variantIds = legacyEvents.keys();
  const comparisonDates = enumerateDates(options.from, options.to);
  const examples = [];
  const mismatchVariantIds = new Set();
  let comparisons = 0;
  let mismatches = 0;

  for (const variantId of variantIds) {
    const staged = stageEvents.get(variantId) ?? new Map();
    const legacy = legacyEvents.get(variantId) ?? new Map();
    let stagedAmount;
    let legacyAmount;

    for (const [observedOn, amountMinor] of staged) {
      if (observedOn >= options.from) break;
      stagedAmount = amountMinor;
    }
    for (const [observedOn, amountMinor] of legacy) {
      if (observedOn >= options.from) break;
      legacyAmount = amountMinor;
    }

    for (const observedOn of comparisonDates) {
      if (staged.has(observedOn)) stagedAmount = staged.get(observedOn);
      if (legacy.has(observedOn)) legacyAmount = legacy.get(observedOn);
      if (observedOn < comparisonStart) continue;
      if (legacyAmount === undefined) continue;

      comparisons += 1;
      if (stagedAmount === legacyAmount) continue;

      mismatches += 1;
      mismatchVariantIds.add(variantId);
      if (examples.length < 10) {
        examples.push(`${variantId} on ${observedOn}: staged=${stagedAmount ?? "missing"}, legacy=${legacyAmount ?? "missing"}`);
      }
    }
  }

  if (mismatches > 0) {
    const mismatchIds = Array.from(mismatchVariantIds);
    const refCounts = await sql`
      select card_variant_id, count(*)::integer as ref_count
      from card_variant_external_refs
      where source = 'tcgplayer'
        and ref_type = 'product_id'
        and card_variant_id in ${sql(mismatchIds)}
      group by card_variant_id
    `;
    const refCountByVariant = new Map(
      refCounts.map((row) => [String(row.card_variant_id), Number(row.ref_count)]),
    );
    const singleRefMismatchIds = mismatchIds.filter(
      (variantId) => (refCountByVariant.get(variantId) ?? 0) <= 1,
    );

    if (singleRefMismatchIds.length > 0) {
      throw new Error(
        `Legacy verification found ${mismatches.toLocaleString()} mismatches across ${comparisons.toLocaleString()} daily comparisons, including ${singleRefMismatchIds.length.toLocaleString()} variants without multiple TCGplayer product references. ${examples.join("; ")}`,
      );
    }

    console.warn(
      `Legacy verification found ${mismatches.toLocaleString()} differences across ${mismatchVariantIds.size.toLocaleString()} variants, all with multiple TCGplayer product references. These are expected where the old row importer preserved an earlier same-day group write; the compressed importer preserves the nightly final group value.`,
    );
    return;
  }

  console.log(
    `Legacy verification passed: ${comparisons.toLocaleString()} carried-forward daily prices matched from ${comparisonStart} through ${options.to}.`,
  );
}

async function verifyStageAgainstCurrentPrices() {
  const currentRows = await sql`
    select
      current_prices.card_variant_id,
      current_prices.amount_minor,
      current_prices.observed_at,
      cards.name as card_name,
      cards.number as card_number,
      card_sets.name as set_name,
      card_variants.printing,
      array(
        select refs.ref_value
        from card_variant_external_refs refs
        where refs.card_variant_id = current_prices.card_variant_id
          and refs.source = 'tcgplayer'
          and refs.ref_type = 'product_id'
        order by refs.ref_value
      ) as product_ids
    from current_prices
    inner join card_variants on card_variants.id = current_prices.card_variant_id
    inner join cards on cards.id = card_variants.card_id
    inner join card_sets on card_sets.id = cards.set_id
    where current_prices.source = 'tcgcsv'
      and current_prices.price_type = 'market'
      and current_prices.currency = 'USD'
      and current_prices.observed_at < ${`${addUtcDays(options.to, 1)}T00:00:00.000Z`}::timestamptz
  `;
  const latestStageAmounts = new Map();
  const stageRows = stage
    .prepare(`
      select variants.variant_id, history_points.amount_minor
      from history_points
      inner join variants on variants.local_id = history_points.variant_key
      where history_points.observed_day <= ?
      order by variants.variant_id, history_points.observed_day
    `)
    .all(toObservedDay(options.to));

  for (const row of stageRows) {
    latestStageAmounts.set(String(row.variant_id), Number(row.amount_minor));
  }

  const examples = [];
  let comparisons = 0;
  let mismatches = 0;

  for (const row of currentRows) {
    const variantId = String(row.card_variant_id);
    const stagedAmount = latestStageAmounts.get(variantId);
    const currentAmount = Number(row.amount_minor);
    if (stagedAmount === undefined) continue;

    comparisons += 1;
    if (stagedAmount === currentAmount) continue;

    mismatches += 1;
    if (examples.length < 10) {
      examples.push(
        `${variantId} (${row.card_name}, ${row.set_name} #${row.card_number}, ${row.printing}; products=${row.product_ids.join(",")}; current observed ${row.observed_at.toISOString()}): staged=${stagedAmount}, current=${currentAmount}`,
      );
    }
  }

  if (mismatches > 0) {
    throw new Error(
      `Current-price verification found ${mismatches.toLocaleString()} mismatches across ${comparisons.toLocaleString()} variants. ${examples.join("; ")}`,
    );
  }

  console.log(
    `Current-price verification passed: ${comparisons.toLocaleString()} latest compressed prices match current_prices as of ${options.to}.`,
  );
}

function groupPriceEvents(rows) {
  const grouped = new Map();

  for (const row of rows) {
    let events = grouped.get(row.variantId);
    if (!events) {
      events = new Map();
      grouped.set(row.variantId, events);
    }
    events.set(row.observedOn, row.amountMinor);
  }

  return grouped;
}

function insertStageVariants(variantIds) {
  const insert = stage.prepare("insert into variants (variant_id) values (?) on conflict (variant_id) do nothing");
  stage.exec("begin immediate");

  try {
    for (const variantId of new Set(variantIds)) insert.run(variantId);
    stage.exec("commit");
  } catch (error) {
    stage.exec("rollback");
    throw error;
  }
}

function loadLocalVariantIds() {
  return new Map(
    stage
      .prepare("select local_id, variant_id from variants")
      .all()
      .map((row) => [String(row.variant_id), Number(row.local_id)]),
  );
}

function loadPreviousAmounts() {
  return new Map(
    stage
      .prepare("select local_id, previous_amount_minor from variants where previous_amount_minor is not null")
      .all()
      .map((row) => [String(row.local_id), Number(row.previous_amount_minor)]),
  );
}

function loadCompletedDates() {
  return new Set(
    stage
      .prepare("select archive_date from archive_imports order by archive_date")
      .all()
      .map((row) => String(row.archive_date)),
  );
}

function assertCompletedDatesAreContiguous(completedDates) {
  let encounteredPendingDate = false;

  for (const archiveDate of requestedDates) {
    if (!completedDates.has(archiveDate)) {
      encounteredPendingDate = true;
    } else if (encounteredPendingDate) {
      throw new Error("The local stage has a completed archive after a gap. Use --reset-stage to rebuild it.");
    }
  }
}

function stageArchive(archiveDate, changedRecords, stats) {
  const observedDay = toObservedDay(archiveDate);
  const insertPoint = stage.prepare(`
    insert into history_points (variant_key, observed_day, amount_minor)
    values (?, ?, ?)
    on conflict (variant_key, observed_day) do update set amount_minor = excluded.amount_minor
  `);
  const updatePrevious = stage.prepare(
    "update variants set previous_amount_minor = ? where local_id = ?",
  );
  const insertArchive = stage.prepare(`
    insert into archive_imports (
      archive_date,
      price_files_read,
      price_rows_read,
      valid_market_rows,
      mapped_market_rows,
      matched_variants,
      changed_points,
      completed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stage.exec("begin immediate");

  try {
    for (const record of changedRecords) {
      const localId = Number(record.card_variant_id);
      insertPoint.run(localId, observedDay, record.amount_minor);
      updatePrevious.run(record.amount_minor, localId);
    }

    insertArchive.run(
      archiveDate,
      stats.priceFilesRead,
      stats.priceRowsRead,
      stats.validMarketRows,
      stats.mappedMarketRows,
      stats.matchedVariants,
      changedRecords.length,
      new Date().toISOString(),
    );
    stage.exec("commit");
  } catch (error) {
    stage.exec("rollback");
    throw error;
  }
}

async function stageLegacyHistoryAfter(lastArchiveDate, previousAmounts, localVariantIds) {
  if (getStageMetadata("legacy_staged_at")) return;

  const nextDate = addUtcDays(lastArchiveDate, 1);
  const rows = await sql`
    select
      points.card_variant_id,
      points.amount_minor,
      points.observed_at
    from price_points points
    where points.source = 'tcgcsv'
      and points.price_type = 'market'
      and points.currency = 'USD'
      and points.observed_at >= ${new Date(`${nextDate}T00:00:00.000Z`)}
    order by points.observed_at asc
  `;
  const currentRows = await sql`
    select
      prices.card_variant_id,
      prices.amount_minor,
      prices.observed_at
    from current_prices prices
    where prices.source = 'tcgcsv'
      and prices.price_type = 'market'
      and prices.currency = 'USD'
      and prices.observed_at >= ${new Date(`${nextDate}T00:00:00.000Z`)}
    order by prices.observed_at asc
  `;
  const rowsByDate = new Map();

  for (const row of [...rows, ...currentRows]) {
    const observedOn = new Date(row.observed_at).toISOString().slice(0, 10);
    const rowsForDate = rowsByDate.get(observedOn) ?? new Map();
    rowsForDate.set(row.card_variant_id, Number(row.amount_minor));
    rowsByDate.set(observedOn, rowsForDate);
  }

  for (const [observedOn, amountsByVariant] of Array.from(rowsByDate).sort(([first], [second]) => first.localeCompare(second))) {
    const stageRecords = [];

    for (const [variantId, amountMinor] of amountsByVariant) {
      let localId = localVariantIds.get(variantId);

      if (!localId) {
        stage.prepare("insert into variants (variant_id) values (?) on conflict (variant_id) do nothing").run(variantId);
        localId = Number(stage.prepare("select local_id from variants where variant_id = ?").get(variantId).local_id);
        localVariantIds.set(variantId, localId);
      }

      stageRecords.push({ card_variant_id: String(localId), amount_minor: amountMinor });
    }

    const changedRecords = selectChangedPriceRecords(stageRecords, previousAmounts);
    stageLegacyDate(observedOn, changedRecords);
  }

  setStageMetadata("legacy_staged_at", new Date().toISOString());
}

function stageLegacyDate(observedOn, changedRecords) {
  const observedDay = toObservedDay(observedOn);
  const insertPoint = stage.prepare(`
    insert into history_points (variant_key, observed_day, amount_minor)
    values (?, ?, ?)
    on conflict (variant_key, observed_day) do update set amount_minor = excluded.amount_minor
  `);
  const updatePrevious = stage.prepare(
    "update variants set previous_amount_minor = ? where local_id = ?",
  );

  stage.exec("begin immediate");

  try {
    for (const record of changedRecords) {
      const localId = Number(record.card_variant_id);
      insertPoint.run(localId, observedDay, record.amount_minor);
      updatePrevious.run(record.amount_minor, localId);
    }
    stage.exec("commit");
  } catch (error) {
    stage.exec("rollback");
    throw error;
  }
}

async function uploadPriceSeries() {
  const iterator = stage
    .prepare(`
      select variants.variant_id, history_points.observed_day, history_points.amount_minor
      from history_points
      inner join variants on variants.local_id = history_points.variant_key
      order by history_points.variant_key, history_points.observed_day
    `)
    .iterate();
  let currentVariantId = null;
  let observedOn = [];
  let amountsMinor = [];
  let batch = [];
  let pointCount = 0;
  let seriesCount = 0;

  const flushSeries = async () => {
    if (!currentVariantId) return;

    batch.push({
      card_variant_id: currentVariantId,
      source: "tcgcsv",
      price_type: "market",
      currency: "USD",
      observed_on: observedOn,
      amounts_minor: amountsMinor,
      updated_at: new Date(),
    });
    pointCount += observedOn.length;
    seriesCount += 1;
    observedOn = [];
    amountsMinor = [];

    if (batch.length >= SERIES_WRITE_BATCH_SIZE) {
      await writeSeriesBatch(batch);
      batch = [];
      if (seriesCount % 2000 === 0) {
        console.log(`Uploaded ${seriesCount.toLocaleString()} compressed price series...`);
      }
    }
  };

  for (const row of iterator) {
    const variantId = String(row.variant_id);

    if (currentVariantId && variantId !== currentVariantId) await flushSeries();
    if (variantId !== currentVariantId) currentVariantId = variantId;

    observedOn.push(fromObservedDay(Number(row.observed_day)));
    amountsMinor.push(Number(row.amount_minor));
  }

  await flushSeries();
  if (batch.length > 0) await writeSeriesBatch(batch);

  return { points: pointCount, series: seriesCount };
}

async function writeSeriesBatch(batch) {
  await sql`
    insert into price_series ${sql(
      batch,
      "card_variant_id",
      "source",
      "price_type",
      "currency",
      "observed_on",
      "amounts_minor",
      "updated_at",
    )}
    on conflict (card_variant_id, source, price_type, currency) do update set
      observed_on = excluded.observed_on,
      amounts_minor = excluded.amounts_minor,
      updated_at = excluded.updated_at
  `;
}

async function getLatestArchiveDate() {
  const responseText = await fetchTcgcsvText("/last-updated.txt", "text/plain");
  const normalizedText = responseText.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const observedAt = new Date(normalizedText);

  if (Number.isNaN(observedAt.getTime())) {
    throw new Error(`Unable to parse TCGCSV last-updated timestamp: ${responseText}`);
  }

  return observedAt.toISOString().slice(0, 10);
}

async function getTcgcsvGroupOrder() {
  const responseText = await fetchTcgcsvText("/tcgplayer/3/groups", "application/json");
  const payload = JSON.parse(responseText);

  if (!Array.isArray(payload.results)) {
    throw new Error("TCGCSV did not return a valid Pokemon group list.");
  }

  return getNightlyTcgcsvGroupOrder(payload.results);
}

async function downloadArchive(archiveDate) {
  const archivePath = getArchivePath(archiveDate);

  try {
    const archiveStats = await stat(archivePath);
    if (archiveStats.size > 0) return archivePath;
  } catch {
    // Download archives that are not already cached from an interrupted run.
  }

  const partialPath = `${archivePath}.part`;
  const path = `/archive/tcgplayer/prices-${archiveDate}.ppmd.7z`;
  let lastError = null;

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
    try {
      await throttleTcgcsvRequest();
      const response = await fetch(`${TCGCSV_BASE_URL}${path}`, {
        headers: {
          Accept: "application/x-7z-compressed",
          "User-Agent": USER_AGENT,
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(`TCGCSV returned ${response.status} for ${path}.`);
      }

      await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath));
      await rename(partialPath, archivePath);
      return archivePath;
    } catch (error) {
      lastError = error;
      await rm(partialPath, { force: true });

      if (attempt > options.maxRetries) break;

      const retryDelayMs = Math.min(15_000, 500 * 2 ** (attempt - 1));
      console.warn(`Retrying ${path} after ${retryDelayMs}ms (${attempt}/${options.maxRetries}).`);
      await sleep(retryDelayMs);
    }
  }

  throw lastError ?? new Error(`TCGCSV archive download failed for ${archiveDate}.`);
}

async function fetchTcgcsvText(path, accept) {
  let lastError = null;

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
    try {
      await throttleTcgcsvRequest();
      const response = await fetch(`${TCGCSV_BASE_URL}${path}`, {
        headers: { Accept: accept, "User-Agent": USER_AGENT },
      });

      if (!response.ok) throw new Error(`TCGCSV returned ${response.status} for ${path}.`);
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt > options.maxRetries) break;
      await sleep(Math.min(15_000, 500 * 2 ** (attempt - 1)));
    }
  }

  throw lastError ?? new Error(`TCGCSV request failed for ${path}.`);
}

async function extractPokemonPrices(archiveDate, archivePath) {
  const extractDirectory = getExtractDirectory(archiveDate);
  const categoryDirectory = join(extractDirectory, archiveDate, "3");

  try {
    const categoryStats = await stat(categoryDirectory);
    if (categoryStats.isDirectory()) return categoryDirectory;
  } catch {
    // Extract archives that were not completed by an interrupted run.
  }

  await rm(extractDirectory, { force: true, recursive: true });
  await mkdir(extractDirectory, { recursive: true });
  await runArchiveExtractor(archivePath, extractDirectory, archiveDate);
  return categoryDirectory;
}

async function runArchiveExtractor(archivePath, extractDirectory, archiveDate) {
  const configuredExtractor = process.env.TCGCSV_ARCHIVE_EXTRACTOR?.trim();
  const extractor = configuredExtractor || "tar";
  const executableName = basename(extractor).toLowerCase();

  try {
    if (executableName === "7z" || executableName === "7z.exe" || executableName === "7zz") {
      await execFileAsync(extractor, ["x", "-y", `-o${extractDirectory}`, archivePath, `${archiveDate}/3/*`]);
      return;
    }

    await execFileAsync(extractor, ["-xf", archivePath, "-C", extractDirectory, `${archiveDate}/3`]);
  } catch (error) {
    throw new Error(
      `Unable to extract ${archivePath} with ${extractor}. Install bsdtar/7-Zip or set TCGCSV_ARCHIVE_EXTRACTOR.`,
      { cause: error },
    );
  }
}

async function readPokemonPriceRows(categoryDirectory) {
  const groupEntries = await readdir(categoryDirectory, { withFileTypes: true });
  const priceRowsByGroup = new Map();
  let priceFilesRead = 0;

  for (const entry of groupEntries) {
    if (!entry.isDirectory()) continue;

    const pricePath = join(categoryDirectory, entry.name, "prices");

    try {
      const payload = JSON.parse(await readFile(pricePath, "utf8"));
      if (Array.isArray(payload.results)) priceRowsByGroup.set(entry.name, payload.results);
      priceFilesRead += 1;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error(`Unable to read archived price file ${pricePath}.`, { cause: error });
    }
  }

  return { priceRowsByGroup, priceFilesRead };
}

async function cleanupArchiveFiles(archiveDate) {
  const archivePath = getArchivePath(archiveDate);
  const extractDirectory = getExtractDirectory(archiveDate);
  assertPathInsideWorkingDirectory(archivePath);
  assertPathInsideWorkingDirectory(extractDirectory);
  await rm(archivePath, { force: true });
  await rm(extractDirectory, { force: true, recursive: true });
}

async function removeStageFiles(value) {
  assertPathInsideWorkingDirectory(value);
  await rm(value, { force: true });
  await rm(`${value}-shm`, { force: true });
  await rm(`${value}-wal`, { force: true });
}

async function throttleTcgcsvRequest() {
  const elapsedMs = Date.now() - lastTcgcsvRequestAt;

  if (elapsedMs < options.requestDelayMs) await sleep(options.requestDelayMs - elapsedMs);
  lastTcgcsvRequestAt = Date.now();
}

function getArchivePath(archiveDate) {
  return join(workingDirectory, `prices-${archiveDate}.ppmd.7z`);
}

function getExtractDirectory(archiveDate) {
  return join(workingDirectory, `extract-${archiveDate}`);
}

function getStageMetadata(key) {
  return stage.prepare("select value from metadata where key = ?").get(key)?.value ?? null;
}

function setStageMetadata(key, value) {
  stage
    .prepare("insert into metadata (key, value) values (?, ?) on conflict (key) do update set value = excluded.value")
    .run(key, value);
}

function assertSafeWorkingDirectory(value) {
  const root = parse(value).root;
  if (value === root || value === resolve(tmpdir())) {
    throw new Error("The TCGCSV working directory must not be a filesystem or temp root.");
  }
}

function assertPathInsideWorkingDirectory(value) {
  const resolvedPath = resolve(value);
  const separator = process.platform === "win32" ? "\\" : "/";
  const prefix = `${workingDirectory.toLowerCase()}${separator}`;

  if (!resolvedPath.toLowerCase().startsWith(prefix)) {
    throw new Error(`Refusing to remove or stage outside ${workingDirectory}.`);
  }
}

function enumerateDates(fromDate, toDate) {
  const dates = [];
  let current = fromDate;

  while (current <= toDate) {
    dates.push(current);
    current = addUtcDays(current, 1);
  }

  return dates;
}

function addUtcDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toObservedDay(value) {
  return Math.floor(new Date(`${value}T00:00:00.000Z`).getTime() / 86_400_000);
}

function fromObservedDay(value) {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${(durationMs / 60_000).toFixed(1)}m`;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
