export type VariantResolutionPath =
  | "catalog-fallback"
  | "existing"
  | "variant-created"
  | "variant-race";

type LocalCardAndVariant = {
  cardId: string;
  variantId: string | null;
};

type VariantResolutionOperations = {
  catalogSource: "local" | "provider";
  createCatalogFallback: () => Promise<string>;
  findLocalCardAndVariant: () => Promise<LocalCardAndVariant | null>;
  findVariant: (cardId: string) => Promise<string | null>;
  insertVariant: (cardId: string) => Promise<string | null>;
};

export async function resolveCardVariant(operations: VariantResolutionOperations) {
  if (operations.catalogSource === "provider") {
    return {
      id: await operations.createCatalogFallback(),
      path: "catalog-fallback",
    } as const;
  }

  const local = await operations.findLocalCardAndVariant();

  if (local?.variantId) {
    return { id: local.variantId, path: "existing" } as const;
  }

  if (!local) {
    throw new Error("Local catalog card disappeared while resolving its variant.");
  }

  const insertedVariantId = await operations.insertVariant(local.cardId);
  if (insertedVariantId) {
    return { id: insertedVariantId, path: "variant-created" } as const;
  }

  const concurrentVariantId = await operations.findVariant(local.cardId);
  if (!concurrentVariantId) {
    throw new Error("Unable to resolve card variant after a concurrent insert.");
  }

  return { id: concurrentVariantId, path: "variant-race" } as const;
}
