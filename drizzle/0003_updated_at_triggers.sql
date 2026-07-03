CREATE OR REPLACE FUNCTION "set_updated_at"()
RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "profiles_set_updated_at" ON "profiles";
--> statement-breakpoint
CREATE TRIGGER "profiles_set_updated_at"
BEFORE UPDATE ON "profiles"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "card_sets_set_updated_at" ON "card_sets";
--> statement-breakpoint
CREATE TRIGGER "card_sets_set_updated_at"
BEFORE UPDATE ON "card_sets"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "cards_set_updated_at" ON "cards";
--> statement-breakpoint
CREATE TRIGGER "cards_set_updated_at"
BEFORE UPDATE ON "cards"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "card_variants_set_updated_at" ON "card_variants";
--> statement-breakpoint
CREATE TRIGGER "card_variants_set_updated_at"
BEFORE UPDATE ON "card_variants"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "collection_items_set_updated_at" ON "collection_items";
--> statement-breakpoint
CREATE TRIGGER "collection_items_set_updated_at"
BEFORE UPDATE ON "collection_items"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "current_prices_set_updated_at" ON "current_prices";
--> statement-breakpoint
CREATE TRIGGER "current_prices_set_updated_at"
BEFORE UPDATE ON "current_prices"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();
