CREATE TABLE "card_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"language_code" varchar(10) DEFAULT 'en' NOT NULL,
	"name" text NOT NULL,
	"series" text,
	"printed_total" integer,
	"total" integer,
	"release_date" date,
	"symbol_url" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"printing" text DEFAULT 'normal' NOT NULL,
	"condition" text DEFAULT 'unspecified' NOT NULL,
	"language_code" varchar(10) DEFAULT 'en' NOT NULL,
	"external_variant_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"set_id" uuid NOT NULL,
	"language_code" varchar(10) DEFAULT 'en' NOT NULL,
	"name" text NOT NULL,
	"number" text NOT NULL,
	"supertype" text,
	"subtypes" text[],
	"rarity" text,
	"artist" text,
	"image_small_url" text,
	"image_large_url" text,
	"provider_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_variant_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "current_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_variant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"price_type" text DEFAULT 'market' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_variant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"price_type" text DEFAULT 'market' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"preferred_currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_variants" ADD CONSTRAINT "card_variants_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_set_id_card_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."card_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_card_variant_id_card_variants_id_fk" FOREIGN KEY ("card_variant_id") REFERENCES "public"."card_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_prices" ADD CONSTRAINT "current_prices_card_variant_id_card_variants_id_fk" FOREIGN KEY ("card_variant_id") REFERENCES "public"."card_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_card_variant_id_card_variants_id_fk" FOREIGN KEY ("card_variant_id") REFERENCES "public"."card_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_sets_provider_language_idx" ON "card_sets" USING btree ("provider_id","language_code");--> statement-breakpoint
CREATE INDEX "card_sets_name_idx" ON "card_sets" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "card_variants_identity_idx" ON "card_variants" USING btree ("card_id","printing","condition","language_code");--> statement-breakpoint
CREATE INDEX "card_variants_card_idx" ON "card_variants" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_provider_language_idx" ON "cards" USING btree ("provider_id","language_code");--> statement-breakpoint
CREATE INDEX "cards_name_idx" ON "cards" USING btree ("name");--> statement-breakpoint
CREATE INDEX "cards_number_idx" ON "cards" USING btree ("number");--> statement-breakpoint
CREATE INDEX "cards_set_idx" ON "cards" USING btree ("set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_user_variant_idx" ON "collection_items" USING btree ("user_id","card_variant_id");--> statement-breakpoint
CREATE INDEX "collection_user_idx" ON "collection_items" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "current_prices_identity_idx" ON "current_prices" USING btree ("card_variant_id","source","price_type","currency");--> statement-breakpoint
CREATE INDEX "current_prices_variant_idx" ON "current_prices" USING btree ("card_variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_points_observation_idx" ON "price_points" USING btree ("card_variant_id","source","price_type","currency","observed_at");--> statement-breakpoint
CREATE INDEX "price_points_variant_date_idx" ON "price_points" USING btree ("card_variant_id","observed_at");