import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const DEFAULT_BASE_URL = "https://api.poketrace.com/v1";
const DEFAULT_DELAY_MS = 2100;
const DEFAULT_LIMIT = 5;
const USER_AGENT = "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";

const TROUBLE_CARD_SAMPLES = [
  { setId: "sm1", number: "164", note: "Sun & Moon unnumbered energy mapping" },
  { setId: "sm1", number: "168", note: "Sun & Moon unnumbered energy mapping" },
  { setId: "sm5", number: "135a", note: "League & Championship variant" },
  { setId: "sm5", number: "153a", note: "League & Championship variant" },
  { setId: "sm3", number: "112a", note: "League & Championship variant" },
  { setId: "sm8", number: "188a", note: "League & Championship variant" },
  { setId: "sm35", number: "10a", note: "Alternate Art Promos variant" },
  { setId: "sm35", number: "77a", note: "Alternate Art Promos variant" },
  { setId: "xy6", number: "77a", note: "Alternate Art Promos variant" },
  { setId: "xy6", number: "92a", note: "Alternate Art Promos variant" },
  { setId: "xy2", number: "88a", note: "Alternate Art Promos variant" },
  { setId: "dpp", number: "DP05", note: "Diamond and Pearl Promos mapping" },
  { setId: "np", number: "36", note: "Nintendo participation promo mapping" },
  { setId: "base1", number: "8", note: "Deck Exclusives mapping" },
  { setId: "sm9", number: "152a", note: "League & Championship staff variant" },
  { setId: "ecard2", number: "103", note: "Aquapolis split a/b variant" },
  { setId: "ecard2", number: "50", note: "Aquapolis split a/b variant" },
  { setId: "svp", number: "148", note: "Battle Academy 2024 cross-set listing" },
];

const SEALED_SAMPLES = [
  "Surging Sparks booster box",
  "Prismatic Evolutions elite trainer box",
  "Pokemon 151 booster bundle",
];

const SUPPLEMENTAL_SET_SEARCHES_BY_NOTE = [
  { noteIncludes: "unnumbered energy", setSearches: ["SM Base Set"] },
  { noteIncludes: "League & Championship", setSearches: ["League & Championship Cards"] },
  { noteIncludes: "Alternate Art Promos", setSearches: ["Alternate Art Promos"] },
  { noteIncludes: "Diamond and Pearl Promos", setSearches: ["Diamond and Pearl Promos"] },
  { noteIncludes: "Nintendo participation", setSearches: ["Nintendo Promos"] },
  { noteIncludes: "Deck Exclusives", setSearches: ["Deck Exclusives"] },
  { noteIncludes: "Aquapolis", setSearches: ["Aquapolis"] },
  {
    noteIncludes: "Battle Academy 2024",
    setSearches: ["Battle Academy 2024", "SV: Scarlet & Violet Promo Cards"],
  },
];

let lastRequestAt = 0;
const setSlugCache = new Map();

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to load local card samples.");
}

const apiKey = process.env.POKETRACE_API_KEY?.trim();
if (!options.localOnly && !apiKey) {
  throw new Error(
    "POKETRACE_API_KEY is required. Add it to .env.local, or run with --local-only to verify local samples only.",
  );
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

try {
  await main();
} finally {
  await sql.end();
}

async function main() {
  const samples = await loadLocalSamples(options.maxCards);
  printLocalSamples(samples);

  if (options.localOnly) {
    console.log("\nLocal-only mode complete. Add POKETRACE_API_KEY to .env.local and rerun without --local-only.");
    return;
  }

  console.log(
    `\nPokeTrace probe: ${samples.length} local card searches` +
      `${options.includeSealed ? ` + ${SEALED_SAMPLES.length} sealed searches` : ""}.`,
  );
  console.log(`Request delay: ${options.delayMs}ms. Result limit per search: ${options.limit}.`);

  for (const sample of samples) {
    await delayBetweenRequests();
    await probeCardSample(sample);
  }

  if (options.includeSealed) {
    for (const search of SEALED_SAMPLES) {
      await delayBetweenRequests();
      await probeSealedSample(search);
    }
  }
}

async function loadLocalSamples(maxCards) {
  const requestedSamples = TROUBLE_CARD_SAMPLES.slice(0, maxCards);
  const rows = [];

  for (const sample of requestedSamples) {
    const [row] = await sql`
      select
        cards.provider_id,
        cards.name,
        cards.number,
        cards.provider_data,
        card_sets.provider_id as set_provider_id,
        card_sets.name as set_name
      from public.cards
      inner join public.card_sets on cards.set_id = card_sets.id
      where card_sets.provider_id = ${sample.setId}
        and cards.language_code = 'en'
        and lower(cards.number) = lower(${sample.number})
      limit 1
    `;

    rows.push({
      ...sample,
      found: Boolean(row),
      card: row ?? null,
      tcgplayerId: extractTcgplayerId(row?.provider_data?.tcgplayer?.url),
    });
  }

  return rows;
}

function printLocalSamples(samples) {
  console.log(`Loaded ${samples.filter((sample) => sample.found).length}/${samples.length} local card samples.`);
  for (const sample of samples) {
    if (!sample.found) {
      console.log(`MISS local ${sample.setId} #${sample.number} (${sample.note})`);
      continue;
    }

    console.log(
      `LOCAL ${sample.card.set_name} #${sample.card.number} ${sample.card.name}` +
        `${sample.tcgplayerId ? ` tcgplayer=${sample.tcgplayerId}` : ""}` +
        ` (${sample.note})`,
    );
  }
}

async function probeCardSample(sample) {
  if (!sample.found) return;

  const attempts = await buildCardSearchAttempts(sample);
  const candidatesById = new Map();
  const attemptSummaries = [];

  for (const attempt of attempts) {
    await delayBetweenRequests();
    const payload = await fetchPokeTraceCards(attempt.params);
    const candidates = normalizeCardsResponse(payload);
    attemptSummaries.push({ label: attempt.label, count: candidates.length });

    for (const candidate of candidates) {
      const candidateKey =
        candidate.id ??
        `${candidate.name}:${candidate.cardNumber}:${candidate.set?.slug}:${candidate.refs?.tcgplayerId}`;
      if (!candidatesById.has(candidateKey)) {
        candidatesById.set(candidateKey, candidate);
      }
    }

    if (candidates.some((candidate) => isStrongCandidate(sample, candidate))) {
      break;
    }
  }

  const candidates = Array.from(candidatesById.values());
  const rankedCandidates = rankCandidates(sample, candidates);

  console.log(`\nCARD ${sample.card.set_name} #${sample.card.number} ${sample.card.name}`);
  console.log(`Attempts: ${attemptSummaries.map((attempt) => `${attempt.label}=${attempt.count}`).join(", ")}`);
  console.log(`Candidates: ${candidates.length}`);

  if (rankedCandidates.length === 0) {
    console.log("  No PokeTrace candidates returned.");
    return;
  }

  for (const candidate of rankedCandidates.slice(0, options.limit)) {
    printCandidate(candidate);
  }
}

async function buildCardSearchAttempts(sample) {
  const attempts = [];
  const setSearches = getSetSearches(sample);
  const setSlugs = [];

  if (sample.tcgplayerId) {
    attempts.push({
      label: `tcgplayer_ids:${sample.tcgplayerId}`,
      params: {
        tcgplayer_ids: sample.tcgplayerId,
        market: "US",
        product_type: "single",
        limit: options.limit,
      },
    });
  }

  for (const setSearch of setSearches) {
    const slug = await discoverBestSetSlug(setSearch);
    if (slug && !setSlugs.includes(slug)) setSlugs.push(slug);
  }

  for (const slug of setSlugs) {
    attempts.push({
      label: `set:${slug}+number`,
      params: {
        set: slug,
        card_number: sample.card.number,
        search: sample.card.name,
        market: "US",
        product_type: "single",
        limit: options.limit,
      },
    });
    attempts.push({
      label: `set:${slug}+name`,
      params: {
        set: slug,
        search: sample.card.name,
        market: "US",
        product_type: "single",
        limit: options.limit,
      },
    });
  }

  attempts.push({
    label: "broad",
    params: {
      search: `${sample.card.name} ${sample.card.number} ${sample.card.set_name}`,
      market: "US",
      product_type: "single",
      limit: options.limit,
    },
  });

  return attempts;
}

function getSetSearches(sample) {
  const setSearches = [sample.card.set_name];
  const note = sample.note.toLocaleLowerCase("en-US");

  for (const supplemental of SUPPLEMENTAL_SET_SEARCHES_BY_NOTE) {
    if (note.includes(supplemental.noteIncludes.toLocaleLowerCase("en-US"))) {
      setSearches.push(...supplemental.setSearches);
    }
  }

  return Array.from(new Set(setSearches));
}

async function discoverBestSetSlug(search) {
  const normalizedSearch = normalizeText(search);
  if (setSlugCache.has(normalizedSearch)) return setSlugCache.get(normalizedSearch);

  await delayBetweenRequests();
  const payload = await fetchPokeTraceSets({ search, game: "pokemon", limit: 10 });
  const sets = normalizeSetsResponse(payload);
  const rankedSets = sets
    .map((set) => ({
      set,
      score:
        normalizeText(set.name) === normalizedSearch
          ? 100
          : normalizeText(set.name).includes(normalizedSearch) || normalizedSearch.includes(normalizeText(set.name))
            ? 50
            : 0,
    }))
    .sort((left, right) => right.score - left.score);
  const bestSet = rankedSets[0]?.set ?? null;
  const slug = bestSet?.slug ?? null;

  setSlugCache.set(normalizedSearch, slug);
  console.log(`Set lookup "${search}" -> ${slug ?? "no match"}${bestSet?.name ? ` (${bestSet.name})` : ""}`);
  return slug;
}

async function probeSealedSample(search) {
  const payload = await fetchPokeTraceCards({
    search,
    market: "US",
    product_type: "sealed",
    limit: options.limit,
  });
  const candidates = normalizeCardsResponse(payload);

  console.log(`\nSEALED ${search}`);
  console.log(`Candidates: ${candidates.length}`);

  for (const candidate of candidates.slice(0, options.limit)) {
    printCandidate({ card: candidate, score: 0, reasons: ["sealed search"] });
  }
}

async function fetchPokeTraceCards(params) {
  return fetchPokeTraceJson("/cards", params);
}

async function fetchPokeTraceSets(params) {
  return fetchPokeTraceJson("/sets", params);
}

async function fetchPokeTraceJson(path, params) {
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

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PokeTrace request failed with ${response.status}: ${body.slice(0, 500)}`);
  }

  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  if (remaining !== null) {
    console.log(`Rate limit remaining: ${remaining}${reset ? ` reset=${reset}` : ""}`);
  }

  return response.json();
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

function rankCandidates(sample, candidates) {
  const expectedSetSearches = getSetSearches(sample);

  return candidates
    .map((card) => {
      const reasons = [];
      let score = 0;

      const candidateTcgplayerId = String(card.refs?.tcgplayerId ?? card.tcgplayerId ?? "");
      if (sample.tcgplayerId && candidateTcgplayerId === sample.tcgplayerId) {
        score += 100;
        reasons.push("tcgplayer id match");
      }

      if (normalizeText(card.name) === normalizeText(sample.card.name)) {
        score += 20;
        reasons.push("exact name match");
      } else if (candidateNameContainsLocalName(card.name, sample.card.name)) {
        score += 10;
        reasons.push("name contains local name");
      }

      if (cardNumbersMatch(card.cardNumber ?? card.number, sample.card.number)) {
        score += 30;
        reasons.push("number match");
      }

      if (normalizeText(card.set?.name) === normalizeText(sample.card.set_name)) {
        score += 10;
        reasons.push("local set match");
      } else if (matchesExpectedSetSearch(card.set, expectedSetSearches)) {
        score += 25;
        reasons.push("expected PokeTrace set match");
      }

      if (
        sample.note.toLocaleLowerCase("en-US").includes("unnumbered") &&
        normalizeText(card.name).includes("unnumbered")
      ) {
        score += 10;
        reasons.push("unnumbered mapping hint");
      }

      if (
        sample.note.toLocaleLowerCase("en-US").includes("league & championship") &&
        normalizeText(card.name).includes("1st place")
      ) {
        score += 5;
        reasons.push("preferred 1st place variant");
      }

      return { card, score, reasons };
    })
    .sort((left, right) => right.score - left.score);
}

function isStrongCandidate(sample, candidate) {
  const candidateTcgplayerId = String(candidate.refs?.tcgplayerId ?? candidate.tcgplayerId ?? "");
  if (sample.tcgplayerId && candidateTcgplayerId === sample.tcgplayerId) return true;

  return (
    (normalizeText(candidate.name) === normalizeText(sample.card.name) ||
      candidateNameContainsLocalName(candidate.name, sample.card.name)) &&
    cardNumbersMatch(candidate.cardNumber ?? candidate.number, sample.card.number) &&
    matchesExpectedSetSearch(candidate.set, getSetSearches(sample))
  );
}

function printCandidate(candidate) {
  const card = candidate.card;
  const conditionOptions = Array.isArray(card.conditionOptions) ? card.conditionOptions.join(", ") : "none listed";
  const tcgplayerId = card.refs?.tcgplayerId ?? card.tcgplayerId ?? "none";
  const productType = card.productType ?? card.product_type ?? "unknown";
  const productFamily = card.productFamily ?? card.product_family ?? "unknown";
  const priceSummary = summarizePrices(card.prices);

  console.log(
      `  score=${candidate.score} ${candidate.reasons.join("; ") || "no strong local match"}\n` +
      `    ${card.name ?? "Unknown"} ${card.cardNumber ?? ""} | ${card.set?.name ?? "Unknown set"}${card.set?.slug ? ` (${card.set.slug})` : ""} | ${productType}/${productFamily}\n` +
      `    id=${card.id ?? "unknown"} tcgplayer=${tcgplayerId} conditions=${conditionOptions}\n` +
      `    prices=${priceSummary}`,
  );
}

function summarizePrices(prices) {
  if (!prices || typeof prices !== "object") return "none";

  const parts = [];
  for (const [source, tiers] of Object.entries(prices)) {
    if (!tiers || typeof tiers !== "object") continue;
    const tierParts = Object.entries(tiers)
      .slice(0, 6)
      .map(([tier, value]) => {
        const price = value?.avg ?? value?.market ?? value?.mid ?? value?.low ?? null;
        return `${source}.${tier}=${typeof price === "number" ? `$${price.toFixed(2)}` : "n/a"}`;
      });
    parts.push(...tierParts);
  }

  return parts.length > 0 ? parts.join(", ") : "none";
}

function extractTcgplayerId(value) {
  if (typeof value !== "string" || value.length === 0) return null;

  try {
    const url = new URL(value);
    const productMatch = url.pathname.match(/\/product\/(\d+)/);
    if (productMatch) return productMatch[1];
  } catch {
    const productMatch = value.match(/\/product\/(\d+)/);
    if (productMatch) return productMatch[1];
  }

  return null;
}

async function delayBetweenRequests() {
  const elapsedMs = Date.now() - lastRequestAt;
  const waitMs = Math.max(0, options.delayMs - elapsedMs);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
}

function delayMsFromEnv() {
  const value = Number(process.env.POKETRACE_REQUEST_DELAY_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DELAY_MS;
}

function getBaseUrl() {
  return (process.env.POKETRACE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function normalizeText(value) {
  return String(value ?? "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function candidateNameContainsLocalName(candidateName, localName) {
  const candidate = normalizeText(candidateName);
  const local = normalizeText(localName);
  return Boolean(local) && candidate.includes(local);
}

function matchesExpectedSetSearch(candidateSet, expectedSetSearches) {
  const candidateName = normalizeText(candidateSet?.name);
  const candidateSlug = normalizeText(String(candidateSet?.slug ?? "").replace(/-/g, " "));

  return expectedSetSearches.some((setSearch) => {
    const normalizedSearch = normalizeText(setSearch);
    return (
      candidateName === normalizedSearch ||
      candidateSlug === normalizedSearch ||
      candidateName.includes(normalizedSearch)
    );
  });
}

function normalizeCardNumber(value) {
  return String(value ?? "")
    .toLocaleLowerCase("en-US")
    .replace(/^0+/, "")
    .replace(/[^a-z0-9]/g, "");
}

function cardNumbersMatch(candidateNumber, localNumber) {
  const candidate = normalizeCardNumber(candidateNumber);
  const local = normalizeCardNumber(localNumber);
  return candidate === local || candidate.startsWith(local);
}

function parseArgs(args) {
  const parsed = {
    delayMs: delayMsFromEnv(),
    includeSealed: false,
    limit: DEFAULT_LIMIT,
    localOnly: false,
    maxCards: TROUBLE_CARD_SAMPLES.length,
  };

  for (const arg of args) {
    if (arg === "--include-sealed") {
      parsed.includeSealed = true;
    } else if (arg === "--local-only") {
      parsed.localOnly = true;
    } else if (arg.startsWith("--delay-ms=")) {
      parsed.delayMs = parseNonnegativeInteger(arg.slice("--delay-ms=".length), "delay");
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = parsePositiveInteger(arg.slice("--limit=".length), "limit");
    } else if (arg.startsWith("--max-cards=")) {
      parsed.maxCards = parsePositiveInteger(arg.slice("--max-cards=".length), "max cards");
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

function parseNonnegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return parsed;
}
