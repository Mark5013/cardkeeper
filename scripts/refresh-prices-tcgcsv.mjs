import nextEnv from "@next/env";
import postgres from "postgres";

import { compareTcgcsvGroupsByPublishedOn } from "./lib/tcgcsv-history-core.mjs";

const { loadEnvConfig } = nextEnv;

const TCGCSV_BASE_URL = "https://tcgcsv.com";
const POKEMON_CATEGORY_ID = 3;
const SOURCE = "tcgcsv";
const CURRENCY = "USD";
const DEFAULT_PAGE_DELAY_MS = 100;
const DEFAULT_MAX_RETRIES = 4;
const WRITE_BATCH_SIZE = 500;
const USER_AGENT = process.env.TCGCSV_USER_AGENT ?? "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";
const SPLIT_SET_MARKERS = ["latias", "latios", "plusle", "minun"];
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
const SET_NAME_ALIASES = new Map(
  [
    [
      "Alternate Art Promos",
      [
        "Ancient Origins",
        "BREAKpoint",
        "BREAKthrough",
        "Burning Shadows",
        "Celestial Storm",
        "Cosmic Eclipse",
        "Crimson Invasion",
        "Dragon Majesty",
        "Fates Collide",
        "Flashfire",
        "Forbidden Light",
        "Furious Fists",
        "Generations",
        "Guardians Rising",
        "Lost Thunder",
        "Phantom Forces",
        "Roaring Skies",
        "Shining Legends",
        "SM Black Star Promos",
        "Sun & Moon",
        "Team Up",
        "Unbroken Bonds",
        "Unified Minds",
        "XY Black Star Promos",
      ],
    ],
    ["Battle Academy 2024", ["Scarlet & Violet Promos"]],
    ["Best of Promos", ["Best of Game"]],
    ["Deck Exclusives", ["Base"]],
    [
      "League & Championship Cards",
      [
        "Burning Shadows",
        "Celestial Storm",
        "Dragon Majesty",
        "Forbidden Light",
        "Guardians Rising",
        "Lost Thunder",
        "Shining Legends",
        "Team Up",
        "Ultra Prism",
        "Unbroken Bonds",
        "Unified Minds",
        "XY Black Star Promos",
      ],
    ],
    ["Ruby and Sapphire", ["Ruby & Sapphire"]],
    ["EX Trainer Kit 1: Latias & Latios", ["EX Trainer Kit Latias", "EX Trainer Kit Latios"]],
    ["EX Trainer Kit 2: Plusle & Minun", ["EX Trainer Kit 2 Plusle", "EX Trainer Kit 2 Minun"]],
    ["Diamond and Pearl", ["Diamond & Pearl"]],
    ["Black and White", ["Black & White"]],
    ["Generations: Radiant Collection", ["Generations"]],
    ["Legendary Treasures: Radiant Collection", ["Legendary Treasures"]],
    ["McDonald's Promos 2011", ["McDonald's Collection 2011"]],
    ["McDonald's Promos 2012", ["McDonald's Collection 2012"]],
    ["McDonald's Promos 2014", ["McDonald's Collection 2014"]],
    ["McDonald's Promos 2015", ["McDonald's Collection 2015"]],
    ["McDonald's Promos 2016", ["McDonald's Collection 2016"]],
    ["McDonald's Promos 2017", ["McDonald's Collection 2017"]],
    ["McDonald's Promos 2018", ["McDonald's Collection 2018"]],
    ["McDonald's Promos 2019", ["McDonald's Collection 2019"]],
    ["McDonald's Promos 2022", ["McDonald's Collection 2022"]],
    ["SM - Burning Shadows", ["Burning Shadows"]],
    ["SM Base Set", ["Sun & Moon"]],
    ["WoTC Promo", "Wizards Black Star Promos"],
    ["Nintendo Promos", "Nintendo Black Star Promos"],
    ["Diamond and Pearl Promos", "DP Black Star Promos"],
    ["HGSS Promos", "HGSS Black Star Promos"],
    ["Black and White Promos", "BW Black Star Promos"],
    ["XY Promos", "XY Black Star Promos"],
    ["SM Promos", "SM Black Star Promos"],
    ["SWSH: Sword & Shield Promo Cards", "SWSH Black Star Promos"],
    ["Sword & Shield Promo Cards", "SWSH Black Star Promos"],
    ["SV: Scarlet & Violet Promo Cards", "Scarlet & Violet Promos"],
    ["Scarlet & Violet Promo Cards", "Scarlet & Violet Promos"],
  ].map(([groupName, setNames]) => [
    normalizeSetName(groupName),
    (Array.isArray(setNames) ? setNames : [setNames]).map((setName) => normalizeSetName(setName)),
  ]),
);
const GROUP_SET_CARD_NUMBER_ALLOWLIST = new Map(
  [
    [
      "Battle Academy 2024",
      "Scarlet & Violet Promos",
      ["105", "106", "107", "108", "109", "110", "111", "112", "113", "114", "148"],
    ],
    ["Deck Exclusives", "Base", ["8"]],
  ].map(([groupName, setName, cardNumbers]) => [
    getGroupSetKey(groupName, setName),
    new Set(cardNumbers.map((cardNumber) => normalizeCardNumber(cardNumber))),
  ]),
);

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
let lastTcgcsvRequestAt = 0;

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
    skipIfCurrent: false,
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
    } else if (arg === "--skip-if-current") {
      parsed.skipIfCurrent = true;
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

  if (options.skipIfCurrent && !options.resetSource) {
    const latestObservedAt = await getLatestCurrentPriceObservedAt();

    if (latestObservedAt && latestObservedAt >= observedAt) {
      console.log(
        `Skipping TCGCSV price refresh. Latest local ${SOURCE} prices are from ${latestObservedAt.toISOString()}, and TCGCSV latest build is ${observedAt.toISOString()}.`,
      );
      return;
    }
  }

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
    priceSeriesChangesAppended: 0,
  };

  console.log(
    `Starting TCGCSV price refresh${options.dryRun ? " (dry run)" : ""} for ${groups.length.toLocaleString()} group${groups.length === 1 ? "" : "s"} observed at ${observedAt.toISOString()}.`,
  );

  if (options.resetSource) {
    if (options.dryRun) {
      console.log(`Dry run: would remove existing ${SOURCE} rows from current_prices and price_series.`);
    } else {
      await resetSourceRows();
    }
  }

  for (const group of groups) {
    stats.groupsChecked += 1;
    const localSetsForGroup = findLocalSetsForGroup(group, setMatchers);

    if (localSetsForGroup.length === 0) {
      console.log(`Skipping ${group.name} (${group.groupId}): no local set match.`);
      continue;
    }

    stats.groupsMatched += 1;

    const productsPayload = await fetchTcgcsvJson(`/tcgplayer/${POKEMON_CATEGORY_ID}/${group.groupId}/products`);
    const pricesPayload = await fetchTcgcsvJson(`/tcgplayer/${POKEMON_CATEGORY_ID}/${group.groupId}/prices`);
    const cardProducts = productsPayload.results.filter(isCardProduct);
    const pricesByProductId = groupPricesByProductId(pricesPayload.results);
    const groupPriceRecords = [];
    const groupMatches = [];

    stats.productsChecked += cardProducts.length;

    for (const localSet of localSetsForGroup) {
      const setPriceRecords = await preparePriceRecordsForSet({
        cardProducts,
        group,
        localSet,
        observedAt,
        pricesByProductId,
        requireNameMatch: localSetsForGroup.length > 1,
      });

      stats.productsMatched += setPriceRecords.productsMatched;
      groupPriceRecords.push(...setPriceRecords.priceRecords);
      groupMatches.push(
        `${localSet.name}: ${setPriceRecords.productsMatched.toLocaleString()} matched, ${setPriceRecords.priceRecords.length.toLocaleString()} observations`,
      );
    }

    stats.priceRowsPrepared += groupPriceRecords.length;

    if (!options.dryRun && groupPriceRecords.length > 0) {
      const writeStats = await writePrices(groupPriceRecords);
      stats.currentPricesUpserted += writeStats.currentPricesUpserted;
      stats.priceSeriesChangesAppended += writeStats.priceSeriesChangesAppended;
    }

    console.log(
      `${group.name} (${group.groupId}) -> ${groupMatches.join("; ")}. ${cardProducts.length.toLocaleString()} card products checked.`,
    );

    if (options.pageDelayMs > 0) {
      await sleep(options.pageDelayMs);
    }
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `TCGCSV price refresh complete in ${elapsedSeconds}s. ${stats.groupsMatched}/${stats.groupsChecked} groups matched, ${stats.productsMatched}/${stats.productsChecked} products matched, ${stats.priceRowsPrepared.toLocaleString()} observations prepared, ${stats.currentPricesUpserted.toLocaleString()} current prices upserted, ${stats.priceSeriesChangesAppended.toLocaleString()} compressed history changes appended.`,
  );
}

async function preparePriceRecordsForSet({
  cardProducts,
  group,
  localSet,
  observedAt,
  pricesByProductId,
  requireNameMatch,
}) {
  const localCards = await getLocalCardsForSet(localSet.id);
  const allowedCardNumbers = getAllowedCardNumbers(group, localSet);
  const duplicateCardNumbers = getDuplicateCardNumbers(localCards);
  const shouldRequireNameMatch = requireNameMatch || duplicateCardNumbers.size > 0;
  const localCardsByNumber = new Map(
    localCards.map((card) => [normalizeCardNumberForSet(card.number, localSet), card]),
  );
  const localCardsByNumberAndName = new Map(
    localCards.map((card) => [getCardNumberAndNameKey(card.number, card.name, localSet), card]),
  );
  const amountsByCardPrinting = new Map();
  const priceRecords = [];
  let productsMatched = 0;

  for (const product of cardProducts) {
    if (shouldSkipProductForSet(product, group, localSet)) continue;

    const cardNumber = getProductCardNumber(product, localSet);
    if (allowedCardNumbers && !allowedCardNumbers.has(normalizeCardNumber(cardNumber))) continue;

    const localCard = cardNumber
      ? shouldRequireNameMatch
        ? getNameMatchedLocalCard(product, cardNumber, localSet, localCardsByNumberAndName)
        : localCardsByNumber.get(normalizeCardNumberForSet(cardNumber, localSet))
      : null;
    const productPrices = pricesByProductId.get(product.productId) ?? [];

    if (!localCard || productPrices.length === 0) continue;

    productsMatched += 1;

    for (const price of productPrices) {
      const printing = normalizePrinting(price.subTypeName);
      const amountRecords = getAmountRecords(price);

      if (amountRecords.length === 0) continue;

      mergeAmountRecordsByCardPrinting(amountsByCardPrinting, {
        cardId: localCard.id,
        printing,
        amountRecords,
        productIds: [String(product.productId)],
      });
    }
  }

  const variantIdsByCardPrinting = await getVariantIdsByCardPrinting(
    Array.from(amountsByCardPrinting.values()),
    options.dryRun,
  );

  if (!options.dryRun) {
    await writeTcgplayerProductRefs(Array.from(amountsByCardPrinting.values()), variantIdsByCardPrinting);
  }

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

  return { priceRecords, productsMatched };
}

function getProductCardNumber(product, localSet) {
  const cardNumber = getExtendedDataValue(product, "Number");

  if (cardNumber) return cardNumber;

  if (localSet.provider_id === "sm1") {
    return getSunMoonEnergyCardNumber(product);
  }

  return "";
}

function getSunMoonEnergyCardNumber(product) {
  const rawName = String(product.name ?? "").toLowerCase();
  if (!rawName.includes("(2017 unnumbered)")) return "";

  const energyType = normalizeCardName(rawName.replace(/\(2017 unnumbered\)/, "")).replace(/\s+energy$/, "");
  const energyNumbers = new Map([
    ["grass", "164"],
    ["fire", "165"],
    ["water", "166"],
    ["lightning", "167"],
    ["psychic", "168"],
    ["fighting", "169"],
    ["darkness", "170"],
    ["metal", "171"],
    ["fairy", "172"],
  ]);

  return energyNumbers.get(energyType) ?? "";
}

function shouldSkipProductForSet(product, group, localSet) {
  const groupName = normalizeSetName(group.name);
  const localSetName = normalizeSetName(localSet.name);
  const productName = normalizeCardName(product.name);
  const cardNumber = normalizeCardNumber(getExtendedDataValue(product, "Number"));

  if (
    groupName === normalizeSetName("Alternate Art Promos") &&
    localSetName === normalizeSetName("Team Up") &&
    productName.includes("communication") &&
    cardNumber === "152b"
  ) {
    return true;
  }

  if (groupName === normalizeSetName("League & Championship Cards") && productName.includes("league challenge")) {
    return !productName.includes("1st place");
  }

  if (groupName === normalizeSetName("Nintendo Promos") && localSetName === normalizeSetName("Nintendo Black Star Promos")) {
    return productName.includes("tropical tidal wave") && !productName.includes("participation");
  }

  if (
    groupName === normalizeSetName("Diamond and Pearl Promos") &&
    localSetName === normalizeSetName("DP Black Star Promos")
  ) {
    return productName.includes("tropical wind") && productName.includes("staff");
  }

  if (groupName === normalizeSetName("Deck Exclusives") && localSetName === normalizeSetName("Base")) {
    return productName.includes("machamp") && productName.includes("shadowless");
  }

  return false;
}

function mergeAmountRecordsByCardPrinting(amountsByCardPrinting, priceInput) {
  const key = getCardPrintingKey(priceInput.cardId, priceInput.printing);
  const existingInput = amountsByCardPrinting.get(key);

  if (!existingInput) {
    amountsByCardPrinting.set(key, {
      ...priceInput,
      samples: 1,
    });
    return;
  }

  amountsByCardPrinting.set(key, {
    cardId: priceInput.cardId,
    printing: priceInput.printing,
    amountRecords: averageAmountRecords(existingInput.amountRecords, priceInput.amountRecords, existingInput.samples),
    productIds: uniqueStrings([...existingInput.productIds, ...priceInput.productIds]),
    samples: existingInput.samples + 1,
  });
}

function averageAmountRecords(existingAmountRecords, nextAmountRecords, existingSamples) {
  const amountRecordsByType = new Map(existingAmountRecords.map((record) => [record.priceType, record]));

  for (const nextRecord of nextAmountRecords) {
    const existingRecord = amountRecordsByType.get(nextRecord.priceType);

    amountRecordsByType.set(nextRecord.priceType, {
      priceType: nextRecord.priceType,
      amountMinor: existingRecord
        ? Math.round((existingRecord.amountMinor * existingSamples + nextRecord.amountMinor) / (existingSamples + 1))
        : nextRecord.amountMinor,
    });
  }

  return Array.from(amountRecordsByType.values());
}

function getNameMatchedLocalCard(product, cardNumber, localSet, localCardsByNumberAndName) {
  if (hasOtherSplitSetMarker(product.name, localSet.name)) return null;

  for (const productName of getProductNameCandidates(product, cardNumber, localSet)) {
    const localCard = localCardsByNumberAndName.get(getCardNumberAndNameKey(cardNumber, productName, localSet));

    if (localCard) return localCard;
  }

  return null;
}

function getProductNameCandidates(product, cardNumber, localSet) {
  return uniqueStrings(
    [product.name, product.cleanName].flatMap((productName) => [
      productName,
      stripSunMoonUnnumberedEnergySuffix(productName, localSet),
      stripTrailingCardNumber(productName, cardNumber, localSet),
    ]),
  );
}

function stripSunMoonUnnumberedEnergySuffix(value, localSet) {
  if (localSet.provider_id !== "sm1") return "";

  return normalizeCardName(value).replace(/\s+2017\s+unnumbered$/, "").trim();
}

function stripTrailingCardNumber(value, cardNumber, localSet) {
  const normalizedName = normalizeCardName(value);
  const normalizedNumbers = getCardNumberTextCandidates(cardNumber, localSet);

  return normalizedNumbers.reduce((currentName, normalizedNumber) => {
    if (!normalizedNumber) return currentName;

    const numberPattern = escapeRegExp(normalizedNumber);

    return currentName
      .replace(new RegExp(`\\s+${numberPattern}(?:\\s+\\d+)?(?:\\s+.*)?$`), "")
      .trim();
  }, normalizedName);
}

function getCardNumberTextCandidates(cardNumber, localSet) {
  const rawNumber = String(cardNumber ?? "").split("/")[0].toLowerCase().trim();

  return uniqueStrings([normalizeCardNumber(cardNumber), normalizeCardNumberForSet(cardNumber, localSet), rawNumber]);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasOtherSplitSetMarker(productName, localSetName) {
  const localSetNormalized = normalizeCardName(localSetName);
  const productMarkers = getParentheticalParts(productName).flatMap((part) => {
    const normalizedPart = normalizeCardName(part);

    return SPLIT_SET_MARKERS.filter((marker) => normalizedPart.includes(marker));
  });

  return productMarkers.length > 0 && productMarkers.every((marker) => !localSetNormalized.includes(marker));
}

function getParentheticalParts(value) {
  return Array.from(String(value ?? "").matchAll(/\(([^)]*)\)/g), (match) => match[1]);
}

async function resetSourceRows() {
  const deletedCurrentPrices = await sql`
    delete from current_prices
    where source = ${SOURCE}
    returning id
  `;
  const deletedPriceSeries = await sql`
    delete from price_series
    where source = ${SOURCE}
    returning card_variant_id
  `;

  console.log(
    `Removed ${deletedCurrentPrices.length.toLocaleString()} current price rows and ${deletedPriceSeries.length.toLocaleString()} compressed price series for source ${SOURCE}.`,
  );
}

async function getLatestCurrentPriceObservedAt() {
  const [row] = await sql`
    select max(observed_at) as observed_at
    from current_prices
    where source = ${SOURCE}
  `;

  return row?.observed_at ? new Date(row.observed_at) : null;
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
    .sort(compareTcgcsvGroupsByPublishedOn);

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
      and condition = 'unspecified'
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
  let priceSeriesChangesAppended = 0;

  for (const batch of chunk(dedupePriceRecords(priceRecords), WRITE_BATCH_SIZE)) {
    const changedSeriesRows = await filterChangedCurrentPriceRows(batch);
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

    if (changedSeriesRows.length > 0) await appendPriceSeriesChanges(changedSeriesRows);

    currentPricesUpserted += currentRows.length;
    priceSeriesChangesAppended += changedSeriesRows.length;
  }

  return { currentPricesUpserted, priceSeriesChangesAppended };
}

async function writeTcgplayerProductRefs(priceInputs, variantIdsByCardPrinting) {
  const rows = priceInputs.flatMap((input) => {
    const variantIds = variantIdsByCardPrinting.get(getCardPrintingKey(input.cardId, input.printing)) ?? [];

    return variantIds.flatMap((cardVariantId) =>
      input.productIds.map((productId) => ({
        card_variant_id: cardVariantId,
        source: "tcgplayer",
        ref_type: "product_id",
        ref_value: productId,
        metadata: { url: `https://www.tcgplayer.com/product/${productId}/-?Language=English` },
        updated_at: new Date(),
      })),
    );
  });

  for (const batch of chunk(rows, WRITE_BATCH_SIZE)) {
    await sql`
      insert into card_variant_external_refs ${sql(
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

async function filterChangedCurrentPriceRows(rows) {
  const uniqueVariantIds = Array.from(new Set(rows.map((row) => row.card_variant_id)));
  const uniqueSources = Array.from(new Set(rows.map((row) => row.source)));
  const uniquePriceTypes = Array.from(new Set(rows.map((row) => row.price_type)));
  const uniqueCurrencies = Array.from(new Set(rows.map((row) => row.currency)));
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
    from current_prices
    where card_variant_id in ${sql(uniqueVariantIds)}
      and source in ${sql(uniqueSources)}
      and price_type in ${sql(uniquePriceTypes)}
      and currency in ${sql(uniqueCurrencies)}
  `;

  for (const row of latestRows) {
    latestAmountsByKey.set(getPriceIdentityKey(row), Number(row.amount_minor));
  }

  return rows.filter((row) => latestAmountsByKey.get(getPriceIdentityKey(row)) !== row.amount_minor);
}

async function appendPriceSeriesChanges(rows) {
  const seriesRows = rows.map((row) => ({
    card_variant_id: row.card_variant_id,
    source: row.source,
    price_type: row.price_type,
    currency: row.currency,
    observed_on: [row.observed_at.toISOString().slice(0, 10)],
    amounts_minor: [row.amount_minor],
    updated_at: new Date(),
  }));

  await sql`
    insert into price_series ${sql(
      seriesRows,
      "card_variant_id",
      "source",
      "price_type",
      "currency",
      "observed_on",
      "amounts_minor",
      "updated_at",
    )}
    on conflict (card_variant_id, source, price_type, currency) do update set
      observed_on = case
        when cardinality(price_series.observed_on) = 0
          then excluded.observed_on
        when price_series.observed_on[cardinality(price_series.observed_on)] < excluded.observed_on[1]
          then price_series.observed_on || excluded.observed_on
        else price_series.observed_on
      end,
      amounts_minor = case
        when cardinality(price_series.observed_on) = 0
          then excluded.amounts_minor
        when price_series.observed_on[cardinality(price_series.observed_on)] < excluded.observed_on[1]
          then price_series.amounts_minor || excluded.amounts_minor
        when price_series.observed_on[cardinality(price_series.observed_on)] = excluded.observed_on[1]
          then trim_array(price_series.amounts_minor, 1) || excluded.amounts_minor
        else price_series.amounts_minor
      end,
      updated_at = excluded.updated_at
  `;
}

function getPriceIdentityKey(row) {
  return `${row.card_variant_id}:${row.source}:${row.price_type}:${row.currency}`;
}

function buildLocalSetMatchers(localSets) {
  return localSets.map((set) => ({
    set,
    normalizedName: normalizeSetName(set.name),
    releaseDate: set.release_date ? new Date(set.release_date).toISOString().slice(0, 10) : null,
  }));
}

function findLocalSetsForGroup(group, setMatchers) {
  const normalizedGroupName = normalizeSetName(group.name);
  const groupCoreName = normalizeSetName(getGroupCoreName(group.name));
  const groupReleaseDate = group.publishedOn ? new Date(group.publishedOn).toISOString().slice(0, 10) : null;
  const exactMatch = setMatchers.find(
    (candidate) =>
      candidate.normalizedName === normalizedGroupName ||
      candidate.normalizedName === groupCoreName,
  )?.set;
  const aliasMatches = findAliasedLocalSets([normalizedGroupName, groupCoreName], setMatchers);

  if (exactMatch) return [exactMatch];
  if (aliasMatches.length > 0) return aliasMatches;
  if (isSupplementalGroupName(group.name)) return [];

  const fallbackMatch =
    setMatchers.find(
      (candidate) =>
        groupReleaseDate &&
        candidate.releaseDate === groupReleaseDate &&
        candidate.normalizedName.length > 0 &&
        groupCoreName.length > 0 &&
        (candidate.normalizedName.includes(groupCoreName) ||
          groupCoreName.includes(candidate.normalizedName)),
    )?.set ?? null;

  return fallbackMatch ? [fallbackMatch] : [];
}

function findAliasedLocalSets(groupNames, setMatchers) {
  for (const groupName of groupNames) {
    const aliasedSetNames = SET_NAME_ALIASES.get(groupName);

    if (!aliasedSetNames) continue;

    const aliasedSets = aliasedSetNames.flatMap((aliasedSetName) => {
      const aliasedSet = setMatchers.find((candidate) => candidate.normalizedName === aliasedSetName)?.set;

      return aliasedSet ? [aliasedSet] : [];
    });

    if (aliasedSets.length > 0) return aliasedSets;
  }

  return [];
}

function getAllowedCardNumbers(group, localSet) {
  return GROUP_SET_CARD_NUMBER_ALLOWLIST.get(getGroupSetKey(group.name, localSet.name)) ?? null;
}

function getGroupSetKey(groupName, setName) {
  return `${normalizeSetName(groupName)}:${normalizeSetName(setName)}`;
}

function getGroupCoreName(value) {
  return value.includes(":") ? value.split(":").slice(1).join(":") : value;
}

function normalizeSetName(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
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
  return Boolean(getExtendedDataValue(product, "Number")) || isSunMoonUnnumberedEnergyProduct(product);
}

function isSunMoonUnnumberedEnergyProduct(product) {
  const rawName = String(product.name ?? "").toLowerCase();

  return rawName.includes("energy") && rawName.includes("(2017 unnumbered)");
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
  const amount = price.marketPrice;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return [];

  return [{ priceType: "market", amountMinor: Math.round(amount * 100) }];
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
    .toLowerCase()
    .replace(/^0+(?=\d)/, "")
    .replace(/^([a-z]+)0+(?=\d)/, "$1")
    .trim();
}

function getCardNumberAndNameKey(number, name, localSet = null) {
  return `${normalizeCardNumberForSet(number, localSet)}:${normalizeCardName(name)}`;
}

function normalizeCardNumberForSet(value, localSet) {
  const normalizedNumber = normalizeCardNumber(value);

  if (localSet?.provider_id === "ecard2") {
    return normalizedNumber.replace(/^(\d+)[ab]$/, "$1");
  }

  if (localSet?.provider_id === "svp") {
    return normalizedNumber.replace(/^svp\s*(?=\d)/, "");
  }

  return normalizedNumber;
}

function getDuplicateCardNumbers(cards) {
  const countsByNumber = new Map();

  for (const card of cards) {
    const number = normalizeCardNumber(card.number);
    countsByNumber.set(number, (countsByNumber.get(number) ?? 0) + 1);
  }

  return new Set([...countsByNumber].filter(([, count]) => count > 1).map(([number]) => number));
}

function normalizeCardName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/\bpokemon\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
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
      await throttleTcgcsvRequest();
      const response = await fetch(url, {
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

    if (attempt > options.maxRetries) break;

    const delayMs = Math.min(15_000, 500 * 2 ** (attempt - 1));
    console.warn(`Retrying ${path} after ${delayMs}ms (${attempt}/${options.maxRetries}).`);
    await sleep(delayMs);
  }

  throw lastError ?? new Error(`TCGCSV request failed for ${path}.`);
}

async function throttleTcgcsvRequest() {
  if (options.pageDelayMs <= 0) return;

  const elapsedMs = Date.now() - lastTcgcsvRequestAt;

  if (elapsedMs < options.pageDelayMs) {
    await sleep(options.pageDelayMs - elapsedMs);
  }

  lastTcgcsvRequestAt = Date.now();
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
