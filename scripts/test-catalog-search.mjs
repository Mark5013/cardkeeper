import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to test catalog search.");
}

const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

const fixtureKey = `catalog-search-test-${randomUUID()}`;
const rollbackSignal = new Error("ROLLBACK_CATALOG_SEARCH_TEST_FIXTURES");
const checks = [];

function check(name, passed) {
  checks.push({ name, passed: Boolean(passed) });
}

function normalizeSearchText(value) {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeSearchName(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

async function searchByPhrase(sql, { name, number = null, page = 1, pageSize = 24 }) {
  const normalizedName = normalizeSearchText(name);
  const offset = (page - 1) * pageSize;
  const [{ count }] = await sql`
    select count(*)::int as count
    from public.cards
    where language_code = 'en'
      and trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) like ${`${normalizedName}%`}
      and (${number}::text is null or lower(number) = ${number})
  `;
  const rows = await sql`
    select provider_id, name, number
    from public.cards
    where language_code = 'en'
      and trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) like ${`${normalizedName}%`}
      and (${number}::text is null or lower(number) = ${number})
    order by name asc,
      case when number ~ '^[0-9]+' then substring(number from '^[0-9]+')::integer else null end asc nulls last,
      number asc,
      provider_id asc
    limit ${pageSize}
    offset ${offset}
  `;

  return { rows, totalCount: count };
}

async function searchByTokens(sql, { name, number = null, page = 1, pageSize = 24 }) {
  const [firstToken, ...remainingTokens] = tokenizeSearchName(name);
  const offset = (page - 1) * pageSize;
  const tokenFilters = remainingTokens.map((token) => `% ${token}%`);
  const [{ count }] = await sql`
    select count(*)::int as count
    from public.cards
    where language_code = 'en'
      and trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) like ${`${firstToken}%`}
      and (${number}::text is null or lower(number) = ${number})
      and ${tokenFilters.length === 0 || sql`trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) like all(${tokenFilters})`}
  `;
  const rows = await sql`
    select provider_id, name, number
    from public.cards
    where language_code = 'en'
      and trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) like ${`${firstToken}%`}
      and (${number}::text is null or lower(number) = ${number})
      and ${tokenFilters.length === 0 || sql`trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) like all(${tokenFilters})`}
    order by name asc,
      case when number ~ '^[0-9]+' then substring(number from '^[0-9]+')::integer else null end asc nulls last,
      number asc,
      provider_id asc
    limit ${pageSize}
    offset ${offset}
  `;

  return { rows, totalCount: count };
}

try {
  try {
    await client.begin(async (sql) => {
      const [trgm] = await sql`
        select exists(select 1 from pg_extension where extname = 'pg_trgm') as enabled
      `;

      check("pg_trgm extension is available", trgm.enabled);

      const [set] = await sql`
        insert into public.card_sets (provider_id, language_code, name)
        values (${fixtureKey}, 'en', 'Catalog Search Test Set')
        returning id
      `;

      await sql`
        insert into public.cards (provider_id, set_id, language_code, name, number)
        values
          (${`${fixtureKey}-mr-mime`}, ${set.id}, 'en', 'Mr. Mime', '6'),
          (${`${fixtureKey}-pikachu-ex`}, ${set.id}, 'en', 'Pikachu ex', '7'),
          (${`${fixtureKey}-team-rocket`}, ${set.id}, 'en', 'Team Rocket''s Pikachu', '8')
      `;

      await sql`
        insert into public.cards (provider_id, set_id, language_code, name, number)
        select
          ${fixtureKey} || '-broad-' || lpad(index::text, 3, '0'),
          ${set.id},
          'en',
          'Search Fixture Broad',
          index::text
        from generate_series(1, 260) as index
      `;

      const punctuationMatch = await searchByPhrase(sql, { name: "Mr Mime", pageSize: 5 });
      check(
        "Punctuation-normalized phrase search matches Mr. Mime",
        punctuationMatch.rows.some((row) => row.provider_id === `${fixtureKey}-mr-mime`),
      );

      const nameNumberMatch = await searchByPhrase(sql, {
        name: "Pikachu ex",
        number: "7",
        pageSize: 5,
      });
      check(
        "Multi-word name plus number returns the exact local card",
        nameNumberMatch.rows.some((row) => row.provider_id === `${fixtureKey}-pikachu-ex`),
      );

      const tokenFallback = await searchByTokens(sql, { name: "Team Pikachu", pageSize: 5 });
      check(
        "Token fallback matches later words without requiring every token as a full-name prefix",
        tokenFallback.rows.some((row) => row.provider_id === `${fixtureKey}-team-rocket`),
      );

      const broadPage = await searchByPhrase(sql, {
        name: "Search Fixture Broad",
        page: 11,
        pageSize: 25,
      });
      check("Broad local search counts beyond 250 rows", broadPage.totalCount === 260);
      check("Broad local search can read rows after offset 250", broadPage.rows.length === 10);

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
  check("Catalog search fixtures were rolled back", fixtureCount === 0);

  for (const result of checks) {
    console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name}`);
  }

  const failures = checks.filter((result) => !result.passed);
  if (failures.length > 0) {
    throw new Error(`${failures.length} catalog search checks failed.`);
  }

  console.log(`Catalog search checks passed: ${checks.length}/${checks.length}`);
} finally {
  await client.end();
}
