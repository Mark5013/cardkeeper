ALTER TABLE "cards"
ADD COLUMN IF NOT EXISTS "number_sort_key" integer GENERATED ALWAYS AS (
  CASE
    WHEN "number" ~ '^[0-9]+'
      THEN substring("number" from '^[0-9]+')::integer
    ELSE NULL
  END
) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_set_number_sort_idx"
  ON "cards" ("set_id", "number_sort_key", "number", "provider_id");
