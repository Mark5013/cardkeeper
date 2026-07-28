import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

import repairManifest from "./data/tcgcsv-sv-promo-printing-repairs-2026-07-26.json" with {
  type: "json",
};
import promoPrereleaseRepairManifest from "./data/tcgcsv-promo-prerelease-printing-repairs-2026-07-26.json" with {
  type: "json",
};
import englishQualifiedPrintingRepairManifest from "./data/tcgcsv-english-qualified-printing-repairs-2026-07-27.json" with {
  type: "json",
};
import englishQualifiedPrintingFollowupManifest from "./data/tcgcsv-english-qualified-printing-followup-2026-07-27.json" with {
  type: "json",
};
import englishQualifiedPrintingFinalManifest from "./data/tcgcsv-english-qualified-printing-final-2026-07-27.json" with {
  type: "json",
};
import {
  doesTcgcsvProductNameMatchCard,
  normalizeTcgcsvCollectorNumber,
} from "./lib/tcgcsv-group-matching.mjs";
import {
  classifyReviewedTcgcsvQualifiedPrinting,
  getTcgcsvQualifiedPrintingSourcePrinting,
} from "./lib/tcgcsv-qualified-printing.mjs";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const options = parseArgs(process.argv.slice(2));
const manifest =
  options.batch === "promo-prerelease"
    ? validatePromoPrereleaseManifest(promoPrereleaseRepairManifest)
    : options.batch === "english-closeout"
      ? validateEnglishCloseoutManifest(
          englishQualifiedPrintingRepairManifest,
        )
      : options.batch === "english-followup"
        ? validateEnglishCloseoutManifest(
            englishQualifiedPrintingFollowupManifest,
          )
      : options.batch === "english-final"
        ? validateEnglishCloseoutManifest(
            englishQualifiedPrintingFinalManifest,
          )
    : validateSvPromoManifest(repairManifest);

if (!process.env.DATABASE_URL) {
  throw new Error(
    `DATABASE_URL is required to repair ${manifest.batchLabel} printings.`,
  );
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

try {
  await repairPrintings();
} finally {
  await sql.end();
}

function parseArgs(args) {
  const parsed = {
    apply: false,
    batch: "sv",
    rollback: false,
  };

  for (const arg of args) {
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--batch=promo-prerelease") {
      parsed.batch = "promo-prerelease";
    } else if (arg === "--batch=english-closeout") {
      parsed.batch = "english-closeout";
    } else if (arg === "--batch=english-followup") {
      parsed.batch = "english-followup";
    } else if (arg === "--batch=english-final") {
      parsed.batch = "english-final";
    }
    else if (arg === "--rollback") {
      parsed.apply = true;
      parsed.rollback = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function validateSvPromoManifest(input) {
  if (
    input?.version !== 1 ||
    input.groupId !== 22872 ||
    input.setProviderId !== "svp" ||
    !Array.isArray(input.assignments) ||
    input.assignments.length !== input.expectedProductCount
  ) {
    throw new Error("Invalid SV promo printing repair manifest header.");
  }

  const assignments = input.assignments.map((entry, index) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 4 ||
      !/^svp-\d+$/.test(entry[0]) ||
      !/^(?:holofoil|normal)$/.test(entry[1]) ||
      !/^[1-9]\d{0,14}$/.test(entry[2]) ||
      !/^[a-z0-9_]+$/.test(entry[3])
    ) {
      throw new Error(`Invalid repair assignment at index ${index}.`);
    }

    return {
      cardProviderId: entry[0],
      groupId: String(input.groupId),
      groupName: null,
      productName: null,
      sourcePrinting: entry[1],
      setProviderId: input.setProviderId,
      productId: entry[2],
      targetPrinting: entry[3],
    };
  });
  const productIds = assignments.map((assignment) => assignment.productId);
  const cardIds = new Set(
    assignments.map((assignment) => assignment.cardProviderId),
  );

  if (
    new Set(productIds).size !== productIds.length ||
    cardIds.size !== input.expectedCardCount
  ) {
    throw new Error("The SV promo repair manifest has duplicate or miscounted identities.");
  }

  for (const cardProviderId of cardIds) {
    const cardAssignments = assignments.filter(
      (assignment) => assignment.cardProviderId === cardProviderId,
    );

    if (
      cardAssignments.length !== 2 ||
      new Set(
        cardAssignments.map((assignment) => assignment.sourcePrinting),
      ).size !== 1 ||
      new Set(
        cardAssignments.map((assignment) => assignment.targetPrinting),
      ).size !== 2
    ) {
      throw new Error(
        `Expected two distinct physical identities for ${cardProviderId}.`,
      );
    }
  }

  return {
    ...input,
    assignments,
    batchLabel: "Scarlet & Violet promo",
    expectedGroupCount: 1,
    snapshotSlug: "sv-promo",
  };
}

function validatePromoPrereleaseManifest(input) {
  if (
    input?.version !== 1 ||
    !Array.isArray(input.groups) ||
    input.groups.length !== input.expectedGroupCount
  ) {
    throw new Error("Invalid promo Prerelease repair manifest header.");
  }

  const assignments = [];
  const groupIds = new Set();
  const setProviderIds = new Set();

  for (const [groupIndex, group] of input.groups.entries()) {
    if (
      !/^[a-z0-9]+$/.test(group?.setProviderId ?? "") ||
      !Number.isInteger(group?.groupId) ||
      group.groupId <= 0 ||
      typeof group.groupName !== "string" ||
      !group.groupName.trim() ||
      group.sourcePrinting !== "holofoil" ||
      !Array.isArray(group.cards)
    ) {
      throw new Error(
        `Invalid promo Prerelease group at index ${groupIndex}.`,
      );
    }

    if (
      groupIds.has(String(group.groupId)) ||
      setProviderIds.has(group.setProviderId)
    ) {
      throw new Error("Duplicate promo Prerelease group identity.");
    }
    groupIds.add(String(group.groupId));
    setProviderIds.add(group.setProviderId);

    for (const [cardIndex, card] of group.cards.entries()) {
      if (
        !Array.isArray(card) ||
        card.length !== 5 ||
        !card[0].startsWith(`${group.setProviderId}-`) ||
        !/^[1-9]\d{0,14}$/.test(card[1]) ||
        typeof card[2] !== "string" ||
        !/\(Prerelease\)$/.test(card[2]) ||
        !/^[1-9]\d{0,14}$/.test(card[3]) ||
        typeof card[4] !== "string" ||
        !/\(Prerelease\) \[Staff\]$/i.test(card[4])
      ) {
        throw new Error(
          `Invalid promo Prerelease card at group ${groupIndex}, index ${cardIndex}.`,
        );
      }

      const common = {
        cardProviderId: card[0],
        groupId: String(group.groupId),
        groupName: group.groupName,
        setProviderId: group.setProviderId,
        sourcePrinting: group.sourcePrinting,
      };
      assignments.push(
        {
          ...common,
          productId: card[1],
          productName: card[2],
          targetPrinting: "prerelease_holofoil",
        },
        {
          ...common,
          productId: card[3],
          productName: card[4],
          targetPrinting: "prerelease_staff_holofoil",
        },
      );
    }
  }

  const productIds = assignments.map((assignment) => assignment.productId);
  const cardProviderIds = new Set(
    assignments.map((assignment) => assignment.cardProviderId),
  );
  if (
    assignments.length !== input.expectedProductCount ||
    new Set(productIds).size !== productIds.length ||
    cardProviderIds.size !== input.expectedCardCount
  ) {
    throw new Error(
      "The promo Prerelease repair manifest has duplicate or miscounted identities.",
    );
  }

  for (const cardProviderId of cardProviderIds) {
    const cardAssignments = assignments.filter(
      (assignment) => assignment.cardProviderId === cardProviderId,
    );
    if (
      cardAssignments.length !== 2 ||
      new Set(
        cardAssignments.map((assignment) => assignment.targetPrinting),
      ).size !== 2
    ) {
      throw new Error(
        `Expected one Prerelease and one Staff identity for ${cardProviderId}.`,
      );
    }
  }

  return {
    ...input,
    assignments,
    batchLabel: "BW/XY/SM/SWSH promo Prerelease",
    snapshotSlug: "promo-prerelease",
  };
}

function validateEnglishCloseoutManifest(input) {
  if (
    input?.version !== 1 ||
    input.clearSourceHistory !== true ||
    !Array.isArray(input.sources) ||
    input.sources.length !== input.expectedVariantCount
  ) {
    throw new Error(
      "Invalid English qualified-printing closeout manifest header.",
    );
  }

  const assignments = [];
  const sourceKeys = new Set();

  for (const [sourceIndex, source] of input.sources.entries()) {
    if (
      !Array.isArray(source) ||
      source.length !== 3 ||
      !/^[A-Za-z0-9._-]+$/.test(source[0]) ||
      !/^(?:holofoil|normal|reverse_holofoil)$/.test(source[1]) ||
      !Array.isArray(source[2]) ||
      source[2].length < 2
    ) {
      throw new Error(
        `Invalid English closeout source at index ${sourceIndex}.`,
      );
    }

    const [cardProviderId, sourcePrinting, products] = source;
    const sourceKey = `${cardProviderId}:${sourcePrinting}`;
    if (sourceKeys.has(sourceKey)) {
      throw new Error(`Duplicate English closeout source ${sourceKey}.`);
    }
    sourceKeys.add(sourceKey);

    for (const [productIndex, product] of products.entries()) {
      if (
        !Array.isArray(product) ||
        product.length !== 4 ||
        !/^[1-9]\d{0,14}$/.test(product[0]) ||
        !Number.isInteger(product[1]) ||
        product[1] <= 0 ||
        typeof product[2] !== "string" ||
        !product[2].trim() ||
        !/^[a-z0-9_]+$/.test(product[3]) ||
        getTcgcsvQualifiedPrintingSourcePrinting(product[3]) !==
          sourcePrinting
      ) {
        throw new Error(
          `Invalid English closeout product at source ${sourceIndex}, index ${productIndex}.`,
        );
      }

      assignments.push({
        cardProviderId,
        groupId: String(product[1]),
        groupName: null,
        productId: product[0],
        productName: product[2],
        setProviderId: cardProviderId.split("-")[0],
        sourcePrinting,
        targetPrinting: product[3],
      });
    }
  }

  const assignmentKeys = assignments.map(
    (assignment) =>
      `${assignment.cardProviderId}:${assignment.sourcePrinting}:${assignment.productId}`,
  );
  const cardProviderIds = new Set(
    assignments.map((assignment) => assignment.cardProviderId),
  );
  if (
    assignments.length !== input.expectedProductCount ||
    new Set(assignmentKeys).size !== assignmentKeys.length ||
    cardProviderIds.size !== input.expectedCardCount
  ) {
    throw new Error(
      "The English closeout manifest has duplicate or miscounted identities.",
    );
  }

  return {
    ...input,
    assignments,
    batchLabel: "English qualified-printing closeout",
    expectedGroupCount: new Set(
      assignments.map((assignment) => assignment.groupId),
    ).size,
    snapshotSlug: "english-qualified-printing-closeout",
  };
}

async function repairPrintings() {
  const plan = await buildRepairPlan(sql);

  if (plan.alreadyApplied) {
    console.log(
      `The reviewed ${manifest.expectedCardCount}-card ${manifest.batchLabel} printing repair is already applied; no rows were changed.`,
    );
    return;
  }

  console.log(
    `Verified ${manifest.expectedProductCount} exact products across ${manifest.expectedCardCount} cards in ${manifest.expectedGroupCount} TCGCSV group(s).`,
  );
  console.log(
    `Plan: retain ${plan.retainedRefCount} ordinary refs, create ${plan.destinationCount} qualified variants, move ${plan.movedRefCount} refs, and retire ${plan.retiredSourceVariantIds.length} empty generic variants.`,
  );
  console.log(
    `Collection safety: ${plan.collectionSnapshot.collectionRows} collection rows / ${plan.collectionSnapshot.quantityHistoryRows} quantity-history rows. Current/history price rows on sources: ${plan.sourcePriceRowCount}/${plan.sourceSeriesRowCount}.`,
  );
  if (
    manifest.clearSourceCurrentPrices ||
    manifest.clearSourceHistory
  ) {
    console.log(
      `Price reset: ${manifest.clearSourceCurrentPrices ? plan.sourcePriceRowCount : 0} ambiguous current row(s) and ${manifest.clearSourceHistory ? plan.sourceSeriesRowCount : 0} source series row(s) will be cleared before the reviewed rebuild.`,
    );
  }

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
          "Qualified promo mapping state changed after the pre-repair snapshot.",
        );
      }

      if (
        manifest.clearSourceCurrentPrices &&
        lockedPlan.sourcePriceRowCount > 0
      ) {
        const deletedCurrentPrices = await transaction`
          delete from current_prices
          where card_variant_id in ${transaction(
            lockedPlan.sourceVariantIds,
          )}
            and source = 'tcgcsv'
          returning id
        `;

        if (
          deletedCurrentPrices.length !==
          lockedPlan.sourcePriceRowCount
        ) {
          throw new Error(
            "Failed to clear every ambiguous TCGCSV current price.",
          );
        }
      }

      if (
        manifest.clearSourceHistory &&
        lockedPlan.sourceSeriesRowCount > 0
      ) {
        const deletedSeries = await transaction`
          delete from price_series
          where card_variant_id in ${transaction(
            lockedPlan.sourceVariantIds,
          )}
            and source = 'tcgcsv'
          returning card_variant_id
        `;

        if (
          deletedSeries.length !==
          lockedPlan.sourceSeriesRowCount
        ) {
          throw new Error(
            "Failed to clear every ambiguous TCGCSV source series.",
          );
        }
      }

      const destinationIds = new Map();

      for (const destination of lockedPlan.destinations) {
        const [variant] = await transaction`
          insert into card_variants (
            card_id,
            printing,
            condition,
            language_code
          )
          values (
            ${destination.cardId},
            ${destination.printing},
            'unspecified',
            'en'
          )
          on conflict (card_id, printing, condition, language_code)
          do update set updated_at = now()
          returning id
        `;
        destinationIds.set(destination.key, String(variant.id));
      }

      for (const assignment of lockedPlan.assignmentsToMove) {
        const destinationId = destinationIds.get(
          getDestinationKey(
            assignment.cardId,
            assignment.targetPrinting,
          ),
        );

        if (!destinationId) {
          throw new Error(
            `Missing destination variant for ${assignment.cardProviderId}:${assignment.targetPrinting}.`,
          );
        }

        const repairMetadata = {
          mappingRepair: manifest.repairId,
          mappingReviewedAt: manifest.reviewedAt,
          tcgcsvGroupId: assignment.groupId,
          tcgcsvProductName: assignment.productName,
          tcgcsvQualifiedPrinting: assignment.targetPrinting,
          tcgcsvProductQualifier: assignment.qualifier,
          tcgcsvSubTypeName:
            getTcgcsvQualifiedPrintingSourcePrinting(
              assignment.targetPrinting,
            ) === "holofoil"
              ? "Holofoil"
              : getTcgcsvQualifiedPrintingSourcePrinting(
                    assignment.targetPrinting,
                  ) === "reverse_holofoil"
                ? "Reverse Holofoil"
              : "Normal",
        };
        if (assignment.groupName) {
          repairMetadata.tcgcsvGroupName = assignment.groupName;
        }
        for (const [key, value] of Object.entries(repairMetadata)) {
          if (value === null) delete repairMetadata[key];
        }

        const rows = await transaction`
          update card_variant_external_refs
          set
            card_variant_id = ${destinationId},
            metadata =
              coalesce(metadata, '{}'::jsonb) ||
              ${transaction.json(repairMetadata)}::jsonb,
            updated_at = now()
          where id = ${assignment.refId}
          returning id
        `;

        if (rows.length !== 1) {
          throw new Error(
            `Failed to move reviewed product ${assignment.productId}.`,
          );
        }
      }

      if (lockedPlan.retiredSourceVariantIds.length > 0) {
        const deleted = await transaction`
          delete from card_variants
          where id in ${transaction(lockedPlan.retiredSourceVariantIds)}
          returning id
        `;

        if (
          deleted.length !== lockedPlan.retiredSourceVariantIds.length
        ) {
          throw new Error("Failed to retire every empty generic source variant.");
        }
      }

      const postPlan = await buildRepairPlan(transaction);
      if (!postPlan.alreadyApplied) {
        throw new Error(
          "Qualified promo repair postcondition verification failed.",
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
    `Applied ${manifest.expectedCardCount}-card ${manifest.batchLabel} printing repair: created ${plan.destinationCount} qualified variants, moved ${plan.movedRefCount} refs, and retired ${plan.retiredSourceVariantIds.length} empty generic variants.`,
  );
  console.log(
    "Run the scoped current-price refresh when the TCGCSV request window opens, then rebuild history with --reset-stage.",
  );
}

async function buildRepairPlan(database) {
  const productIds = manifest.assignments.map(
    (assignment) => assignment.productId,
  );
  const rows = await database`
    select
      external_ref.id as ref_id,
      external_ref.ref_value as product_id,
      external_ref.metadata,
      variant.id as variant_id,
      variant.printing,
      variant.condition,
      variant.language_code,
      card.id as card_id,
      card.provider_id as card_provider_id,
      card.name as card_name,
      card.number as card_number,
      card_set.provider_id as set_provider_id
    from card_variant_external_refs as external_ref
    inner join card_variants as variant
      on variant.id = external_ref.card_variant_id
    inner join cards as card on card.id = variant.card_id
    inner join card_sets as card_set on card_set.id = card.set_id
    where external_ref.source = 'tcgplayer'
      and external_ref.ref_type = 'product_id'
      and external_ref.ref_value in ${database(productIds)}
    order by external_ref.ref_value
  `;

  const rowsByProductId = new Map();
  for (const row of rows) {
    const productId = String(row.product_id);
    const productRows = rowsByProductId.get(productId) ?? [];
    productRows.push(row);
    rowsByProductId.set(productId, productRows);
  }
  const getAssignmentRows = (assignment, printing) =>
    (rowsByProductId.get(assignment.productId) ?? []).filter(
      (row) =>
        row.card_provider_id === assignment.cardProviderId &&
        row.set_provider_id === assignment.setProviderId &&
        row.printing === printing &&
        row.condition === "unspecified" &&
        row.language_code === "en",
    );
  const targetRows = manifest.assignments.map((assignment) =>
    getAssignmentRows(assignment, assignment.targetPrinting),
  );
  const atTarget = targetRows.every(
    (assignmentRows) => assignmentRows.length === 1,
  );
  const stateRows = atTarget
    ? targetRows.flat()
    : manifest.assignments.flatMap((assignment) =>
        getAssignmentRows(assignment, assignment.sourcePrinting),
      );
  const involvedVariantIds = [
    ...new Set(stateRows.map((row) => String(row.variant_id))),
  ];
  const collectionSnapshot = await getCollectionSnapshot(
    database,
    involvedVariantIds,
  );

  if (atTarget) {
    for (const [index, assignment] of manifest.assignments.entries()) {
      verifyProductEvidence(
        assignment,
        targetRows[index][0],
      );
    }

    const allTargetRefs = await database`
      select source, ref_type, ref_value
      from card_variant_external_refs
      where card_variant_id in ${database(involvedVariantIds)}
    `;

    if (
      allTargetRefs.length !== manifest.expectedProductCount ||
      allTargetRefs.some(
        (row) =>
          row.source !== "tcgplayer" ||
          row.ref_type !== "product_id" ||
          !productIds.includes(String(row.ref_value)),
      )
    ) {
      throw new Error("An applied destination contains an unreviewed product ref.");
    }

    return {
      alreadyApplied: true,
      collectionSnapshot,
    };
  }

  const assignments = manifest.assignments.map((assignment) => {
    const assignmentRows = getAssignmentRows(
      assignment,
      assignment.sourcePrinting,
    );
    const row = assignmentRows[0];

    if (
      assignmentRows.length !== 1
    ) {
      throw new Error(
        `Repair is partially applied or drifted for product ${assignment.productId}.`,
      );
    }

    verifyProductEvidence(assignment, row);
    return {
      ...assignment,
      cardId: String(row.card_id),
      qualifier:
        classifyReviewedTcgcsvQualifiedPrinting({
          groupId: assignment.groupId,
          productId: assignment.productId,
          productName:
            assignment.productName ??
            row.metadata?.tcgcsvProductName,
          sourcePrinting: assignment.sourcePrinting,
        }).qualifier,
      refId: String(row.ref_id),
      sourceVariantId: String(row.variant_id),
    };
  });
  const sourceVariantIds = [
    ...new Set(assignments.map((assignment) => assignment.sourceVariantId)),
  ];
  const sourceRefs = await database`
    select card_variant_id, source, ref_type, ref_value
    from card_variant_external_refs
    where card_variant_id in ${database(sourceVariantIds)}
  `;

  if (
    sourceRefs.length !== manifest.expectedProductCount ||
    sourceRefs.some(
      (row) =>
        row.source !== "tcgplayer" ||
        row.ref_type !== "product_id" ||
        !productIds.includes(String(row.ref_value)),
    )
  ) {
    throw new Error("A source variant contains an unreviewed product ref.");
  }

  const assignmentsToMove = assignments.filter(
    (assignment) =>
      assignment.targetPrinting !== assignment.sourcePrinting,
  );
  const destinations = [
    ...new Map(
      assignmentsToMove.map((assignment) => {
        const key = getDestinationKey(
          assignment.cardId,
          assignment.targetPrinting,
        );
        return [
          key,
          {
            cardId: assignment.cardId,
            key,
            printing: assignment.targetPrinting,
          },
        ];
      }),
    ).values(),
  ];
  const destinationRows =
    destinations.length === 0
      ? []
      : await database`
          select card_id, printing
          from card_variants
          where card_id in ${database(
            [...new Set(destinations.map((destination) => destination.cardId))],
          )}
            and printing in ${database(
              [...new Set(destinations.map((destination) => destination.printing))],
            )}
            and condition = 'unspecified'
            and language_code = 'en'
        `;

  if (destinationRows.length > 0) {
    throw new Error("A reviewed destination variant already exists; refusing a partial repair.");
  }

  const retainedSourceVariantIds = new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.targetPrinting === assignment.sourcePrinting,
      )
      .map((assignment) => assignment.sourceVariantId),
  );
  const retiredSourceVariantIds = sourceVariantIds.filter(
    (variantId) => !retainedSourceVariantIds.has(variantId),
  );
  const [priceCounts] = await database`
    select
      (
        select count(*) from current_prices
        where card_variant_id in ${database(sourceVariantIds)}
      )::int as current_price_rows,
      (
        select count(*) from price_series
        where card_variant_id in ${database(sourceVariantIds)}
      )::int as series_rows
  `;

  if (
    collectionSnapshot.collectionRows !== 0 ||
    collectionSnapshot.quantityHistoryRows !== 0 ||
    (!manifest.clearSourceCurrentPrices &&
      priceCounts.current_price_rows !== 0) ||
    (!manifest.clearSourceHistory &&
      priceCounts.series_rows !== 0)
  ) {
    throw new Error(
      "Reviewed source variants are no longer empty of collections or prices.",
    );
  }

  return {
    alreadyApplied: false,
    assignmentsToMove,
    collectionSnapshot,
    destinationCount: destinations.length,
    destinations,
    movedRefCount: assignmentsToMove.length,
    mappingFingerprint: createPlanFingerprint(assignments),
    retainedRefCount:
      manifest.expectedProductCount - assignmentsToMove.length,
    retiredSourceVariantIds,
    sourceVariantIds,
    sourcePriceRowCount: priceCounts.current_price_rows,
    sourceSeriesRowCount: priceCounts.series_rows,
  };
}

function createPlanFingerprint(assignments) {
  const state = assignments.map((assignment) => ({
    cardId: assignment.cardId,
    cardProviderId: assignment.cardProviderId,
    productId: assignment.productId,
    refId: assignment.refId,
    sourcePrinting: assignment.sourcePrinting,
    sourceVariantId: assignment.sourceVariantId,
    targetPrinting: assignment.targetPrinting,
  }));

  return createHash("sha256")
    .update(JSON.stringify(state))
    .digest("hex");
}

async function writeBeforeStateSnapshot(plan) {
  const destinationCardIds = [
    ...new Set(
      plan.destinations.map((destination) => destination.cardId),
    ),
  ];
  const destinationPrintings = [
    ...new Set(
      plan.destinations.map((destination) => destination.printing),
    ),
  ];
  const [
    sourceVariants,
    productRefs,
    destinationVariants,
    collectionItems,
    quantityHistory,
    currentPrices,
    priceSeries,
  ] = await Promise.all([
    sql`
      select to_jsonb(card_variants.*) as row
      from card_variants
      where id in ${sql(plan.sourceVariantIds)}
      order by id
    `,
    sql`
      select to_jsonb(card_variant_external_refs.*) as row
      from card_variant_external_refs
      where card_variant_id in ${sql(plan.sourceVariantIds)}
      order by ref_value, id
    `,
    destinationCardIds.length === 0
      ? []
      : sql`
          select to_jsonb(card_variants.*) as row
          from card_variants
          where card_id in ${sql(destinationCardIds)}
            and printing in ${sql(destinationPrintings)}
            and condition = 'unspecified'
            and language_code = 'en'
          order by id
        `,
    sql`
      select to_jsonb(collection_items.*) as row
      from collection_items
      where card_variant_id in ${sql(plan.sourceVariantIds)}
      order by id
    `,
    sql`
      select to_jsonb(collection_quantity_history.*) as row
      from collection_quantity_history
      where card_variant_id in ${sql(plan.sourceVariantIds)}
      order by user_id, card_variant_id, effective_on
    `,
    sql`
      select to_jsonb(current_prices.*) as row
      from current_prices
      where card_variant_id in ${sql(plan.sourceVariantIds)}
      order by card_variant_id
    `,
    sql`
      select to_jsonb(price_series.*) as row
      from price_series
      where card_variant_id in ${sql(plan.sourceVariantIds)}
      order by card_variant_id
    `,
  ]);
  const state = {
    sourceVariants: sourceVariants.map((entry) => entry.row),
    productRefs: productRefs.map((entry) => entry.row),
    destinationVariants: destinationVariants.map((entry) => entry.row),
    collectionItems: collectionItems.map((entry) => entry.row),
    quantityHistory: quantityHistory.map((entry) => entry.row),
    currentPrices: currentPrices.map((entry) => entry.row),
    priceSeries: priceSeries.map((entry) => entry.row),
  };

  if (
    state.sourceVariants.length !== plan.sourceVariantIds.length ||
    state.productRefs.length !== manifest.expectedProductCount ||
    state.destinationVariants.length !== 0 ||
    state.collectionItems.length !== 0 ||
    state.quantityHistory.length !== 0 ||
    state.currentPrices.length !== plan.sourcePriceRowCount ||
    state.priceSeries.length !== plan.sourceSeriesRowCount
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
    `tcgcsv-${manifest.snapshotSlug}-repair-before-${manifest.reviewedAt}-${fingerprint.slice(0, 12)}.json`,
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

function verifyProductEvidence(assignment, row) {
  const recordedGroupId = String(
    row.metadata?.tcgcsvGroupId ?? "",
  ).trim();
  const recordedGroupName = String(
    row.metadata?.tcgcsvGroupName ?? "",
  ).trim();
  const recordedProductName = String(
    row.metadata?.tcgcsvProductName ?? "",
  ).trim();
  const productName =
    assignment.productName ?? recordedProductName;
  const subtype = String(row.metadata?.tcgcsvSubTypeName ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
  const classification = classifyReviewedTcgcsvQualifiedPrinting({
    groupId: assignment.groupId,
    productId: assignment.productId,
    productName,
    sourcePrinting: assignment.sourcePrinting,
  });
  const classifiedPrinting =
    classification.status === "qualified"
      ? classification.printing
      : assignment.sourcePrinting;
  const productNumber =
    productName.match(/\s+-\s+0*(\d+)\b/)?.[1] ?? "";

  if (
    (recordedGroupId &&
      recordedGroupId !== assignment.groupId) ||
    (assignment.groupName &&
      recordedGroupName &&
      recordedGroupName !== assignment.groupName) ||
    (assignment.productName &&
      recordedProductName &&
      recordedProductName !== assignment.productName) ||
    (!assignment.productName &&
      !doesTcgcsvProductNameMatchCard({
        cardName: row.card_name,
        productName,
      })) ||
    (productNumber &&
      normalizeTcgcsvCollectorNumber(productNumber) !==
        normalizeTcgcsvCollectorNumber(row.card_number)) ||
    (subtype &&
      subtype !==
        getTcgcsvQualifiedPrintingSourcePrinting(
          assignment.targetPrinting,
        )) ||
    classifiedPrinting !== assignment.targetPrinting
  ) {
    throw new Error(
      `Reviewed evidence drifted for product ${assignment.productId} "${productName}".`,
    );
  }
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

function getDestinationKey(cardId, printing) {
  return `${cardId}:${printing}`;
}

function assertCollectionSnapshotUnchanged(before, after) {
  if (
    before.collectionRows !== after.collectionRows ||
    before.quantityHistoryRows !== after.quantityHistoryRows
  ) {
    throw new Error("Collection safety snapshot changed during the repair.");
  }
}
