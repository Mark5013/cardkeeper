import nextEnv from "@next/env";
import postgres from "postgres";

import {
  buildPriceRows,
  buildProviderCard,
  classifyTcgcsvProduct,
  getCardNumberDenominator,
  getJapaneseProviderCardId,
  getJapaneseProviderSetId,
  groupPricesByProduct,
  normalizeTcgcsvPrinting,
  TCGCSV_PRODUCT_CATEGORIES,
} from "./lib/tcgcsv-product-import.mjs";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const TCGCSV_BASE_URL = "https://tcgcsv.com";
const SOURCE = "tcgcsv";
const IMPORT_SOURCE = "tcgcsv_product_catalog";
const CURRENCY = "USD";
const DEFAULT_PAGE_DELAY_MS = 250;
const MINIMUM_PAGE_DELAY_MS = 250;
const DEFAULT_MAX_RETRIES = 4;
const MAX_REQUESTS = 10_000;
const USER_AGENT =
  process.env.TCGCSV_USER_AGENT?.trim() ||
  "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";
const PRICE_COLUMNS = [
  "sealed_product_id",
  "source",
  "price_type",
  "currency",
  "amount_minor",
  "observed_at",
];
const CARD_PRICE_COLUMNS = [
  "card_variant_id",
  "source",
  "price_type",
  "currency",
  "amount_minor",
  "observed_at",
];

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to import TCGCSV products.");
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 20,
});
let lastTcgcsvRequestAt = 0;
let requestCount = 0;

try {
  await importProducts();
} finally {
  await sql.end();
}

function parseArgs(args) {
  const parsed = {
    apply: false,
    categoryIds: [3, 85],
    groupIds: null,
    maxGroups: null,
    maxRetries: DEFAULT_MAX_RETRIES,
    pageDelayMs: DEFAULT_PAGE_DELAY_MS,
    skipIfCurrent: false,
  };

  for (const arg of args) {
    if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg === "--dry-run") {
      parsed.apply = false;
    } else if (arg === "--skip-if-current") {
      parsed.skipIfCurrent = true;
    } else if (arg.startsWith("--category=")) {
      const value = arg.slice("--category=".length).toLowerCase();
      if (value === "all") parsed.categoryIds = [3, 85];
      else if (value === "en" || value === "3") parsed.categoryIds = [3];
      else if (value === "ja" || value === "jp" || value === "85") {
        parsed.categoryIds = [85];
      } else {
        throw new Error("Expected --category=all, en, ja, 3, or 85.");
      }
    } else if (arg.startsWith("--group-ids=")) {
      parsed.groupIds = parsePositiveIntegerList(
        arg.slice("--group-ids=".length),
        "group IDs",
      );
    } else if (arg.startsWith("--max-groups=")) {
      parsed.maxGroups = parsePositiveInteger(
        arg.slice("--max-groups=".length),
        "max groups",
      );
    } else if (arg.startsWith("--page-delay-ms=")) {
      parsed.pageDelayMs = parsePositiveInteger(
        arg.slice("--page-delay-ms=".length),
        "page delay",
      );
    } else if (arg.startsWith("--max-retries=")) {
      parsed.maxRetries = parsePositiveInteger(
        arg.slice("--max-retries=".length),
        "max retries",
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.pageDelayMs < MINIMUM_PAGE_DELAY_MS) {
    throw new Error(
      `TCGCSV requests require at least ${MINIMUM_PAGE_DELAY_MS}ms spacing.`,
    );
  }
  if (parsed.groupIds && parsed.maxGroups) {
    throw new Error("Use either --group-ids or --max-groups, not both.");
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

function parsePositiveIntegerList(value, label) {
  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parsePositiveInteger(entry, label));

  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`Expected ${label} to be a non-empty distinct list.`);
  }
  return values;
}

async function importProducts() {
  const startedAt = new Date();
  const observedAt = await getObservedAt();
  const mode = `categories:${options.categoryIds.join(",")}`;

  if (options.skipIfCurrent && !options.groupIds && !options.maxGroups) {
    const [currentRun] = await sql`
      select options ->> 'buildTimestamp' as build_timestamp
      from catalog_import_runs
      where source = ${IMPORT_SOURCE}
        and mode = ${mode}
        and status = 'succeeded'
        and options ->> 'groupIds' is null
        and options ->> 'maxGroups' is null
      order by finished_at desc nulls last
      limit 1
    `;

    if (
      currentRun?.build_timestamp &&
      new Date(currentRun.build_timestamp) >= observedAt
    ) {
      console.log(
        `Skipping TCGCSV product import. ${mode} is already current at ${currentRun.build_timestamp}.`,
      );
      return;
    }
  }

  const categoryGroups = [];
  for (const categoryId of options.categoryIds) {
    const payload = await fetchTcgcsvJson(`/tcgplayer/${categoryId}/groups`);
    let groups = payload.results;
    if (!Array.isArray(groups)) {
      throw new Error(`TCGCSV category ${categoryId} did not return groups.`);
    }

    if (options.groupIds) {
      const selected = new Set(options.groupIds.map(String));
      groups = groups.filter((group) => selected.has(String(group.groupId)));
    }
    groups = [...groups].sort(compareGroups);
    if (options.maxGroups) groups = groups.slice(0, options.maxGroups);

    categoryGroups.push({ categoryId, groups });
  }

  const groupCount = categoryGroups.reduce(
    (total, entry) => total + entry.groups.length,
    0,
  );
  const plannedRequests = requestCount + groupCount * 2;
  const worstCaseRequests =
    requestCount + groupCount * 2 * (options.maxRetries + 1);
  if (worstCaseRequests >= MAX_REQUESTS) {
    throw new Error(
      `Worst-case request budget ${worstCaseRequests} approaches TCGCSV's ${MAX_REQUESTS.toLocaleString()} request ceiling.`,
    );
  }

  const stats = {
    groupsProcessed: 0,
    cardsImported: 0,
    sealedImported: 0,
    productsExcluded: 0,
    cardVariantsImported: 0,
    cardPricesImported: 0,
    sealedPricesImported: 0,
    sealedPriceSubtypeConflicts: 0,
  };
  let runId = null;

  if (options.apply) {
    const [run] = await sql`
      insert into catalog_import_runs (
        source,
        mode,
        status,
        options,
        started_at
      )
      values (
        ${IMPORT_SOURCE},
        ${mode},
        'running',
        ${sql.json({
          buildTimestamp: observedAt.toISOString(),
          categoryIds: options.categoryIds,
          groupIds: options.groupIds,
          maxGroups: options.maxGroups,
        })},
        ${startedAt}
      )
      returning id
    `;
    runId = run?.id ?? null;
  }

  console.log(
    `${options.apply ? "Applying" : "Dry-running"} TCGCSV product import for ${groupCount.toLocaleString()} groups at ${observedAt.toISOString()} (${plannedRequests.toLocaleString()} planned, ${worstCaseRequests.toLocaleString()} worst-case requests).`,
  );

  try {
    for (const { categoryId, groups } of categoryGroups) {
      const category = TCGCSV_PRODUCT_CATEGORIES[categoryId];

      for (const group of groups) {
        const productsPayload = await fetchTcgcsvJson(
          `/tcgplayer/${categoryId}/${group.groupId}/products`,
        );
        const pricesPayload = await fetchTcgcsvJson(
          `/tcgplayer/${categoryId}/${group.groupId}/prices`,
        );
        const products = requireResults(
          productsPayload,
          `products for ${categoryId}/${group.groupId}`,
        );
        const prices = requireResults(
          pricesPayload,
          `prices for ${categoryId}/${group.groupId}`,
        );
        const classified = classifyProducts({
          category,
          group,
          products,
          prices,
          observedAt,
        });

        stats.groupsProcessed += 1;
        stats.cardsImported += classified.cards.length;
        stats.sealedImported += classified.sealed.length;
        stats.productsExcluded += classified.excludedCount;
        stats.cardVariantsImported += classified.cardVariantCount;
        stats.cardPricesImported += classified.cardPriceCount;
        stats.sealedPricesImported += classified.sealedPriceCount;
        stats.sealedPriceSubtypeConflicts +=
          classified.sealedPriceSubtypeConflicts;

        if (options.apply) {
          await importGroup({
            category,
            group,
            classified,
            observedAt,
            importedAt: startedAt,
          });
        }

        if (
          stats.groupsProcessed % 25 === 0 ||
          stats.groupsProcessed === groupCount
        ) {
          console.log(
            `  ${stats.groupsProcessed}/${groupCount} groups; ${stats.cardsImported.toLocaleString()} JP cards; ${stats.sealedImported.toLocaleString()} sealed products.`,
          );
        }
      }
    }

    if (
      options.apply &&
      !options.groupIds &&
      !options.maxGroups
    ) {
      await deactivateMissingProducts(startedAt);
    }

    if (runId) {
      await sql`
        update catalog_import_runs
        set
          status = 'succeeded',
          sets_processed = ${stats.groupsProcessed},
          cards_processed = ${stats.cardsImported},
          finished_at = now(),
          duration_ms = ${Date.now() - startedAt.getTime()},
          options = options || ${sql.json({
            sealedProductsProcessed: stats.sealedImported,
            requestsMade: requestCount,
            stats,
          })}
        where id = ${runId}
      `;
    }
  } catch (error) {
    if (runId) {
      await sql`
        update catalog_import_runs
        set
          status = 'failed',
          sets_processed = ${stats.groupsProcessed},
          cards_processed = ${stats.cardsImported},
          finished_at = now(),
          duration_ms = ${Date.now() - startedAt.getTime()},
          error_message = ${String(error?.message ?? error).slice(0, 4000)},
          options = options || ${sql.json({
            sealedProductsProcessed: stats.sealedImported,
            requestsMade: requestCount,
            stats,
          })}
        where id = ${runId}
      `;
    }
    throw error;
  }

  console.log(
    JSON.stringify(
      {
        buildTimestamp: observedAt.toISOString(),
        requestsMade: requestCount,
        ...stats,
      },
      null,
      2,
    ),
  );
}

function classifyProducts({
  category,
  group,
  products,
  prices,
  observedAt,
}) {
  const pricesByProduct = groupPricesByProduct(prices);
  const cards = [];
  const sealed = [];
  let excludedCount = 0;
  let cardVariantCount = 0;
  let cardPriceCount = 0;
  let sealedPriceCount = 0;
  let sealedPriceSubtypeConflicts = 0;

  for (const product of products) {
    const classification = classifyTcgcsvProduct(product);
    const productPrices = pricesByProduct.get(String(product.productId)) ?? [];

    if (classification === "excluded") {
      excludedCount += 1;
      continue;
    }

    if (classification === "card") {
      if (!category.importCards) continue;
      const subtypePrices = productPrices.length
        ? productPrices
        : [{ productId: product.productId, subTypeName: "Normal" }];
      const providerCard = buildProviderCard({
        group,
        product,
        productPrices,
        observedAt,
      });
      const variants = new Map();

      for (const subtypePrice of subtypePrices) {
        const printing = normalizeTcgcsvPrinting(subtypePrice.subTypeName);
        const priceRows = buildPriceRows(subtypePrice);
        const existing = variants.get(printing) ?? [];
        existing.push(...priceRows);
        variants.set(printing, existing);
        cardPriceCount += priceRows.length;
      }

      cardVariantCount += variants.size;
      cards.push({ product, providerCard, variants });
      continue;
    }

    const subtypeNames = new Set(
      productPrices.map((price) =>
        normalizeTcgcsvPrinting(price.subTypeName),
      ),
    );
    const canPrice = subtypeNames.size <= 1;
    if (!canPrice) sealedPriceSubtypeConflicts += 1;
    const priceRows = canPrice
      ? productPrices.flatMap((price) => buildPriceRows(price))
      : [];
    sealedPriceCount += priceRows.length;
    sealed.push({ product, priceRows });
  }

  return {
    cards,
    sealed,
    excludedCount,
    cardVariantCount,
    cardPriceCount,
    sealedPriceCount,
    sealedPriceSubtypeConflicts,
  };
}

async function importGroup({
  category,
  group,
  classified,
  observedAt,
  importedAt,
}) {
  await sql.begin(async (transaction) => {
    if (category.importCards && classified.cards.length > 0) {
      await importJapaneseCards(transaction, {
        group,
        cards: classified.cards,
        observedAt,
        importedAt,
      });
    }

    if (classified.sealed.length > 0) {
      await importSealedProducts(transaction, {
        category,
        group,
        sealed: classified.sealed,
        observedAt,
        importedAt,
      });
    }
  });
}

async function importJapaneseCards(
  transaction,
  { group, cards, observedAt, importedAt },
) {
  const total = cards.length;
  const printedTotal =
    cards
      .map(({ providerCard }) =>
        getCardNumberDenominator(providerCard.number),
      )
      .filter(Number.isInteger)
      .sort((left, right) => right - left)[0] ?? total;
  const providerSetId = getJapaneseProviderSetId(group.groupId);
  const [setRow] = await transaction`
    insert into card_sets (
      provider_id,
      language_code,
      name,
      series,
      printed_total,
      total,
      release_date,
      provider_updated_at,
      last_imported_at,
      is_active
    )
    values (
      ${providerSetId},
      'ja',
      ${group.name},
      'Pokémon Japan',
      ${printedTotal},
      ${total},
      ${toDateOnly(group.publishedOn)},
      ${toDateOrNull(group.modifiedOn)},
      ${importedAt},
      true
    )
    on conflict (provider_id, language_code)
    do update set
      name = excluded.name,
      series = excluded.series,
      printed_total = excluded.printed_total,
      total = excluded.total,
      release_date = excluded.release_date,
      provider_updated_at = excluded.provider_updated_at,
      last_imported_at = excluded.last_imported_at,
      is_active = true,
      updated_at = now()
    returning id
  `;

  const cardRows = cards.map(({ product, providerCard }) => ({
    provider_id: getJapaneseProviderCardId(product.productId),
    set_id: setRow.id,
    language_code: "ja",
    name: product.name,
    number: providerCard.number,
    supertype: providerCard.supertype,
    subtypes: providerCard.subtypes,
    rarity: providerCard.rarity ?? null,
    artist: null,
    image_small_url: product.imageUrl ?? null,
    image_large_url: product.imageUrl ?? null,
    last_imported_at: importedAt,
    is_active: true,
    provider_data: providerCard,
  }));
  await transaction`
    insert into cards ${transaction(
      cardRows,
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
    )}
    on conflict (provider_id, language_code)
    do update set
      set_id = excluded.set_id,
      name = excluded.name,
      number = excluded.number,
      supertype = excluded.supertype,
      subtypes = excluded.subtypes,
      rarity = excluded.rarity,
      artist = excluded.artist,
      image_small_url = excluded.image_small_url,
      image_large_url = excluded.image_large_url,
      last_imported_at = excluded.last_imported_at,
      is_active = true,
      provider_data = excluded.provider_data,
      updated_at = now()
  `;

  const cardIds = cards.map(({ product }) =>
    getJapaneseProviderCardId(product.productId),
  );
  const localCards = await transaction`
    select id, provider_id
    from cards
    where language_code = 'ja'
      and provider_id in ${transaction(cardIds)}
  `;
  const cardIdByProviderId = new Map(
    localCards.map((card) => [card.provider_id, card.id]),
  );
  const variantRows = cards.flatMap(({ product, variants }) => {
    const cardId = cardIdByProviderId.get(
      getJapaneseProviderCardId(product.productId),
    );
    if (!cardId) throw new Error(`Missing imported card ${product.productId}.`);
    return [...variants.keys()].map((printing) => ({
      card_id: cardId,
      printing,
      condition: "unspecified",
      language_code: "ja",
    }));
  });
  await transaction`
    insert into card_variants ${transaction(
      variantRows,
      "card_id",
      "printing",
      "condition",
      "language_code",
    )}
    on conflict (card_id, printing, condition, language_code)
    do nothing
  `;

  const localVariants = await transaction`
    select id, card_id, printing
    from card_variants
    where language_code = 'ja'
      and condition = 'unspecified'
      and card_id in ${transaction(localCards.map((card) => card.id))}
  `;
  const variantIdByIdentity = new Map(
    localVariants.map((variant) => [
      `${variant.card_id}:${variant.printing}`,
      variant.id,
    ]),
  );
  const refs = [];
  const currentPriceRows = [];

  for (const { product, variants } of cards) {
    const cardId = cardIdByProviderId.get(
      getJapaneseProviderCardId(product.productId),
    );

    for (const [printing, prices] of variants) {
      const variantId = variantIdByIdentity.get(`${cardId}:${printing}`);
      if (!variantId) {
        throw new Error(
          `Missing imported variant ${product.productId}/${printing}.`,
        );
      }

      refs.push({
        card_variant_id: variantId,
        source: "tcgplayer",
        ref_type: "product_id",
        ref_value: String(product.productId),
        metadata: {
          tcgcsvCategoryId: 85,
          tcgcsvGroupId: group.groupId,
          tcgcsvMappingMethod: "direct_category_catalog",
          tcgcsvMappingStatus: "exact",
          tcgcsvProductName: product.name,
          languageCode: "ja",
        },
      });

      for (const price of prices) {
        currentPriceRows.push({
          card_variant_id: variantId,
          source: SOURCE,
          price_type: price.priceType,
          currency: CURRENCY,
          amount_minor: price.amountMinor,
          observed_at: observedAt,
        });
      }
    }
  }

  if (refs.length > 0) {
    await transaction`
      insert into card_variant_external_refs ${transaction(
        refs,
        "card_variant_id",
        "source",
        "ref_type",
        "ref_value",
        "metadata",
      )}
      on conflict (card_variant_id, source, ref_type, ref_value)
      do update set
        metadata = excluded.metadata,
        updated_at = now()
    `;
  }

  await transaction`
    delete from current_prices
    where source = ${SOURCE}
      and card_variant_id in ${transaction(
        localVariants.map((variant) => variant.id),
      )}
  `;
  await upsertCardPrices(transaction, currentPriceRows, observedAt);
}

async function importSealedProducts(
  transaction,
  { category, group, sealed, observedAt, importedAt },
) {
  const productRows = sealed.map(({ product }) => ({
    provider_id: String(product.productId),
    category_id: category.categoryId,
    group_id: Number(group.groupId),
    group_name: group.name,
    language_code: category.languageCode,
    name: product.name,
    image_url: product.imageUrl ?? null,
    tcgplayer_url: product.url ?? null,
    release_date:
      toDateOnly(product.presaleInfo?.releasedOn) ??
      toDateOnly(group.publishedOn),
    is_presale: Boolean(product.presaleInfo?.isPresale),
    last_imported_at: importedAt,
    is_active: true,
    provider_data: product,
  }));
  await transaction`
    insert into sealed_products ${transaction(
      productRows,
      "provider_id",
      "category_id",
      "group_id",
      "group_name",
      "language_code",
      "name",
      "image_url",
      "tcgplayer_url",
      "release_date",
      "is_presale",
      "last_imported_at",
      "is_active",
      "provider_data",
    )}
    on conflict (category_id, provider_id)
    do update set
      group_id = excluded.group_id,
      group_name = excluded.group_name,
      language_code = excluded.language_code,
      name = excluded.name,
      image_url = excluded.image_url,
      tcgplayer_url = excluded.tcgplayer_url,
      release_date = excluded.release_date,
      is_presale = excluded.is_presale,
      last_imported_at = excluded.last_imported_at,
      is_active = true,
      provider_data = excluded.provider_data,
      updated_at = now()
  `;

  const localProducts = await transaction`
    select id, provider_id
    from sealed_products
    where category_id = ${category.categoryId}
      and provider_id in ${transaction(
        sealed.map(({ product }) => String(product.productId)),
      )}
  `;
  const productIdByProviderId = new Map(
    localProducts.map((product) => [product.provider_id, product.id]),
  );
  const currentPriceRows = sealed.flatMap(({ product, priceRows }) => {
    const sealedProductId = productIdByProviderId.get(String(product.productId));
    if (!sealedProductId) {
      throw new Error(`Missing imported sealed product ${product.productId}.`);
    }

    return priceRows.map((price) => ({
      sealed_product_id: sealedProductId,
      source: SOURCE,
      price_type: price.priceType,
      currency: CURRENCY,
      amount_minor: price.amountMinor,
      observed_at: observedAt,
    }));
  });

  await transaction`
    delete from sealed_current_prices
    where source = ${SOURCE}
      and sealed_product_id in ${transaction(
        localProducts.map((product) => product.id),
      )}
  `;
  await upsertSealedPrices(transaction, currentPriceRows, observedAt);
}

async function upsertCardPrices(transaction, rows, observedAt) {
  if (rows.length === 0) return;

  await transaction`
    insert into current_prices ${transaction(rows, ...CARD_PRICE_COLUMNS)}
    on conflict (card_variant_id, source, price_type, currency)
    do update set
      amount_minor = excluded.amount_minor,
      observed_at = excluded.observed_at,
      updated_at = now()
  `;
  await appendPriceSeries(transaction, {
    rows,
    observedAt,
    productColumn: "card_variant_id",
    tableName: "price_series",
  });
}

async function upsertSealedPrices(transaction, rows, observedAt) {
  if (rows.length === 0) return;

  await transaction`
    insert into sealed_current_prices ${transaction(rows, ...PRICE_COLUMNS)}
    on conflict (sealed_product_id, source, price_type, currency)
    do update set
      amount_minor = excluded.amount_minor,
      observed_at = excluded.observed_at,
      updated_at = now()
  `;
  await appendPriceSeries(transaction, {
    rows,
    observedAt,
    productColumn: "sealed_product_id",
    tableName: "sealed_price_series",
  });
}

async function appendPriceSeries(
  transaction,
  { rows, observedAt, productColumn, tableName },
) {
  const observedOn = observedAt.toISOString().slice(0, 10);
  const seriesRows = rows.map((row) => ({
    [productColumn]: row[productColumn],
    source: row.source,
    price_type: row.price_type,
    currency: row.currency,
    observed_on: [observedOn],
    amounts_minor: [row.amount_minor],
  }));
  const productIdentifier = transaction(productColumn);
  const tableIdentifier = transaction(tableName);

  await transaction`
    insert into ${tableIdentifier} ${transaction(
      seriesRows,
      productColumn,
      "source",
      "price_type",
      "currency",
      "observed_on",
      "amounts_minor",
    )}
    on conflict (${productIdentifier}, source, price_type, currency)
    do update set
      observed_on = case
        when ${tableIdentifier}.observed_on[
          cardinality(${tableIdentifier}.observed_on)
        ] = excluded.observed_on[1]
          then array_cat(
            ${tableIdentifier}.observed_on[
              1:greatest(cardinality(${tableIdentifier}.observed_on) - 1, 0)
            ],
            excluded.observed_on
          )
        when ${tableIdentifier}.amounts_minor[
          cardinality(${tableIdentifier}.amounts_minor)
        ] = excluded.amounts_minor[1]
          then ${tableIdentifier}.observed_on
        else array_append(
          ${tableIdentifier}.observed_on,
          excluded.observed_on[1]
        )
      end,
      amounts_minor = case
        when ${tableIdentifier}.observed_on[
          cardinality(${tableIdentifier}.observed_on)
        ] = excluded.observed_on[1]
          then array_cat(
            ${tableIdentifier}.amounts_minor[
              1:greatest(cardinality(${tableIdentifier}.amounts_minor) - 1, 0)
            ],
            excluded.amounts_minor
          )
        when ${tableIdentifier}.amounts_minor[
          cardinality(${tableIdentifier}.amounts_minor)
        ] = excluded.amounts_minor[1]
          then ${tableIdentifier}.amounts_minor
        else array_append(
          ${tableIdentifier}.amounts_minor,
          excluded.amounts_minor[1]
        )
      end,
      updated_at = now()
  `;
}

async function deactivateMissingProducts(importedAt) {
  if (options.categoryIds.includes(85)) {
    await sql.begin(async (transaction) => {
      await transaction`
        update cards
        set is_active = false, updated_at = now()
        where language_code = 'ja'
          and provider_id like 'tcgplayer-85-%'
          and (last_imported_at is null or last_imported_at < ${importedAt})
      `;
      await transaction`
        update card_sets
        set is_active = false, updated_at = now()
        where language_code = 'ja'
          and provider_id like 'tcgplayer-85-%'
          and (last_imported_at is null or last_imported_at < ${importedAt})
      `;
    });
  }

  for (const categoryId of options.categoryIds) {
    await sql`
      update sealed_products
      set is_active = false, updated_at = now()
      where category_id = ${categoryId}
        and (last_imported_at is null or last_imported_at < ${importedAt})
    `;
  }
}

function requireResults(payload, label) {
  if (!Array.isArray(payload?.results)) {
    throw new Error(`TCGCSV did not return ${label}.`);
  }
  return payload.results;
}

function compareGroups(left, right) {
  const leftDate = Date.parse(left.publishedOn ?? "") || 0;
  const rightDate = Date.parse(right.publishedOn ?? "") || 0;
  return leftDate - rightDate || Number(left.groupId) - Number(right.groupId);
}

function toDateOnly(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function toDateOrNull(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function getObservedAt() {
  const response = await fetchTcgcsv("/last-updated.txt");
  const marker = (await response.text()).trim();
  const observedAt = new Date(marker);

  if (!marker || Number.isNaN(observedAt.getTime())) {
    throw new Error(`Invalid TCGCSV last-updated marker: ${marker || "(empty)"}`);
  }
  return observedAt;
}

async function fetchTcgcsvJson(pathname) {
  const response = await fetchTcgcsv(pathname);
  return response.json();
}

async function fetchTcgcsv(pathname) {
  let lastError = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    if (requestCount >= MAX_REQUESTS) {
      throw new Error(
        `TCGCSV request ceiling of ${MAX_REQUESTS.toLocaleString()} reached.`,
      );
    }
    await waitForRequestWindow();
    requestCount += 1;

    try {
      const response = await fetch(`${TCGCSV_BASE_URL}${pathname}`, {
        headers: {
          Accept: pathname.endsWith(".txt") ? "text/plain" : "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response;

      const body = (await response.text()).slice(0, 500);
      const error = new Error(
        `TCGCSV ${pathname} returned ${response.status}: ${body}`,
      );
      if (response.status < 500 && response.status !== 429) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
    }

    if (attempt < options.maxRetries) {
      await delay(Math.min(2 ** attempt * 1000, 10_000));
    }
  }

  throw lastError ?? new Error(`Unable to fetch TCGCSV ${pathname}.`);
}

async function waitForRequestWindow() {
  const remaining =
    options.pageDelayMs - (Date.now() - lastTcgcsvRequestAt);
  if (remaining > 0) await delay(remaining);
  lastTcgcsvRequestAt = Date.now();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
