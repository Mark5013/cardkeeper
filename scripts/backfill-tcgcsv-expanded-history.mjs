import nextEnv from "@next/env";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import postgres from "postgres";

import {
  buildExpandedHistoricalMarketRecords,
  createExpandedHistoryMappingFingerprint,
  createExpandedHistoryMappings,
  selectChangedExpandedHistoryRecords,
  TCGCSV_EXPANDED_HISTORY_MAPPING_POLICY_VERSION,
} from "./lib/tcgcsv-expanded-history-core.mjs";

const { loadEnvConfig } = nextEnv;
const execFileAsync = promisify(execFile);

loadEnvConfig(process.cwd());

const TCGCSV_BASE_URL = "https://tcgcsv.com";
const EARLIEST_ARCHIVE_DATE = "2024-02-08";
const CATEGORY_IDS = [3, 85];
const DEFAULT_REQUEST_DELAY_MS = 250;
const MINIMUM_REQUEST_DELAY_MS = 100;
const DEFAULT_MAX_RETRIES = 3;
const MAX_REQUESTS_PER_DAY = 10_000;
const SERIES_WRITE_BATCH_SIZE = 100;
const USER_AGENT =
  process.env.TCGCSV_USER_AGENT ??
  "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";

class RollbackRehearsal extends Error {
  constructor(stats) {
    super("Expanded history rollback rehearsal completed.");
    this.stats = stats;
  }
}

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required to backfill expanded TCGCSV history.",
  );
}

const requestedDates = enumerateDates(options.from, options.to);
const workingDirectory = resolve(
  options.tempDir ??
    join(tmpdir(), "cardkeeper-tcgcsv-expanded-history"),
);
assertSafeWorkingDirectory(workingDirectory);
await mkdir(workingDirectory, { recursive: true });

const stagePath = resolve(
  options.stagePath ??
    join(workingDirectory, "tcgcsv-expanded-history-stage.sqlite"),
);
assertPathInsideWorkingDirectory(stagePath);
if (options.resetStage) await removeStageFiles(stagePath);

const stage = new DatabaseSync(stagePath);
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 20,
});
let lastTcgcsvRequestAt = 0;

try {
  initializeStage();
  await backfillExpandedHistory();
} finally {
  stage.close();
  await sql.end();
}

function parseArgs(args) {
  const parsed = {
    from: null,
    keepFiles: false,
    maxDays: null,
    maxRetries: DEFAULT_MAX_RETRIES,
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
    resetStage: false,
    rollback: false,
    stagePath: null,
    tempDir: null,
    to: null,
    upload: false,
    verifyUpload: false,
  };

  for (const arg of args) {
    if (arg === "--keep-files") {
      parsed.keepFiles = true;
    } else if (arg === "--reset-stage") {
      parsed.resetStage = true;
    } else if (arg === "--rollback") {
      parsed.rollback = true;
    } else if (arg === "--upload") {
      parsed.upload = true;
    } else if (arg === "--verify-upload") {
      parsed.verifyUpload = true;
    } else if (arg.startsWith("--from=")) {
      parsed.from = parseDateArgument(
        arg.slice("--from=".length),
        "from",
      );
    } else if (arg.startsWith("--to=")) {
      parsed.to = parseDateArgument(arg.slice("--to=".length), "to");
    } else if (arg.startsWith("--max-days=")) {
      parsed.maxDays = parsePositiveInteger(
        arg.slice("--max-days=".length),
        "max days",
      );
    } else if (arg.startsWith("--max-retries=")) {
      parsed.maxRetries = parseNonnegativeInteger(
        arg.slice("--max-retries=".length),
        "max retries",
      );
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
    throw new Error(
      "Both --from=YYYY-MM-DD and --to=YYYY-MM-DD are required.",
    );
  }
  if (parsed.from < EARLIEST_ARCHIVE_DATE) {
    throw new Error(
      `TCGCSV archives begin on ${EARLIEST_ARCHIVE_DATE}.`,
    );
  }
  if (parsed.to < parsed.from) {
    throw new Error("The --to date must be on or after the --from date.");
  }
  if (parsed.requestDelayMs < MINIMUM_REQUEST_DELAY_MS) {
    throw new Error(
      `TCGCSV requires at least ${MINIMUM_REQUEST_DELAY_MS}ms between requests.`,
    );
  }
  if (parsed.upload && parsed.verifyUpload) {
    throw new Error("Use either --upload or --verify-upload, not both.");
  }
  if (parsed.rollback && !parsed.upload) {
    throw new Error("--rollback requires --upload.");
  }
  if (parsed.maxDays && (parsed.upload || parsed.verifyUpload)) {
    throw new Error(
      "--max-days cannot be combined with upload verification or writes.",
    );
  }

  return parsed;
}

function parseDateArgument(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected ${label} to use YYYY-MM-DD.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
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

    create table if not exists targets (
      local_id integer primary key,
      target_type text not null check (target_type in ('card', 'sealed')),
      target_id text not null,
      previous_amount_minor integer,
      unique (target_type, target_id)
    );

    create table if not exists history_points (
      target_key integer not null
        references targets(local_id) on delete cascade,
      observed_day integer not null,
      amount_minor integer not null check (amount_minor >= 0),
      primary key (target_key, observed_day)
    ) without rowid;

    create table if not exists archive_imports (
      archive_date text primary key,
      price_files_read integer not null,
      price_rows_read integer not null,
      valid_market_rows integer not null,
      mapped_market_rows integer not null,
      matched_targets integer not null,
      changed_points integer not null,
      completed_at text not null
    ) without rowid;
  `);

  const storedFrom = getStageMetadata("archive_from");
  const storedTo = getStageMetadata("archive_to");
  const storedPolicy = getStageMetadata("mapping_policy_version");
  const hasState =
    storedFrom !== null ||
    storedTo !== null ||
    stageHasHistoricalState();

  if (
    storedPolicy !==
      TCGCSV_EXPANDED_HISTORY_MAPPING_POLICY_VERSION &&
    (storedPolicy || hasState)
  ) {
    throw new Error(
      `The expanded stage uses mapping policy ${storedPolicy ?? "legacy/unversioned"}; use --reset-stage.`,
    );
  }
  if (
    (storedFrom && storedFrom !== options.from) ||
    (storedTo && storedTo !== options.to)
  ) {
    throw new Error(
      `The expanded stage belongs to ${storedFrom} through ${storedTo}; use matching dates or --reset-stage.`,
    );
  }

  setStageMetadata(
    "mapping_policy_version",
    TCGCSV_EXPANDED_HISTORY_MAPPING_POLICY_VERSION,
  );
  setStageMetadata("archive_from", options.from);
  setStageMetadata("archive_to", options.to);
}

async function backfillExpandedHistory() {
  const startedAt = Date.now();
  const mappingRows = await getExpandedHistoryMappingRows();
  const mappingFingerprint =
    createExpandedHistoryMappingFingerprint(mappingRows);
  const storedFingerprint = getStageMetadata("mapping_fingerprint");

  if (
    storedFingerprint !== mappingFingerprint &&
    (storedFingerprint || stageHasHistoricalState())
  ) {
    throw new Error(
      "Expanded card/sealed mappings changed after this stage was created; use --reset-stage.",
    );
  }
  if (!storedFingerprint) {
    setStageMetadata("mapping_fingerprint", mappingFingerprint);
  }

  insertStageTargets(mappingRows);
  const localTargetIds = loadLocalTargetIds();
  const stagedMappingRows = mappingRows.map((row) => {
    const localId = localTargetIds.get(
      getTargetIdentity(row.target_type, row.target_id),
    );

    if (!localId) {
      throw new Error(
        `Missing staged ${row.target_type} target ${row.target_id}.`,
      );
    }

    return {
      ...row,
      target_id: String(localId),
    };
  });
  const mappings = createExpandedHistoryMappings(stagedMappingRows);

  if (mappings.targetCount !== localTargetIds.size) {
    throw new Error(
      `Only ${mappings.targetCount.toLocaleString()} of ${localTargetIds.size.toLocaleString()} expanded targets have one exact source mapping.`,
    );
  }

  const previousAmounts = loadPreviousAmounts();
  const completedDates = loadCompletedDates();
  assertCompletedDatesAreContiguous(completedDates);
  const pendingDates = requestedDates.filter(
    (date) => !completedDates.has(date),
  );
  const datesToProcess = options.maxDays
    ? pendingDates.slice(0, options.maxDays)
    : pendingDates;
  const maximumRequests =
    datesToProcess.length * (options.maxRetries + 1) +
    (datesToProcess.length ? 1 : 0);

  if (maximumRequests >= MAX_REQUESTS_PER_DAY) {
    throw new Error(
      `This run could make up to ${maximumRequests.toLocaleString()} requests, violating TCGCSV's under-10,000 daily rule.`,
    );
  }

  if (datesToProcess.length > 0) {
    const latestArchiveDate = await getLatestArchiveDate();

    if (options.to > latestArchiveDate) {
      throw new Error(
        `TCGCSV's latest completed archive is ${latestArchiveDate}, before requested ${options.to}.`,
      );
    }
  }

  console.log(
    `Starting expanded TCGCSV history staging: ${options.from} through ${options.to}; ${completedDates.size.toLocaleString()} archives already staged, ${datesToProcess.length.toLocaleString()} to process, ${localTargetIds.size.toLocaleString()} exact Japanese-card and sealed targets, ${options.requestDelayMs}ms request spacing.`,
  );

  for (const archiveDate of datesToProcess) {
    const archiveStartedAt = Date.now();
    const archivePath = await downloadArchive(archiveDate);
    const extractDirectory = await extractExpandedPrices(
      archiveDate,
      archivePath,
    );
    const { categoryGroups, priceFilesRead } =
      await readExpandedPriceRows(extractDirectory, archiveDate);
    const built = buildExpandedHistoricalMarketRecords({
      categoryGroups,
      mappings,
    });

    if (built.stats.ambiguousSealedTargets > 0) {
      throw new Error(
        `${archiveDate} contains ${built.stats.ambiguousSealedTargets.toLocaleString()} sealed targets with conflicting subtype evidence.`,
      );
    }

    const changedRecords = selectChangedExpandedHistoryRecords(
      built.records,
      previousAmounts,
    );
    stageArchive(archiveDate, changedRecords, {
      ...built.stats,
      priceFilesRead,
      matchedTargets: built.records.length,
    });

    console.log(
      `${archiveDate}: ${priceFilesRead.toLocaleString()} files, ${built.stats.mappedMarketRows.toLocaleString()}/${built.stats.validMarketRows.toLocaleString()} market rows mapped, ${built.records.length.toLocaleString()} targets, ${changedRecords.length.toLocaleString()} changes staged in ${formatDuration(Date.now() - archiveStartedAt)}.`,
    );

    if (!options.keepFiles) {
      await cleanupArchiveFiles(archiveDate);
    }
  }

  await assertCurrentMappingFingerprint(mappingFingerprint);
  const stagedArchiveCount = Number(
    stage
      .prepare("select count(*) as count from archive_imports")
      .get().count,
  );

  if (stagedArchiveCount < requestedDates.length) {
    console.log(
      `Staging paused after ${stagedArchiveCount.toLocaleString()}/${requestedDates.length.toLocaleString()} archives. Run the same command again to resume.`,
    );
    return;
  }

  await refreshStageTail(localTargetIds);
  await assertCurrentMappingFingerprint(mappingFingerprint);
  const expectation = getStageExpectation();

  console.log(
    `Expanded stage complete: ${formatExpectation(expectation)} in ${formatDuration(Date.now() - startedAt)}.`,
  );

  await verifyStageAgainstCurrentPrices(localTargetIds);

  if (options.verifyUpload) {
    await verifyUploadedExpandedSeries(expectation);
    console.log(`Expanded stage retained at ${stagePath}.`);
    return;
  }

  if (!options.upload) {
    console.log(
      `Stage-only run complete; production was not changed. Stage retained at ${stagePath}.`,
    );
    return;
  }

  let uploadStats;

  try {
    uploadStats = await uploadExpandedSeries(
      expectation,
      mappingFingerprint,
    );
  } catch (error) {
    if (error instanceof RollbackRehearsal) {
      console.log(
        `Expanded upload rollback rehearsal passed: ${formatExpectation(error.stats)}. Production was not changed.`,
      );
      return;
    }
    throw error;
  }
  setStageMetadata("uploaded_at", new Date().toISOString());
  setStageMetadata(
    "uploaded_points",
    String(uploadStats.card.points + uploadStats.sealed.points),
  );

  console.log(
    `Expanded history upload complete: ${formatExpectation(uploadStats)}. Current-price rows and collections were not changed.`,
  );
}

async function getExpandedHistoryMappingRows(database = sql) {
  const cardRows = await database`
    with eligible_refs as (
      select
        refs.card_variant_id,
        min(btrim(refs.ref_value)) as product_id,
        min(refs.metadata ->> 'tcgcsvCategoryId') as category_id,
        min(refs.metadata ->> 'tcgcsvGroupId') as group_id
      from card_variant_external_refs refs
      where refs.source = 'tcgplayer'
        and refs.ref_type = 'product_id'
      group by refs.card_variant_id
      having count(*) = 1
        and bool_and(btrim(refs.ref_value) ~ '^[1-9][0-9]{0,14}$')
        and bool_and(
          coalesce(refs.metadata ->> 'tcgcsvMappingStatus', '') <> 'stale'
        )
    )
    select
      'card'::text as target_type,
      variant.id::text as target_id,
      refs.category_id::integer as category_id,
      refs.group_id::integer as group_id,
      refs.product_id,
      variant.printing
    from eligible_refs refs
    inner join card_variants variant
      on variant.id = refs.card_variant_id
    where variant.language_code = 'ja'
      and variant.condition = 'unspecified'
  `;
  const sealedRows = await database`
    select
      'sealed'::text as target_type,
      product.id::text as target_id,
      product.category_id,
      product.group_id,
      btrim(product.provider_id) as product_id,
      null::text as printing
    from sealed_products product
    where product.category_id in (3, 85)
  `;
  const rows = [...cardRows, ...sealedRows];
  const invalid = rows.filter(
    (row) =>
      !CATEGORY_IDS.includes(Number(row.category_id)) ||
      !Number.isInteger(Number(row.group_id)) ||
      !/^[1-9][0-9]{0,14}$/.test(String(row.product_id)),
  );

  if (invalid.length > 0) {
    throw new Error(
      `${invalid.length.toLocaleString()} expanded history mappings have invalid category, group, or product identities.`,
    );
  }

  return rows;
}

async function assertCurrentMappingFingerprint(
  expectedFingerprint,
  database = sql,
) {
  const currentRows = await getExpandedHistoryMappingRows(database);
  const currentFingerprint =
    createExpandedHistoryMappingFingerprint(currentRows);

  if (currentFingerprint !== expectedFingerprint) {
    throw new Error(
      "Japanese-card or sealed-product mappings changed during the history run; use --reset-stage.",
    );
  }
}

function insertStageTargets(mappingRows) {
  const insert = stage.prepare(`
    insert into targets (target_type, target_id)
    values (?, ?)
    on conflict (target_type, target_id) do nothing
  `);
  stage.exec("begin immediate");

  try {
    for (const row of mappingRows) {
      insert.run(row.target_type, row.target_id);
    }
    stage.exec("commit");
  } catch (error) {
    stage.exec("rollback");
    throw error;
  }
}

function loadLocalTargetIds() {
  return new Map(
    stage
      .prepare(
        "select local_id, target_type, target_id from targets",
      )
      .all()
      .map((row) => [
        getTargetIdentity(row.target_type, row.target_id),
        Number(row.local_id),
      ]),
  );
}

function loadPreviousAmounts() {
  return new Map(
    stage
      .prepare(`
        select local_id, previous_amount_minor
        from targets
        where previous_amount_minor is not null
      `)
      .all()
      .map((row) => [
        String(row.local_id),
        Number(row.previous_amount_minor),
      ]),
  );
}

function loadCompletedDates() {
  return new Set(
    stage
      .prepare(
        "select archive_date from archive_imports order by archive_date",
      )
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
      throw new Error(
        "The expanded stage has a completed archive after a gap; use --reset-stage.",
      );
    }
  }
}

function stageArchive(archiveDate, changedRecords, stats) {
  const insertPoint = stage.prepare(`
    insert into history_points (target_key, observed_day, amount_minor)
    values (?, ?, ?)
    on conflict (target_key, observed_day)
    do update set amount_minor = excluded.amount_minor
  `);
  const updatePrevious = stage.prepare(
    "update targets set previous_amount_minor = ? where local_id = ?",
  );
  const insertArchive = stage.prepare(`
    insert into archive_imports (
      archive_date,
      price_files_read,
      price_rows_read,
      valid_market_rows,
      mapped_market_rows,
      matched_targets,
      changed_points,
      completed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const observedDay = toObservedDay(archiveDate);
  stage.exec("begin immediate");

  try {
    for (const record of changedRecords) {
      const localId = Number(record.target_id);
      insertPoint.run(localId, observedDay, record.amount_minor);
      updatePrevious.run(record.amount_minor, localId);
    }

    insertArchive.run(
      archiveDate,
      stats.priceFilesRead,
      stats.priceRowsRead,
      stats.validMarketRows,
      stats.mappedMarketRows,
      stats.matchedTargets,
      changedRecords.length,
      new Date().toISOString(),
    );
    stage.exec("commit");
  } catch (error) {
    stage.exec("rollback");
    throw error;
  }
}

async function refreshStageTail(localTargetIds) {
  const archiveEndDay = toObservedDay(options.to);
  stage.exec("begin immediate");

  try {
    stage
      .prepare(
        "delete from history_points where observed_day > ?",
      )
      .run(archiveEndDay);
    stage.exec(`
      update targets
      set previous_amount_minor = (
        select point.amount_minor
        from history_points point
        where point.target_key = targets.local_id
        order by point.observed_day desc
        limit 1
      )
    `);
    stage.exec("commit");
  } catch (error) {
    stage.exec("rollback");
    throw error;
  }

  const rowsByDate = new Map();
  const addTailPoint = (
    targetType,
    targetId,
    observedOn,
    amountMinor,
  ) => {
    if (observedOn <= options.to) return;

    const localId = localTargetIds.get(
      getTargetIdentity(targetType, targetId),
    );
    if (!localId) return;

    const rowsForDate = rowsByDate.get(observedOn) ?? new Map();
    rowsForDate.set(String(localId), Number(amountMinor));
    rowsByDate.set(observedOn, rowsForDate);
  };
  const cardSeries = await sql`
    select
      variant.id::text as target_id,
      series.observed_on,
      series.amounts_minor
    from price_series series
    inner join card_variants variant
      on variant.id = series.card_variant_id
    where series.source = 'tcgcsv'
      and series.price_type = 'market'
      and series.currency = 'USD'
      and variant.language_code = 'ja'
  `;
  const sealedSeries = await sql`
    select
      product.id::text as target_id,
      series.observed_on,
      series.amounts_minor
    from sealed_price_series series
    inner join sealed_products product
      on product.id = series.sealed_product_id
    where series.source = 'tcgcsv'
      and series.price_type = 'market'
      and series.currency = 'USD'
      and product.category_id in (3, 85)
  `;

  for (const [targetType, rows] of [
    ["card", cardSeries],
    ["sealed", sealedSeries],
  ]) {
    for (const row of rows) {
      const pointCount = Math.min(
        row.observed_on.length,
        row.amounts_minor.length,
      );

      for (let index = 0; index < pointCount; index += 1) {
        addTailPoint(
          targetType,
          row.target_id,
          toDateOnly(row.observed_on[index]),
          row.amounts_minor[index],
        );
      }
    }
  }

  const cardCurrent = await sql`
    select
      variant.id::text as target_id,
      price.observed_at,
      price.amount_minor
    from current_prices price
    inner join card_variants variant
      on variant.id = price.card_variant_id
    where price.source = 'tcgcsv'
      and price.price_type = 'market'
      and price.currency = 'USD'
      and variant.language_code = 'ja'
      and price.observed_at >=
        ${`${addUtcDays(options.to, 1)}T00:00:00.000Z`}::timestamptz
  `;
  const sealedCurrent = await sql`
    select
      product.id::text as target_id,
      price.observed_at,
      price.amount_minor
    from sealed_current_prices price
    inner join sealed_products product
      on product.id = price.sealed_product_id
    where price.source = 'tcgcsv'
      and price.price_type = 'market'
      and price.currency = 'USD'
      and product.category_id in (3, 85)
      and price.observed_at >=
        ${`${addUtcDays(options.to, 1)}T00:00:00.000Z`}::timestamptz
  `;

  for (const [targetType, rows] of [
    ["card", cardCurrent],
    ["sealed", sealedCurrent],
  ]) {
    for (const row of rows) {
      addTailPoint(
        targetType,
        row.target_id,
        new Date(row.observed_at).toISOString().slice(0, 10),
        row.amount_minor,
      );
    }
  }

  const previousAmounts = loadPreviousAmounts();

  for (const [observedOn, amountsByTarget] of Array.from(
    rowsByDate,
  ).sort(([left], [right]) => left.localeCompare(right))) {
    const records = Array.from(
      amountsByTarget,
      ([targetId, amountMinor]) => ({
        target_id: targetId,
        amount_minor: amountMinor,
      }),
    );
    const changedRecords = selectChangedExpandedHistoryRecords(
      records,
      previousAmounts,
    );
    stageTailDate(observedOn, changedRecords);
  }
}

function stageTailDate(observedOn, changedRecords) {
  const insertPoint = stage.prepare(`
    insert into history_points (target_key, observed_day, amount_minor)
    values (?, ?, ?)
    on conflict (target_key, observed_day)
    do update set amount_minor = excluded.amount_minor
  `);
  const updatePrevious = stage.prepare(
    "update targets set previous_amount_minor = ? where local_id = ?",
  );
  const observedDay = toObservedDay(observedOn);
  stage.exec("begin immediate");

  try {
    for (const record of changedRecords) {
      const localId = Number(record.target_id);
      insertPoint.run(localId, observedDay, record.amount_minor);
      updatePrevious.run(record.amount_minor, localId);
    }
    stage.exec("commit");
  } catch (error) {
    stage.exec("rollback");
    throw error;
  }
}

async function verifyStageAgainstCurrentPrices(localTargetIds) {
  const latestStageAmounts = new Map(
    stage
      .prepare(`
        select
          target.target_type,
          target.target_id,
          point.amount_minor
        from targets target
        inner join history_points point
          on point.target_key = target.local_id
        where point.observed_day = (
          select max(latest.observed_day)
          from history_points latest
          where latest.target_key = target.local_id
        )
      `)
      .all()
      .map((row) => [
        getTargetIdentity(row.target_type, row.target_id),
        Number(row.amount_minor),
      ]),
  );
  const cardCurrent = await sql`
    select
      variant.id::text as target_id,
      price.amount_minor
    from current_prices price
    inner join card_variants variant
      on variant.id = price.card_variant_id
    where price.source = 'tcgcsv'
      and price.price_type = 'market'
      and price.currency = 'USD'
      and variant.language_code = 'ja'
  `;
  const sealedCurrent = await sql`
    select
      product.id::text as target_id,
      price.amount_minor
    from sealed_current_prices price
    inner join sealed_products product
      on product.id = price.sealed_product_id
    where price.source = 'tcgcsv'
      and price.price_type = 'market'
      and price.currency = 'USD'
      and product.category_id in (3, 85)
  `;
  const examples = [];
  let comparisons = 0;
  let mismatches = 0;

  for (const [targetType, rows] of [
    ["card", cardCurrent],
    ["sealed", sealedCurrent],
  ]) {
    for (const row of rows) {
      const targetIdentity = getTargetIdentity(
        targetType,
        row.target_id,
      );
      if (!localTargetIds.has(targetIdentity)) {
        mismatches += 1;
        if (examples.length < 10) {
          examples.push(`${targetIdentity}: not in staged mappings`);
        }
        continue;
      }

      comparisons += 1;
      const stagedAmount = latestStageAmounts.get(targetIdentity);
      const currentAmount = Number(row.amount_minor);

      if (stagedAmount === currentAmount) continue;

      mismatches += 1;
      if (examples.length < 10) {
        examples.push(
          `${targetIdentity}: staged=${stagedAmount ?? "missing"}, current=${currentAmount}`,
        );
      }
    }
  }

  if (mismatches > 0) {
    throw new Error(
      `Expanded current-price verification found ${mismatches.toLocaleString()} mismatches across ${comparisons.toLocaleString()} comparisons. ${examples.join("; ")}`,
    );
  }

  console.log(
    `Expanded current-price verification passed: ${comparisons.toLocaleString()} latest staged market values match production.`,
  );
}

function getStageExpectation() {
  const rows = stage
    .prepare(`
      select
        target.target_type,
        count(distinct target.local_id) as series,
        count(*) as points,
        min(point.observed_day) as earliest,
        max(point.observed_day) as latest
      from history_points point
      inner join targets target on target.local_id = point.target_key
      group by target.target_type
    `)
    .all();
  const expectation = {
    card: emptySeriesStats(),
    sealed: emptySeriesStats(),
  };

  for (const row of rows) {
    expectation[row.target_type] = {
      earliest: fromObservedDay(Number(row.earliest)),
      latest: fromObservedDay(Number(row.latest)),
      points: Number(row.points),
      series: Number(row.series),
    };
  }

  return expectation;
}

async function uploadExpandedSeries(expectation, mappingFingerprint) {
  return sql.begin(async (transaction) => {
    await transaction`
      lock table
        card_variants,
        card_variant_external_refs,
        sealed_products
      in share mode
    `;
    await transaction`
      lock table current_prices, sealed_current_prices in share mode
    `;
    await assertCurrentMappingFingerprint(
      mappingFingerprint,
      transaction,
    );

    const deletedCardSeries = await transaction`
      delete from price_series series
      using card_variants variant
      where series.card_variant_id = variant.id
        and series.source = 'tcgcsv'
        and series.price_type = 'market'
        and series.currency = 'USD'
        and variant.language_code = 'ja'
      returning series.card_variant_id
    `;
    const deletedSealedSeries = await transaction`
      delete from sealed_price_series series
      using sealed_products product
      where series.sealed_product_id = product.id
        and series.source = 'tcgcsv'
        and series.price_type = 'market'
        and series.currency = 'USD'
        and product.category_id in (3, 85)
      returning series.sealed_product_id
    `;
    const iterator = stage
      .prepare(`
        select
          target.target_type,
          target.target_id,
          point.observed_day,
          point.amount_minor
        from history_points point
        inner join targets target on target.local_id = point.target_key
        order by
          target.target_type,
          target.target_id,
          point.observed_day
      `)
      .iterate();
    let currentType = null;
    let currentId = null;
    let observedOn = [];
    let amountsMinor = [];
    let cardBatch = [];
    let sealedBatch = [];
    let cardSeries = 0;
    let sealedSeries = 0;
    let cardPoints = 0;
    let sealedPoints = 0;

    const flushBatches = async () => {
      if (cardBatch.length > 0) {
        await writeCardSeriesBatch(cardBatch, transaction);
        cardBatch = [];
      }
      if (sealedBatch.length > 0) {
        await writeSealedSeriesBatch(sealedBatch, transaction);
        sealedBatch = [];
      }
    };
    const flushSeries = async () => {
      if (!currentType || !currentId) return;

      const shared = {
        source: "tcgcsv",
        price_type: "market",
        currency: "USD",
        observed_on: observedOn,
        amounts_minor: amountsMinor,
        updated_at: new Date(),
      };

      if (currentType === "card") {
        cardBatch.push({
          card_variant_id: currentId,
          ...shared,
        });
        cardSeries += 1;
        cardPoints += observedOn.length;
      } else {
        sealedBatch.push({
          sealed_product_id: currentId,
          ...shared,
        });
        sealedSeries += 1;
        sealedPoints += observedOn.length;
      }

      observedOn = [];
      amountsMinor = [];

      if (
        cardBatch.length + sealedBatch.length >=
        SERIES_WRITE_BATCH_SIZE
      ) {
        await flushBatches();
        const seriesCount = cardSeries + sealedSeries;
        if (seriesCount % 2_000 === 0) {
          console.log(
            `Uploaded ${seriesCount.toLocaleString()} expanded series...`,
          );
        }
      }
    };

    for (const row of iterator) {
      const targetType = String(row.target_type);
      const targetId = String(row.target_id);

      if (
        currentId &&
        (targetType !== currentType || targetId !== currentId)
      ) {
        await flushSeries();
      }
      if (targetType !== currentType || targetId !== currentId) {
        currentType = targetType;
        currentId = targetId;
      }

      observedOn.push(fromObservedDay(Number(row.observed_day)));
      amountsMinor.push(Number(row.amount_minor));
    }

    await flushSeries();
    await flushBatches();

    const uploadStats = {
      card: {
        ...expectation.card,
        points: cardPoints,
        replacedSeries: deletedCardSeries.length,
        series: cardSeries,
      },
      sealed: {
        ...expectation.sealed,
        points: sealedPoints,
        replacedSeries: deletedSealedSeries.length,
        series: sealedSeries,
      },
    };

    for (const targetType of ["card", "sealed"]) {
      if (
        uploadStats[targetType].points !==
          expectation[targetType].points ||
        uploadStats[targetType].series !==
          expectation[targetType].series
      ) {
        throw new Error(
          `Staged ${targetType} iteration did not match its expected summary.`,
        );
      }
    }

    await verifyUploadedExpandedSeries(uploadStats, transaction);

    if (options.rollback) {
      throw new RollbackRehearsal(uploadStats);
    }

    return uploadStats;
  });
}

async function writeCardSeriesBatch(batch, database = sql) {
  await database`
    insert into price_series ${database(
      batch,
      "card_variant_id",
      "source",
      "price_type",
      "currency",
      "observed_on",
      "amounts_minor",
      "updated_at",
    )}
    on conflict (card_variant_id, source, price_type, currency)
    do update set
      observed_on = excluded.observed_on,
      amounts_minor = excluded.amounts_minor,
      updated_at = excluded.updated_at
  `;
}

async function writeSealedSeriesBatch(batch, database = sql) {
  await database`
    insert into sealed_price_series ${database(
      batch,
      "sealed_product_id",
      "source",
      "price_type",
      "currency",
      "observed_on",
      "amounts_minor",
      "updated_at",
    )}
    on conflict (sealed_product_id, source, price_type, currency)
    do update set
      observed_on = excluded.observed_on,
      amounts_minor = excluded.amounts_minor,
      updated_at = excluded.updated_at
  `;
}

async function verifyUploadedExpandedSeries(
  expected,
  database = sql,
) {
  const [cardStats] = await database`
    select
      count(*)::integer as series,
      coalesce(sum(cardinality(series.observed_on)), 0)::bigint as points,
      min(series.observed_on[1])::text as earliest,
      max(
        series.observed_on[cardinality(series.observed_on)]
      )::text as latest,
      count(*) filter (
        where cardinality(series.observed_on) <>
            cardinality(series.amounts_minor)
          or cardinality(series.observed_on) = 0
      )::integer as malformed,
      count(*) filter (
        where exists (
          select 1
          from generate_subscripts(series.observed_on, 1)
            as indices(idx)
          where indices.idx < cardinality(series.observed_on)
            and series.observed_on[indices.idx] >=
              series.observed_on[indices.idx + 1]
        )
      )::integer as invalid_order
    from price_series series
    inner join card_variants variant
      on variant.id = series.card_variant_id
    where series.source = 'tcgcsv'
      and series.price_type = 'market'
      and series.currency = 'USD'
      and variant.language_code = 'ja'
  `;
  const [sealedStats] = await database`
    select
      count(*)::integer as series,
      coalesce(sum(cardinality(series.observed_on)), 0)::bigint as points,
      min(series.observed_on[1])::text as earliest,
      max(
        series.observed_on[cardinality(series.observed_on)]
      )::text as latest,
      count(*) filter (
        where cardinality(series.observed_on) <>
            cardinality(series.amounts_minor)
          or cardinality(series.observed_on) = 0
      )::integer as malformed,
      count(*) filter (
        where exists (
          select 1
          from generate_subscripts(series.observed_on, 1)
            as indices(idx)
          where indices.idx < cardinality(series.observed_on)
            and series.observed_on[indices.idx] >=
              series.observed_on[indices.idx + 1]
        )
      )::integer as invalid_order
    from sealed_price_series series
    inner join sealed_products product
      on product.id = series.sealed_product_id
    where series.source = 'tcgcsv'
      and series.price_type = 'market'
      and series.currency = 'USD'
      and product.category_id in (3, 85)
  `;
  const [cardCurrent] = await database`
    select count(*)::integer as mismatches
    from current_prices price
    inner join card_variants variant
      on variant.id = price.card_variant_id
    left join price_series series
      on series.card_variant_id = price.card_variant_id
      and series.source = price.source
      and series.price_type = price.price_type
      and series.currency = price.currency
    where price.source = 'tcgcsv'
      and price.price_type = 'market'
      and price.currency = 'USD'
      and variant.language_code = 'ja'
      and (
        series.card_variant_id is null
        or series.amounts_minor[
          cardinality(series.amounts_minor)
        ] <> price.amount_minor
      )
  `;
  const [sealedCurrent] = await database`
    select count(*)::integer as mismatches
    from sealed_current_prices price
    inner join sealed_products product
      on product.id = price.sealed_product_id
    left join sealed_price_series series
      on series.sealed_product_id = price.sealed_product_id
      and series.source = price.source
      and series.price_type = price.price_type
      and series.currency = price.currency
    where price.source = 'tcgcsv'
      and price.price_type = 'market'
      and price.currency = 'USD'
      and product.category_id in (3, 85)
      and (
        series.sealed_product_id is null
        or series.amounts_minor[
          cardinality(series.amounts_minor)
        ] <> price.amount_minor
      )
  `;
  const actual = {
    card: normalizeDatabaseStats(cardStats),
    sealed: normalizeDatabaseStats(sealedStats),
  };

  for (const targetType of ["card", "sealed"]) {
    const expectedStats = expected[targetType];
    const actualStats = actual[targetType];
    const currentMismatches = Number(
      targetType === "card"
        ? cardCurrent.mismatches
        : sealedCurrent.mismatches,
    );

    if (
      actualStats.series !== expectedStats.series ||
      actualStats.points !== expectedStats.points ||
      actualStats.earliest !== expectedStats.earliest ||
      actualStats.latest !== expectedStats.latest ||
      actualStats.malformed !== 0 ||
      actualStats.invalidOrder !== 0 ||
      currentMismatches !== 0
    ) {
      throw new Error(
        `Uploaded expanded ${targetType} history failed verification: ${JSON.stringify({ expected: expectedStats, actual: actualStats, currentMismatches })}`,
      );
    }
  }

  console.log(
    `Expanded upload verification passed: ${formatExpectation(actual)}; latest series values match all current market rows.`,
  );
}

function normalizeDatabaseStats(row) {
  return {
    earliest: row.earliest,
    invalidOrder: Number(row.invalid_order),
    latest: row.latest,
    malformed: Number(row.malformed),
    points: Number(row.points),
    series: Number(row.series),
  };
}

function emptySeriesStats() {
  return {
    earliest: null,
    latest: null,
    points: 0,
    series: 0,
  };
}

function formatExpectation(expectation) {
  return [
    `${expectation.card.points.toLocaleString()} Japanese-card changes across ${expectation.card.series.toLocaleString()} series (${expectation.card.earliest ?? "none"} through ${expectation.card.latest ?? "none"})`,
    `${expectation.sealed.points.toLocaleString()} sealed changes across ${expectation.sealed.series.toLocaleString()} series (${expectation.sealed.earliest ?? "none"} through ${expectation.sealed.latest ?? "none"})`,
  ].join("; ");
}

async function getLatestArchiveDate() {
  const responseText = await fetchTcgcsvText(
    "/last-updated.txt",
    "text/plain",
  );
  const normalizedText = responseText
    .trim()
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const observedAt = new Date(normalizedText);

  if (Number.isNaN(observedAt.getTime())) {
    throw new Error(
      `Unable to parse TCGCSV last-updated timestamp: ${responseText}`,
    );
  }

  return observedAt.toISOString().slice(0, 10);
}

async function downloadArchive(archiveDate) {
  const archivePath = getArchivePath(archiveDate);

  try {
    const archiveStats = await stat(archivePath);
    if (archiveStats.size > 0) return archivePath;
  } catch {
    // Resume from a cached archive when available.
  }

  const partialPath = `${archivePath}.part`;
  const path = `/archive/tcgplayer/prices-${archiveDate}.ppmd.7z`;
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= options.maxRetries + 1;
    attempt += 1
  ) {
    try {
      await throttleTcgcsvRequest();
      const response = await fetch(`${TCGCSV_BASE_URL}${path}`, {
        headers: {
          Accept: "application/x-7z-compressed",
          "User-Agent": USER_AGENT,
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(
          `TCGCSV returned ${response.status} for ${path}.`,
        );
      }

      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(partialPath),
      );
      await rename(partialPath, archivePath);
      return archivePath;
    } catch (error) {
      lastError = error;
      await rm(partialPath, { force: true });

      if (attempt > options.maxRetries) break;

      const retryDelayMs = Math.min(
        15_000,
        500 * 2 ** (attempt - 1),
      );
      console.warn(
        `Retrying ${path} after ${retryDelayMs}ms (${attempt}/${options.maxRetries}).`,
      );
      await sleep(retryDelayMs);
    }
  }

  throw (
    lastError ??
    new Error(`TCGCSV archive download failed for ${archiveDate}.`)
  );
}

async function fetchTcgcsvText(path, accept) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= options.maxRetries + 1;
    attempt += 1
  ) {
    try {
      await throttleTcgcsvRequest();
      const response = await fetch(`${TCGCSV_BASE_URL}${path}`, {
        headers: { Accept: accept, "User-Agent": USER_AGENT },
      });

      if (!response.ok) {
        throw new Error(
          `TCGCSV returned ${response.status} for ${path}.`,
        );
      }
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt > options.maxRetries) break;
      await sleep(
        Math.min(15_000, 500 * 2 ** (attempt - 1)),
      );
    }
  }

  throw (
    lastError ??
    new Error(`TCGCSV request failed for ${path}.`)
  );
}

async function extractExpandedPrices(archiveDate, archivePath) {
  const extractDirectory = getExtractDirectory(archiveDate);
  const englishDirectory = join(
    extractDirectory,
    archiveDate,
    "3",
  );

  try {
    const categoryStats = await stat(englishDirectory);
    if (categoryStats.isDirectory()) return extractDirectory;
  } catch {
    // Extract archives that were not completed by an interrupted run.
  }

  await rm(extractDirectory, { force: true, recursive: true });
  await mkdir(extractDirectory, { recursive: true });
  await runArchiveExtractor(
    archivePath,
    extractDirectory,
    archiveDate,
  );
  return extractDirectory;
}

async function runArchiveExtractor(
  archivePath,
  extractDirectory,
  archiveDate,
) {
  const configuredExtractor =
    process.env.TCGCSV_ARCHIVE_EXTRACTOR?.trim();
  const extractor = configuredExtractor || "tar";
  const executableName = basename(extractor).toLowerCase();
  const categoryPaths = CATEGORY_IDS.map(
    (categoryId) => `${archiveDate}/${categoryId}`,
  );

  try {
    if (
      executableName === "7z" ||
      executableName === "7z.exe" ||
      executableName === "7zz"
    ) {
      for (const categoryPath of categoryPaths) {
        try {
          await execFileAsync(extractor, [
            "x",
            "-y",
            `-o${extractDirectory}`,
            archivePath,
            `${categoryPath}/*`,
          ]);
        } catch (error) {
          if (archiveMemberIsMissing(error)) continue;
          throw error;
        }
      }
      return;
    }

    for (const categoryPath of categoryPaths) {
      try {
        await execFileAsync(extractor, [
          "-xf",
          archivePath,
          "-C",
          extractDirectory,
          categoryPath,
        ]);
      } catch (error) {
        if (archiveMemberIsMissing(error)) continue;
        throw error;
      }
    }
  } catch (error) {
    throw new Error(
      `Unable to extract ${archivePath} with ${extractor}. Install bsdtar/7-Zip or set TCGCSV_ARCHIVE_EXTRACTOR.`,
      { cause: error },
    );
  }
}

function archiveMemberIsMissing(error) {
  const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;

  return /not found in archive|no files to process|no files to extract/i.test(
    output,
  );
}

async function readExpandedPriceRows(
  extractDirectory,
  archiveDate,
) {
  const categoryGroups = [];
  let priceFilesRead = 0;

  for (const categoryId of CATEGORY_IDS) {
    const categoryDirectory = join(
      extractDirectory,
      archiveDate,
      String(categoryId),
    );
    let groupEntries;

    try {
      groupEntries = await readdir(categoryDirectory, {
        withFileTypes: true,
      });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    groupEntries.sort((left, right) =>
      left.name.localeCompare(right.name, "en", { numeric: true }),
    );

    for (const entry of groupEntries) {
      if (!entry.isDirectory()) continue;

      const groupId = Number(entry.name);
      if (!Number.isInteger(groupId)) continue;

      const pricePath = join(
        categoryDirectory,
        entry.name,
        "prices",
      );

      try {
        const payload = JSON.parse(
          await readFile(pricePath, "utf8"),
        );
        if (Array.isArray(payload.results)) {
          categoryGroups.push({
            categoryId,
            groupId,
            priceRows: payload.results,
          });
        }
        priceFilesRead += 1;
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw new Error(
          `Unable to read archived price file ${pricePath}.`,
          { cause: error },
        );
      }
    }
  }

  return { categoryGroups, priceFilesRead };
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

  if (elapsedMs < options.requestDelayMs) {
    await sleep(options.requestDelayMs - elapsedMs);
  }
  lastTcgcsvRequestAt = Date.now();
}

function getArchivePath(archiveDate) {
  return join(
    workingDirectory,
    `prices-${archiveDate}.ppmd.7z`,
  );
}

function getExtractDirectory(archiveDate) {
  return join(workingDirectory, `extract-${archiveDate}`);
}

function getStageMetadata(key) {
  return (
    stage.prepare("select value from metadata where key = ?").get(key)
      ?.value ?? null
  );
}

function setStageMetadata(key, value) {
  stage
    .prepare(`
      insert into metadata (key, value)
      values (?, ?)
      on conflict (key) do update set value = excluded.value
    `)
    .run(key, value);
}

function stageHasHistoricalState() {
  return (
    Number(
      stage
        .prepare(`
          select exists (
            select 1 from targets
            union all
            select 1 from history_points
            union all
            select 1 from archive_imports
          ) as has_state
        `)
        .get().has_state,
    ) === 1
  );
}

function getTargetIdentity(targetType, targetId) {
  return `${targetType}:${targetId}`;
}

function assertSafeWorkingDirectory(value) {
  const root = parse(value).root;

  if (value === root || value === resolve(tmpdir())) {
    throw new Error(
      "The expanded history working directory must not be a filesystem or temp root.",
    );
  }
}

function assertPathInsideWorkingDirectory(value) {
  const resolvedPath = resolve(value);
  const separator = process.platform === "win32" ? "\\" : "/";
  const prefix = `${workingDirectory.toLowerCase()}${separator}`;

  if (!resolvedPath.toLowerCase().startsWith(prefix)) {
    throw new Error(
      `Refusing to remove or stage outside ${workingDirectory}.`,
    );
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
  return Math.floor(
    new Date(`${value}T00:00:00.000Z`).getTime() / 86_400_000,
  );
}

function fromObservedDay(value) {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

function toDateOnly(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function formatDuration(durationMs) {
  if (durationMs < 1_000) return `${durationMs}ms`;
  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }
  return `${(durationMs / 60_000).toFixed(1)}m`;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}
