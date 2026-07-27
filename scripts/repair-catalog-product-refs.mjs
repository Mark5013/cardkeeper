import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

import repairManifest from "./data/tcgcsv-catalog-product-ref-repairs-2026-07-26.json" with {
  type: "json",
};

const { loadEnvConfig } = nextEnv;

const PROVIDER_PRICE_KEYS = Object.freeze({
  holofoil: "holofoil",
  normal: "normal",
  reverse_holofoil: "reverseHolofoil",
});

loadEnvConfig(process.cwd());

const options = parseArgs(process.argv.slice(2));
const manifest = validateManifest(repairManifest);

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required to repair catalog product references.",
  );
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

try {
  await repairCatalogProductRefs();
} finally {
  await sql.end();
}

function parseArgs(args) {
  const parsed = {
    apply: false,
    rollback: false,
  };

  for (const arg of args) {
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--rollback") {
      parsed.apply = true;
      parsed.rollback = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function validateManifest(input) {
  if (
    input?.version !== 1 ||
    typeof input.repairId !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedAt) ||
    input.providerProxyBaseUrl !==
      "https://prices.pokemontcg.io/tcgplayer/" ||
    !Array.isArray(input.assignments) ||
    input.assignments.length !== input.expectedAssignmentCount
  ) {
    throw new Error("Invalid catalog product-ref repair manifest header.");
  }

  const assignments = input.assignments.map((entry, index) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 6 ||
      !/^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(entry[0]) ||
      !/^[A-Za-z0-9]+$/.test(entry[1]) ||
      !Object.hasOwn(PROVIDER_PRICE_KEYS, entry[2]) ||
      !/^[1-9]\d{0,14}$/.test(entry[3]) ||
      !/^(?:attach|create)$/.test(entry[4]) ||
      !(
        entry[5] === null ||
        Object.hasOwn(PROVIDER_PRICE_KEYS, entry[5])
      )
    ) {
      throw new Error(`Invalid repair assignment at index ${index}.`);
    }

    return {
      cardProviderId: entry[0],
      setProviderId: entry[1],
      printing: entry[2],
      productId: entry[3],
      mode: entry[4],
      siblingPrinting: entry[5],
    };
  });
  const targetKeys = assignments.map(
    (assignment) =>
      `${assignment.cardProviderId}:${assignment.printing}`,
  );
  const productIds = assignments.map(
    (assignment) => assignment.productId,
  );

  if (
    new Set(targetKeys).size !== targetKeys.length ||
    new Set(productIds).size !== productIds.length ||
    assignments.filter((assignment) => assignment.mode === "create")
      .length !== input.expectedCreateVariantCount ||
    assignments.filter((assignment) => assignment.mode === "attach")
      .length !== input.expectedExistingVariantCount ||
    assignments.filter((assignment) => assignment.siblingPrinting)
      .length !== input.expectedSiblingPlacementCount
  ) {
    throw new Error(
      "The catalog product-ref repair manifest has duplicate or miscounted identities.",
    );
  }

  return {
    ...input,
    assignments,
  };
}

async function repairCatalogProductRefs() {
  const plan = await buildRepairPlan(sql);

  if (plan.alreadyApplied) {
    console.log(
      `The reviewed ${manifest.expectedAssignmentCount}-card catalog product-ref repair is already applied; no rows were changed.`,
    );
    return;
  }

  console.log(
    `Verified ${manifest.expectedAssignmentCount} exact catalog-to-TCGplayer mappings across ${plan.setCount} sets.`,
  );
  console.log(
    `Plan: create ${plan.createVariantCount} provider-advertised variants and attach ${plan.refInsertCount} exact product refs (${plan.siblingPlacementCount} independently corroborated by sibling finishes).`,
  );
  console.log(
    `Safety: ${plan.collectionSnapshot.collectionRows} collection rows / ${plan.collectionSnapshot.quantityHistoryRows} quantity-history rows; ${plan.targetPriceRowCount}/${plan.targetSeriesRowCount} current/history price rows on existing targets.`,
  );

  if (!options.apply) {
    console.log(
      "Dry run complete. Use --rollback to validate the write transaction or --apply after taking a database snapshot and stopping concurrent refresh jobs.",
    );
    return;
  }

  const snapshotPath = await writeBeforeStateSnapshot(plan);
  console.log(`Saved exact pre-repair row snapshot to ${snapshotPath}.`);

  const rollbackSignal = new Error("ROLLBACK_VALIDATION");

  try {
    await sql.begin(async (transaction) => {
      await transaction`
        lock table card_variants in share row exclusive mode
      `;
      await transaction`
        lock table card_variant_external_refs in share row exclusive mode
      `;

      const lockedPlan = await buildRepairPlan(transaction);
      if (
        lockedPlan.alreadyApplied ||
        lockedPlan.mappingFingerprint !== plan.mappingFingerprint
      ) {
        throw new Error(
          "Catalog mapping state changed after the pre-repair snapshot.",
        );
      }

      const targetVariantIds = new Map();

      for (const assignment of lockedPlan.assignments) {
        let targetVariantId = assignment.targetVariantId;

        if (assignment.mode === "create") {
          const [variant] = await transaction`
            insert into card_variants (
              card_id,
              printing,
              condition,
              language_code
            )
            values (
              ${assignment.cardId},
              ${assignment.printing},
              'unspecified',
              'en'
            )
            returning id
          `;
          targetVariantId = String(variant.id);
        }

        if (!targetVariantId) {
          throw new Error(
            `Missing target variant for ${assignment.cardProviderId}:${assignment.printing}.`,
          );
        }
        targetVariantIds.set(
          getTargetKey(
            assignment.cardProviderId,
            assignment.printing,
          ),
          targetVariantId,
        );
      }

      for (const assignment of lockedPlan.assignments) {
        const targetVariantId = targetVariantIds.get(
          getTargetKey(
            assignment.cardProviderId,
            assignment.printing,
          ),
        );
        const inserted = await transaction`
          insert into card_variant_external_refs (
            card_variant_id,
            source,
            ref_type,
            ref_value,
            metadata
          )
          values (
            ${targetVariantId},
            'tcgplayer',
            'product_id',
            ${assignment.productId},
            ${transaction.json({
              mappingRepair: manifest.repairId,
              mappingReviewedAt: manifest.reviewedAt,
              providerProxyUrl: assignment.providerProxyUrl,
              url: `https://www.tcgplayer.com/product/${assignment.productId}/-?Language=English`,
            })}
          )
          returning id
        `;

        if (inserted.length !== 1) {
          throw new Error(
            `Failed to attach reviewed product ${assignment.productId}.`,
          );
        }
      }

      const postPlan = await buildRepairPlan(transaction);
      if (!postPlan.alreadyApplied) {
        throw new Error(
          "Catalog product-ref repair postcondition verification failed.",
        );
      }
      assertCollectionSnapshotUnchanged(
        plan.collectionSnapshot,
        postPlan.collectionSnapshot,
      );

      if (options.rollback) throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) throw error;
    console.log(
      "Write validation succeeded; the transaction was intentionally rolled back.",
    );
    return;
  }

  console.log(
    `Applied ${manifest.expectedAssignmentCount}-card catalog product-ref repair: created ${plan.createVariantCount} variants and attached ${plan.refInsertCount} exact product refs.`,
  );
  console.log(
    "Run the next changed-build current-price refresh, then rebuild history with --reset-stage.",
  );
}

async function buildRepairPlan(database) {
  const cardProviderIds = manifest.assignments.map(
    (assignment) => assignment.cardProviderId,
  );
  const productIds = manifest.assignments.map(
    (assignment) => assignment.productId,
  );
  const cardRows = await database`
    select
      card.id,
      card.provider_id,
      card.name,
      card.number,
      card.provider_data -> 'tcgplayer' ->> 'url' as provider_proxy_url,
      card.provider_data -> 'tcgplayer' -> 'prices' as provider_prices,
      card_set.provider_id as set_provider_id
    from cards as card
    inner join card_sets as card_set on card_set.id = card.set_id
    where card.provider_id in ${database(cardProviderIds)}
      and card.is_active = true
      and card.language_code = 'en'
      and card_set.is_active = true
      and card_set.language_code = 'en'
    order by card.provider_id
  `;

  if (cardRows.length !== manifest.expectedAssignmentCount) {
    throw new Error(
      `Expected ${manifest.expectedAssignmentCount} active cards, found ${cardRows.length}.`,
    );
  }

  const cardRowsByProviderId = new Map(
    cardRows.map((row) => [row.provider_id, row]),
  );
  const cardIds = cardRows.map((row) => String(row.id));
  const variantRows = await database`
    select
      variant.id,
      variant.card_id,
      variant.printing,
      variant.condition,
      variant.language_code
    from card_variants as variant
    where variant.card_id in ${database(cardIds)}
    order by variant.card_id, variant.printing, variant.condition, variant.id
  `;
  const variantIds = variantRows.map((row) => String(row.id));
  const cardRefRows =
    variantIds.length === 0
      ? []
      : await database`
          select
            external_ref.id,
            external_ref.card_variant_id,
            external_ref.ref_value as product_id,
            external_ref.metadata
          from card_variant_external_refs as external_ref
          where external_ref.card_variant_id in ${database(variantIds)}
            and external_ref.source = 'tcgplayer'
            and external_ref.ref_type = 'product_id'
          order by external_ref.card_variant_id, external_ref.ref_value
        `;
  const productPlacements = await database`
    select
      external_ref.id as ref_id,
      external_ref.ref_value as product_id,
      external_ref.metadata,
      variant.id as variant_id,
      variant.printing,
      variant.condition,
      variant.language_code,
      card.id as card_id,
      card.provider_id as card_provider_id
    from card_variant_external_refs as external_ref
    inner join card_variants as variant
      on variant.id = external_ref.card_variant_id
    inner join cards as card on card.id = variant.card_id
    where external_ref.source = 'tcgplayer'
      and external_ref.ref_type = 'product_id'
      and external_ref.ref_value in ${database(productIds)}
    order by external_ref.ref_value, card.provider_id, variant.printing
  `;
  const variantsByCardId = groupRows(
    variantRows,
    (row) => String(row.card_id),
  );
  const refsByVariantId = groupRows(
    cardRefRows,
    (row) => String(row.card_variant_id),
  );
  const placementsByProductId = groupRows(
    productPlacements,
    (row) => String(row.product_id),
  );
  const assignments = manifest.assignments.map((assignment) => {
    const card = cardRowsByProviderId.get(
      assignment.cardProviderId,
    );

    if (
      !card ||
      card.set_provider_id !== assignment.setProviderId ||
      card.provider_proxy_url !==
        `${manifest.providerProxyBaseUrl}${assignment.cardProviderId}` ||
      !Object.hasOwn(
        card.provider_prices ?? {},
        PROVIDER_PRICE_KEYS[assignment.printing],
      )
    ) {
      throw new Error(
        `Catalog evidence drifted for ${assignment.cardProviderId}:${assignment.printing}.`,
      );
    }

    const cardVariants =
      variantsByCardId.get(String(card.id)) ?? [];
    const targetVariant =
      cardVariants.find(
        (variant) =>
          variant.printing === assignment.printing &&
          variant.condition === "unspecified" &&
          variant.language_code === "en",
      ) ?? null;
    const targetRefs = targetVariant
      ? refsByVariantId.get(String(targetVariant.id)) ?? []
      : [];

    return {
      ...assignment,
      cardId: String(card.id),
      cardName: card.name,
      cardNumber: card.number,
      providerProxyUrl:
        `${manifest.providerProxyBaseUrl}${assignment.cardProviderId}`,
      targetRefs,
      targetVariantId: targetVariant
        ? String(targetVariant.id)
        : null,
    };
  });
  const appliedAssignments = assignments.filter((assignment) =>
    isAssignmentApplied(assignment),
  );

  if (
    appliedAssignments.length > 0 &&
    appliedAssignments.length !== assignments.length
  ) {
    throw new Error(
      "The catalog product-ref repair is partially applied.",
    );
  }

  const collectionSnapshot = await getCollectionSnapshot(
    database,
    variantIds,
  );

  if (appliedAssignments.length === assignments.length) {
    for (const assignment of assignments) {
      verifyAppliedPlacements(
        assignment,
        placementsByProductId.get(assignment.productId) ?? [],
      );
    }

    return {
      alreadyApplied: true,
      collectionSnapshot,
    };
  }

  for (const assignment of assignments) {
    if (
      (assignment.mode === "attach" &&
        !assignment.targetVariantId) ||
      (assignment.mode === "create" &&
        assignment.targetVariantId) ||
      assignment.targetRefs.length !== 0
    ) {
      throw new Error(
        `Target state drifted for ${assignment.cardProviderId}:${assignment.printing}.`,
      );
    }

    verifyInitialPlacements(
      assignment,
      placementsByProductId.get(assignment.productId) ?? [],
    );
  }

  if (
    collectionSnapshot.collectionRows !== 0 ||
    collectionSnapshot.quantityHistoryRows !== 0
  ) {
    throw new Error(
      "Reviewed cards are no longer empty of collections or quantity history.",
    );
  }

  const existingTargetVariantIds = assignments
    .map((assignment) => assignment.targetVariantId)
    .filter(Boolean);
  const [targetPriceCounts] =
    existingTargetVariantIds.length === 0
      ? [{ current_price_rows: 0, series_rows: 0 }]
      : await database`
          select
            (
              select count(*) from current_prices
              where card_variant_id in ${database(existingTargetVariantIds)}
            )::int as current_price_rows,
            (
              select count(*) from price_series
              where card_variant_id in ${database(existingTargetVariantIds)}
            )::int as series_rows
        `;

  if (
    targetPriceCounts.current_price_rows !== 0 ||
    targetPriceCounts.series_rows !== 0
  ) {
    throw new Error(
      "Reviewed existing targets are no longer empty of prices.",
    );
  }

  return {
    alreadyApplied: false,
    assignments,
    cardIds,
    collectionSnapshot,
    createVariantCount: assignments.filter(
      (assignment) => assignment.mode === "create",
    ).length,
    mappingFingerprint: createPlanFingerprint(
      assignments,
      productPlacements,
    ),
    refInsertCount: assignments.length,
    setCount: new Set(
      assignments.map((assignment) => assignment.setProviderId),
    ).size,
    siblingPlacementCount: assignments.filter(
      (assignment) => assignment.siblingPrinting,
    ).length,
    targetPriceRowCount: targetPriceCounts.current_price_rows,
    targetSeriesRowCount: targetPriceCounts.series_rows,
    variantIds,
  };
}

function isAssignmentApplied(assignment) {
  return (
    assignment.targetVariantId !== null &&
    assignment.targetRefs.length === 1 &&
    String(assignment.targetRefs[0].product_id) ===
      assignment.productId &&
    assignment.targetRefs[0].metadata?.mappingRepair ===
      manifest.repairId
  );
}

function verifyInitialPlacements(assignment, placements) {
  if (!assignment.siblingPrinting) {
    if (placements.length !== 0) {
      throw new Error(
        `Product ${assignment.productId} has an unexpected existing placement.`,
      );
    }
    return;
  }

  if (
    placements.length !== 1 ||
    placements[0].card_provider_id !==
      assignment.cardProviderId ||
    placements[0].printing !== assignment.siblingPrinting ||
    placements[0].condition !== "unspecified" ||
    placements[0].language_code !== "en" ||
    placements[0].metadata?.tcgcsvMappingStatus === "stale"
  ) {
    throw new Error(
      `Sibling evidence drifted for product ${assignment.productId}.`,
    );
  }
}

function verifyAppliedPlacements(assignment, placements) {
  const expectedCount = assignment.siblingPrinting ? 2 : 1;
  const targetPlacement = placements.find(
    (placement) =>
      placement.card_provider_id === assignment.cardProviderId &&
      placement.printing === assignment.printing &&
      placement.condition === "unspecified" &&
      placement.language_code === "en" &&
      placement.metadata?.mappingRepair === manifest.repairId,
  );
  const siblingPlacement = assignment.siblingPrinting
    ? placements.find(
        (placement) =>
          placement.card_provider_id ===
            assignment.cardProviderId &&
          placement.printing === assignment.siblingPrinting &&
          placement.condition === "unspecified" &&
          placement.language_code === "en",
      )
    : null;

  if (
    placements.length !== expectedCount ||
    !targetPlacement ||
    (assignment.siblingPrinting && !siblingPlacement)
  ) {
    throw new Error(
      `Applied placement verification failed for product ${assignment.productId}.`,
    );
  }
}

function createPlanFingerprint(assignments, productPlacements) {
  const state = {
    assignments: assignments.map((assignment) => ({
      cardId: assignment.cardId,
      cardProviderId: assignment.cardProviderId,
      mode: assignment.mode,
      printing: assignment.printing,
      productId: assignment.productId,
      targetVariantId: assignment.targetVariantId,
    })),
    placements: productPlacements.map((placement) => ({
      cardProviderId: placement.card_provider_id,
      printing: placement.printing,
      productId: String(placement.product_id),
      refId: String(placement.ref_id),
      variantId: String(placement.variant_id),
    })),
  };

  return createHash("sha256")
    .update(JSON.stringify(state))
    .digest("hex");
}

async function writeBeforeStateSnapshot(plan) {
  const [
    cards,
    variants,
    externalRefs,
    collectionItems,
    quantityHistory,
    currentPrices,
    priceSeries,
  ] = await Promise.all([
    sql`
      select to_jsonb(cards.*) as row
      from cards
      where id in ${sql(plan.cardIds)}
      order by id
    `,
    sql`
      select to_jsonb(card_variants.*) as row
      from card_variants
      where card_id in ${sql(plan.cardIds)}
      order by id
    `,
    sql`
      select to_jsonb(card_variant_external_refs.*) as row
      from card_variant_external_refs
      where card_variant_id in ${sql(plan.variantIds)}
      order by id
    `,
    sql`
      select to_jsonb(collection_items.*) as row
      from collection_items
      where card_variant_id in ${sql(plan.variantIds)}
      order by id
    `,
    sql`
      select to_jsonb(collection_quantity_history.*) as row
      from collection_quantity_history
      where card_variant_id in ${sql(plan.variantIds)}
      order by user_id, card_variant_id, effective_on
    `,
    sql`
      select to_jsonb(current_prices.*) as row
      from current_prices
      where card_variant_id in ${sql(plan.variantIds)}
      order by card_variant_id, source, price_type, currency
    `,
    sql`
      select to_jsonb(price_series.*) as row
      from price_series
      where card_variant_id in ${sql(plan.variantIds)}
      order by card_variant_id, source, price_type, currency
    `,
  ]);
  const state = {
    cards: cards.map((entry) => entry.row),
    variants: variants.map((entry) => entry.row),
    externalRefs: externalRefs.map((entry) => entry.row),
    collectionItems: collectionItems.map((entry) => entry.row),
    quantityHistory: quantityHistory.map((entry) => entry.row),
    currentPrices: currentPrices.map((entry) => entry.row),
    priceSeries: priceSeries.map((entry) => entry.row),
  };

  if (
    state.cards.length !== manifest.expectedAssignmentCount ||
    state.variants.length !== plan.variantIds.length ||
    state.collectionItems.length !== 0 ||
    state.quantityHistory.length !== 0
  ) {
    throw new Error(
      "The exact pre-repair row snapshot does not match the reviewed plan.",
    );
  }

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(state))
    .digest("hex");
  const snapshot = {
    version: 1,
    repairId: manifest.repairId,
    createdAt: new Date().toISOString(),
    stateFingerprint: fingerprint,
    state,
  };
  const artifactDirectory = path.join(
    process.cwd(),
    ".artifacts",
    "tcgcsv",
  );
  const artifactPath = path.join(
    artifactDirectory,
    `tcgcsv-catalog-product-ref-repair-before-${manifest.reviewedAt}-${fingerprint.slice(0, 12)}.json`,
  );

  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    artifactPath,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
    },
  ).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;

    const existing = JSON.parse(
      await readFile(artifactPath, "utf8"),
    );
    if (
      existing?.stateFingerprint !== fingerprint ||
      JSON.stringify(existing.state) !== JSON.stringify(state)
    ) {
      throw new Error(
        `Existing pre-repair snapshot does not match its content-addressed path: ${artifactPath}`,
      );
    }
  });

  return path.relative(process.cwd(), artifactPath);
}

async function getCollectionSnapshot(database, variantIds) {
  if (variantIds.length === 0) {
    return {
      collectionRows: 0,
      quantityHistoryRows: 0,
    };
  }

  const [row] = await database`
    select
      (
        select count(*) from collection_items
        where card_variant_id in ${database(variantIds)}
      )::int as collection_rows,
      (
        select count(*) from collection_quantity_history
        where card_variant_id in ${database(variantIds)}
      )::int as quantity_history_rows
  `;

  return {
    collectionRows: row.collection_rows,
    quantityHistoryRows: row.quantity_history_rows,
  };
}

function groupRows(rows, getKey) {
  const grouped = new Map();

  for (const row of rows) {
    const key = getKey(row);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  return grouped;
}

function getTargetKey(cardProviderId, printing) {
  return `${cardProviderId}:${printing}`;
}

function assertCollectionSnapshotUnchanged(before, after) {
  if (
    before.collectionRows !== after.collectionRows ||
    before.quantityHistoryRows !== after.quantityHistoryRows
  ) {
    throw new Error(
      "Collection safety snapshot changed during the repair.",
    );
  }
}
