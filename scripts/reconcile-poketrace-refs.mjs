import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const DEFAULT_BASE_URL = "https://api.poketrace.com/v1";
const DEFAULT_DELAY_MS = 400;
const DEFAULT_LIMIT = 100;
const DEFAULT_MIN_SCORE = 80;
const WRITE_BATCH_SIZE = 500;
const USER_AGENT = "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";

const POKETRACE_SET_ALIAS_ENTRIES = [
  ["Black Bolt", ["SV: Black Bolt"]],
  ["BW Black Star Promos", ["Black and White Promos", "BW Promos"]],
  ["DP Black Star Promos", ["Diamond and Pearl Promos"]],
  ["McDonald's Collection 2021", ["McDonald's 25th Anniversary Promos"]],
  ["Nintendo Black Star Promos", ["Nintendo Promos"]],
  ["Pokemon Futsal Collection", ["Miscellaneous Cards & Products"]],
  ["Pokemon Rumble", ["Rumble"]],
  ["Scarlet & Violet Black Star Promos", ["SV: Scarlet & Violet Promo Cards", "Scarlet & Violet Promo Cards"]],
  ["Team Up", ["League & Championship Cards", "Alternate Art Promos"]],
  ["Wizards Black Star Promos", ["WoTC Promo"]],
];
const POKETRACE_SET_ALIASES_BY_LOCAL_SET = new Map(
  POKETRACE_SET_ALIAS_ENTRIES.map(([setName, aliases]) => [normalizeText(setName), aliases]),
);

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to reconcile PokeTrace refs.");
}

const apiKey = process.env.POKETRACE_API_KEY?.trim();
if (!apiKey) {
  throw new Error("POKETRACE_API_KEY is required to reconcile PokeTrace refs.");
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});
let lastRequestAt = 0;
let requestsMade = 0;
const setSlugCache = new Map();

try {
  await reconcileRefs();
} finally {
  await sql.end();
}

async function reconcileRefs() {
  const missingCards = await getCardsMissingTcgplayerRefs(options.limit);
  const stats = {
    cardsChecked: missingCards.length,
    confidentMatches: 0,
    reviewMatches: 0,
    noMatches: 0,
    refsPrepared: 0,
    refsUpserted: 0,
  };
  const refInputs = [];
  const reviewRows = [];

  console.log(
    `Starting PokeTrace ref reconciliation${options.dryRun ? " (dry run)" : ""} for ${missingCards.length.toLocaleString()} card${missingCards.length === 1 ? "" : "s"} with min score ${options.minScore}.`,
  );

  for (const card of missingCards) {
    const match = await findBestMatch(card);

    if (!match || match.score <= 0) {
      stats.noMatches += 1;
      reviewRows.push({ card, match: null });
      continue;
    }

    const tcgplayerProductId = String(match.card.refs?.tcgplayerId ?? match.card.tcgplayerId ?? "");
    if (match.score >= options.minScore && tcgplayerProductId) {
      stats.confidentMatches += 1;
      refInputs.push({
        cardId: card.id,
        printing: "normal",
        source: "tcgplayer",
        refType: "product_id",
        refValue: tcgplayerProductId,
        metadata: {
          provider: "poketrace_reconciliation",
          poketraceCardId: match.card.id,
          poketraceName: match.card.name,
          poketraceCardNumber: match.card.cardNumber,
          poketraceSetName: match.card.set?.name,
          poketraceSetSlug: match.card.set?.slug,
          poketraceScore: match.score,
          poketraceAttempt: match.attempt,
        },
      });
    } else {
      stats.reviewMatches += 1;
      reviewRows.push({ card, match });
    }

    if (options.verbose) {
      printMatch(card, match);
    }
  }

  stats.refsPrepared = refInputs.length;
  const variantIdsByCardPrinting = await getVariantIdsByCardPrinting(refInputs, options.dryRun);
  const refRows = refInputs.flatMap((input) => {
    const variantIds = variantIdsByCardPrinting.get(getCardPrintingKey(input.cardId, input.printing)) ?? [];
    return variantIds.map((variantId) => ({
      card_variant_id: variantId,
      source: input.source,
      ref_type: input.refType,
      ref_value: input.refValue,
      metadata: sql.json(input.metadata),
    }));
  });

  if (!options.dryRun) {
    stats.refsUpserted = await writeExternalRefs(refRows);
  }

  console.log(
    `PokeTrace ref reconciliation complete. ${requestsMade} requests, ${stats.confidentMatches} confident matches, ${stats.reviewMatches} review matches, ${stats.noMatches} no matches, ${stats.refsPrepared} refs prepared, ${stats.refsUpserted} refs upserted.`,
  );

  printReviewRows("Needs review", reviewRows);
}

async function getCardsMissingTcgplayerRefs(limit) {
  const limitClause = limit === null ? sql`` : sql`limit ${limit}`;

  return sql`
    with priced_cards as (
      select distinct card_variants.card_id
      from current_prices
      inner join card_variants on current_prices.card_variant_id = card_variants.id
      where current_prices.source = 'poketrace_tcgplayer'
        and current_prices.price_type = 'market'
        and current_prices.currency = 'USD'
        and card_variants.language_code = 'en'
    ), ref_counts as (
      select card_variants.card_id, count(distinct card_variant_external_refs.ref_value)::integer as ref_count
      from card_variant_external_refs
      inner join card_variants on card_variant_external_refs.card_variant_id = card_variants.id
      where card_variant_external_refs.source = 'tcgplayer'
        and card_variant_external_refs.ref_type = 'product_id'
        and card_variants.language_code = 'en'
      group by card_variants.card_id
    )
    select
      cards.id,
      cards.provider_id,
      cards.name,
      cards.number,
      card_sets.name as set_name,
      card_sets.provider_id as set_provider_id
    from cards
    inner join card_sets on cards.set_id = card_sets.id
    left join priced_cards on cards.id = priced_cards.card_id
    left join ref_counts on cards.id = ref_counts.card_id
    where cards.language_code = 'en'
      and cards.is_active = true
      and card_sets.language_code = 'en'
      and card_sets.is_active = true
      and priced_cards.card_id is null
      and coalesce(ref_counts.ref_count, 0) = 0
    order by card_sets.name, cards.number_sort_key nulls last, cards.number, cards.name
    ${limitClause}
  `;
}

async function findBestMatch(localCard) {
  const attempts = await buildSearchAttempts(localCard);
  let bestMatch = null;

  for (const attempt of attempts) {
    const candidates = normalizeCardsResponse(await fetchPokeTraceJson("/cards", attempt.params));

    for (const candidate of candidates) {
      const score = scoreCandidate(localCard, candidate);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { score, attempt: attempt.label, card: candidate };
      }
    }

    if (bestMatch?.score >= options.minScore) break;
  }

  return bestMatch;
}

async function buildSearchAttempts(localCard) {
  const slugs = await getSetSlugs(localCard);
  const attempts = [];

  for (const slug of slugs) {
    attempts.push({
      label: `set:${slug}+number`,
      params: {
        set: slug,
        card_number: localCard.number,
        search: localCard.name,
        market: "US",
        product_type: "single",
        limit: 10,
      },
    });
    attempts.push({
      label: `set:${slug}+name`,
      params: {
        set: slug,
        search: localCard.name,
        market: "US",
        product_type: "single",
        limit: 10,
      },
    });
  }

  attempts.push({
    label: "broad",
    params: {
      search: `${localCard.name} ${localCard.number} ${localCard.set_name}`,
      market: "US",
      product_type: "single",
      limit: 10,
    },
  });

  return attempts;
}

async function getSetSlugs(localCard) {
  const searches = getExpectedSetNames(localCard);
  const slugs = [];

  for (const search of searches) {
    const cacheKey = normalizeText(search);
    if (!setSlugCache.has(cacheKey)) {
      const sets = normalizeSetsResponse(await fetchPokeTraceJson("/sets", { search, game: "pokemon", limit: 10 }));
      setSlugCache.set(cacheKey, chooseBestSetSlug(search, sets));
    }

    const slug = setSlugCache.get(cacheKey);
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }

  return slugs;
}

function chooseBestSetSlug(search, sets) {
  const normalizedSearch = normalizeText(search);
  const rankedSets = sets
    .map((set) => {
      const normalizedSetName = normalizeText(set.name);
      return {
        set,
        score:
          normalizedSetName === normalizedSearch
            ? 100
            : normalizedSetName.includes(normalizedSearch) || normalizedSearch.includes(normalizedSetName)
              ? 70
              : 0,
      };
    })
    .sort((left, right) => right.score - left.score);

  return rankedSets[0]?.score > 0 ? rankedSets[0].set.slug : null;
}

function scoreCandidate(localCard, candidate) {
  const localName = normalizeText(localCard.name);
  const candidateName = normalizeText(candidate.name ?? "");
  const localNumber = normalizeCardNumber(localCard.number);
  const candidateNumber = normalizeCardNumber(candidate.cardNumber ?? candidate.number ?? "");
  const expectedSetNames = getExpectedSetNames(localCard).map((setName) => normalizeText(setName));
  const candidateSetName = normalizeText(candidate.set?.name ?? "");

  let score = 0;

  if (candidateName === localName) score += 45;
  else if (candidateName.includes(localName) || localName.includes(candidateName)) score += 30;

  if (candidateNumber === localNumber) score += 35;
  else if (candidateName.includes(localNumber)) score += 20;

  if (expectedSetNames.includes(candidateSetName)) score += 25;
  else if (
    expectedSetNames.some(
      (setName) => candidateSetName.includes(setName) || setName.includes(candidateSetName),
    )
  ) {
    score += 15;
  }

  if (candidate.refs?.tcgplayerId || candidate.tcgplayerId) score += 5;

  return score;
}

function getExpectedSetNames(localCard) {
  const normalizedSetName = normalizeText(localCard.set_name);
  const aliases = POKETRACE_SET_ALIASES_BY_LOCAL_SET.get(normalizedSetName) ?? [];

  return uniqueStrings([localCard.set_name, ...aliases]);
}

async function getVariantIdsByCardPrinting(refInputs, dryRun) {
  const variantIdsByCardPrinting = new Map();

  if (refInputs.length === 0) return variantIdsByCardPrinting;

  const cardIds = Array.from(new Set(refInputs.map((input) => input.cardId)));
  const existingRows = await sql`
    select id, card_id, printing
    from card_variants
    where card_id in ${sql(cardIds)}
      and printing = 'normal'
      and condition = 'unspecified'
      and language_code = 'en'
  `;

  for (const row of existingRows) {
    addVariantId(variantIdsByCardPrinting, row.card_id, row.printing, row.id);
  }

  if (dryRun) {
    for (const input of refInputs) {
      addVariantId(variantIdsByCardPrinting, input.cardId, input.printing, `dry-run:${input.cardId}:${input.printing}`);
    }
    return variantIdsByCardPrinting;
  }

  const variantRows = refInputs.map((input) => ({
    card_id: input.cardId,
    printing: input.printing,
    condition: "unspecified",
    language_code: "en",
    updated_at: new Date(),
  }));

  for (const batch of chunk(variantRows, WRITE_BATCH_SIZE)) {
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
      addVariantId(variantIdsByCardPrinting, row.card_id, row.printing, row.id);
    }
  }

  return variantIdsByCardPrinting;
}

async function writeExternalRefs(refRows) {
  let refsUpserted = 0;

  for (const batch of chunk(dedupeExternalRefRecords(refRows), WRITE_BATCH_SIZE)) {
    const rows = await sql`
      insert into card_variant_external_refs ${sql(
        batch,
        "card_variant_id",
        "source",
        "ref_type",
        "ref_value",
        "metadata",
      )}
      on conflict (card_variant_id, source, ref_type, ref_value) do update set
        metadata = excluded.metadata,
        updated_at = now()
      returning id
    `;

    refsUpserted += rows.length;
  }

  return refsUpserted;
}

async function fetchPokeTraceJson(path, params) {
  await throttlePokeTraceRequest();
  const url = new URL(`${getBaseUrl()}${path}`);

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

  requestsMade += 1;

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

  const now = Date.now();
  const waitMs = Math.max(0, options.delayMs - (now - lastRequestAt));

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
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

function normalizeSetsResponse(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === "object") return [payload.data];
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload)) return payload;
  return [];
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u2605/g, "star")
    .replace(/\u03b4/g, "delta")
    .replace(/pok\u00e9mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCardNumber(value) {
  return normalizeText(value)
    .split(" ")[0]
    .replace(/^0+/, "")
    .replace(/([a-z])0+(\d)/g, "$1$2");
}

function getCardPrintingKey(cardId, printing) {
  return `${cardId}:${printing}`;
}

function addVariantId(variantIdsByCardPrinting, cardId, printing, variantId) {
  const key = getCardPrintingKey(cardId, printing);
  const variantIds = variantIdsByCardPrinting.get(key) ?? [];

  if (!variantIds.includes(variantId)) {
    variantIds.push(variantId);
  }

  variantIdsByCardPrinting.set(key, variantIds);
}

function dedupeExternalRefRecords(rows) {
  const rowsByKey = new Map();
  for (const row of rows) {
    rowsByKey.set(`${row.card_variant_id}:${row.source}:${row.ref_type}:${row.ref_value}`, row);
  }
  return Array.from(rowsByKey.values());
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

function printMatch(localCard, match) {
  if (!match) {
    console.log(`${localCard.set_name} | ${localCard.name} #${localCard.number} -> no match`);
    return;
  }

  const candidate = match.card;
  const tcgplayerProductId = String(candidate.refs?.tcgplayerId ?? candidate.tcgplayerId ?? "");
  console.log(
    `${localCard.set_name} | ${localCard.name} #${localCard.number} -> ${candidate.name} #${candidate.cardNumber ?? ""} [${candidate.set?.name ?? ""}] tcgplayer=${tcgplayerProductId || "none"} score=${match.score} via ${match.attempt}`,
  );
}

function printReviewRows(label, rows) {
  if (rows.length === 0) return;

  console.log(`\n${label} (${rows.length})`);
  for (const { card, match } of rows) {
    if (!match) {
      console.log(`- ${card.set_name} | ${card.name} #${card.number} -> no match`);
      continue;
    }

    const candidate = match.card;
    const tcgplayerProductId = String(candidate.refs?.tcgplayerId ?? candidate.tcgplayerId ?? "");
    console.log(
      `- ${card.set_name} | ${card.name} #${card.number} -> ${candidate.name} #${candidate.cardNumber ?? ""} [${candidate.set?.name ?? ""}] tcgplayer=${tcgplayerProductId || "none"} score=${match.score}`,
    );
  }
}

function parseArgs(args) {
  const parsed = {
    delayMs: delayMsFromEnv(),
    dryRun: false,
    limit: DEFAULT_LIMIT,
    minScore: DEFAULT_MIN_SCORE,
    verbose: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--all") {
      parsed.limit = null;
    } else if (arg === "--verbose") {
      parsed.verbose = true;
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = parsePositiveInteger(arg.slice("--limit=".length), "limit");
    } else if (arg.startsWith("--min-score=")) {
      parsed.minScore = parsePositiveInteger(arg.slice("--min-score=".length), "min score");
    } else if (arg.startsWith("--delay-ms=")) {
      parsed.delayMs = parseNonNegativeInteger(arg.slice("--delay-ms=".length), "delay ms");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function delayMsFromEnv() {
  const value = Number(process.env.POKETRACE_REQUEST_DELAY_MS);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_DELAY_MS;
}

function getBaseUrl() {
  return (process.env.POKETRACE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}
