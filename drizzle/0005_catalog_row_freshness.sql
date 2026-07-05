ALTER TABLE "card_sets" ADD COLUMN IF NOT EXISTS "provider_updated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "card_sets" ADD COLUMN IF NOT EXISTS "last_imported_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "last_imported_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "card_sets"
SET "last_imported_at" = COALESCE("last_imported_at", "updated_at");
--> statement-breakpoint
UPDATE "cards"
SET "last_imported_at" = COALESCE("last_imported_at", "updated_at");
