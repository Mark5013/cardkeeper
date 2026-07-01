import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to test Row Level Security.");
}

const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

const fixtureKey = `rls-test-${randomUUID()}`;
const intruderId = randomUUID();
const rollbackSignal = new Error("ROLLBACK_RLS_TEST_FIXTURES");
const checks = [];

function check(name, passed) {
  checks.push({ name, passed: Boolean(passed) });
}

async function assumeRole(sql, role, userId = null) {
  await sql`reset role`;
  const claims = userId ? { sub: userId, role } : { role };
  await sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
  await sql.unsafe(`set local role ${role}`);
}

async function expectDenied(sql, operation) {
  try {
    await sql.savepoint(operation);
    return false;
  } catch (error) {
    return error?.code === "42501";
  }
}

try {
  const [{ count: collectionCountBefore }] = await client`
    select count(*)::int as count from public.collection_items
  `;

  try {
    await client.begin(async (sql) => {
      const [owner] = await sql`
        select user_id from public.profiles order by created_at limit 1
      `;

      if (!owner) {
        throw new Error("Create and confirm at least one account before running the RLS test.");
      }

      const [set] = await sql`
        insert into public.card_sets (provider_id, language_code, name)
        values (${fixtureKey}, 'en', 'RLS Test Set')
        returning id
      `;
      const [card] = await sql`
        insert into public.cards (provider_id, set_id, language_code, name, number)
        values (${fixtureKey}, ${set.id}, 'en', 'RLS Test Card', '1')
        returning id
      `;
      const variants = await sql`
        insert into public.card_variants (card_id, printing, condition, language_code)
        values
          (${card.id}, 'normal', 'near_mint', 'en'),
          (${card.id}, 'reverse_holofoil', 'near_mint', 'en')
        returning id
      `;
      await sql`
        insert into public.collection_items (user_id, card_variant_id, quantity)
        values (${owner.user_id}, ${variants[0].id}, 1)
      `;

      await assumeRole(sql, "authenticated", owner.user_id);
      const ownerCollection = await sql`
        select id from public.collection_items where user_id = ${owner.user_id}
      `;
      const ownerProfile = await sql`
        select user_id from public.profiles where user_id = ${owner.user_id}
      `;
      const ownerUpdate = await sql`
        update public.collection_items
        set quantity = 2
        where user_id = ${owner.user_id} and card_variant_id = ${variants[0].id}
        returning quantity
      `;
      const authenticatedCatalog = await sql`
        select id from public.cards where id = ${card.id}
      `;

      check("Owner can read their collection", ownerCollection.length === 1);
      check("Owner can read their profile", ownerProfile.length === 1);
      check("Owner can update their collection", ownerUpdate[0]?.quantity === 2);
      check("Authenticated users can read catalog cards", authenticatedCatalog.length === 1);

      await assumeRole(sql, "authenticated", intruderId);
      const intruderCollection = await sql`
        select id from public.collection_items where user_id = ${owner.user_id}
      `;
      const intruderProfile = await sql`
        select user_id from public.profiles where user_id = ${owner.user_id}
      `;
      const intruderUpdate = await sql`
        update public.collection_items
        set quantity = 99
        where user_id = ${owner.user_id} and card_variant_id = ${variants[0].id}
        returning quantity
      `;
      const crossUserInsertDenied = await expectDenied(sql, (savepoint) => savepoint`
        insert into public.collection_items (user_id, card_variant_id, quantity)
        values (${owner.user_id}, ${variants[1].id}, 1)
      `);

      check("Another user cannot read the owner's collection", intruderCollection.length === 0);
      check("Another user cannot read the owner's profile", intruderProfile.length === 0);
      check("Another user cannot update the owner's collection", intruderUpdate.length === 0);
      check("Another user cannot insert rows for the owner", crossUserInsertDenied);

      await assumeRole(sql, "anon");
      const anonymousCatalog = await sql`
        select id from public.cards where id = ${card.id}
      `;
      const anonymousCollectionDenied = await expectDenied(sql, (savepoint) => savepoint`
        select id from public.collection_items limit 1
      `);
      const anonymousCatalogWriteDenied = await expectDenied(sql, (savepoint) => savepoint`
        insert into public.card_sets (provider_id, language_code, name)
        values (${`${fixtureKey}-forbidden`}, 'en', 'Forbidden Set')
      `);

      check("Anonymous visitors can read catalog cards", anonymousCatalog.length === 1);
      check("Anonymous visitors cannot read collections", anonymousCollectionDenied);
      check("Anonymous visitors cannot modify the catalog", anonymousCatalogWriteDenied);

      await sql`reset role`;
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal && error?.message !== rollbackSignal.message) throw error;
  }

  const [{ fixtureCount }] = await client`
    select count(*)::int as "fixtureCount"
    from public.card_sets
    where provider_id = ${fixtureKey}
  `;
  const [{ count: collectionCountAfter }] = await client`
    select count(*)::int as count from public.collection_items
  `;

  check("RLS fixtures were rolled back", fixtureCount === 0);
  check("Existing collection data was unchanged", collectionCountAfter === collectionCountBefore);

  for (const result of checks) {
    console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name}`);
  }

  const failures = checks.filter((result) => !result.passed);
  if (failures.length > 0) {
    throw new Error(`${failures.length} Row Level Security checks failed.`);
  }

  console.log(`Row Level Security checks passed: ${checks.length}/${checks.length}`);
} finally {
  await client.end();
}
