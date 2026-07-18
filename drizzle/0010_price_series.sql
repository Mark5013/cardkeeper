CREATE TABLE IF NOT EXISTS "price_series" (
  "card_variant_id" uuid NOT NULL,
  "source" text NOT NULL,
  "price_type" text DEFAULT 'market' NOT NULL,
  "currency" varchar(3) NOT NULL,
  "observed_on" date[] DEFAULT '{}'::date[] NOT NULL,
  "amounts_minor" integer[] DEFAULT '{}'::integer[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "price_series_pkey"
    PRIMARY KEY ("card_variant_id", "source", "price_type", "currency"),
  CONSTRAINT "price_series_card_variant_id_card_variants_id_fk"
    FOREIGN KEY ("card_variant_id") REFERENCES "public"."card_variants"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "price_series_source_format_check"
    CHECK ("price_series"."source" ~ '^[a-z0-9_]{1,60}$'),
  CONSTRAINT "price_series_price_type_format_check"
    CHECK ("price_series"."price_type" ~ '^[a-z0-9_]{1,60}$'),
  CONSTRAINT "price_series_cardinality_check"
    CHECK (cardinality("price_series"."observed_on") = cardinality("price_series"."amounts_minor")),
  CONSTRAINT "price_series_amounts_nonnegative"
    CHECK (0 <= all("price_series"."amounts_minor"))
);
--> statement-breakpoint
ALTER TABLE public.price_series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.price_series FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.price_series TO anon, authenticated;
--> statement-breakpoint
CREATE POLICY "Price series are publicly readable"
  ON public.price_series FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint
DROP TRIGGER IF EXISTS "price_series_set_updated_at" ON "price_series";
--> statement-breakpoint
CREATE TRIGGER "price_series_set_updated_at"
BEFORE UPDATE ON "price_series"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();
