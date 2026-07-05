ALTER TABLE "card_sets" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_sets_active_idx" ON "card_sets" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_active_idx" ON "cards" USING btree ("is_active");
--> statement-breakpoint
UPDATE "card_sets" SET "is_active" = true WHERE "is_active" IS DISTINCT FROM true;
--> statement-breakpoint
UPDATE "cards" SET "is_active" = true WHERE "is_active" IS DISTINCT FROM true;
