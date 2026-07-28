import nextEnv from "@next/env";
import postgres from "postgres";

import {
  classifyTcgcsvProduct,
  getExtendedDataValue,
} from "./lib/tcgcsv-product-import.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required to audit Japanese unnumbered products.",
  );
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 20,
});

try {
  const rows = await sql`
    select
      card.id,
      card.provider_id,
      card.name,
      card.number,
      card.rarity,
      card_set.name as group_name,
      card.provider_data -> 'tcgcsv' as product,
      (
        select array_agg(variant.printing order by variant.printing)
        from card_variants as variant
        where variant.card_id = card.id
      ) as printings,
      (
        select count(*)::integer
        from card_variants as variant
        inner join collection_items as item
          on item.card_variant_id = variant.id
        where variant.card_id = card.id
      ) as collection_rows
    from cards as card
    inner join card_sets as card_set on card_set.id = card.set_id
    where card.language_code = 'ja'
      and card.is_active
      and (
        card.number = 'Unnumbered'
        or card.number like 'Unnumbered-%'
      )
    order by card_set.name, card.name, card.provider_id
  `;

  const audited = rows.map((row) => {
    const product = row.product ?? {};
    const evidence = {
      number: getExtendedDataValue(product, "Number"),
      rarity: getExtendedDataValue(product, "Rarity"),
      hp: getExtendedDataValue(product, "HP"),
      stage: getExtendedDataValue(product, "Stage"),
      cardType: getExtendedDataValue(product, "CardType"),
      cardText: getExtendedDataValue(product, "CardText"),
      upc: getExtendedDataValue(product, "UPC"),
    };

    return {
      providerId: row.provider_id,
      groupName: row.group_name,
      name: row.name,
      number: row.number,
      rarity: row.rarity,
      classification: classifyTcgcsvProduct(product),
      hasGameplayEvidence: Boolean(
        evidence.hp ||
          evidence.stage ||
          evidence.cardType ||
          evidence.cardText,
      ),
      evidence,
      extendedDataNames: (product.extendedData ?? []).map(
        (entry) => entry.name,
      ),
      printings: row.printings ?? [],
      collectionRows: row.collection_rows,
    };
  });

  const summary = {
    total: audited.length,
    withGameplayEvidence: audited.filter((row) => row.hasGameplayEvidence)
      .length,
    rarityOnly: audited.filter(
      (row) => row.rarity && !row.hasGameplayEvidence,
    ).length,
    withUpc: audited.filter((row) => row.evidence.upc).length,
    collectionRows: audited.reduce(
      (total, row) => total + row.collectionRows,
      0,
    ),
    groups: new Set(audited.map((row) => row.groupName)).size,
  };

  const only = process.argv
    .find((arg) => arg.startsWith("--only="))
    ?.slice("--only=".length);
  const products =
    only === "all"
      ? audited
      : only === "gameplay"
        ? audited.filter((row) => row.hasGameplayEvidence)
        : audited.filter((row) => row.rarity && !row.hasGameplayEvidence);

  console.log(JSON.stringify({ summary, products }, null, 2));
} finally {
  await sql.end();
}
