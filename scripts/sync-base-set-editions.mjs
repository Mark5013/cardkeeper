import nextEnv from "@next/env";
import postgres from "postgres";

import {
  BASE_SET_PROVIDER_ID,
  BASE_SET_SHADOWLESS_NAME,
  BASE_SET_SHADOWLESS_TCGCSV_GROUP_ID,
  BASE_SET_TCGCSV_GROUP_ID,
  BASE_SET_UNLIMITED_NAME,
  BASE_SET_UNLIMITED_PROVIDER_ID,
  applyBaseSetCardOverrides,
  buildCanonicalProductMappings,
  createUnlimitedProviderCard,
  getUnlimitedCardProviderId,
  normalizeTcgcsvPrinting,
} from "./lib/base-set-editions.mjs";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const TCGCSV_BASE_URL = "https://tcgcsv.com";
const POKEMON_CATEGORY_ID = 3;
const EXPECTED_CARD_COUNT = 102;
const DECK_EXCLUSIVES_GROUP_ID = 1840;
const UNLIMITED_MACHAMP_PRODUCT_ID = 42425;
const SHADOWLESS_MACHAMP_PRODUCT_ID = 107004;
const WRITE_BATCH_SIZE = 500;
const REQUEST_DELAY_MS = 250;
const MAX_RETRIES = 4;
const USER_AGENT =
  process.env.TCGCSV_USER_AGENT ??
  "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";
let lastRequestAt = 0;

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to sync Base Set editions.");
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 2,
  connect_timeout: 10,
});

try {
  await syncBaseSetEditions();
} finally {
  await sql.end();
}

function parseArgs(args) {
  const parsed = { apply: false, rollback: false };

  for (const arg of args) {
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--rollback") {
      parsed.apply = true;
      parsed.rollback = true;
    }
    else if (arg !== "--dry-run") throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function syncBaseSetEditions() {
  const [baseSet] = await sql`
    select *
    from card_sets
    where provider_id = ${BASE_SET_PROVIDER_ID}
      and language_code = 'en'
  `;

  if (!baseSet) throw new Error(`Local set ${BASE_SET_PROVIDER_ID} was not found.`);

  const baseCards = await sql`
    select *
    from cards
    where set_id = ${baseSet.id}
      and language_code = 'en'
    order by number_sort_key nulls last, number, provider_id
  `;

  if (baseCards.length !== EXPECTED_CARD_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_CARD_COUNT} local Base Set cards, found ${baseCards.length}.`,
    );
  }

  const [
    unlimitedPayload,
    unlimitedPricesPayload,
    shadowlessPayload,
    shadowlessPricesPayload,
    deckPayload,
    deckPricesPayload,
  ] = await fetchBaseSetPayloads();
  const deckProducts = deckPayload.results.filter(isNumberedCardProduct);
  const unlimitedProducts = [
    ...unlimitedPayload.results.filter(isNumberedCardProduct),
    getRequiredProduct(deckProducts, UNLIMITED_MACHAMP_PRODUCT_ID),
  ];
  const shadowlessProducts = [
    ...shadowlessPayload.results.filter(isNumberedCardProduct),
    getRequiredProduct(deckProducts, SHADOWLESS_MACHAMP_PRODUCT_ID),
  ];
  const unlimitedMapping = buildCanonicalProductMappings(baseCards, unlimitedProducts);
  const shadowlessMapping = buildCanonicalProductMappings(baseCards, shadowlessProducts);

  assertCompleteMapping("Unlimited", unlimitedMapping, unlimitedProducts);
  assertCompleteMapping("Shadowless", shadowlessMapping, shadowlessProducts);

  const shadowlessCards = baseCards.map((row) => ({
    row,
    providerCard: applyBaseSetCardOverrides(row.provider_data),
  }));
  const unlimitedCards = shadowlessCards.map(({ row, providerCard }) => ({
    row,
    providerCard: createUnlimitedProviderCard({
      shadowlessCard: providerCard,
      product: unlimitedMapping.mappings.get(row.provider_id),
    }),
  }));
  const observedAt = await getObservedAt();
  const priceInputs = [
    ...buildPriceInputs({
      baseCards,
      mappings: unlimitedMapping.mappings,
      prices: [...unlimitedPricesPayload.results, ...deckPricesPayload.results],
      providerIdForCard: (providerId) => getUnlimitedCardProviderId(providerId),
    }),
    ...buildPriceInputs({
      baseCards,
      mappings: shadowlessMapping.mappings,
      prices: [...shadowlessPricesPayload.results, ...deckPricesPayload.results],
      providerIdForCard: (providerId) => providerId,
    }),
  ];

  const summary = summarizePriceInputs(priceInputs);
  console.log(
    `Validated ${baseCards.length} Shadowless and ${unlimitedCards.length} Unlimited cards using exact name + collector-number matches.`,
  );
  console.log(
    `Prepared ${priceInputs.length} current market prices across ${summary.variantCount} card printings (${summary.shadowlessCount} Shadowless, ${summary.unlimitedCount} Unlimited).`,
  );

  if (!options.apply) {
    console.log("Dry run complete. Re-run with --apply to write the edition split.");
    return;
  }

  const rollbackSignal = new Error("ROLLBACK_VALIDATION");

  try {
    await sql.begin(async (tx) => {
      await upsertEditionSets(tx, baseSet);
      await upsertEditionCards(tx, shadowlessCards, unlimitedCards);
      await moveUnlimitedVariants(tx);
      const variantIdsByIdentity = await upsertMarketVariants(tx, priceInputs);
      await replaceEditionProductRefs(tx, priceInputs, variantIdsByIdentity);
      await replaceEditionCurrentPrices(tx, priceInputs, variantIdsByIdentity, observedAt);
      if (options.rollback) throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) throw error;
    console.log("Write validation succeeded; the transaction was intentionally rolled back.");
    return;
  }

  console.log(
    `Base Set edition split applied. Existing normal/holofoil variants now belong to ${BASE_SET_UNLIMITED_NAME}; Shadowless-specific variants remain on ${BASE_SET_SHADOWLESS_NAME}.`,
  );
  console.log(
    "Run the TCGCSV historical backfill after this migration so both editions receive canonical compressed history.",
  );
}

async function fetchBaseSetPayloads() {
  const paths = [
    `/tcgplayer/${POKEMON_CATEGORY_ID}/${BASE_SET_TCGCSV_GROUP_ID}/products`,
    `/tcgplayer/${POKEMON_CATEGORY_ID}/${BASE_SET_TCGCSV_GROUP_ID}/prices`,
    `/tcgplayer/${POKEMON_CATEGORY_ID}/${BASE_SET_SHADOWLESS_TCGCSV_GROUP_ID}/products`,
    `/tcgplayer/${POKEMON_CATEGORY_ID}/${BASE_SET_SHADOWLESS_TCGCSV_GROUP_ID}/prices`,
    `/tcgplayer/${POKEMON_CATEGORY_ID}/${DECK_EXCLUSIVES_GROUP_ID}/products`,
    `/tcgplayer/${POKEMON_CATEGORY_ID}/${DECK_EXCLUSIVES_GROUP_ID}/prices`,
  ];
  const payloads = [];

  for (const path of paths) payloads.push(await fetchTcgcsvJson(path));

  return payloads;
}

function getRequiredProduct(products, productId) {
  const product = products.find((candidate) => candidate.productId === productId);
  if (!product) throw new Error(`Required TCGplayer product ${productId} was not found.`);
  return product;
}

function assertCompleteMapping(label, result, products) {
  if (result.errors.length > 0 || result.mappings.size !== EXPECTED_CARD_COUNT) {
    throw new Error(
      `${label} mapping was not complete (${result.mappings.size}/${EXPECTED_CARD_COUNT}). ` +
        `${products.length} numbered products were inspected.\n${result.errors.join("\n")}`,
    );
  }
}

function buildPriceInputs({ baseCards, mappings, prices, providerIdForCard }) {
  const pricesByProductId = new Map();

  for (const price of prices) {
    const productPrices = pricesByProductId.get(price.productId) ?? [];
    productPrices.push(price);
    pricesByProductId.set(price.productId, productPrices);
  }

  return baseCards.flatMap((card) => {
    const product = mappings.get(card.provider_id);

    return (pricesByProductId.get(product.productId) ?? []).flatMap((price) => {
      const amount = price.marketPrice;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return [];

      return [{
        cardProviderId: providerIdForCard(card.provider_id),
        printing: normalizeTcgcsvPrinting(price.subTypeName),
        productId: String(product.productId),
        productUrl:
          product.url ??
          `https://www.tcgplayer.com/product/${encodeURIComponent(product.productId)}/-?Language=English`,
        amountMinor: Math.round(amount * 100),
      }];
    });
  });
}

function summarizePriceInputs(inputs) {
  return {
    variantCount: new Set(inputs.map(getPriceInputIdentity)).size,
    shadowlessCount: inputs.filter((input) => !input.cardProviderId.endsWith("-unlimited")).length,
    unlimitedCount: inputs.filter((input) => input.cardProviderId.endsWith("-unlimited")).length,
  };
}

async function upsertEditionSets(tx, baseSet) {
  await tx`
    update card_sets
    set name = ${BASE_SET_SHADOWLESS_NAME}, updated_at = now()
    where id = ${baseSet.id}
  `;
  await tx`
    insert into card_sets (
      provider_id, language_code, name, series, printed_total, total, release_date,
      provider_updated_at, last_imported_at, is_active, symbol_url, logo_url, updated_at
    )
    values (
      ${BASE_SET_UNLIMITED_PROVIDER_ID}, 'en', ${BASE_SET_UNLIMITED_NAME}, ${baseSet.series},
      ${baseSet.printed_total}, ${baseSet.total}, ${baseSet.release_date},
      ${baseSet.provider_updated_at}, ${baseSet.last_imported_at}, true,
      ${baseSet.symbol_url}, ${baseSet.logo_url}, now()
    )
    on conflict (provider_id, language_code) do update set
      name = excluded.name,
      series = excluded.series,
      printed_total = excluded.printed_total,
      total = excluded.total,
      release_date = excluded.release_date,
      is_active = true,
      symbol_url = excluded.symbol_url,
      logo_url = excluded.logo_url,
      updated_at = now()
  `;
}

async function upsertEditionCards(tx, shadowlessCards, unlimitedCards) {
  const [shadowlessSet, unlimitedSet] = await tx`
    select id, provider_id
    from card_sets
    where provider_id in (${BASE_SET_PROVIDER_ID}, ${BASE_SET_UNLIMITED_PROVIDER_ID})
      and language_code = 'en'
    order by provider_id
  `;
  const setIds = new Map(
    [shadowlessSet, unlimitedSet].map((set) => [set.provider_id, set.id]),
  );
  const rows = [
    ...shadowlessCards.map(({ row, providerCard }) => buildCardRow(
      row,
      providerCard,
      setIds.get(BASE_SET_PROVIDER_ID),
    )),
    ...unlimitedCards.map(({ row, providerCard }) => buildCardRow(
      row,
      providerCard,
      setIds.get(BASE_SET_UNLIMITED_PROVIDER_ID),
    )),
  ];

  for (const batch of chunk(rows, WRITE_BATCH_SIZE)) {
    await tx`
      insert into cards ${tx(
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
        "last_imported_at",
        "is_active",
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
        is_active = true,
        provider_data = excluded.provider_data,
        updated_at = now()
    `;
  }
}

function buildCardRow(row, providerCard, setId) {
  if (!setId) throw new Error(`Missing local set for ${providerCard.set.id}.`);

  return {
    provider_id: providerCard.id,
    set_id: setId,
    language_code: "en",
    name: providerCard.name,
    number: row.number,
    supertype: row.supertype,
    subtypes: row.subtypes,
    rarity: row.rarity,
    artist: row.artist,
    image_small_url: providerCard.images.small,
    image_large_url: providerCard.images.large,
    last_imported_at: row.last_imported_at,
    is_active: true,
    provider_data: providerCard,
    updated_at: new Date(),
  };
}

async function moveUnlimitedVariants(tx) {
  await tx`
    update card_variants as variant
    set card_id = unlimited_card.id, updated_at = now()
    from cards as shadowless_card
    inner join cards as unlimited_card
      on unlimited_card.provider_id = shadowless_card.provider_id || '-unlimited'
      and unlimited_card.language_code = shadowless_card.language_code
    where variant.card_id = shadowless_card.id
      and shadowless_card.set_id = (
        select id from card_sets
        where provider_id = ${BASE_SET_PROVIDER_ID} and language_code = 'en'
      )
      and variant.printing in ('normal', 'holofoil')
  `;
}

async function upsertMarketVariants(tx, inputs) {
  const identities = new Map(inputs.map((input) => [getPriceInputIdentity(input), input]));
  const providerIds = [...new Set([...identities.values()].map((input) => input.cardProviderId))];
  const localCards = await tx`
    select id, provider_id
    from cards
    where provider_id in ${tx(providerIds)} and language_code = 'en'
  `;
  const cardIds = new Map(localCards.map((card) => [card.provider_id, card.id]));
  const rows = [...identities.values()].map((input) => ({
    card_id: cardIds.get(input.cardProviderId),
    printing: input.printing,
    condition: "unspecified",
    language_code: "en",
    updated_at: new Date(),
  }));
  const variantIds = new Map();

  if (rows.some((row) => !row.card_id)) throw new Error("A mapped Base Set card is missing locally.");

  for (const batch of chunk(rows, WRITE_BATCH_SIZE)) {
    const savedRows = await tx`
      insert into card_variants ${tx(
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

    for (const saved of savedRows) variantIds.set(`${saved.card_id}:${saved.printing}`, saved.id);
  }

  return { cardIds, variantIds };
}

async function replaceEditionProductRefs(tx, inputs, identities) {
  const editionCardIds = [...identities.cardIds.values()];
  await tx`
    delete from card_variant_external_refs as ref
    using card_variants as variant
    where ref.card_variant_id = variant.id
      and variant.card_id in ${tx(editionCardIds)}
      and ref.source = 'tcgplayer'
      and ref.ref_type = 'product_id'
  `;

  const rows = dedupeInputs(inputs).map((input) => ({
    card_variant_id: getVariantId(input, identities),
    source: "tcgplayer",
    ref_type: "product_id",
    ref_value: input.productId,
    metadata: { url: input.productUrl },
    updated_at: new Date(),
  }));

  for (const batch of chunk(rows, WRITE_BATCH_SIZE)) {
    await tx`
      insert into card_variant_external_refs ${tx(
        batch,
        "card_variant_id",
        "source",
        "ref_type",
        "ref_value",
        "metadata",
        "updated_at",
      )}
      on conflict (card_variant_id, source, ref_type, ref_value) do update set
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `;
  }
}

async function replaceEditionCurrentPrices(tx, inputs, identities, observedAt) {
  const editionCardIds = [...identities.cardIds.values()];
  await tx`
    delete from current_prices as price
    using card_variants as variant
    where price.card_variant_id = variant.id
      and variant.card_id in ${tx(editionCardIds)}
      and price.source = 'tcgcsv'
  `;

  const rows = dedupeInputs(inputs).map((input) => ({
    card_variant_id: getVariantId(input, identities),
    source: "tcgcsv",
    price_type: "market",
    currency: "USD",
    amount_minor: input.amountMinor,
    observed_at: observedAt,
  }));

  for (const batch of chunk(rows, WRITE_BATCH_SIZE)) {
    await tx`
      insert into current_prices ${tx(
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
    `;
  }
}

function getVariantId(input, identities) {
  const cardId = identities.cardIds.get(input.cardProviderId);
  const variantId = identities.variantIds.get(`${cardId}:${input.printing}`);
  if (!variantId) throw new Error(`Missing variant for ${getPriceInputIdentity(input)}.`);
  return variantId;
}

function dedupeInputs(inputs) {
  return [...new Map(inputs.map((input) => [getPriceInputIdentity(input), input])).values()];
}

function getPriceInputIdentity(input) {
  return `${input.cardProviderId}:${input.printing}`;
}

function isNumberedCardProduct(product) {
  return Boolean(product.extendedData?.find((entry) => entry.name === "Number")?.value);
}

async function getObservedAt() {
  const value = (await fetchTcgcsvText("/last-updated.txt"))
    .trim()
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const observedAt = new Date(value);

  if (Number.isNaN(observedAt.getTime())) {
    throw new Error(`Unable to parse TCGCSV last-updated timestamp: ${value}`);
  }

  return observedAt;
}

async function fetchTcgcsvJson(path) {
  return JSON.parse(await fetchTcgcsvText(path));
}

async function fetchTcgcsvText(path) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    const waitMs = Math.max(0, lastRequestAt + REQUEST_DELAY_MS - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAt = Date.now();

    try {
      const response = await fetch(`${TCGCSV_BASE_URL}${path}`, {
        headers: {
          Accept: "application/json,text/plain",
          "User-Agent": USER_AGENT,
        },
      });
      if (response.ok) return response.text();
      lastError = new Error(`TCGCSV returned ${response.status} for ${path}.`);
    } catch (error) {
      lastError = error;
    }

    if (attempt <= MAX_RETRIES) await sleep(Math.min(15_000, 500 * 2 ** (attempt - 1)));
  }

  throw lastError ?? new Error(`TCGCSV request failed for ${path}.`);
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
