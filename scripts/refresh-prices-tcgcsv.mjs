import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;

const TCGCSV_BASE_URL = "https://tcgcsv.com";
const POKEMON_CATEGORY_ID = 3;
const SOURCE = "tcgcsv";
const CURRENCY = "USD";
const DEFAULT_PAGE_DELAY_MS = 100;
const DEFAULT_MAX_RETRIES = 4;
const WRITE_BATCH_SIZE = 500;
const SUPPLEMENTAL_GROUP_TERMS = [
  "academy",
  "blister",
  "burger king",
  "deck",
  "energies",
  "first partner",
  "jumbo",
  "league",
  "mcdonald",
  "placement",
  "prize pack",
  "professor",
  "promo",
  "promos",
  "shadowless",
  "trick or trade",
  "trainer kit",
  "world championship",
];

loadEnvConfig(process.cwd());

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to refresh prices.");
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

try {
  await refreshPrices();
} finally {
  await sql.end();
}

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    groupId: null,
    maxGroups: null,
    pageDelayMs: DEFAULT_PAGE_DELAY_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    resetSource: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg.startsWith("--group-id=")) {
      parsed.groupId = parsePositiveInteger(arg.slice("--group-id=".length), "group id");
    } else if (arg.startsWith("--max-groups=")) {
      parsed.maxGroups = parsePositiveInteger(arg.slice("--max-groups=".length), "max groups");
    } else if (arg.startsWith("--page-delay-ms=")) {
      parsed.pageDelayMs = parsePositiveInteger(arg.slice("--page-delay-ms=".length), "page delay");
    } else if (arg.startsWith("--max-retries=")) {
      parsed.maxRetries = parsePositiveInteger(arg.slice("--max-retries=".length), "max retries");
    } else if (arg === "--reset-source") {
      parsed.resetSource = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
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

async function refreshPrices() {
  const startedAt = Date.now();
  const observedAt = await getObservedAt();
  const groups = await getGroupsToRefresh();
  const localSets = await getLocalSets();
  const setMatchers = buildLocalSetMatchers(localSets);
  const stats = {
    groupsChecked: 0,
    groupsMatched: 0,
    productsChecked: 0,
    productsMatched: 0,
    priceRowsPrepared: 0,
    currentPricesUpserted: 0,
    pricePointsInserted: 0,
  };

  console.log(
    `Starting TCGCSV price refresh${options.dryRun ? " (dry run)" : ""} for ${groups.length.toLocaleString()} group${groups.length === 1 ? "" : "s"} observed at ${observedAt.toISOString()}.`,
  );

  if (options.resetSource) {
    if (options.dryRun) {
      console.log(`Dry run: would remove existing ${SOURCE} rows from current_prices and price_points.`);
    } else {
      await resetSourceRows();
    }
  }

  for (const group of groups) {
    stats.groupsChecked += 1;
    const localSet = findLocalSetForGroup(group, setMatchers);

    if (!localSet) {
      console.log(`Skipping ${group.name} (${group.groupId}): no local set match.`);
      continue;
    }

    stats.groupsMatched += 1;

    const [productsPayload, pricesPayload] = await Promise.all([
      fetchTcgcsvJson(`/tcgplayer/${POKEMON_CATEGORY_ID}/${group.groupId}/products`),
      fetchTcgcsvJson(`/tcgplayer/${POKEMON_CATEGORY_ID}/${group.groupId}/prices`),
    ]);
    const cardProducts = productsPayload.results.filter(isCardProduct);
    const pricesByProductId = groupPricesByProductId(pricesPayload.results);
    const localCards = await getLocalCardsForSet(localSet.id);
    const localCardsByNumber = new Map(localCards.map((card) => [normalizeCardNumber(card.number), card]));
    const amountsByCardPrinting = new Map();
    const priceRecords = [];

    stats.productsChecked += cardProducts.length;

    for (const product of cardProducts) {
      const cardNumber = getExtendedDataValue(product, "Number");
      const localCard = cardNumber ? localCardsByNumber.get(normalizeCardNumber(cardNumber)) : null;
      const productPrices = pricesByProductId.get(product.productId) ?? [];

      if (!localCard || productPrices.length === 0) continue;

      stats.productsMatched += 1;

      for (const price of productPrices) {
        const printing = normalizePrinting(price.subTypeName);
        const amountRecords = getAmountRecords(price);

        if (amountRecords.length === 0) continue;

        amountsByCardPrinting.set(getCardPrintingKey(localCard.id, printing), {
          cardId: localCard.id,
          printing,
          amountRecords,
        });
      }
    }

    const variantIdsByCardPrinting = await getVariantIdsByCardPrinting(
      Array.from(amountsByCardPrinting.values()),
      options.dryRun,
    );

    for (const priceInput of amountsByCardPrinting.values()) {
      const variantIds =
        variantIdsByCardPrinting.get(getCardPrintingKey(priceInput.cardId, priceInput.printing)) ?? [];

      for (const cardVariantId of variantIds) {
        for (const amountRecord of priceInput.amountRecords) {
          priceRecords.push({
            card_variant_id: cardVariantId,
            source: SOURCE,
            price_type: amountRecord.priceType,
            currency: CURRENCY,
            amount_minor: amountRecord.amountMinor,
            observed_at: observedAt,
          });
        }
      }
    }

    stats.priceRowsPrepared += priceRecords.length;

    if (!options.dryRun && priceRecords.length > 0) {
      const writeStats = await writePrices(priceRecords);
      stats.currentPricesUpserted += writeStats.currentPricesUpserted;
      stats.pricePointsInserted += writeStats.pricePointsInserted;
    }

    console.log(
      `${group.name} (${group.groupId}) -> ${localSet.name}: ${cardProducts.length.toLocaleString()} card products, ${priceRecords.length.toLocaleString()} price observations prepared.`,
    );

    if (options.pageDelayMs > 0) {
      await sleep(options.pageDelayMs);
    }
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `TCGCSV price refresh complete in ${elapsedSeconds}s. ${stats.groupsMatched}/${stats.groupsChecked} groups matched, ${stats.productsMatched}/${stats.productsChecked} products matched, ${stats.priceRowsPrepared.toLocaleString()} observations prepared, ${stats.currentPricesUpserted.toLocaleString()} current prices upserted, ${stats.pricePointsInserted.toLocaleString()} price points inserted.`,
  );
}

async function resetSourceRows() {
  const deletedCurrentPrices = await sql`
    delete from current_prices
    where source = ${SOURCE}
    returning id
  `;
  const deletedPricePoints = await sql`
    delete from price_points
    where source = ${SOURCE}
    returning id
  `;

  console.log(
    `Removed ${deletedCurrentPrices.length.toLocaleString()} current price rows and ${deletedPricePoints.length.toLocaleString()} price point rows for source ${SOURCE}.`,
  );
}

async function getObservedAt() {
  const responseText = await fetchTcgcsvText("/last-updated.txt");
  const normalizedText = responseText.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const observedAt = new Date(normalizedText);

  if (Number.isNaN(observedAt.getTime())) {
    throw new Error(`Unable to parse TCGCSV last-updated timestamp: ${responseText}`);
  }

  return observedAt;
}

async function getGroupsToRefresh() {
  const groupsPayload = await fetchTcgcsvJson(`/tcgplayer/${POKEMON_CATEGORY_ID}/groups`);
  let groups = groupsPayload.results;

  if (options.groupId !== null) {
    groups = groups.filter((group) => group.groupId === options.groupId);
  }

  groups = groups
    .filter((group) => group.categoryId === POKEMON_CATEGORY_ID)
    .sort((left, right) => Date.parse(right.publishedOn ?? "") - Date.parse(left.publishedOn ?? ""));

  if (options.maxGroups !== null) {
    groups = groups.slice(0, options.maxGroups);
  }

  if (groups.length === 0) {
    throw new Error("No TCGCSV groups matched the selected options.");
  }

  return groups;
}

async function getLocalSets() {
  return sql`
    select id, provider_id, name, release_date
    from card_sets
    where language_code = 'en'
  `;
}

async function getLocalCardsForSet(setId) {
  return sql`
    select id, provider_id, name, number
    from cards
    where set_id = ${setId}
      and language_code = 'en'
  `;
}

async function getVariantIdsByCardPrinting(priceInputs, dryRun) {
  const variantIdsByCardPrinting = new Map();

  if (priceInputs.length === 0) return variantIdsByCardPrinting;

  const cardIds = Array.from(new Set(priceInputs.map((input) => input.cardId)));
  const printings = Array.from(new Set(priceInputs.map((input) => input.printing)));
  const existingRows = await sql`
    select id, card_id, printing
    from card_variants
    where card_id in ${sql(cardIds)}
      and printing in ${sql(printings)}
      and language_code = 'en'
  `;

  for (const row of existingRows) {
    const key = getCardPrintingKey(row.card_id, row.printing);
    const variantIds = variantIdsByCardPrinting.get(key) ?? new Set();
    variantIds.add(row.id);
    variantIdsByCardPrinting.set(key, variantIds);
  }

  if (dryRun) {
    for (const input of priceInputs) {
      const key = getCardPrintingKey(input.cardId, input.printing);
      const variantIds = variantIdsByCardPrinting.get(key) ?? new Set();
      variantIds.add(`dry-run:${input.cardId}:${input.printing}:unspecified`);
      variantIdsByCardPrinting.set(key, variantIds);
    }

    return mapSetsToArrays(variantIdsByCardPrinting);
  }

  const unspecifiedRows = priceInputs.map((input) => ({
    card_id: input.cardId,
    printing: input.printing,
    condition: "unspecified",
    language_code: "en",
    updated_at: new Date(),
  }));

  for (const batch of chunk(unspecifiedRows, WRITE_BATCH_SIZE)) {
    const rows = await sql`
      insert into card_variants ${sql(
        batch,
        "card_id",
        "printing",
        "condition",
        "language_code",
        "updated_at",
      )}
      on conflict (card_id, printing, condition, language_code) do update set
        updated_at = excluded.updated_at
      returning id, card_id, printing
    `;

    for (const row of rows) {
      const key = getCardPrintingKey(row.card_id, row.printing);
      const variantIds = variantIdsByCardPrinting.get(key) ?? new Set();
      variantIds.add(row.id);
      variantIdsByCardPrinting.set(key, variantIds);
    }
  }

  return mapSetsToArrays(variantIdsByCardPrinting);
}

async function writePrices(priceRecords) {
  let currentPricesUpserted = 0;
  let pricePointsInserted = 0;

  for (const batch of chunk(dedupePriceRecords(priceRecords), WRITE_BATCH_SIZE)) {
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
    const pointRows = await sql`
      insert into price_points ${sql(
        batch,
        "card_variant_id",
        "source",
        "price_type",
        "currency",
        "amount_minor",
        "observed_at",
      )}
      on conflict (card_variant_id, source, price_type, currency, observed_at) do nothing
      returning id
    `;

    currentPricesUpserted += currentRows.length;
    pricePointsInserted += pointRows.length;
  }

  return { currentPricesUpserted, pricePointsInserted };
}

function buildLocalSetMatchers(localSets) {
  return localSets.map((set) => ({
    set,
    normalizedName: normalizeSetName(set.name),
    releaseDate: set.release_date ? new Date(set.release_date).toISOString().slice(0, 10) : null,
  }));
}

function findLocalSetForGroup(group, setMatchers) {
  const normalizedGroupName = normalizeSetName(group.name);
  const groupCoreName = normalizeSetName(getGroupCoreName(group.name));
  const groupReleaseDate = group.publishedOn ? new Date(group.publishedOn).toISOString().slice(0, 10) : null;
  const exactMatch = setMatchers.find(
    (candidate) =>
      candidate.normalizedName === normalizedGroupName ||
      candidate.normalizedName === groupCoreName,
  )?.set;

  if (exactMatch) return exactMatch;
  if (isSupplementalGroupName(group.name)) return null;

  return (
    setMatchers.find(
      (candidate) =>
        groupReleaseDate &&
        candidate.releaseDate === groupReleaseDate &&
        candidate.normalizedName.length > 0 &&
        groupCoreName.length > 0 &&
        (candidate.normalizedName.includes(groupCoreName) ||
          groupCoreName.includes(candidate.normalizedName)),
    )?.set ?? null
  );
}

function getGroupCoreName(value) {
  return value.includes(":") ? value.split(":").slice(1).join(":") : value;
}

function normalizeSetName(value) {
  return value
    .toLowerCase()
    .replace(/\bpokemon\b/g, "")
    .replace(/\bsv\d+\b|\bme\d+\b|\bswsh\d+\b|\bsm\d+\b|\bxy\d+\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isSupplementalGroupName(value) {
  const normalizedValue = normalizeSetName(value);

  return SUPPLEMENTAL_GROUP_TERMS.some((term) => normalizedValue.includes(term));
}

function isCardProduct(product) {
  return Boolean(getExtendedDataValue(product, "Number"));
}

function getExtendedDataValue(product, key) {
  return product.extendedData?.find((entry) => entry.name === key)?.value ?? null;
}

function groupPricesByProductId(prices) {
  const pricesByProductId = new Map();

  for (const price of prices) {
    const productPrices = pricesByProductId.get(price.productId) ?? [];
    productPrices.push(price);
    pricesByProductId.set(price.productId, productPrices);
  }

  return pricesByProductId;
}

function getAmountRecords(price) {
  return [
    ["low", price.lowPrice],
    ["mid", price.midPrice],
    ["high", price.highPrice],
    ["market", price.marketPrice],
    ["direct_low", price.directLowPrice],
  ].flatMap(([priceType, amount]) => {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return [];

    return [{ priceType, amountMinor: Math.round(amount * 100) }];
  });
}

function normalizePrinting(value) {
  return String(value ?? "normal")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function normalizeCardNumber(value) {
  return String(value ?? "")
    .split("/")[0]
    .replace(/^0+(?=\d)/, "")
    .toLowerCase()
    .trim();
}

function getCardPrintingKey(cardId, printing) {
  return `${cardId}:${printing}`;
}

function mapSetsToArrays(input) {
  return new Map(Array.from(input, ([key, value]) => [key, Array.from(value)]));
}

function dedupePriceRecords(priceRecords) {
  const rowsByKey = new Map();

  for (const row of priceRecords) {
    rowsByKey.set(
      `${row.card_variant_id}:${row.source}:${row.price_type}:${row.currency}:${row.observed_at.toISOString()}`,
      row,
    );
  }

  return Array.from(rowsByKey.values());
}

async function fetchTcgcsvJson(path) {
  const responseText = await fetchTcgcsvText(path);
  return JSON.parse(responseText);
}

async function fetchTcgcsvText(path) {
  const url = `${TCGCSV_BASE_URL}${path}`;
  let lastError = null;

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json,text/plain",
          "User-Agent": "Cardkeeper/0.1.0",
        },
      });

      if (response.ok) return response.text();

      lastError = new Error(`TCGCSV returned ${response.status} for ${path}.`);
    } catch (error) {
      lastError = error;
    }

    if (attempt > options.maxRetries) break;

    const delayMs = Math.min(15_000, 500 * 2 ** (attempt - 1));
    console.warn(`Retrying ${path} after ${delayMs}ms (${attempt}/${options.maxRetries}).`);
    await sleep(delayMs);
  }

  throw lastError ?? new Error(`TCGCSV request failed for ${path}.`);
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
