import nextEnv from "@next/env";
import postgres from "postgres";

import {
  doesTcgcsvProductNameMatchCard,
  getTcgcsvCollectorNumberEvidence,
  normalizeTcgcsvCollectorNumber,
} from "./lib/tcgcsv-group-matching.mjs";
import {
  classifyReviewedTcgcsvQualifiedPrinting,
  REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS,
  TCGCSV_QUALIFIED_PRINTING_KEYS,
} from "./lib/tcgcsv-qualified-printing.mjs";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const TCGCSV_BASE_URL = "https://tcgcsv.com";
const TCGCSV_CATEGORY_ID = 3;
const REQUEST_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const SOURCE_PRINTING = "holofoil";
const REVIEWED_AT = "2026-07-25";
const REPAIR_ID = "modern-set-qualified-printings-v1";
const USER_AGENT =
  process.env.TCGCSV_USER_AGENT?.trim() ||
  "Cardkeeper/0.1.0 (+https://github.com/Mark5013/cardkeeper)";
const options = parseArgs(process.argv.slice(2));

const TARGET_SETS = Object.freeze([
  {
    providerId: "sv8pt5",
    name: "Prismatic Evolutions",
    groupId:
      REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS,
    activeCardCount: 180,
    printedTotal: 131,
    expectedQualifiedCounts: {
      [TCGCSV_QUALIFIED_PRINTING_KEYS.POKE_BALL]: 100,
      [TCGCSV_QUALIFIED_PRINTING_KEYS.MASTER_BALL]: 67,
      [TCGCSV_QUALIFIED_PRINTING_KEYS.HOLIDAY_CALENDAR]: 1,
    },
    expectedMissingQualifiedProductIds: [],
  },
  {
    providerId: "zsv10pt5",
    name: "Black Bolt",
    groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.BLACK_BOLT,
    activeCardCount: 172,
    printedTotal: 86,
    expectedQualifiedCounts: {
      [TCGCSV_QUALIFIED_PRINTING_KEYS.POKE_BALL]: 80,
      [TCGCSV_QUALIFIED_PRINTING_KEYS.MASTER_BALL]: 72,
    },
    expectedMissingQualifiedProductIds: ["644864"],
  },
  {
    providerId: "rsv10pt5",
    name: "White Flare",
    groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.WHITE_FLARE,
    activeCardCount: 173,
    printedTotal: 86,
    expectedQualifiedCounts: {
      [TCGCSV_QUALIFIED_PRINTING_KEYS.POKE_BALL]: 80,
      [TCGCSV_QUALIFIED_PRINTING_KEYS.MASTER_BALL]: 72,
    },
    expectedMissingQualifiedProductIds: [],
  },
]);

const ANTIQUE_COVER_FOSSIL_CORRECTION = Object.freeze({
  setProviderId: "zsv10pt5",
  cardProviderId: "zsv10pt5-80",
  cardName: "Antique Cover Fossil",
  oldNumber: "60",
  newNumber: "80",
});

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required to repair modern-set printings.",
  );
}

assertIdentifiableUserAgent(USER_AGENT);

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

try {
  const reviewedProducts = await fetchReviewedQualifiedProducts();
  const plan = await buildRepairPlan(sql, reviewedProducts);

  printPlan(plan);

  if (!options.apply) {
    console.log(
      "Dry run complete. Re-run with --apply to execute this exact reviewed repair transaction.",
    );
  } else {
    await applyRepair(reviewedProducts);
  }
} finally {
  await sql.end();
}

function parseArgs(args) {
  const parsed = { apply: false };

  for (const arg of args) {
    if (arg === "--apply") parsed.apply = true;
    else if (arg !== "--dry-run") throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function assertIdentifiableUserAgent(value) {
  if (
    value.length < 12 ||
    !/[A-Za-z]/.test(value) ||
    !/[/(]/.test(value)
  ) {
    throw new Error(
      "TCGCSV_USER_AGENT must identify this application. Example: Cardkeeper/0.1 (+https://example.com/contact).",
    );
  }
}

async function fetchReviewedQualifiedProducts() {
  const reviewedProducts = [];
  const feedAudits = [];
  let lastRequestStartedAt = 0;

  for (const targetSet of TARGET_SETS) {
    const waitMs = Math.max(
      0,
      lastRequestStartedAt + REQUEST_DELAY_MS - Date.now(),
    );

    if (waitMs > 0) await sleep(waitMs);
    lastRequestStartedAt = Date.now();

    const path = `/tcgplayer/${TCGCSV_CATEGORY_ID}/${targetSet.groupId}/products`;
    const response = await fetch(`${TCGCSV_BASE_URL}${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `TCGCSV product request for group ${targetSet.groupId} failed with HTTP ${response.status}. No database rows were changed.`,
      );
    }

    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error(
        `TCGCSV product response for group ${targetSet.groupId} exceeded ${MAX_RESPONSE_BYTES} bytes.`,
      );
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error(
        `TCGCSV product response for group ${targetSet.groupId} was not valid JSON.`,
      );
    }

    if (!payload || !Array.isArray(payload.results)) {
      throw new Error(
        `TCGCSV product response for group ${targetSet.groupId} did not contain a results array.`,
      );
    }

    const seenProductIds = new Set();
    const unsupported = [];
    const qualified = [];

    for (const product of payload.results) {
      const productId = normalizeProductId(product?.productId);
      if (!productId || seenProductIds.has(productId)) {
        throw new Error(
          `TCGCSV group ${targetSet.groupId} contains a missing or duplicate product id.`,
        );
      }
      seenProductIds.add(productId);

      if (
        product.groupId !== undefined &&
        Number(product.groupId) !== targetSet.groupId
      ) {
        throw new Error(
          `TCGCSV product ${productId} reports unexpected group ${product.groupId}; expected ${targetSet.groupId}.`,
        );
      }

      // These set feeds also contain sealed products. This repair is scoped
      // only to cards carrying the official collector-number field.
      if (!getExtendedDataValue(product, "Number")) continue;

      const classification =
        classifyReviewedTcgcsvQualifiedPrinting({
          groupId: targetSet.groupId,
          productName: product.name,
        });

      if (classification.status === "unsupported") {
        unsupported.push({
          productId,
          productName: String(product.name ?? ""),
          qualifier: classification.qualifier,
        });
      } else if (classification.status === "qualified") {
        qualified.push({
          targetSet,
          product: {
            ...product,
            productId,
          },
          productId,
          printing: classification.printing,
          qualifier: classification.qualifier,
        });
      }
    }

    feedAudits.push({ qualified, targetSet, unsupported });
    reviewedProducts.push(...qualified);

    const qualifiedCounts = [...countBy(
      qualified,
      (entry) => entry.printing,
    ).entries()]
      .sort()
      .map(([printing, count]) => `${printing}=${count}`)
      .join(", ");
    console.log(
      `Reviewed TCGCSV group ${targetSet.groupId} (${targetSet.name}): ${payload.results.length} products, ${qualified.length} explicitly qualified products (${qualifiedCounts}).`,
    );
  }

  for (const { qualified, targetSet, unsupported } of feedAudits) {
    if (unsupported.length > 0) {
      const examples = unsupported
        .slice(0, 5)
        .map(
          (product) =>
            `${product.productId} "${product.productName}" (${product.qualifier ?? "unknown qualifier"})`,
        )
        .join("; ");
      throw new Error(
        `TCGCSV group ${targetSet.groupId} contains ${unsupported.length} unreviewed physical-printing qualifier(s): ${examples}. No database rows were changed.`,
      );
    }

    assertExpectedQualifiedCounts(targetSet, qualified);
  }

  const productIds = reviewedProducts.map((entry) => entry.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw new Error(
      "A qualified TCGplayer product id occurred in more than one reviewed group.",
    );
  }

  return reviewedProducts;
}

function assertExpectedQualifiedCounts(targetSet, qualified) {
  const actualCounts = countBy(
    qualified,
    (entry) => entry.printing,
  );
  const expectedPrintings = Object.keys(
    targetSet.expectedQualifiedCounts,
  ).sort();
  const actualPrintings = [...actualCounts.keys()].sort();

  if (
    expectedPrintings.length !== actualPrintings.length ||
    expectedPrintings.some(
      (printing, index) => printing !== actualPrintings[index],
    )
  ) {
    throw new Error(
      `Qualified printing types drifted for ${targetSet.name}: expected ${expectedPrintings.join(", ")}, found ${actualPrintings.join(", ")}.`,
    );
  }

  for (const [
    printing,
    expectedCount,
  ] of Object.entries(targetSet.expectedQualifiedCounts)) {
    const actualCount = actualCounts.get(printing) ?? 0;
    if (actualCount !== expectedCount) {
      throw new Error(
        `${targetSet.name} ${printing} count drifted: expected ${expectedCount}, found ${actualCount}. No database rows were changed.`,
      );
    }
  }
}

async function buildRepairPlan(db, reviewedProducts) {
  const setProviderIds = TARGET_SETS.map((targetSet) =>
    targetSet.providerId
  );
  const sets = await db`
    select id, provider_id, name, printed_total, total
    from card_sets
    where provider_id in ${db(setProviderIds)}
      and language_code = 'en'
  `;
  const setsByProviderId = new Map(
    sets.map((set) => [String(set.provider_id), set]),
  );

  if (sets.length !== TARGET_SETS.length) {
    throw new Error(
      `Expected exactly ${TARGET_SETS.length} reviewed English sets, found ${sets.length}.`,
    );
  }

  for (const targetSet of TARGET_SETS) {
    const set = setsByProviderId.get(targetSet.providerId);
    if (
      !set ||
      set.name !== targetSet.name ||
      Number(set.printed_total) !== targetSet.printedTotal
    ) {
      throw new Error(
        `Local set identity drifted for ${targetSet.providerId}; expected ${targetSet.name} with printed total ${targetSet.printedTotal}.`,
      );
    }
  }

  const setIds = sets.map((set) => String(set.id));
  const cards = await db`
    select
      id,
      provider_id,
      set_id,
      name,
      number,
      provider_data,
      is_active
    from cards
    where set_id in ${db(setIds)}
      and language_code = 'en'
  `;
  const cardsBySetId = groupBy(cards, (card) => String(card.set_id));
  const correction = validateNumberCorrection({
    cards,
    setsByProviderId,
  });
  const virtuallyCorrectedCards = cards.map((card) =>
    String(card.id) === correction.cardId
      ? { ...card, number: correction.newNumber }
      : card
  );
  const correctedCardsBySetId = groupBy(
    virtuallyCorrectedCards,
    (card) => String(card.set_id),
  );

  for (const targetSet of TARGET_SETS) {
    const set = setsByProviderId.get(targetSet.providerId);
    const activeCards = (cardsBySetId.get(String(set.id)) ?? []).filter(
      (card) => card.is_active,
    );
    if (activeCards.length !== targetSet.activeCardCount) {
      throw new Error(
        `${targetSet.name} active-card count drifted: expected ${targetSet.activeCardCount}, found ${activeCards.length}.`,
      );
    }
  }

  const matchedProducts = reviewedProducts.map((reviewedProduct) => {
    const localSet = setsByProviderId.get(
      reviewedProduct.targetSet.providerId,
    );
    const localCards = (
      correctedCardsBySetId.get(String(localSet.id)) ?? []
    ).filter((card) => card.is_active);

    return matchReviewedProductToCard(reviewedProduct, localCards);
  });
  const moveIdentityKeys = matchedProducts.map(
    (match) => `${match.cardId}:${match.printing}`,
  );

  if (new Set(moveIdentityKeys).size !== moveIdentityKeys.length) {
    throw new Error(
      "More than one reviewed product resolved to the same card and qualified printing.",
    );
  }

  const cardIds = [
    ...new Set(matchedProducts.map((match) => match.cardId)),
  ];
  const targetPrintings = [
    ...new Set(matchedProducts.map((match) => match.printing)),
  ];
  const variants = await db`
    select id, card_id, printing, condition, language_code
    from card_variants
    where card_id in ${db(cardIds)}
      and printing in ${db([SOURCE_PRINTING, ...targetPrintings])}
      and condition = 'unspecified'
      and language_code = 'en'
  `;
  const variantsByIdentity = groupBy(
    variants,
    (variant) => `${variant.card_id}:${variant.printing}`,
  );
  const matchedWithVariants = matchedProducts.map((match) => {
    const sourceVariants =
      variantsByIdentity.get(`${match.cardId}:${SOURCE_PRINTING}`) ??
      [];
    const targetVariants =
      variantsByIdentity.get(`${match.cardId}:${match.printing}`) ??
      [];

    if (sourceVariants.length !== 1 || targetVariants.length > 1) {
      throw new Error(
        `Expected one generic holofoil and at most one ${match.printing} variant for ${match.cardProviderId}; found ${sourceVariants.length} and ${targetVariants.length}.`,
      );
    }

    return {
      ...match,
      sourceVariantId: String(sourceVariants[0].id),
      targetVariantId:
        targetVariants.length === 1
          ? String(targetVariants[0].id)
          : null,
    };
  });
  const productIds = matchedWithVariants.map((match) => match.productId);
  const refs = await db`
    select
      external_ref.id,
      external_ref.card_variant_id,
      external_ref.ref_value,
      external_ref.metadata,
      variant.card_id,
      variant.printing,
      variant.condition,
      variant.language_code,
      card.provider_id as card_provider_id,
      card.set_id,
      card_set.provider_id as set_provider_id
    from card_variant_external_refs as external_ref
    inner join card_variants as variant
      on variant.id = external_ref.card_variant_id
    inner join cards as card
      on card.id = variant.card_id
    inner join card_sets as card_set
      on card_set.id = card.set_id
    where external_ref.source = 'tcgplayer'
      and external_ref.ref_type = 'product_id'
      and external_ref.ref_value in ${db(productIds)}
  `;
  const refsByProductId = groupBy(
    refs,
    (ref) => String(ref.ref_value),
  );
  const moves = matchedWithVariants.map((match) => {
    const productRefs = refsByProductId.get(match.productId) ?? [];
    if (productRefs.length > 1) {
      throw new Error(
        `Expected at most one TCGplayer product ref for reviewed product ${match.productId}, found ${productRefs.length}.`,
      );
    }

    if (productRefs.length === 0) {
      const expectedMissingProductIds = new Set(
        match.targetSet.expectedMissingQualifiedProductIds,
      );
      if (!expectedMissingProductIds.has(match.productId)) {
        throw new Error(
          `Reviewed product ${match.productId} is unexpectedly missing its TCGplayer ref.`,
        );
      }

      return {
        ...match,
        currentVariantId: null,
        refId: null,
        refMetadata: null,
        state: "missing",
      };
    }

    const ref = productRefs[0];
    validateReviewedProductRef(match, ref);

    const isPending =
      String(ref.card_variant_id) === match.sourceVariantId &&
      ref.printing === SOURCE_PRINTING;
    const isApplied =
      match.targetVariantId !== null &&
      String(ref.card_variant_id) === match.targetVariantId &&
      ref.printing === match.printing;

    if (!isPending && !isApplied) {
      throw new Error(
        `Reviewed product ${match.productId} is attached to unexpected printing ${ref.printing} on ${ref.card_provider_id}.`,
      );
    }

    return {
      ...match,
      currentVariantId: String(ref.card_variant_id),
      refId: String(ref.id),
      refMetadata: ref.metadata,
      state: isPending ? "pending" : "applied",
    };
  });
  const states = new Set(moves.map((move) => move.state));
  const hasApplied = states.has("applied");
  const hasUnapplied =
    states.has("pending") || states.has("missing");

  if (hasApplied && hasUnapplied) {
    const pendingCount = moves.filter(
      (move) => move.state !== "applied",
    ).length;
    throw new Error(
      `The qualified-printing repair is partially applied (${pendingCount}/${moves.length} refs pending). No database rows were changed.`,
    );
  }

  const state = hasUnapplied ? "pending" : "applied";
  assertExpectedMissingRefs(moves, state);
  const sourceVariantIds = [
    ...new Set(moves.map((move) => move.sourceVariantId)),
  ];
  await assertTargetVariantsAreSafe(db, moves, state);
  await assertGenericRefsWillBeUnambiguous(
    db,
    sourceVariantIds,
    new Set(productIds),
    state,
  );
  const invalidationCounts =
    state === "pending"
      ? await getInvalidationCounts(db, sourceVariantIds)
      : emptyInvalidationCounts();
  const collectionSnapshot = await getCollectionSnapshot(
    db,
    sourceVariantIds,
  );

  return {
    collectionSnapshot,
    correction,
    invalidationCounts,
    moves,
    reviewedProductCount: reviewedProducts.length,
    setIds,
    sourceVariantIds,
    state,
    targetVariantCount: moveIdentityKeys.length,
    missingTargetVariantCount: moves.filter(
      (move) => move.targetVariantId === null,
    ).length,
    missingProductRefCount: moves.filter(
      (move) => move.state === "missing",
    ).length,
  };
}

function assertExpectedMissingRefs(moves, state) {
  for (const targetSet of TARGET_SETS) {
    const expected =
      state === "pending"
        ? [...targetSet.expectedMissingQualifiedProductIds].sort()
        : [];
    const actual = moves
      .filter(
        (move) =>
          move.setProviderId === targetSet.providerId &&
          move.state === "missing",
      )
      .map((move) => move.productId)
      .sort();

    if (
      expected.length !== actual.length ||
      expected.some(
        (productId, index) => productId !== actual[index],
      )
    ) {
      throw new Error(
        `${targetSet.name} missing qualified refs drifted: expected [${expected.join(", ")}], found [${actual.join(", ")}].`,
      );
    }
  }
}

function validateNumberCorrection({ cards, setsByProviderId }) {
  const correction = ANTIQUE_COVER_FOSSIL_CORRECTION;
  const set = setsByProviderId.get(correction.setProviderId);
  const matches = cards.filter(
    (card) =>
      String(card.set_id) === String(set.id) &&
      card.provider_id === correction.cardProviderId,
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${correction.cardProviderId} card, found ${matches.length}.`,
    );
  }

  const card = matches[0];
  const providerData = card.provider_data;
  if (
    card.name !== correction.cardName ||
    !providerData ||
    Array.isArray(providerData) ||
    typeof providerData !== "object" ||
    providerData.id !== correction.cardProviderId ||
    providerData.name !== correction.cardName
  ) {
    throw new Error(
      `Antique Cover Fossil identity/provider_data drifted for ${correction.cardProviderId}.`,
    );
  }

  const localNumber = String(card.number ?? "");
  const providerNumber = String(providerData.number ?? "");
  let state;

  if (
    localNumber === correction.oldNumber &&
    providerNumber === correction.oldNumber
  ) {
    state = "pending";
  } else if (
    localNumber === correction.newNumber &&
    providerNumber === correction.newNumber
  ) {
    state = "applied";
  } else {
    throw new Error(
      `Antique Cover Fossil is partially or unexpectedly numbered (${localNumber}/${providerNumber}).`,
    );
  }

  const conflictingNumber = cards.find(
    (candidate) =>
      String(candidate.set_id) === String(set.id) &&
      String(candidate.id) !== String(card.id) &&
      normalizeTcgcsvCollectorNumber(candidate.number) ===
        correction.newNumber,
  );
  if (conflictingNumber) {
    throw new Error(
      `Cannot correct Antique Cover Fossil to #${correction.newNumber}; ${conflictingNumber.provider_id} already uses that number.`,
    );
  }

  return {
    ...correction,
    cardId: String(card.id),
    state,
  };
}

function matchReviewedProductToCard(reviewedProduct, localCards) {
  const productNumber = getExtendedDataValue(
    reviewedProduct.product,
    "Number",
  );
  if (!productNumber) {
    throw new Error(
      `Reviewed product ${reviewedProduct.productId} has no collector-number metadata.`,
    );
  }

  const evidence = getTcgcsvCollectorNumberEvidence({
    productName: reviewedProduct.product.name,
    productNumber,
  });
  if (
    evidence.hasConflict ||
    evidence.denominator !== reviewedProduct.targetSet.printedTotal ||
    !evidence.numerator
  ) {
    throw new Error(
      `Reviewed product ${reviewedProduct.productId} has unsafe collector-number evidence (${productNumber}).`,
    );
  }

  const numberCandidates = localCards.filter(
    (card) =>
      normalizeTcgcsvCollectorNumber(card.number) === evidence.numerator,
  );
  const nameCandidates = numberCandidates.filter((card) =>
    doesTcgcsvProductNameMatchCard({
      cardName: card.name,
      productCleanName: reviewedProduct.product.cleanName,
      productName: reviewedProduct.product.name,
    }),
  );

  if (nameCandidates.length !== 1) {
    throw new Error(
      `Reviewed product ${reviewedProduct.productId} "${reviewedProduct.product.name}" matched ${nameCandidates.length} ${reviewedProduct.targetSet.name} cards at #${evidence.numerator}.`,
    );
  }

  const card = nameCandidates[0];
  if (String(card.set_id) === "" || !card.provider_id) {
    throw new Error(
      `Reviewed product ${reviewedProduct.productId} resolved to an incomplete local card identity.`,
    );
  }

  return {
    cardId: String(card.id),
    cardName: String(card.name),
    cardNumber: String(card.number),
    cardProviderId: String(card.provider_id),
    groupId: reviewedProduct.targetSet.groupId,
    printing: reviewedProduct.printing,
    product: reviewedProduct.product,
    productId: reviewedProduct.productId,
    productName: String(reviewedProduct.product.name),
    productNumber: String(productNumber),
    qualifier: reviewedProduct.qualifier,
    setName: reviewedProduct.targetSet.name,
    setProviderId: reviewedProduct.targetSet.providerId,
    targetSet: reviewedProduct.targetSet,
  };
}

function validateReviewedProductRef(match, ref) {
  if (
    String(ref.card_id) !== match.cardId ||
    String(ref.card_provider_id) !== match.cardProviderId ||
    String(ref.set_provider_id) !== match.setProviderId ||
    ref.condition !== "unspecified" ||
    ref.language_code !== "en"
  ) {
    throw new Error(
      `TCGplayer product ref ${match.productId} does not belong to its exact reviewed English card identity.`,
    );
  }

  const metadata =
    ref.metadata &&
    !Array.isArray(ref.metadata) &&
    typeof ref.metadata === "object"
      ? ref.metadata
      : {};

  if (metadata.url !== undefined) {
    let url;
    try {
      url = new URL(String(metadata.url));
    } catch {
      throw new Error(
        `TCGplayer product ref ${match.productId} has an invalid metadata URL.`,
      );
    }

    if (
      !/(^|\.)tcgplayer\.com$/i.test(url.hostname) ||
      !new RegExp(
        `^/product/${escapeRegExp(match.productId)}(?:/|$)`,
        "i",
      ).test(url.pathname)
    ) {
      throw new Error(
        `TCGplayer product ref ${match.productId} metadata URL identifies a different product.`,
      );
    }
  }

  if (
    metadata.tcgcsvGroupId !== undefined &&
    Number(metadata.tcgcsvGroupId) !== match.groupId
  ) {
    throw new Error(
      `TCGplayer product ref ${match.productId} metadata identifies a different TCGCSV group.`,
    );
  }
  if (
    metadata.tcgcsvProductName !== undefined &&
    String(metadata.tcgcsvProductName) !== match.productName
  ) {
    throw new Error(
      `TCGplayer product ref ${match.productId} metadata identifies a different product name.`,
    );
  }
  if (
    metadata.tcgcsvSubTypeName !== undefined &&
    normalizePrinting(metadata.tcgcsvSubTypeName) !== SOURCE_PRINTING
  ) {
    throw new Error(
      `TCGplayer product ref ${match.productId} does not have Holofoil subtype evidence.`,
    );
  }
}

async function assertTargetVariantsAreSafe(db, moves, state) {
  const existingTargetVariantIds = [
    ...new Set(
      moves
        .map((move) => move.targetVariantId)
        .filter(Boolean),
    ),
  ];
  if (existingTargetVariantIds.length === 0) return;

  const rows = await db`
    select
      variant.id,
      (
        select count(*)::integer
        from card_variant_external_refs as external_ref
        where external_ref.card_variant_id = variant.id
      ) as external_ref_count,
      (
        select count(*)::integer
        from collection_items as collection_item
        where collection_item.card_variant_id = variant.id
      ) as collection_item_count,
      (
        select count(*)::integer
        from collection_quantity_history as quantity_history
        where quantity_history.card_variant_id = variant.id
      ) as quantity_history_count,
      (
        select count(*)::integer
        from current_prices as current_price
        where current_price.card_variant_id = variant.id
      ) as current_price_count,
      (
        select count(*)::integer
        from price_series as series
        where series.card_variant_id = variant.id
      ) as price_series_count,
      (
        select count(*)::integer
        from price_points as point
        where point.card_variant_id = variant.id
      ) as price_point_count
    from card_variants as variant
    where variant.id in ${db(existingTargetVariantIds)}
  `;
  if (rows.length !== existingTargetVariantIds.length) {
    throw new Error(
      "A preexisting qualified target variant disappeared during validation.",
    );
  }

  const movesByTargetVariantId = new Map(
    moves
      .filter((move) => move.targetVariantId)
      .map((move) => [move.targetVariantId, move]),
  );

  for (const row of rows) {
    const variantId = String(row.id);
    const move = movesByTargetVariantId.get(variantId);
    if (!move) {
      throw new Error(
        `Qualified target variant ${variantId} has no reviewed product identity.`,
      );
    }

    if (state === "pending") {
      const stateCounts = {
        refs: Number(row.external_ref_count),
        collectionItems: Number(row.collection_item_count),
        quantityHistory: Number(row.quantity_history_count),
        currentPrices: Number(row.current_price_count),
        priceSeries: Number(row.price_series_count),
        pricePoints: Number(row.price_point_count),
      };
      if (Object.values(stateCounts).some((count) => count !== 0)) {
        throw new Error(
          `Preexisting target variant ${move.cardProviderId}:${move.printing} is not empty (${JSON.stringify(stateCounts)}).`,
        );
      }
    } else if (Number(row.external_ref_count) !== 1) {
      throw new Error(
        `Applied target variant ${move.cardProviderId}:${move.printing} has ${row.external_ref_count} external refs; expected only reviewed product ${move.productId}.`,
      );
    }
  }
}

async function assertGenericRefsWillBeUnambiguous(
  db,
  sourceVariantIds,
  qualifiedProductIds,
  state,
) {
  const genericRefs = await db`
    select card_variant_id, ref_value
    from card_variant_external_refs
    where card_variant_id in ${db(sourceVariantIds)}
      and source = 'tcgplayer'
      and ref_type = 'product_id'
  `;
  const remainingRefsByVariant = new Map();

  for (const ref of genericRefs) {
    const productId = String(ref.ref_value);
    if (
      state === "pending" &&
      qualifiedProductIds.has(productId)
    ) {
      continue;
    }

    const variantId = String(ref.card_variant_id);
    const refs = remainingRefsByVariant.get(variantId) ?? [];
    refs.push(productId);
    remainingRefsByVariant.set(variantId, refs);
  }

  const ambiguous = [...remainingRefsByVariant.entries()].filter(
    ([, productIds]) => productIds.length > 1,
  );
  if (ambiguous.length > 0) {
    const example = ambiguous
      .slice(0, 3)
      .map(
        ([variantId, productIds]) =>
          `${variantId}: ${productIds.join(",")}`,
      )
      .join("; ");
    throw new Error(
      `${ambiguous.length} generic holofoil variants would remain ambiguous after the reviewed moves (${example}).`,
    );
  }
}

async function getInvalidationCounts(db, sourceVariantIds) {
  const [currentPrices, priceSeries, pricePoints] = await Promise.all([
    db`
      select count(*)::integer as count
      from current_prices
      where card_variant_id in ${db(sourceVariantIds)}
        and source = 'tcgcsv'
        and price_type = 'market'
        and currency = 'USD'
    `,
    db`
      select count(*)::integer as count
      from price_series
      where card_variant_id in ${db(sourceVariantIds)}
        and source = 'tcgcsv'
        and price_type = 'market'
        and currency = 'USD'
    `,
    db`
      select count(*)::integer as count
      from price_points
      where card_variant_id in ${db(sourceVariantIds)}
        and source = 'tcgcsv'
        and price_type = 'market'
        and currency = 'USD'
    `,
  ]);

  return {
    currentPrices: Number(currentPrices[0].count),
    priceSeries: Number(priceSeries[0].count),
    pricePoints: Number(pricePoints[0].count),
  };
}

function emptyInvalidationCounts() {
  return {
    currentPrices: 0,
    priceSeries: 0,
    pricePoints: 0,
  };
}

async function getCollectionSnapshot(db, sourceVariantIds) {
  const [items, history] = await Promise.all([
    db`
      select
        count(*)::integer as row_count,
        coalesce(sum(quantity), 0)::bigint as quantity
      from collection_items
      where card_variant_id in ${db(sourceVariantIds)}
    `,
    db`
      select
        count(*)::integer as row_count,
        coalesce(sum(quantity), 0)::bigint as quantity
      from collection_quantity_history
      where card_variant_id in ${db(sourceVariantIds)}
    `,
  ]);

  return {
    collectionItemRows: Number(items[0].row_count),
    collectionItemQuantity: String(items[0].quantity),
    quantityHistoryRows: Number(history[0].row_count),
    quantityHistoryQuantity: String(history[0].quantity),
  };
}

function printPlan(plan) {
  const countsBySetAndPrinting = countBy(
    plan.moves,
    (move) => `${move.setName} / ${formatPrinting(move.printing)}`,
  );

  console.log(
    `Validated ${plan.reviewedProductCount} reviewed qualified TCGplayer products across ${TARGET_SETS.length} modern sets.`,
  );
  for (const [label, count] of [...countsBySetAndPrinting.entries()].sort()) {
    console.log(`  ${label}: ${count}`);
  }

  console.log(
    `Repair state: ${plan.state}; ${plan.targetVariantCount} explicit variant identities (${plan.missingTargetVariantCount} currently missing), ${plan.missingProductRefCount} exact product refs currently missing, ${plan.sourceVariantIds.length} affected generic holofoil variants.`,
  );
  console.log(
    `Antique Cover Fossil #60 -> #80 state: ${plan.correction.state}.`,
  );
  console.log(
    `Scoped generic TCGCSV USD market invalidation: ${plan.invalidationCounts.currentPrices} current prices, ${plan.invalidationCounts.priceSeries} compressed series, ${plan.invalidationCounts.pricePoints} legacy points.`,
  );
  console.log(
    `Collection safety snapshot: ${plan.collectionSnapshot.collectionItemRows} collection rows / ${plan.collectionSnapshot.collectionItemQuantity} cards; ${plan.collectionSnapshot.quantityHistoryRows} quantity-history rows / ${plan.collectionSnapshot.quantityHistoryQuantity} cards.`,
  );
}

async function applyRepair(reviewedProducts) {
  const result = await sql.begin(
    "isolation level serializable",
    async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(
          hashtext('cardkeeper:modern-set-qualified-printings-v1')
        )
      `;
      const plan = await buildRepairPlan(transaction, reviewedProducts);

      if (
        plan.state === "applied" &&
        plan.correction.state === "applied"
      ) {
        return {
          alreadyApplied: true,
          createdRefs: 0,
          createdVariants: 0,
          deletedCurrentPrices: 0,
          deletedPricePoints: 0,
          deletedPriceSeries: 0,
          movedRefs: 0,
        };
      }

      if (plan.correction.state === "pending") {
        const corrected = await transaction`
          update cards
          set
            number = ${plan.correction.newNumber},
            provider_data = jsonb_set(
              provider_data,
              '{number}',
              ${transaction.json(plan.correction.newNumber)}::jsonb,
              false
            ),
            updated_at = now()
          where id = ${plan.correction.cardId}
            and provider_id = ${plan.correction.cardProviderId}
            and name = ${plan.correction.cardName}
            and number = ${plan.correction.oldNumber}
            and provider_data ->> 'number' = ${plan.correction.oldNumber}
          returning id
        `;
        if (corrected.length !== 1) {
          throw new Error(
            `Expected to correct one Antique Cover Fossil row, corrected ${corrected.length}.`,
          );
        }
      }

      let createdVariants = 0;
      let createdRefs = 0;
      let movedRefs = 0;
      let deletedCurrentPrices = 0;
      let deletedPriceSeries = 0;
      let deletedPricePoints = 0;

      if (plan.state === "pending") {
        const variantRows = plan.moves.map((move) => ({
          card_id: move.cardId,
          printing: move.printing,
          condition: "unspecified",
          language_code: "en",
        }));
        const insertedVariants = await transaction`
          insert into card_variants ${transaction(
            variantRows,
            "card_id",
            "printing",
            "condition",
            "language_code",
          )}
          on conflict (card_id, printing, condition, language_code)
            do nothing
          returning id
        `;
        createdVariants = insertedVariants.length;

        if (createdVariants !== plan.missingTargetVariantCount) {
          throw new Error(
            `Expected to create ${plan.missingTargetVariantCount} target variants, created ${createdVariants}.`,
          );
        }

        const targetVariants = await transaction`
          select id, card_id, printing
          from card_variants
          where card_id in ${transaction(
            [...new Set(plan.moves.map((move) => move.cardId))],
          )}
            and printing in ${transaction(
              [...new Set(plan.moves.map((move) => move.printing))],
            )}
            and condition = 'unspecified'
            and language_code = 'en'
        `;
        const targetVariantsByIdentity = new Map(
          targetVariants.map((variant) => [
            `${variant.card_id}:${variant.printing}`,
            String(variant.id),
          ]),
        );
        const operationRows = plan.moves.map((move) => {
          const targetVariantId = targetVariantsByIdentity.get(
            `${move.cardId}:${move.printing}`,
          );
          if (!targetVariantId) {
            throw new Error(
              `Target variant disappeared for ${move.cardProviderId}:${move.printing}.`,
            );
          }

          return {
            ref_id: move.refId,
            source_variant_id: move.sourceVariantId,
            target_variant_id: targetVariantId,
            metadata: buildReviewedRefMetadata(move),
            product_id: move.productId,
          };
        });
        const moveRows = operationRows.filter((move) => move.ref_id);
        const missingRefRows = operationRows.filter((move) => !move.ref_id);

        if (moveRows.length > 0) {
          await transaction`
            create temporary table modern_set_printing_moves (
              ref_id uuid primary key,
              source_variant_id uuid not null,
              target_variant_id uuid not null,
              metadata jsonb not null
            ) on commit drop
          `;
          await transaction`
            insert into modern_set_printing_moves ${transaction(
              moveRows,
              "ref_id",
              "source_variant_id",
              "target_variant_id",
              "metadata",
            )}
          `;
          const updatedRefs = await transaction`
            update card_variant_external_refs as external_ref
            set
              card_variant_id = move.target_variant_id,
              metadata =
                coalesce(external_ref.metadata, '{}'::jsonb) ||
                move.metadata,
              updated_at = now()
            from modern_set_printing_moves as move
            where external_ref.id = move.ref_id
              and external_ref.card_variant_id = move.source_variant_id
              and external_ref.source = 'tcgplayer'
              and external_ref.ref_type = 'product_id'
            returning external_ref.id
          `;
          movedRefs = updatedRefs.length;
        }
        if (movedRefs !== moveRows.length) {
          throw new Error(
            `Expected to move ${moveRows.length} qualified refs, moved ${movedRefs}.`,
          );
        }

        if (missingRefRows.length > 0) {
          const insertedRefs = await transaction`
            insert into card_variant_external_refs ${transaction(
              missingRefRows.map((row) => ({
                card_variant_id: row.target_variant_id,
                source: "tcgplayer",
                ref_type: "product_id",
                ref_value: row.product_id,
                metadata: row.metadata,
              })),
              "card_variant_id",
              "source",
              "ref_type",
              "ref_value",
              "metadata",
            )}
            on conflict (
              card_variant_id,
              source,
              ref_type,
              ref_value
            ) do update set
              metadata =
                coalesce(card_variant_external_refs.metadata, '{}'::jsonb) ||
                excluded.metadata,
              updated_at = now()
            returning id
          `;
          createdRefs = insertedRefs.length;
        }
        if (createdRefs !== plan.missingProductRefCount) {
          throw new Error(
            `Expected to create ${plan.missingProductRefCount} exact qualified refs, created ${createdRefs}.`,
          );
        }

        const deletedCurrentRows = await transaction`
          delete from current_prices
          where card_variant_id in ${transaction(plan.sourceVariantIds)}
            and source = 'tcgcsv'
            and price_type = 'market'
            and currency = 'USD'
          returning id
        `;
        const deletedSeriesRows = await transaction`
          delete from price_series
          where card_variant_id in ${transaction(plan.sourceVariantIds)}
            and source = 'tcgcsv'
            and price_type = 'market'
            and currency = 'USD'
          returning card_variant_id
        `;
        const deletedPointRows = await transaction`
          delete from price_points
          where card_variant_id in ${transaction(plan.sourceVariantIds)}
            and source = 'tcgcsv'
            and price_type = 'market'
            and currency = 'USD'
          returning id
        `;
        deletedCurrentPrices = deletedCurrentRows.length;
        deletedPriceSeries = deletedSeriesRows.length;
        deletedPricePoints = deletedPointRows.length;

        assertExactCount(
          "current-price invalidation",
          plan.invalidationCounts.currentPrices,
          deletedCurrentPrices,
        );
        assertExactCount(
          "compressed-series invalidation",
          plan.invalidationCounts.priceSeries,
          deletedPriceSeries,
        );
        assertExactCount(
          "legacy-point invalidation",
          plan.invalidationCounts.pricePoints,
          deletedPricePoints,
        );
      }

      const postPlan = await buildRepairPlan(
        transaction,
        reviewedProducts,
      );
      if (
        postPlan.state !== "applied" ||
        postPlan.correction.state !== "applied" ||
        Object.values(postPlan.invalidationCounts).some(
          (count) => count !== 0,
        )
      ) {
        throw new Error(
          "Modern-set printing repair postconditions did not pass.",
        );
      }
      assertCollectionSnapshotUnchanged(
        plan.collectionSnapshot,
        postPlan.collectionSnapshot,
      );

      return {
        alreadyApplied: false,
        createdRefs,
        createdVariants,
        deletedCurrentPrices,
        deletedPricePoints,
        deletedPriceSeries,
        movedRefs,
      };
    },
  );

  if (result.alreadyApplied) {
    console.log(
      "The reviewed modern-set printing repair is already fully applied; no database rows were changed.",
    );
    return;
  }

  console.log(
    `Applied modern-set printing repair: corrected Antique Cover Fossil to #80, created ${result.createdVariants} explicit variants, moved ${result.movedRefs} qualified product refs, created ${result.createdRefs} exact missing product ref, and invalidated ${result.deletedCurrentPrices} current prices / ${result.deletedPriceSeries} compressed series / ${result.deletedPricePoints} legacy points on affected generic holofoil variants.`,
  );
  console.log(
    "Run the scoped TCGCSV current refresh and historical backfill next; this repair deliberately does not relabel contaminated generic history.",
  );
}

function buildReviewedRefMetadata(move) {
  const officialUrl = String(move.product.url ?? "").trim();
  let productUrl = `https://www.tcgplayer.com/product/${encodeURIComponent(move.productId)}/-?Language=English`;

  if (officialUrl) {
    try {
      const parsed = new URL(officialUrl);
      if (
        /(^|\.)tcgplayer\.com$/i.test(parsed.hostname) &&
        new RegExp(
          `^/product/${escapeRegExp(move.productId)}(?:/|$)`,
          "i",
        ).test(parsed.pathname)
      ) {
        productUrl = parsed.toString();
      }
    } catch {
      // The canonical product-id URL above is safer than retaining malformed
      // optional display metadata from the product feed.
    }
  }

  return {
    url: productUrl,
    tcgcsvGroupId: move.groupId,
    tcgcsvProductName: move.productName,
    tcgcsvSubTypeName: "Holofoil",
    tcgcsvQualifiedPrinting: move.printing,
    tcgcsvProductQualifier: move.qualifier,
    tcgcsvProductNumber: move.productNumber,
    mappingRepair: REPAIR_ID,
    mappingReviewedAt: REVIEWED_AT,
  };
}

function assertExactCount(label, expected, actual) {
  if (actual !== expected) {
    throw new Error(
      `Expected ${label} count ${expected}, found ${actual}.`,
    );
  }
}

function assertCollectionSnapshotUnchanged(before, after) {
  for (const key of Object.keys(before)) {
    if (before[key] !== after[key]) {
      throw new Error(
        `Collection safety postcondition failed for ${key}: ${before[key]} -> ${after[key]}.`,
      );
    }
  }
}

function getExtendedDataValue(product, key) {
  if (!Array.isArray(product?.extendedData)) return null;

  const matches = product.extendedData.filter(
    (entry) => entry?.name === key,
  );
  return matches.length === 1 ? matches[0].value : null;
}

function normalizeProductId(value) {
  const normalized = String(value ?? "").trim();
  return /^[1-9]\d*$/.test(normalized) ? normalized : null;
}

function normalizePrinting(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function countBy(values, keyForValue) {
  const counts = new Map();
  for (const value of values) {
    const key = keyForValue(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function groupBy(values, keyForValue) {
  const groups = new Map();
  for (const value of values) {
    const key = keyForValue(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function formatPrinting(value) {
  return value
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
