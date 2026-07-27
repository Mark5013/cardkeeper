import nextEnv from "@next/env";
import postgres from "postgres";

import {
  doesTcgcsvProductNameMatchCard,
  getTcgcsvCollectorNumberEvidence,
  isSupplementalTcgcsvGroup,
  isReviewedPokemonFutsalProduct,
} from "./lib/tcgcsv-group-matching.mjs";
import { compareTcgcsvGroupsByPublishedOn } from "./lib/tcgcsv-history-core.mjs";
import {
  resolveTcgcsvPriceCandidates,
  resolveTcgcsvVariantProductIds,
} from "./lib/tcgcsv-price-mapping.mjs";
import {
  classifyReviewedTcgcsvQualifiedPrinting,
  getTcgcsvQualifiedPrintingSourcePrinting,
  REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS,
  reviewTcgcsvQualifiedPrintingRef,
} from "./lib/tcgcsv-qualified-printing.mjs";

const { loadEnvConfig } = nextEnv;

const TCGCSV_BASE_URL = "https://tcgcsv.com";
const POKEMON_CATEGORY_ID = 3;
const SOURCE = "tcgcsv";
const CURRENCY = "USD";
const DEFAULT_PAGE_DELAY_MS = 250;
const MINIMUM_PAGE_DELAY_MS = 250;
const DEFAULT_MAX_RETRIES = 4;
const WRITE_BATCH_SIZE = 500;
const USER_AGENT = process.env.TCGCSV_USER_AGENT ?? "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";
const SPLIT_SET_MARKERS = ["latias", "latios", "plusle", "minun"];
const REVIEWED_QUALIFIED_PRINTING_GROUP_IDS = new Set(
  Object.values(REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS).map(String),
);
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
    [
      "Battle Academy 2024",
      ["Scarlet & Violet Black Star Promos", "Scarlet & Violet Promos"],
    ],
    ["Best of Promos", ["Best of Game"]],
    ["Base Set", ["Base Set (Unlimited)"]],
    ["Deck Exclusives", ["Base Set (Shadowless)", "Base Set (Unlimited)"]],
    [
      "League & Championship Cards",
      [
        "Burning Shadows",
        "Celestial Storm",
        "Dragon Majesty",
        "Forbidden Light",
        "Guardians Rising",
        "Lost Thunder",
        "Roaring Skies",
        "Shining Legends",
        "Steam Siege",
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
    ["McDonald's 25th Anniversary Promos", ["McDonald's Collection 2021"]],
    ["McDonald's Promos 2022", ["McDonald's Collection 2022"]],
    ["Miscellaneous Cards & Products", ["Pokémon Futsal Collection"]],
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
    [
      "SV: Scarlet & Violet Promo Cards",
      ["Scarlet & Violet Black Star Promos", "Scarlet & Violet Promos"],
    ],
    [
      "Scarlet & Violet Promo Cards",
      ["Scarlet & Violet Black Star Promos", "Scarlet & Violet Promos"],
    ],
  ].map(([groupName, setNames]) => [
    normalizeSetName(groupName),
    (Array.isArray(setNames) ? setNames : [setNames]).map((setName) => normalizeSetName(setName)),
  ]),
);
const GROUP_SET_CARD_NUMBER_ALLOWLIST = new Map(
  [
    [
      "Battle Academy 2024",
      "Scarlet & Violet Black Star Promos",
      ["105", "106", "107", "108", "109", "110", "111", "112", "113", "114", "148"],
    ],
    ["Deck Exclusives", "Base Set (Shadowless)", ["8"]],
    ["Deck Exclusives", "Base Set (Unlimited)", ["8"]],
    ["Miscellaneous Cards & Products", "Pokémon Futsal Collection", ["1", "2", "3", "4", "5"]],
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
    groupIds: null,
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
      if (parsed.groupIds !== null) {
        throw new Error("Specify only one group ID selector.");
      }
      parsed.groupIds = [
        parsePositiveInteger(
          arg.slice("--group-id=".length),
          "group id",
        ),
      ];
    } else if (arg.startsWith("--group-ids=")) {
      if (parsed.groupIds !== null) {
        throw new Error("Specify only one group ID selector.");
      }
      parsed.groupIds = parsePositiveIntegerList(
        arg.slice("--group-ids=".length),
        "group IDs",
      );
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

  if (parsed.pageDelayMs < MINIMUM_PAGE_DELAY_MS) {
    throw new Error(
      `TCGCSV requests require at least ${MINIMUM_PAGE_DELAY_MS}ms spacing.`,
    );
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
  const values = value.split(",").map((entry) => entry.trim());
  const parsed = values.map((entry) =>
    parsePositiveInteger(entry, label),
  );

  if (
    parsed.length === 0 ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error(
      `Expected ${label} to be a non-empty list of distinct positive integers.`,
    );
  }

  return parsed;
}

async function refreshPrices() {
  const startedAt = Date.now();
  const observedAt = await getObservedAt();
  const initiallyInvalidatedCurrentPrices =
    await invalidateUntrustedCurrentPrices();

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
  const discoveredProductIdsByVariantId = new Map();
  const stats = {
    groupsChecked: 0,
    groupsMatched: 0,
    productsChecked: 0,
    productsMatched: 0,
    priceRowsPrepared: 0,
    currentPricesUpserted: 0,
    priceSeriesChangesAppended: 0,
    ambiguousProductMappings: 0,
    currentPricesInvalidated: initiallyInvalidatedCurrentPrices,
    staleProductRefsFound: 0,
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
      if (options.dryRun) {
        const productsPayload = await fetchTcgcsvJson(
          `/tcgplayer/${POKEMON_CATEGORY_ID}/${group.groupId}/products`,
        );
        const cardProducts = productsPayload.results.filter(isCardProduct);
        const reconciliation = await reconcileTcgplayerProductRefs({
          groupId: group.groupId,
          groupProducts: cardProducts,
          identityMatchedProductRefs: [],
          localSets: [],
        });

        stats.productsChecked += cardProducts.length;
        stats.staleProductRefsFound += reconciliation.staleRefCount;

        for (const issue of reconciliation.issues) {
          console.warn(
            `  mapping issue: product ${issue.productId} "${issue.productName}" -> ${issue.setName} ${issue.cardName} #${issue.cardNumber} (${issue.printing}); ${issue.reason}`,
          );
        }

        console.log(
          `Skipping ${group.name} (${group.groupId}): no local set match; audited ${cardProducts.length.toLocaleString()} card products and found ${reconciliation.staleRefCount.toLocaleString()} high-confidence stale refs.`,
        );

        if (options.pageDelayMs > 0) await sleep(options.pageDelayMs);
        continue;
      }

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
    const identityMatchedProductRefs = [];

    stats.productsChecked += cardProducts.length;

    for (const localSet of localSetsForGroup) {
      const setPriceRecords = await preparePriceRecordsForSet({
        cardProducts,
        group,
        localSet,
        observedAt,
        pricesByProductId,
        requireNameMatch: localSetsForGroup.length > 1,
        discoveredProductIdsByVariantId,
      });

      stats.productsMatched += setPriceRecords.productsMatched;
      stats.ambiguousProductMappings += setPriceRecords.ambiguousProductMappings;
      stats.currentPricesInvalidated +=
        setPriceRecords.currentPricesInvalidated;
      groupPriceRecords.push(...setPriceRecords.priceRecords);
      identityMatchedProductRefs.push(...setPriceRecords.identityMatchedProductRefs);
      groupMatches.push(
        `${localSet.name}: ${setPriceRecords.productsMatched.toLocaleString()} matched, ${setPriceRecords.priceRecords.length.toLocaleString()} observations${setPriceRecords.ambiguousProductMappings > 0 ? `, ${setPriceRecords.ambiguousProductMappings.toLocaleString()} ambiguous finish mappings skipped` : ""}`,
      );
    }

    stats.priceRowsPrepared += groupPriceRecords.length;

    const reconciliation = await reconcileTcgplayerProductRefs({
      groupId: group.groupId,
      groupProducts: cardProducts,
      identityMatchedProductRefs,
      localSets: localSetsForGroup,
      pricesByProductId,
    });
    stats.staleProductRefsFound += reconciliation.staleRefCount;

    if (reconciliation.staleRefCount > 0) {
      groupMatches.push(
        `found ${reconciliation.staleRefCount.toLocaleString()} high-confidence stale product refs`,
      );

      for (const issue of reconciliation.issues) {
        console.warn(
          `  mapping issue: product ${issue.productId} "${issue.productName}" -> ${issue.setName} ${issue.cardName} #${issue.cardNumber} (${issue.printing}); ${issue.reason}`,
        );
      }

      if (!options.dryRun) {
        const quarantine = await quarantineStaleTcgplayerRefs(
          reconciliation.issues,
        );
        stats.currentPricesInvalidated +=
          quarantine.currentPricesInvalidated;

        throw new Error(
          `Stopped the TCGCSV refresh after quarantining ${quarantine.refsQuarantined.toLocaleString()} high-confidence stale product refs. Run the mapping audit and prepare a reviewed repair before refreshing again.`,
        );
      }
    }

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
    `TCGCSV price refresh complete in ${elapsedSeconds}s. ${stats.groupsMatched}/${stats.groupsChecked} groups matched, ${stats.productsMatched}/${stats.productsChecked} products matched, ${stats.priceRowsPrepared.toLocaleString()} observations prepared, ${stats.ambiguousProductMappings.toLocaleString()} ambiguous finish mappings skipped, ${stats.currentPricesInvalidated.toLocaleString()} ambiguous current prices invalidated, ${stats.currentPricesUpserted.toLocaleString()} current prices upserted, ${stats.priceSeriesChangesAppended.toLocaleString()} compressed history changes appended, ${stats.staleProductRefsFound.toLocaleString()} high-confidence stale product refs found.`,
  );

  if (options.dryRun && stats.staleProductRefsFound > 0) {
    throw new Error(
      `TCGCSV mapping audit found ${stats.staleProductRefsFound.toLocaleString()} high-confidence stale product refs.`,
    );
  }
}

async function preparePriceRecordsForSet({
  cardProducts,
  group,
  localSet,
  observedAt,
  pricesByProductId,
  requireNameMatch,
  discoveredProductIdsByVariantId,
}) {
  const localCards = await getLocalCardsForSet(localSet.id);
  const allowedCardNumbers = getAllowedCardNumbers(group, localSet);
  const localCardsByNumber = groupLocalCardsByNumber(localCards, localSet);
  const amountsByCardPrinting = new Map();
  const priceRecords = [];
  const identityMatchedProductRefs = [];
  let productsMatched = 0;

  for (const product of cardProducts) {
    if (shouldSkipProductForSet(product, group, localSet)) continue;

    const cardNumber = getProductCardNumber(product, localSet);
    if (allowedCardNumbers && !allowedCardNumbers.has(normalizeCardNumber(cardNumber))) continue;

    if (requireNameMatch) {
      const collectorEvidence = getTcgcsvCollectorNumberEvidence({
        productName: product.name,
        productNumber: cardNumber,
      });
      const printedTotal = Number(
        localSet.printed_total ?? localSet.total,
      );

      if (
        collectorEvidence.hasConflict ||
        (collectorEvidence.denominator === null
          ? !allowedCardNumbers
          : !Number.isInteger(printedTotal) ||
            collectorEvidence.denominator !== printedTotal)
      ) {
        continue;
      }
    }

    const normalizedCardNumber = normalizeCardNumberForSet(cardNumber, localSet);
    const cardCandidates = cardNumber
      ? localCardsByNumber.get(normalizedCardNumber) ?? []
      : [];
    const localCard = getNameMatchedLocalCard(
      product,
      localSet,
      cardCandidates,
    );
    const productPrices = pricesByProductId.get(product.productId) ?? [];

    if (!localCard) continue;

    identityMatchedProductRefs.push({
      cardId: String(localCard.id),
      productId: String(product.productId),
    });

    if (productPrices.length === 0) continue;

    productsMatched += 1;

    for (const price of productPrices) {
      const amountRecords = getAmountRecords(price);
      const subTypeName = String(price.subTypeName ?? "").trim();
      const normalizedSubtype = normalizePrinting(subTypeName);
      const qualifiedPrinting =
        classifyReviewedTcgcsvQualifiedPrinting({
          groupId: group.groupId,
          productId: product.productId,
          productName: product.name,
        });

      if (!subTypeName && amountRecords.length === 0) continue;

      if (
        REVIEWED_QUALIFIED_PRINTING_GROUP_IDS.has(
          String(group.groupId),
        ) &&
        qualifiedPrinting.status === "unsupported"
      ) {
        throw new Error(
          `Unsupported physical-printing qualifier for TCGCSV group ${group.groupId}, product ${product.productId} "${product.name ?? ""}".`,
        );
      }

      if (
        qualifiedPrinting.status === "qualified" &&
        normalizedSubtype !==
          getTcgcsvQualifiedPrintingSourcePrinting(
            qualifiedPrinting.printing,
          )
      ) {
        throw new Error(
          `Expected qualified TCGCSV product ${product.productId} "${product.name ?? ""}" to use ${getTcgcsvQualifiedPrintingSourcePrinting(qualifiedPrinting.printing)}, received "${subTypeName}".`,
        );
      }

      mergeAmountRecordsByCardPrinting(amountsByCardPrinting, {
        cardId: localCard.id,
        printing:
          qualifiedPrinting.status === "qualified"
            ? qualifiedPrinting.printing
            : normalizedSubtype,
        amountRecords,
        productIds: [String(product.productId)],
        productMetadata: {
          tcgcsvGroupId: group.groupId,
          tcgcsvProductName: String(product.name ?? ""),
          tcgcsvProductQualifier:
            qualifiedPrinting.status === "qualified"
              ? qualifiedPrinting.qualifier
              : null,
          tcgcsvSubTypeName: subTypeName,
        },
      });
    }
  }

  const mappingInputs = Array.from(amountsByCardPrinting.values());
  const variantIdsByCardPrinting = await getVariantIdsByCardPrinting(
    mappingInputs,
    options.dryRun,
  );
  const existingProductIdsByVariantId =
    await getTcgplayerProductIdsByVariantId(variantIdsByCardPrinting);
  const trustedVariantIdsByCardPrinting = new Map();
  const ambiguousVariantIds = new Set();
  let ambiguousProductMappings = 0;

  if (!options.dryRun) {
    await writeTcgplayerProductRefs(
      mappingInputs,
      variantIdsByCardPrinting,
    );
  }

  for (const priceInput of mappingInputs) {
    const key = getCardPrintingKey(
      priceInput.cardId,
      priceInput.printing,
    );
    const variantIds =
      variantIdsByCardPrinting.get(key) ?? [];
    let inputIsAmbiguous = priceInput.ambiguous;

    for (const cardVariantId of variantIds) {
      const variantId = String(cardVariantId);
      const productIdentity = resolveTcgcsvVariantProductIds({
        candidateProductIds: priceInput.productIds,
        existingProductIds: [
          ...(existingProductIdsByVariantId.get(variantId) ?? []),
          ...(discoveredProductIdsByVariantId.get(variantId) ?? []),
        ],
      });
      discoveredProductIdsByVariantId.set(
        variantId,
        new Set(productIdentity.productIds),
      );

      if (productIdentity.ambiguous) {
        inputIsAmbiguous = true;
        if (!variantId.startsWith("dry-run:")) {
          ambiguousVariantIds.add(variantId);
        }
        continue;
      }

      const trustedVariantIds =
        trustedVariantIdsByCardPrinting.get(key) ?? [];
      trustedVariantIds.push(cardVariantId);
      trustedVariantIdsByCardPrinting.set(key, trustedVariantIds);
    }

    if (inputIsAmbiguous) {
      ambiguousProductMappings += 1;
      trustedVariantIdsByCardPrinting.delete(key);
      continue;
    }

    for (const cardVariantId of
      trustedVariantIdsByCardPrinting.get(key) ?? []) {
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
  const currentPricesInvalidated = options.dryRun
    ? 0
    : await deleteTcgcsvCurrentPricesForVariantIds(ambiguousVariantIds);

  return {
    ambiguousProductMappings,
    currentPricesInvalidated,
    identityMatchedProductRefs,
    priceRecords,
    productsMatched,
  };
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
    groupName === normalizeSetName("Miscellaneous Cards & Products") &&
    localSetName === normalizeSetName("Pokémon Futsal Collection")
  ) {
    return !isReviewedPokemonFutsalProduct({
      productName: product.name,
      productNumber: getExtendedDataValue(product, "Number"),
    });
  }

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

  if (groupName === normalizeSetName("Deck Exclusives") && cardNumber === "8") {
    if (localSetName === normalizeSetName("Base Set (Shadowless)")) {
      return product.productId !== 107004;
    }

    if (localSetName === normalizeSetName("Base Set (Unlimited)")) {
      return product.productId !== 42425;
    }
  }

  return false;
}

function mergeAmountRecordsByCardPrinting(amountsByCardPrinting, priceInput) {
  const key = getCardPrintingKey(priceInput.cardId, priceInput.printing);
  const existingInput = amountsByCardPrinting.get(key);
  const candidates = [
    ...(existingInput?.candidates ?? []),
    ...priceInput.productIds.map((productId) => ({
      amountRecords: priceInput.amountRecords,
      metadata: priceInput.productMetadata,
      productId,
    })),
  ];
  const resolved = resolveTcgcsvPriceCandidates(candidates);

  amountsByCardPrinting.set(key, {
    cardId: priceInput.cardId,
    printing: priceInput.printing,
    candidates,
    ...resolved,
  });
}

function getNameMatchedLocalCard(product, localSet, localCards) {
  if (hasOtherSplitSetMarker(product.name, localSet.name)) return null;

  const matches = localCards.filter((card) =>
    doesTcgcsvProductNameMatchCard({
      cardName: card.name,
      productCleanName: product.cleanName,
      productName: product.name,
    }),
  );

  return matches.length === 1 ? matches[0] : null;
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

  if (options.groupIds !== null) {
    const selectedGroupIds = new Set(options.groupIds);
    groups = groups.filter((group) =>
      selectedGroupIds.has(group.groupId),
    );
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
    select id, provider_id, name, release_date, printed_total, total
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

      if (variantIds.size === 0) {
        variantIds.add(
          `dry-run:${input.cardId}:${input.printing}:unspecified`,
        );
      }

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

async function getTcgplayerProductIdsByVariantId(
  variantIdsByCardPrinting,
) {
  const variantIds = [
    ...new Set(
      Array.from(variantIdsByCardPrinting.values())
        .flat()
        .map(String)
        .filter((variantId) => !variantId.startsWith("dry-run:")),
    ),
  ];
  const productIdsByVariantId = new Map();

  if (variantIds.length === 0) return productIdsByVariantId;

  const rows = await sql`
    select card_variant_id, ref_value, metadata
    from card_variant_external_refs
    where card_variant_id in ${sql(variantIds)}
      and source = 'tcgplayer'
      and ref_type = 'product_id'
  `;

  for (const row of rows) {
    const variantId = String(row.card_variant_id);
    const productIds =
      productIdsByVariantId.get(variantId) ?? new Set();
    productIds.add(String(row.ref_value));

    if (row.metadata?.tcgcsvMappingStatus === "stale") {
      productIds.add(`stale-ref:${row.ref_value}`);
    }

    productIdsByVariantId.set(variantId, productIds);
  }

  return productIdsByVariantId;
}

async function invalidateUntrustedCurrentPrices() {
  const untrustedPriceFilter = sql`
    prices.source = ${SOURCE}
    and (
      (
        select count(distinct refs.ref_value)
        from card_variant_external_refs as refs
        where refs.card_variant_id = prices.card_variant_id
          and refs.source = 'tcgplayer'
          and refs.ref_type = 'product_id'
          and refs.ref_value ~ '^[1-9][0-9]{0,14}$'
          and coalesce(
            refs.metadata ->> 'tcgcsvMappingStatus',
            ''
          ) <> 'stale'
      ) <> 1
      or exists (
        select 1
        from card_variant_external_refs as invalid_ref
        where invalid_ref.card_variant_id = prices.card_variant_id
          and invalid_ref.source = 'tcgplayer'
          and invalid_ref.ref_type = 'product_id'
          and (
            invalid_ref.ref_value !~ '^[1-9][0-9]{0,14}$'
            or invalid_ref.metadata ->> 'tcgcsvMappingStatus' = 'stale'
          )
      )
    )
  `;
  const count = options.dryRun
    ? Number(
        (
          await sql`
            select count(*)::integer as count
            from current_prices as prices
            where ${untrustedPriceFilter}
          `
        )[0]?.count ?? 0,
      )
    : (
        await sql`
          delete from current_prices as prices
          where ${untrustedPriceFilter}
          returning id
        `
      ).length;

  if (count > 0) {
    console.log(
      `${options.dryRun ? "Dry run: would invalidate" : "Invalidated"} ${count.toLocaleString()} TCGCSV current-price rows without exactly one valid TCGplayer product ref.`,
    );
  }

  return count;
}

async function deleteTcgcsvCurrentPricesForVariantIds(variantIds) {
  if (variantIds.size === 0) return 0;

  const rows = await sql`
    delete from current_prices
    where source = ${SOURCE}
      and card_variant_id in ${sql([...variantIds])}
    returning id
  `;

  return rows.length;
}

async function quarantineStaleTcgplayerRefs(issues) {
  const issuesByRefId = new Map(
    issues.map((issue) => [String(issue.refId), issue]),
  );
  const variantIds = new Set(
    issues.map((issue) => String(issue.cardVariantId)),
  );
  const quarantinedAt = new Date().toISOString();

  return sql.begin(async (transaction) => {
    let refsQuarantined = 0;

    for (const [refId, issue] of issuesByRefId) {
      const rows = await transaction`
        update card_variant_external_refs
        set
          metadata =
            coalesce(metadata, '{}'::jsonb) ||
            jsonb_build_object(
              'tcgcsvMappingStatus',
              'stale',
              'tcgcsvMappingReason',
              ${issue.reason},
              'tcgcsvMappingQuarantinedAt',
              ${quarantinedAt}
            ),
          updated_at = now()
        where id = ${refId}
          and source = 'tcgplayer'
          and ref_type = 'product_id'
        returning id
      `;
      refsQuarantined += rows.length;
    }

    if (refsQuarantined !== issuesByRefId.size) {
      throw new Error(
        `Expected to quarantine ${issuesByRefId.size} stale refs, updated ${refsQuarantined}.`,
      );
    }

    const deletedCurrentPrices = await transaction`
      delete from current_prices
      where source = ${SOURCE}
        and card_variant_id in ${transaction([...variantIds])}
      returning id
    `;

    return {
      currentPricesInvalidated: deletedCurrentPrices.length,
      refsQuarantined,
    };
  });
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
    const productRefs = new Map(
      input.candidates.map((candidate) => [
        candidate.productId,
        candidate,
      ]),
    );

    return variantIds.flatMap((cardVariantId) =>
      [...productRefs.values()].map((productRef) => ({
        card_variant_id: cardVariantId,
        source: "tcgplayer",
        ref_type: "product_id",
        ref_value: productRef.productId,
        metadata: {
          ...productRef.metadata,
          url: `https://www.tcgplayer.com/product/${productRef.productId}/-?Language=English`,
        },
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
        metadata =
          coalesce(card_variant_external_refs.metadata, '{}'::jsonb) ||
          excluded.metadata,
        updated_at = excluded.updated_at
    `;
  }
}

async function reconcileTcgplayerProductRefs({
  groupId,
  groupProducts,
  identityMatchedProductRefs,
  localSets,
  pricesByProductId = new Map(),
}) {
  const groupProductIds = groupProducts.map((product) =>
    String(product.productId),
  );

  if (groupProductIds.length === 0) {
    return {
      issues: [],
      staleRefCount: 0,
    };
  }

  const expectedCardIdsByProductId = new Map();
  for (const mapping of identityMatchedProductRefs) {
    const cardIds =
      expectedCardIdsByProductId.get(mapping.productId) ?? new Set();
    cardIds.add(mapping.cardId);
    expectedCardIdsByProductId.set(mapping.productId, cardIds);
  }
  const productsById = new Map(
    groupProducts.map((product) => [String(product.productId), product]),
  );
  const existingRefs = await sql`
    select
      external_ref.id,
      external_ref.card_variant_id,
      external_ref.ref_value,
      variant.printing,
      card.id as card_id,
      card.name as card_name,
      card.number as card_number,
      card_set.name as set_name,
      card_set.provider_id as set_provider_id,
      card_set.printed_total,
      card_set.total
    from card_variant_external_refs as external_ref
    inner join card_variants as variant on variant.id = external_ref.card_variant_id
    inner join cards as card on card.id = variant.card_id
    inner join card_sets as card_set on card_set.id = card.set_id
    where external_ref.source = 'tcgplayer'
      and external_ref.ref_type = 'product_id'
      and external_ref.ref_value in ${sql(groupProductIds)}
  `;
  const issues = existingRefs.flatMap((ref) => {
    const productId = String(ref.ref_value);
    const product = productsById.get(productId);

    if (!product) return [];

    const productNumber = getExtendedDataValue(product, "Number");
    const productPrintings = new Set(
      (
        pricesByProductId.get(product.productId) ??
        pricesByProductId.get(productId) ??
        []
      ).map((price) => normalizePrinting(price.subTypeName)),
    );
    const qualifiedPrintingReview =
      reviewTcgcsvQualifiedPrintingRef({
        groupId,
        normalizedSubtypes: [...productPrintings],
        printing: ref.printing,
        productId,
        productName: product.name,
      });
    const nameMatches = doesTcgcsvProductNameMatchCard({
      cardName: ref.card_name,
      productCleanName: product.cleanName,
      productName: product.name,
    });
    let reason = null;

    if (!nameMatches) {
      reason = "product name identifies a different card";
    } else if (
      productNumber &&
      normalizeCardNumberForSet(productNumber, {
        provider_id: ref.set_provider_id,
      }) !==
        normalizeCardNumberForSet(ref.card_number, {
          provider_id: ref.set_provider_id,
        })
    ) {
      reason = "collector number identifies a different card";
    } else if (qualifiedPrintingReview.reason) {
      reason = qualifiedPrintingReview.reason;
    } else if (
      qualifiedPrintingReview.classification.status !== "qualified" &&
      productPrintings.size > 1 &&
      !productPrintings.has(ref.printing)
    ) {
      reason = "product prices identify a different finish";
    } else if (localSets.length > 1) {
      const evidence = getTcgcsvCollectorNumberEvidence({
        productName: product.name,
        productNumber,
      });
      const setPrintedTotal = Number(ref.printed_total ?? ref.total);

      if (
        !evidence.hasConflict &&
        evidence.denominator !== null &&
        Number.isInteger(setPrintedTotal) &&
        evidence.denominator !== setPrintedTotal
      ) {
        reason = `collector denominator ${evidence.denominator} does not match set printed total ${setPrintedTotal}`;
      }
    }

    const expectedCardIds = expectedCardIdsByProductId.get(productId);
    if (
      !reason &&
      expectedCardIds?.size === 1 &&
      !expectedCardIds.has(String(ref.card_id))
    ) {
      reason = "the unique identity match points to a different local card";
    }

    return reason
      ? [
          {
            cardName: ref.card_name,
            cardNumber: ref.card_number,
            cardVariantId: String(ref.card_variant_id),
            printing: ref.printing,
            productId,
            productName: String(product.name ?? ""),
            reason,
            refId: String(ref.id),
            setName: ref.set_name,
          },
        ]
      : [];
  });
  return {
    issues,
    staleRefCount: issues.length,
  };
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
    .trim()
    .replace(/^ex\s+/, "");
}

function isSupplementalGroupName(value) {
  return isSupplementalTcgcsvGroup(value);
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

function groupLocalCardsByNumber(localCards, localSet) {
  const cardsByNumber = new Map();

  for (const card of localCards) {
    const cardNumber = normalizeCardNumberForSet(card.number, localSet);
    const candidates = cardsByNumber.get(cardNumber) ?? [];
    candidates.push(card);
    cardsByNumber.set(cardNumber, candidates);
  }

  return cardsByNumber;
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
