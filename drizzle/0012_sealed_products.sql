CREATE TABLE IF NOT EXISTS "sealed_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_id" text NOT NULL,
  "category_id" integer NOT NULL,
  "group_id" integer NOT NULL,
  "group_name" text NOT NULL,
  "language_code" varchar(10) NOT NULL,
  "name" text NOT NULL,
  "image_url" text,
  "tcgplayer_url" text,
  "release_date" date,
  "is_presale" boolean DEFAULT false NOT NULL,
  "last_imported_at" timestamp with time zone,
  "is_active" boolean DEFAULT true NOT NULL,
  "provider_data" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sealed_products_category_positive" CHECK ("category_id" > 0),
  CONSTRAINT "sealed_products_group_positive" CHECK ("group_id" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_products_category_provider_idx"
  ON "sealed_products" USING btree ("category_id", "provider_id");
--> statement-breakpoint
CREATE INDEX "sealed_products_name_idx" ON "sealed_products" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "sealed_products_group_idx"
  ON "sealed_products" USING btree ("category_id", "group_id");
--> statement-breakpoint
CREATE INDEX "sealed_products_language_active_idx"
  ON "sealed_products" USING btree ("language_code", "is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealed_current_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sealed_product_id" uuid NOT NULL,
  "source" text NOT NULL,
  "price_type" text DEFAULT 'market' NOT NULL,
  "currency" varchar(3) NOT NULL,
  "amount_minor" bigint NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sealed_current_prices_sealed_product_id_fk"
    FOREIGN KEY ("sealed_product_id") REFERENCES "public"."sealed_products"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sealed_current_prices_amount_nonnegative" CHECK ("amount_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_current_prices_identity_idx"
  ON "sealed_current_prices" USING btree
  ("sealed_product_id", "source", "price_type", "currency");
--> statement-breakpoint
CREATE INDEX "sealed_current_prices_product_idx"
  ON "sealed_current_prices" USING btree ("sealed_product_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sealed_price_series" (
  "sealed_product_id" uuid NOT NULL,
  "source" text NOT NULL,
  "price_type" text DEFAULT 'market' NOT NULL,
  "currency" varchar(3) NOT NULL,
  "observed_on" date[] DEFAULT '{}'::date[] NOT NULL,
  "amounts_minor" integer[] DEFAULT '{}'::integer[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sealed_price_series_pkey"
    PRIMARY KEY ("sealed_product_id", "source", "price_type", "currency"),
  CONSTRAINT "sealed_price_series_sealed_product_id_fk"
    FOREIGN KEY ("sealed_product_id") REFERENCES "public"."sealed_products"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sealed_price_series_source_format_check"
    CHECK ("source" ~ '^[a-z0-9_]{1,60}$'),
  CONSTRAINT "sealed_price_series_price_type_format_check"
    CHECK ("price_type" ~ '^[a-z0-9_]{1,60}$'),
  CONSTRAINT "sealed_price_series_cardinality_check"
    CHECK (cardinality("observed_on") = cardinality("amounts_minor")),
  CONSTRAINT "sealed_price_series_amounts_nonnegative"
    CHECK (0 <= all("amounts_minor"))
);
--> statement-breakpoint
ALTER TABLE public.sealed_products ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sealed_current_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sealed_price_series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.sealed_products FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.sealed_current_prices FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.sealed_price_series FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.sealed_products TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.sealed_current_prices TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.sealed_price_series TO anon, authenticated;
--> statement-breakpoint
CREATE POLICY "Sealed products are publicly readable"
  ON public.sealed_products FOR SELECT TO anon, authenticated USING (true);
--> statement-breakpoint
CREATE POLICY "Sealed current prices are publicly readable"
  ON public.sealed_current_prices FOR SELECT TO anon, authenticated USING (true);
--> statement-breakpoint
CREATE POLICY "Sealed price series are publicly readable"
  ON public.sealed_price_series FOR SELECT TO anon, authenticated USING (true);
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sealed_products_set_updated_at" ON "sealed_products";
--> statement-breakpoint
CREATE TRIGGER "sealed_products_set_updated_at"
BEFORE UPDATE ON "sealed_products"
FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sealed_current_prices_set_updated_at" ON "sealed_current_prices";
--> statement-breakpoint
CREATE TRIGGER "sealed_current_prices_set_updated_at"
BEFORE UPDATE ON "sealed_current_prices"
FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sealed_price_series_set_updated_at" ON "sealed_price_series";
--> statement-breakpoint
CREATE TRIGGER "sealed_price_series_set_updated_at"
BEFORE UPDATE ON "sealed_price_series"
FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
