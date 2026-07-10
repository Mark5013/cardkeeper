import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const DEFAULT_BASE_URL = "https://api.poketrace.com/v1";
const DEFAULT_DELAY_MS = 400;
const DEFAULT_LIMIT = 100;
const DEFAULT_BATCH_SIZE = 5;
const WRITE_BATCH_SIZE = 500;
const CURRENCY = "USD";
const USER_AGENT = "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";

const CONDITION_BY_TIER = new Map([
  ["NEAR_MINT", "near_mint"],
  ["LIGHTLY_PLAYED", "lightly_played"],
  ["MODERATELY_PLAYED", "moderately_played"],
  ["HEAVILY_PLAYED", "heavily_played"],
  ["DAMAGED", "damaged"],
]);

const SOURCE_BY_PRICE_SOURCE = new Map([
  ["tcgplayer", "poketrace_tcgplayer"],
]);

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to refresh PokeTrace prices.");
}

const apiKey = process.env.POKETRACE_API_KEY?.trim();
if (!apiKey) {
  throw new Error("POKETRACE_API_KEY is required to refresh PokeTrace prices.");
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});
let lastRequestAt = 0;

try {
  await refreshPokeTracePrices();
} finally {
  await sql.end();
}

async function refreshPokeTracePrices() {
  const startedAt = Date.now();
  const observedAt = options.observedAt ?? new Date();
  const refs = await getTcgplayerRefs(options.limit, options.onlyMissing);
  const refsByProductId = groupRefsByProductId(refs);
  const stats = {
    refsLoaded: refs.length,
    productIdsLoaded: refsByProductId.size,
    requestsMade: 0,
    cardsReturned: 0,
    productsMatched: 0,
    variantsEnsured: 0,
    priceRowsPrepared: 0,
    currentPricesUpserted: 0,
    pricePointsInserted: 0,
  };

  console.log(
    `Starting PokeTrace price refresh${options.dryRun ? " (dry run)" : ""} for ${stats.productIdsLoaded.toLocaleString()} TCGPlayer product id${stats.productIdsLoaded === 1 ? "" : "s"} observed at ${observedAt.toISOString()}.`,
  );

  for (const productIdBatch of chunk(Array.from(refsByProductId.keys()), options.batchSize)) {
    const payload = await fetchPokeTraceCards({
      tcgplayer_ids: productIdBatch.join(","),
      market: "US",
      product_type: "single",
      limit: Math.max(options.batchSize, Math.min(options.batchSize * 5, 100)),
    });
    stats.requestsMade += 1;

    const poketraceCards = selectBestCardsByTcgplayerProductId(normalizeCardsResponse(payload));
    stats.cardsReturned += poketraceCards.length;

    const variantInputs = [];
    const priceInputs = [];

    for (const poketraceCard of poketraceCards) {
      const productId = String(poketraceCard.refs?.tcgplayerId ?? poketraceCard.tcgplayerId ?? "");
      const localRefs = refsByProductId.get(productId) ?? [];

      if (localRefs.length === 0) continue;

      stats.productsMatched += 1;

      for (const localRef of localRefs) {
        const priceRecords = getPriceRecordsForCard(poketraceCard, localRef, observedAt);
        priceInputs.push(...priceRecords);

        for (const condition of uniqueStrings(priceRecords.map((record) => record.condition))) {
          variantInputs.push({
            cardId: localRef.card_id,
            printing: localRef.printing,
            condition,
            languageCode: localRef.language_code,
          });
        }
      }
    }

    const variantIdsByKey = await ensureConditionVariants(variantInputs, options.dryRun);
    const priceRows = [];

    for (const priceInput of priceInputs) {
      const variantId = variantIdsByKey.get(getVariantKey(priceInput));
      if (!variantId) continue;

      priceRows.push({
        card_variant_id: variantId,
        source: priceInput.source,
        price_type: priceInput.priceType,
        currency: CURRENCY,
        amount_minor: priceInput.amountMinor,
        observed_at: observedAt,
      });
    }

    stats.variantsEnsured += variantIdsByKey.size;
    stats.priceRowsPrepared += priceRows.length;

    if (!options.dryRun) {
      const priceWriteStats = await writePrices(priceRows);
      stats.currentPricesUpserted += priceWriteStats.currentPricesUpserted;
      stats.pricePointsInserted += priceWriteStats.pricePointsInserted;
    }
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `PokeTrace price refresh complete in ${elapsedSeconds}s. ${stats.requestsMade.toLocaleString()} requests, ${stats.cardsReturned.toLocaleString()} cards returned, ${stats.productsMatched.toLocaleString()} products matched, ${stats.variantsEnsured.toLocaleString()} condition variants ensured, ${stats.priceRowsPrepared.toLocaleString()} prices prepared, ${stats.currentPricesUpserted.toLocaleString()} current prices upserted, ${stats.pricePointsInserted.toLocaleString()} price points inserted.`,
  );
}

async function getTcgplayerRefs(limit, onlyMissing) {
  const limitSql = limit === null ? sql`` : sql`limit ${limit}`;
  const onlyMissingSql = onlyMissing
    ? sql`
      and not exists (
        select 1
        from card_variants condition_variants
        inner join current_prices on current_prices.card_variant_id = condition_variants.id
        where condition_variants.card_id = card_variants.card_id
          and condition_variants.printing = card_variants.printing
          and condition_variants.language_code = card_variants.language_code
          and condition_variants.condition <> 'unspecified'
          and current_prices.source = 'poketrace_tcgplayer'
          and current_prices.price_type = 'market'
          and current_prices.currency = 'USD'
      )
    `
    : sql``;

  return sql`
    select distinct on (card_variant_external_refs.ref_value, card_variants.card_id, card_variants.printing)
      card_variant_external_refs.ref_value,
      card_variants.card_id,
      card_variants.printing,
      card_variants.language_code
    from card_variant_external_refs
    inner join card_variants on card_variant_external_refs.card_variant_id = card_variants.id
    inner join cards on card_variants.card_id = cards.id
    where card_variant_external_refs.source = 'tcgplayer'
      and card_variant_external_refs.ref_type = 'product_id'
      and card_variants.language_code = 'en'
      and cards.language_code = 'en'
      and cards.is_active = true
      ${onlyMissingSql}
    order by card_variant_external_refs.ref_value, card_variants.card_id, card_variants.printing
    ${limitSql}
  `;
}

function groupRefsByProductId(refs) {
  const refsByProductId = new Map();

  for (const ref of refs) {
    const productId = String(ref.ref_value);
    const refsForProduct = refsByProductId.get(productId) ?? [];
    refsForProduct.push(ref);
    refsByProductId.set(productId, refsForProduct);
  }

  return refsByProductId;
}

function getPriceRecordsForCard(poketraceCard, localRef, observedAt) {
  const rows = [];

  for (const [priceSource, source] of SOURCE_BY_PRICE_SOURCE) {
    const tiers = poketraceCard.prices?.[priceSource];
    if (!tiers || typeof tiers !== "object") continue;

    for (const [tier, price] of Object.entries(tiers)) {
      const condition = CONDITION_BY_TIER.get(tier);
      if (!condition || !price || typeof price !== "object") continue;

      for (const amountRecord of getAmountRecords(price)) {
        rows.push({
          cardId: localRef.card_id,
          printing: localRef.printing,
          condition,
          languageCode: localRef.language_code,
          source,
          priceType: amountRecord.priceType,
          amountMinor: amountRecord.amountMinor,
          observedAt,
        });
      }
    }
  }

  return rows;
}

function getAmountRecords(price) {
  const amount = price.avg;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return [];

  return [{ priceType: "market", amountMinor: Math.round(amount * 100) }];
}

async function ensureConditionVariants(variantInputs, dryRun) {
  const variantsByKey = new Map();
  const uniqueInputs = dedupeVariantInputs(variantInputs);

  if (uniqueInputs.length === 0) return variantsByKey;

  if (dryRun) {
    for (const input of uniqueInputs) {
      variantsByKey.set(getVariantKey(input), `dry-run:${getVariantKey(input)}`);
    }
    return variantsByKey;
  }

  for (const batch of chunk(uniqueInputs, WRITE_BATCH_SIZE)) {
    const rows = await sql`
      insert into card_variants ${sql(
        batch.map((input) => ({
          card_id: input.cardId,
          printing: input.printing,
          condition: input.condition,
          language_code: input.languageCode,
          updated_at: new Date(),
        })),
        "card_id",
        "printing",
        "condition",
        "language_code",
        "updated_at",
      )}
      on conflict (card_id, printing, condition, language_code) do update set
        updated_at = excluded.updated_at
      returning id, card_id, printing, condition, language_code
    `;

    for (const row of rows) {
      variantsByKey.set(
        getVariantKey({
          cardId: row.card_id,
          printing: row.printing,
          condition: row.condition,
          languageCode: row.language_code,
        }),
        row.id,
      );
    }
  }

  return variantsByKey;
}

async function writePrices(priceRows) {
  let currentPricesUpserted = 0;
  let pricePointsInserted = 0;

  for (const batch of chunk(dedupePriceRows(priceRows), WRITE_BATCH_SIZE)) {
    const currentRows = await sql`
      insert into current_prices ${sql(
        batch,
        "card_variant_id",
        "source",
        "price_type",
        "currency",
        "amount_minor",
        "observed_at",
      )}
      on conflict (card_variant_id, source, price_type, currency) do update set
        amount_minor = excluded.amount_minor,
        observed_at = excluded.observed_at,
        updated_at = now()
      returning id
    `;
    const changedPointRows = await filterChangedPricePointRows(batch);
    const pointRows = changedPointRows.length
      ? await sql`
      insert into price_points ${sql(
        changedPointRows,
        "card_variant_id",
        "source",
        "price_type",
        "currency",
        "amount_minor",
        "observed_at",
      )}
      on conflict (card_variant_id, source, price_type, currency, observed_at) do nothing
      returning id
    `
      : [];

    currentPricesUpserted += currentRows.length;
    pricePointsInserted += pointRows.length;
  }

  return { currentPricesUpserted, pricePointsInserted };
}

async function filterChangedPricePointRows(rows) {
  const uniqueVariantIds = uniqueStrings(rows.map((row) => row.card_variant_id));
  const uniqueSources = uniqueStrings(rows.map((row) => row.source));
  const uniquePriceTypes = uniqueStrings(rows.map((row) => row.price_type));
  const uniqueCurrencies = uniqueStrings(rows.map((row) => row.currency));
  const latestAmountsByKey = new Map();

  if (
    uniqueVariantIds.length === 0 ||
    uniqueSources.length === 0 ||
    uniquePriceTypes.length === 0 ||
    uniqueCurrencies.length === 0
  ) {
    return [];
  }

  const latestRows = await sql`
    select distinct on (card_variant_id, source, price_type, currency)
      card_variant_id,
      source,
      price_type,
      currency,
      amount_minor
    from price_points
    where card_variant_id in ${sql(uniqueVariantIds)}
      and source in ${sql(uniqueSources)}
      and price_type in ${sql(uniquePriceTypes)}
      and currency in ${sql(uniqueCurrencies)}
    order by card_variant_id, source, price_type, currency, observed_at desc
  `;

  for (const row of latestRows) {
    latestAmountsByKey.set(getPriceIdentityKey(row), Number(row.amount_minor));
  }

  return rows.filter((row) => latestAmountsByKey.get(getPriceIdentityKey(row)) !== row.amount_minor);
}

async function fetchPokeTraceCards(params) {
  await throttlePokeTraceRequest();
  const url = new URL(`${getBaseUrl()}/cards`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PokeTrace request failed with ${response.status}: ${body.slice(0, 500)}`);
  }

  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  if (remaining !== null && (Number(remaining) < 200 || options.verbose)) {
    console.log(`PokeTrace rate limit remaining: ${remaining}${reset ? ` reset=${reset}` : ""}`);
  }

  return response.json();
}

async function throttlePokeTraceRequest() {
  if (options.delayMs <= 0) return;

  const elapsedMs = Date.now() - lastRequestAt;
  if (elapsedMs < options.delayMs) {
    await sleep(options.delayMs - elapsedMs);
  }
  lastRequestAt = Date.now();
}

function normalizeCardsResponse(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === "object") return [payload.data];
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload)) return payload;
  return [];
}

function selectBestCardsByTcgplayerProductId(cards) {
  const cardsByProductId = new Map();

  for (const card of cards) {
    const productId = String(card.refs?.tcgplayerId ?? card.tcgplayerId ?? "");
    if (!productId) continue;

    const existingCard = cardsByProductId.get(productId);
    if (!existingCard || comparePokeTraceCards(card, existingCard) > 0) {
      cardsByProductId.set(productId, card);
    }
  }

  return Array.from(cardsByProductId.values());
}

function comparePokeTraceCards(left, right) {
  const leftTcgplayerPriceCount = getPriceCountForSource(left, "tcgplayer");
  const rightTcgplayerPriceCount = getPriceCountForSource(right, "tcgplayer");

  if (leftTcgplayerPriceCount !== rightTcgplayerPriceCount) {
    return leftTcgplayerPriceCount - rightTcgplayerPriceCount;
  }

  const leftUpdatedAt = Date.parse(left.lastUpdated ?? "");
  const rightUpdatedAt = Date.parse(right.lastUpdated ?? "");
  const leftTimestamp = Number.isNaN(leftUpdatedAt) ? 0 : leftUpdatedAt;
  const rightTimestamp = Number.isNaN(rightUpdatedAt) ? 0 : rightUpdatedAt;

  if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;

  return getTotalSaleCount(left) - getTotalSaleCount(right);
}

function getPriceCountForSource(card, source) {
  const sourcePrices = card.prices?.[source];
  if (!sourcePrices || typeof sourcePrices !== "object") return 0;

  let count = 0;
  for (const tierPrice of Object.values(sourcePrices)) {
    if (tierPrice && typeof tierPrice === "object") count += 1;
  }

  return count;
}

function getTotalSaleCount(card) {
  if (typeof card.totalSaleCount === "number") return card.totalSaleCount;

  let total = 0;
  for (const sourcePrices of Object.values(card.prices ?? {})) {
    if (!sourcePrices || typeof sourcePrices !== "object") continue;

    for (const tierPrice of Object.values(sourcePrices)) {
      if (typeof tierPrice?.saleCount === "number") total += tierPrice.saleCount;
    }
  }

  return total;
}

function dedupeVariantInputs(inputs) {
  const inputsByKey = new Map();
  for (const input of inputs) {
    inputsByKey.set(getVariantKey(input), input);
  }
  return Array.from(inputsByKey.values());
}

function dedupePriceRows(rows) {
  const rowsByKey = new Map();
  for (const row of rows) {
    rowsByKey.set(`${getPriceIdentityKey(row)}:${row.observed_at.toISOString()}`, row);
  }
  return Array.from(rowsByKey.values());
}

function getPriceIdentityKey(row) {
  return `${row.card_variant_id}:${row.source}:${row.price_type}:${row.currency}`;
}

function getVariantKey(input) {
  return `${input.cardId}:${input.printing}:${input.condition}:${input.languageCode}`;
}

function parseArgs(args) {
  const parsed = {
    batchSize: DEFAULT_BATCH_SIZE,
    delayMs: delayMsFromEnv(),
    dryRun: false,
    limit: DEFAULT_LIMIT,
    onlyMissing: false,
    observedAt: null,
    verbose: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--all") {
      parsed.limit = null;
    } else if (arg === "--only-missing") {
      parsed.onlyMissing = true;
    } else if (arg === "--verbose") {
      parsed.verbose = true;
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = parsePositiveInteger(arg.slice("--limit=".length), "limit");
    } else if (arg.startsWith("--batch-size=")) {
      parsed.batchSize = Math.min(parsePositiveInteger(arg.slice("--batch-size=".length), "batch size"), 20);
    } else if (arg.startsWith("--delay-ms=")) {
      parsed.delayMs = parseNonnegativeInteger(arg.slice("--delay-ms=".length), "delay");
    } else if (arg.startsWith("--observed-at=")) {
      const observedAt = new Date(arg.slice("--observed-at=".length));
      if (Number.isNaN(observedAt.getTime())) throw new Error("observed-at must be a valid date.");
      parsed.observedAt = observedAt;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function delayMsFromEnv() {
  const value = Number(process.env.POKETRACE_REQUEST_DELAY_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DELAY_MS;
}

function getBaseUrl() {
  return (process.env.POKETRACE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonnegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return parsed;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
