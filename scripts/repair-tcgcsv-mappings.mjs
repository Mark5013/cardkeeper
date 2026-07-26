import nextEnv from "@next/env";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to repair TCGCSV mappings.");
}

const planPath = resolve(options.planPath);
assertPlanInsideWorkspace(planPath);
const plan = validatePlan(
  JSON.parse(await readFile(planPath, "utf8")),
);
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

try {
  await repairMappings();
} finally {
  await sql.end();
}

function parseArgs(args) {
  const parsed = {
    apply: false,
    planPath: null,
  };

  for (const arg of args) {
    if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg.startsWith("--plan=")) {
      parsed.planPath = arg.slice("--plan=".length).trim();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.planPath) {
    throw new Error("--plan=<workspace-relative JSON file> is required.");
  }

  return parsed;
}

function assertPlanInsideWorkspace(path) {
  const relativePath = relative(process.cwd(), path);

  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("The mapping repair plan must be inside the workspace.");
  }
}

function validatePlan(input) {
  if (
    !input ||
    input.version !== 1 ||
    input.source !== "tcgplayer" ||
    input.refType !== "product_id" ||
    !Array.isArray(input.repairs) ||
    !Array.isArray(input.historyRebuildIdentities) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.historyTrustedFrom ?? "") ||
    !Number.isInteger(input.expectedRefCount) ||
    input.expectedRefCount !== input.repairs.length
  ) {
    throw new Error("The mapping repair plan has an invalid header.");
  }

  const repairs = input.repairs.map((repair, index) => {
    if (
      !repair ||
      !/^[1-9]\d*$/.test(String(repair.productId ?? "")) ||
      !/^[A-Za-z0-9._-]+$/.test(String(repair.cardProviderId ?? "")) ||
      !/^[a-z0-9_]+$/.test(String(repair.printing ?? "")) ||
      !["collector_denominator", "cross_card"].includes(repair.reason)
    ) {
      throw new Error(`Invalid mapping repair at index ${index}.`);
    }

    return {
      cardProviderId: String(repair.cardProviderId),
      printing: String(repair.printing),
      productId: String(repair.productId),
      reason: repair.reason,
    };
  });
  const keys = repairs.map(getRepairKey);

  if (new Set(keys).size !== keys.length) {
    throw new Error("The mapping repair plan contains duplicate identities.");
  }

  const repairVariantKeys = new Set(
    repairs.map(
      (repair) => `${repair.cardProviderId}:${repair.printing}`,
    ),
  );
  const historyRebuildIdentities = input.historyRebuildIdentities.map(
    (identity, index) => {
      if (
        !identity ||
        !/^[A-Za-z0-9._-]+$/.test(
          String(identity.cardProviderId ?? ""),
        ) ||
        !/^[a-z0-9_]+$/.test(String(identity.printing ?? ""))
      ) {
        throw new Error(`Invalid history rebuild identity at index ${index}.`);
      }

      const normalizedIdentity = {
        cardProviderId: String(identity.cardProviderId),
        printing: String(identity.printing),
      };
      const key = `${normalizedIdentity.cardProviderId}:${normalizedIdentity.printing}`;

      if (!repairVariantKeys.has(key)) {
        throw new Error(
          `History rebuild identity ${key} has no corresponding mapping repair.`,
        );
      }

      return normalizedIdentity;
    },
  );
  const historyKeys = historyRebuildIdentities.map(
    (identity) => `${identity.cardProviderId}:${identity.printing}`,
  );

  if (new Set(historyKeys).size !== historyKeys.length) {
    throw new Error(
      "The mapping repair plan contains duplicate history rebuild identities.",
    );
  }

  return {
    ...input,
    historyRebuildIdentities,
    repairs,
  };
}

function getRepairKey(repair) {
  return `${repair.productId}:${repair.cardProviderId}:${repair.printing}`;
}

async function repairMappings() {
  const productIds = [...new Set(plan.repairs.map((repair) => repair.productId))];
  const rows = await sql`
    select
      external_ref.id as ref_id,
      external_ref.ref_value as product_id,
      variant.id as card_variant_id,
      variant.printing,
      variant.condition,
      card.provider_id as card_provider_id,
      card.name as card_name,
      card_set.name as set_name
    from card_variant_external_refs as external_ref
    inner join card_variants as variant
      on variant.id = external_ref.card_variant_id
    inner join cards as card
      on card.id = variant.card_id
    inner join card_sets as card_set
      on card_set.id = card.set_id
    where external_ref.source = ${plan.source}
      and external_ref.ref_type = ${plan.refType}
      and external_ref.ref_value in ${sql(productIds)}
  `;
  const rowsByKey = new Map();

  for (const row of rows) {
    const key = getRepairKey({
      cardProviderId: row.card_provider_id,
      printing: row.printing,
      productId: row.product_id,
    });
    const matches = rowsByKey.get(key) ?? [];
    matches.push(row);
    rowsByKey.set(key, matches);
  }

  const matchesByRepair = plan.repairs.map((repair) => ({
    matches: rowsByKey.get(getRepairKey(repair)) ?? [],
    repair,
  }));
  const missingRepairs = matchesByRepair.filter(
    ({ matches }) => matches.length === 0,
  );

  if (missingRepairs.length === plan.repairs.length) {
    console.log(
      `The reviewed ${plan.expectedRefCount.toLocaleString()}-ref mapping repair is already applied; no database rows were changed.`,
    );
    return;
  }

  if (missingRepairs.length > 0) {
    throw new Error(
      `The mapping repair is only partially applied: ${missingRepairs.length} of ${plan.expectedRefCount} reviewed refs are already absent. Database state was not changed.`,
    );
  }

  const verifiedRows = matchesByRepair.map(({ matches, repair }) => {
    if (matches.length !== 1 || matches[0].condition !== "unspecified") {
      throw new Error(
        `Expected exactly one unspecified-condition ref for ${getRepairKey(repair)}, found ${matches.length}. Database state was not changed.`,
      );
    }

    return {
      ...matches[0],
      reason: repair.reason,
    };
  });
  const refIds = verifiedRows.map((row) => row.ref_id);
  const affectedVariantIds = [
    ...new Set(verifiedRows.map((row) => row.card_variant_id)),
  ];

  console.log(
    `Verified ${verifiedRows.length.toLocaleString()} reviewed refs across ${affectedVariantIds.length.toLocaleString()} variants from ${plan.auditedAt}.`,
  );

  if (!options.apply) {
    console.log(
      "Dry run complete; pass --apply to remove these refs and reset only their current TCGCSV prices. Historical rows will not be deleted.",
    );
    return;
  }

  const result = await sql.begin(async (transaction) => {
    const deletedRefs = await transaction`
      delete from card_variant_external_refs
      where id in ${transaction(refIds)}
      returning id
    `;
    const deletedCurrentPrices = await transaction`
      delete from current_prices
      where card_variant_id in ${transaction(affectedVariantIds)}
        and source = 'tcgcsv'
      returning id
    `;

    if (deletedRefs.length !== plan.expectedRefCount) {
      throw new Error(
        `Expected to remove ${plan.expectedRefCount} refs, removed ${deletedRefs.length}.`,
      );
    }

    return {
      deletedCurrentPriceCount: deletedCurrentPrices.length,
      deletedRefCount: deletedRefs.length,
    };
  });

  console.log(
    `Removed ${result.deletedRefCount.toLocaleString()} invalid refs and ${result.deletedCurrentPriceCount.toLocaleString()} affected current-price rows. Historical price rows were preserved for a scoped rebuild.`,
  );
}
