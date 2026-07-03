CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_search_name_prefix_idx"
  ON "cards" ((trim(regexp_replace(lower("name"), '[^a-z0-9]+', ' ', 'g'))) text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_search_name_trgm_idx"
  ON "cards" USING gin ((trim(regexp_replace(lower("name"), '[^a-z0-9]+', ' ', 'g'))) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_number_lower_idx" ON "cards" (lower("number"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_set_number_idx" ON "cards" ("set_id", "number");
