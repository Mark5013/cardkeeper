import assert from "node:assert/strict";
import test from "node:test";

import { resolveCardVariant } from "../../../src/lib/catalog/variant-resolution.ts";

function createOperations(overrides = {}) {
  const calls = {
    createCatalogFallback: 0,
    findLocalCardAndVariant: 0,
    findVariant: 0,
    insertVariant: 0,
  };
  const operations = {
    catalogSource: "local",
    async createCatalogFallback() {
      calls.createCatalogFallback += 1;
      return "fallback-variant-id";
    },
    async findLocalCardAndVariant() {
      calls.findLocalCardAndVariant += 1;
      return { cardId: "card-id", variantId: "existing-variant-id" };
    },
    async findVariant() {
      calls.findVariant += 1;
      return "race-winner-variant-id";
    },
    async insertVariant() {
      calls.insertVariant += 1;
      return "inserted-variant-id";
    },
    ...overrides,
  };

  return { calls, operations };
}

test("returns an existing variant without performing any writes", async () => {
  const { calls, operations } = createOperations();

  const result = await resolveCardVariant(operations);

  assert.deepEqual(result, { id: "existing-variant-id", path: "existing" });
  assert.deepEqual(calls, {
    createCatalogFallback: 0,
    findLocalCardAndVariant: 1,
    findVariant: 0,
    insertVariant: 0,
  });
});

test("inserts only a variant when the local card exists", async () => {
  const { calls, operations } = createOperations({
    async findLocalCardAndVariant() {
      calls.findLocalCardAndVariant += 1;
      return { cardId: "card-id", variantId: null };
    },
  });

  const result = await resolveCardVariant(operations);

  assert.deepEqual(result, { id: "inserted-variant-id", path: "variant-created" });
  assert.deepEqual(calls, {
    createCatalogFallback: 0,
    findLocalCardAndVariant: 1,
    findVariant: 0,
    insertVariant: 1,
  });
});

test("uses the full catalog fallback only for a provider-sourced card", async () => {
  const { calls, operations } = createOperations({
    catalogSource: "provider",
  });

  const result = await resolveCardVariant(operations);

  assert.deepEqual(result, { id: "fallback-variant-id", path: "catalog-fallback" });
  assert.deepEqual(calls, {
    createCatalogFallback: 1,
    findLocalCardAndVariant: 0,
    findVariant: 0,
    insertVariant: 0,
  });
});

test("does not write a locally enriched card back if its row disappears", async () => {
  const { calls, operations } = createOperations({
    async findLocalCardAndVariant() {
      calls.findLocalCardAndVariant += 1;
      return null;
    },
  });

  await assert.rejects(
    resolveCardVariant(operations),
    /Local catalog card disappeared while resolving its variant/,
  );
  assert.equal(calls.createCatalogFallback, 0);
});

test("re-reads the variant when another request wins the insert race", async () => {
  const { calls, operations } = createOperations({
    async findLocalCardAndVariant() {
      calls.findLocalCardAndVariant += 1;
      return { cardId: "card-id", variantId: null };
    },
    async insertVariant() {
      calls.insertVariant += 1;
      return null;
    },
  });

  const result = await resolveCardVariant(operations);

  assert.deepEqual(result, { id: "race-winner-variant-id", path: "variant-race" });
  assert.deepEqual(calls, {
    createCatalogFallback: 0,
    findLocalCardAndVariant: 1,
    findVariant: 1,
    insertVariant: 1,
  });
});

test("fails closed if a conflict occurs but the winning variant cannot be found", async () => {
  const { operations } = createOperations({
    async findLocalCardAndVariant() {
      return { cardId: "card-id", variantId: null };
    },
    async findVariant() {
      return null;
    },
    async insertVariant() {
      return null;
    },
  });

  await assert.rejects(
    resolveCardVariant(operations),
    /Unable to resolve card variant after a concurrent insert/,
  );
});
