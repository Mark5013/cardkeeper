import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required to repair Japanese unnumbered cards.",
  );
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 20,
});

try {
  const [before] = await sql`
    select
      count(*) filter (
        where number like 'Unnumbered-%'
      )::integer as synthetic_numbers,
      count(*) filter (
        where number = 'Unnumbered'
      )::integer as normalized_numbers
    from cards
    where language_code = 'ja'
      and is_active
  `;

  console.log(
    `Japanese unnumbered repair (${apply ? "apply" : "dry run"}): ` +
      `${before.synthetic_numbers.toLocaleString()} synthetic, ` +
      `${before.normalized_numbers.toLocaleString()} normalized.`,
  );

  if (!apply) {
    console.log(
      "Dry run complete. Re-run with --apply to replace synthetic product-ID suffixes.",
    );
  } else {
    const updated = await sql.begin(async (transaction) => {
      const rows = await transaction`
        update cards
        set
          number = 'Unnumbered',
          provider_data = case
            when provider_data is null then null
            else jsonb_set(
              provider_data,
              '{number}',
              to_jsonb('Unnumbered'::text),
              true
            )
          end,
          updated_at = now()
        where language_code = 'ja'
          and is_active
          and number like 'Unnumbered-%'
        returning id
      `;
      return rows.length;
    });

    const [after] = await sql`
      select
        count(*) filter (
          where number like 'Unnumbered-%'
        )::integer as synthetic_numbers,
        count(*) filter (
          where number = 'Unnumbered'
        )::integer as normalized_numbers
      from cards
      where language_code = 'ja'
        and is_active
    `;

    if (after.synthetic_numbers !== 0) {
      throw new Error(
        `Repair verification failed: ${after.synthetic_numbers} synthetic numbers remain.`,
      );
    }
    if (
      after.normalized_numbers !==
      before.normalized_numbers + before.synthetic_numbers
    ) {
      throw new Error(
        "Repair verification failed: normalized row count did not match the planned update.",
      );
    }

    console.log(
      `Updated and verified ${updated.toLocaleString()} Japanese card numbers.`,
    );
  }
} finally {
  await sql.end();
}
