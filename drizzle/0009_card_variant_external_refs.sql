CREATE TABLE IF NOT EXISTS "card_variant_external_refs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_variant_id" uuid NOT NULL,
  "source" text NOT NULL,
  "ref_type" text NOT NULL,
  "ref_value" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_variant_external_refs"
  ADD CONSTRAINT "card_variant_external_refs_card_variant_id_card_variants_id_fk"
  FOREIGN KEY ("card_variant_id") REFERENCES "public"."card_variants"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "card_variant_external_refs_identity_idx"
  ON "card_variant_external_refs" USING btree ("card_variant_id","source","ref_type","ref_value");
--> statement-breakpoint
CREATE INDEX "card_variant_external_refs_ref_idx"
  ON "card_variant_external_refs" USING btree ("source","ref_type","ref_value");
--> statement-breakpoint
CREATE INDEX "card_variant_external_refs_variant_idx"
  ON "card_variant_external_refs" USING btree ("card_variant_id");
--> statement-breakpoint
ALTER TABLE "card_variant_external_refs"
  ADD CONSTRAINT "card_variant_external_refs_source_format_check"
  CHECK ("card_variant_external_refs"."source" ~ '^[a-z0-9_]{1,60}$');
--> statement-breakpoint
ALTER TABLE "card_variant_external_refs"
  ADD CONSTRAINT "card_variant_external_refs_ref_type_format_check"
  CHECK ("card_variant_external_refs"."ref_type" ~ '^[a-z0-9_]{1,60}$');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "card_variant_external_refs_set_updated_at" ON "card_variant_external_refs";
--> statement-breakpoint
CREATE TRIGGER "card_variant_external_refs_set_updated_at"
BEFORE UPDATE ON "card_variant_external_refs"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
ALTER TABLE public.card_variant_external_refs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.card_variant_external_refs FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.card_variant_external_refs TO anon, authenticated;
--> statement-breakpoint
CREATE POLICY "Card variant external refs are publicly readable"
  ON public.card_variant_external_refs FOR SELECT
  TO anon, authenticated
  USING (true);
