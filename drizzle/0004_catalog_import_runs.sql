CREATE TABLE IF NOT EXISTS "catalog_import_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text DEFAULT 'pokemon_tcg_api' NOT NULL,
  "mode" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "options" jsonb,
  "sets_processed" integer DEFAULT 0 NOT NULL,
  "cards_processed" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "duration_ms" integer,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalog_import_runs_status_check" CHECK ("catalog_import_runs"."status" in ('running', 'succeeded', 'failed')),
  CONSTRAINT "catalog_import_runs_sets_processed_nonnegative" CHECK ("catalog_import_runs"."sets_processed" >= 0),
  CONSTRAINT "catalog_import_runs_cards_processed_nonnegative" CHECK ("catalog_import_runs"."cards_processed" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_import_runs_started_at_idx" ON "catalog_import_runs" USING btree ("started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_import_runs_status_idx" ON "catalog_import_runs" USING btree ("status");
--> statement-breakpoint
ALTER TABLE public.catalog_import_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.catalog_import_runs FROM anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_import_runs_set_updated_at" ON "catalog_import_runs";
--> statement-breakpoint
CREATE TRIGGER "catalog_import_runs_set_updated_at"
BEFORE UPDATE ON "catalog_import_runs"
FOR EACH ROW
EXECUTE FUNCTION "set_updated_at"();
