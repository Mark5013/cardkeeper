import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;

const API_BASE_URL = "https://api.pokemontcg.io/v2";
const DEFAULT_SET_PAGE_SIZE = 250;
const DEFAULT_CARD_PAGE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_PAGE_DELAY_MS = 500;
const WRITE_BATCH_SIZE = 500;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

loadEnvConfig(process.cwd());

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to import the catalog.");
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 3,
  connect_timeout: 10,
});

try {
  await importCatalog();
} finally {
  await sql.end();
}

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    cardsOnly: false,
    setsOnly: false,
    setPageSize: DEFAULT_SET_PAGE_SIZE,
    cardPageSize: DEFAULT_CARD_PAGE_SIZE,
    maxPages: null,
    startSetPage: 1,
    startCardPage: 1,
    maxRetries: DEFAULT_MAX_RETRIES,
    pageDelayMs: DEFAULT_PAGE_DELAY_MS,
    cardsBySet: false,
    missingOnly: false,
    setId: null,
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--cards-only") {
      parsed.cardsOnly = true;
    } else if (arg === "--sets-only") {
      parsed.setsOnly = true;
    } else if (arg === "--cards-by-set") {
      parsed.cardsBySet = true;
    } else if (arg === "--missing-only") {
      parsed.missingOnly = true;
    } else if (arg.startsWith("--page-size=")) {
      const pageSize = parsePositiveInteger(arg.slice("--page-size=".length), "page size");
      parsed.setPageSize = pageSize;
      parsed.cardPageSize = pageSize;
    } else if (arg.startsWith("--set-page-size=")) {
      parsed.setPageSize = parsePositiveInteger(arg.slice("--set-page-size=".length), "set page size");
    } else if (arg.startsWith("--card-page-size=")) {
      parsed.cardPageSize = parsePositiveInteger(arg.slice("--card-page-size=".length), "card page size");
    } else if (arg.startsWith("--max-pages=")) {
      parsed.maxPages = parsePositiveInteger(arg.slice("--max-pages=".length), "max pages");
    } else if (arg.startsWith("--start-page=")) {
      const startPage = parsePositiveInteger(arg.slice("--start-page=".length), "start page");
      parsed.startSetPage = startPage;
      parsed.startCardPage = startPage;
    } else if (arg.startsWith("--start-set-page=")) {
      parsed.startSetPage = parsePositiveInteger(arg.slice("--start-set-page=".length), "start set page");
    } else if (arg.startsWith("--start-card-page=")) {
      parsed.startCardPage = parsePositiveInteger(arg.slice("--start-card-page=".length), "start card page");
    } else if (arg.startsWith("--max-retries=")) {
      parsed.maxRetries = parsePositiveInteger(arg.slice("--max-retries=".length), "max retries");
    } else if (arg.startsWith("--page-delay-ms=")) {
      parsed.pageDelayMs = parsePositiveInteger(arg.slice("--page-delay-ms=".length), "page delay");
    } else if (arg.startsWith("--set-id=")) {
      parsed.setId = arg.slice("--set-id=".length).trim() || null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.cardsOnly && parsed.setsOnly) {
    throw new Error("Use either --cards-only or --sets-only, not both.");
  }

  return parsed;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }

  return parsed;
}

async function importCatalog() {
  const startedAt = Date.now();
  const stats = {
    setCount: 0,
    cardCount: 0,
  };
  const runId = await createCatalogImportRun();

  console.log(
    `Starting catalog import${options.dryRun ? " (dry run)" : ""}${
      options.setId ? ` for set ${options.setId}` : ""
    }.`,
  );

  try {
    if (!options.cardsOnly) {
      stats.setCount = await importSets();
    }

    if (!options.setsOnly) {
      stats.cardCount = options.cardsBySet ? await importCardsBySet() : await importCards();
    }

    await finishCatalogImportRun(runId, "succeeded", stats, startedAt);

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `Catalog import complete in ${elapsedSeconds}s. ${stats.setCount.toLocaleString()} sets, ${stats.cardCount.toLocaleString()} cards processed.`,
    );
  } catch (error) {
    try {
      await finishCatalogImportRun(runId, "failed", stats, startedAt, error);
    } catch (updateError) {
      console.error("Failed to mark catalog import run as failed", updateError);
    }

    throw error;
  }
}

async function createCatalogImportRun() {
  const [row] = await sql`
    insert into catalog_import_runs (
      mode,
      status,
      options
    )
    values (
      ${getCatalogImportMode()},
      'running',
      ${sql.json(getCatalogImportOptions())}
    )
    returning id
  `;

  return row.id;
}

async function finishCatalogImportRun(runId, status, stats, startedAt, error = null) {
  await sql`
    update catalog_import_runs
    set
      status = ${status},
      sets_processed = ${stats.setCount},
      cards_processed = ${stats.cardCount},
      finished_at = now(),
      duration_ms = ${Date.now() - startedAt},
      error_message = ${error ? getErrorMessage(error) : null}
    where id = ${runId}
  `;
}

function getCatalogImportMode() {
  if (options.setsOnly) return "sets-only";
  if (options.cardsOnly && options.cardsBySet) return "cards-by-set-only";
  if (options.cardsOnly) return "cards-only";
  if (options.cardsBySet) return "full-cards-by-set";

  return "full";
}

function getCatalogImportOptions() {
  return {
    dryRun: options.dryRun,
    cardsOnly: options.cardsOnly,
    setsOnly: options.setsOnly,
    cardsBySet: options.cardsBySet,
    missingOnly: options.missingOnly,
    setId: options.setId,
    setPageSize: options.setPageSize,
    cardPageSize: options.cardPageSize,
    maxPages: options.maxPages,
    startSetPage: options.startSetPage,
    startCardPage: options.startCardPage,
    maxRetries: options.maxRetries,
    pageDelayMs: options.pageDelayMs,
  };
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

async function importSets() {
  let processed = 0;

  for await (const payload of fetchPaged("/sets", {
    orderBy: "-releaseDate,name",
    pageSize: options.setPageSize,
    startPage: options.startSetPage,
  })) {
    if (!options.dryRun) {
      await upsertSets(payload.data);
    }

    processed += payload.data.length;
    console.log(
      `Sets page ${payload.page}: processed ${processed.toLocaleString()} of ${payload.totalCount.toLocaleString()}.`,
    );
  }

  return processed;
}

async function importCards() {
  let processed = 0;
  const baseParams = {
    orderBy: "set.releaseDate,number,name,id",
    pageSize: options.cardPageSize,
    startPage: options.startCardPage,
  };

  if (options.setId) {
    baseParams.q = `set.id:${escapeLucene(options.setId)}`;
  }

  for await (const payload of fetchPaged("/cards", baseParams)) {
    if (!options.dryRun) {
      await upsertSetsFromCards(payload.data);
      await upsertCards(payload.data);
    }

    processed += payload.data.length;
    console.log(
      `Cards page ${payload.page}: processed ${processed.toLocaleString()} of ${payload.totalCount.toLocaleString()}.`,
    );
  }

  return processed;
}

async function importCardsBySet() {
  const providerSetIds = options.setId ? [options.setId] : await getLocalProviderSetIds();
  let processed = 0;

  console.log(`Importing cards for ${providerSetIds.length.toLocaleString()} sets.`);

  for (const providerSetId of providerSetIds) {
    const baseParams = {
      orderBy: "number,name,id",
      pageSize: options.cardPageSize,
      q: `set.id:${escapeLucene(providerSetId)}`,
      startPage: options.startCardPage,
    };
    let setProcessed = 0;

    for await (const payload of fetchPaged("/cards", baseParams)) {
      if (!options.dryRun) {
        await upsertSetsFromCards(payload.data);
        await upsertCards(payload.data);
      }

      setProcessed += payload.data.length;
      processed += payload.data.length;
      console.log(
        `Set ${providerSetId} cards page ${payload.page}: processed ${setProcessed.toLocaleString()} of ${payload.totalCount.toLocaleString()} for set, ${processed.toLocaleString()} total this run.`,
      );
    }
  }

  return processed;
}

async function getLocalProviderSetIds() {
  const rows = await sql`
    select
      card_sets.provider_id,
      card_sets.total,
      count(cards.id)::integer as local_card_count
    from card_sets
    left join cards
      on cards.set_id = card_sets.id
      and cards.language_code = card_sets.language_code
    where card_sets.language_code = 'en'
    group by card_sets.id
    order by card_sets.release_date nulls last, card_sets.provider_id
  `;

  if (rows.length === 0) {
    throw new Error("No local sets found. Run the set import before --cards-by-set.");
  }

  const filteredRows = rows.filter((row) => {
      if (!options.missingOnly) return true;

      return row.total === null || row.local_card_count < row.total;
    });

  if (options.missingOnly && filteredRows.length > 0) {
    console.log(
      `Incomplete sets: ${filteredRows
        .map((row) => `${row.provider_id} (${row.local_card_count}/${row.total ?? "unknown"})`)
        .join(", ")}`,
    );
  }

  return filteredRows.map((row) => row.provider_id);
}

async function* fetchPaged(path, inputParams) {
  let page = inputParams.startPage;
  let totalPages = 1;

  do {
    if (options.maxPages !== null && page > options.maxPages) return;

    const payload = await fetchPokemon(path, {
      ...inputParams,
      page,
      pageSize: inputParams.pageSize,
    });

    totalPages = Math.max(1, Math.ceil(payload.totalCount / payload.pageSize));
    yield payload;
    page += 1;

    if (page <= totalPages && options.pageDelayMs > 0) {
      await sleep(options.pageDelayMs);
    }
  } while (page <= totalPages);
}

async function fetchPokemon(path, params) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  const headers = { Accept: "application/json" };
  const apiKey = process.env.POKEMON_TCG_API_KEY?.trim();

  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
  }

  const url = `${API_BASE_URL}${path}?${searchParams}`;
  let lastError = null;

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
    try {
      const response = await fetch(url, { headers });

      if (response.ok) {
        return response.json();
      }

      lastError = new Error(`Pokemon TCG API returned ${response.status} for ${path}.`);

      if (!RETRYABLE_STATUSES.has(response.status) || attempt > options.maxRetries) {
        throw lastError;
      }
    } catch (error) {
      lastError = error;

      if (attempt > options.maxRetries) {
        throw error;
      }
    }

    const delayMs = getRetryDelayMs(attempt);
    console.warn(
      `Retrying ${path} page ${params.page} after ${delayMs}ms (${attempt}/${options.maxRetries}).`,
    );
    await sleep(delayMs);
  }

  throw lastError ?? new Error(`Pokemon TCG API request failed for ${path}.`);
}

async function upsertSetsFromCards(cards) {
  const setsByProviderId = new Map();

  for (const card of cards) {
    setsByProviderId.set(card.set.id, {
      id: card.set.id,
      name: card.set.name,
      series: card.set.series,
      printedTotal: card.set.printedTotal ?? null,
      total: card.set.total ?? null,
      releaseDate: card.set.releaseDate ?? null,
      images: card.set.images,
    });
  }

  await upsertSets(Array.from(setsByProviderId.values()));
}

async function upsertSets(sets) {
  if (sets.length === 0) return;

  const rows = sets.map((set) => ({
    provider_id: set.id,
    language_code: "en",
    name: set.name,
    series: set.series ?? null,
    printed_total: set.printedTotal ?? null,
    total: set.total ?? null,
    release_date: set.releaseDate ?? null,
    symbol_url: set.images?.symbol ?? null,
    logo_url: set.images?.logo ?? null,
    updated_at: new Date(),
  }));

  for (const batch of chunk(rows, WRITE_BATCH_SIZE)) {
    await sql`
      insert into card_sets ${sql(
        batch,
        "provider_id",
        "language_code",
        "name",
        "series",
        "printed_total",
        "total",
        "release_date",
        "symbol_url",
        "logo_url",
        "updated_at",
      )}
      on conflict (provider_id, language_code) do update set
        name = excluded.name,
        series = excluded.series,
        printed_total = excluded.printed_total,
        total = excluded.total,
        release_date = excluded.release_date,
        symbol_url = excluded.symbol_url,
        logo_url = excluded.logo_url,
        updated_at = excluded.updated_at
    `;
  }
}

async function upsertCards(cards) {
  if (cards.length === 0) return;

  const setProviderIds = Array.from(new Set(cards.map((card) => card.set.id)));
  const localSets = await sql`
    select id, provider_id
    from card_sets
    where language_code = 'en'
      and provider_id in ${sql(setProviderIds)}
  `;
  const localSetIdsByProviderId = new Map(localSets.map((set) => [set.provider_id, set.id]));
  const now = new Date();
  const rows = cards.map((card) => {
    const setId = localSetIdsByProviderId.get(card.set.id);

    if (!setId) {
      throw new Error(`Missing local set for provider set ${card.set.id}.`);
    }

    return {
      provider_id: card.id,
      set_id: setId,
      language_code: "en",
      name: card.name,
      number: card.number,
      supertype: card.supertype ?? null,
      subtypes: card.subtypes ?? null,
      rarity: card.rarity ?? null,
      artist: card.artist ?? null,
      image_small_url: card.images?.small ?? null,
      image_large_url: card.images?.large ?? null,
      provider_data: sql.json(card),
      updated_at: now,
    };
  });

  for (const batch of chunk(rows, WRITE_BATCH_SIZE)) {
    await sql`
      insert into cards ${sql(
        batch,
        "provider_id",
        "set_id",
        "language_code",
        "name",
        "number",
        "supertype",
        "subtypes",
        "rarity",
        "artist",
        "image_small_url",
        "image_large_url",
        "provider_data",
        "updated_at",
      )}
      on conflict (provider_id, language_code) do update set
        set_id = excluded.set_id,
        name = excluded.name,
        number = excluded.number,
        supertype = excluded.supertype,
        subtypes = excluded.subtypes,
        rarity = excluded.rarity,
        artist = excluded.artist,
        image_small_url = excluded.image_small_url,
        image_large_url = excluded.image_large_url,
        provider_data = excluded.provider_data,
        updated_at = excluded.updated_at
    `;
  }
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function escapeLucene(value) {
  return value.replace(/([+\-=&|><!(){}\[\]^"~*?:\\/])/g, "\\$1");
}

function getRetryDelayMs(attempt) {
  return Math.min(30_000, 1_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
