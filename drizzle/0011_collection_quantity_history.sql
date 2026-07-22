CREATE TABLE IF NOT EXISTS "collection_quantity_history" (
  "user_id" uuid NOT NULL,
  "card_variant_id" uuid NOT NULL,
  "effective_on" date NOT NULL,
  "quantity" integer NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "collection_quantity_history_pkey"
    PRIMARY KEY ("user_id", "card_variant_id", "effective_on"),
  CONSTRAINT "collection_quantity_history_user_id_profiles_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "collection_quantity_history_card_variant_id_card_variants_id_fk"
    FOREIGN KEY ("card_variant_id") REFERENCES "public"."card_variants"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "collection_quantity_history_quantity_nonnegative"
    CHECK ("quantity" >= 0)
);
--> statement-breakpoint
CREATE INDEX "collection_quantity_history_user_date_idx"
  ON "collection_quantity_history" USING btree ("user_id", "effective_on");
--> statement-breakpoint
CREATE INDEX "collection_quantity_history_variant_idx"
  ON "collection_quantity_history" USING btree ("card_variant_id");
--> statement-breakpoint
ALTER TABLE public.collection_quantity_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.collection_quantity_history FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.collection_quantity_history TO authenticated;
--> statement-breakpoint
CREATE POLICY "Users can read their own collection quantity history"
  ON public.collection_quantity_history FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_collection_quantity_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  event_at timestamp with time zone := clock_timestamp();
  event_user_id uuid;
  event_card_variant_id uuid;
  event_quantity integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    event_user_id := OLD.user_id;
    event_card_variant_id := OLD.card_variant_id;
    event_quantity := 0;
  ELSIF TG_OP = 'INSERT' THEN
    event_user_id := NEW.user_id;
    event_card_variant_id := NEW.card_variant_id;
    event_quantity := NEW.quantity;
  ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    event_user_id := NEW.user_id;
    event_card_variant_id := NEW.card_variant_id;
    event_quantity := NEW.quantity;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.collection_quantity_history (
    user_id,
    card_variant_id,
    effective_on,
    quantity,
    recorded_at
  )
  VALUES (
    event_user_id,
    event_card_variant_id,
    (event_at AT TIME ZONE 'UTC')::date,
    event_quantity,
    event_at
  )
  ON CONFLICT (user_id, card_variant_id, effective_on)
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    recorded_at = EXCLUDED.recorded_at;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_collection_quantity_history() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "collection_items_record_quantity_history" ON "collection_items";
--> statement-breakpoint
CREATE TRIGGER "collection_items_record_quantity_history"
AFTER INSERT OR UPDATE OF "quantity" OR DELETE ON "collection_items"
FOR EACH ROW
EXECUTE FUNCTION public.record_collection_quantity_history();
--> statement-breakpoint
INSERT INTO public.collection_quantity_history (
  user_id,
  card_variant_id,
  effective_on,
  quantity,
  recorded_at
)
SELECT
  item.user_id,
  item.card_variant_id,
  (item.created_at AT TIME ZONE 'UTC')::date,
  item.quantity,
  item.created_at
FROM public.collection_items AS item
ON CONFLICT (user_id, card_variant_id, effective_on) DO NOTHING;
