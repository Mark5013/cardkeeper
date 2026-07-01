ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_quantity_positive" CHECK ("collection_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "current_prices" ADD CONSTRAINT "current_prices_amount_nonnegative" CHECK ("current_prices"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_amount_nonnegative" CHECK ("price_points"."amount_minor" >= 0);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name')
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint
ALTER TABLE public.card_sets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.card_variants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.current_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.price_points ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.card_sets, public.cards, public.card_variants, public.current_prices, public.price_points, public.profiles, public.collection_items FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.card_sets, public.cards, public.card_variants, public.current_prices, public.price_points TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.collection_items TO authenticated;
--> statement-breakpoint
CREATE POLICY "Catalog sets are publicly readable"
  ON public.card_sets FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "Cards are publicly readable"
  ON public.cards FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "Card variants are publicly readable"
  ON public.card_variants FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "Current prices are publicly readable"
  ON public.current_prices FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "Price history is publicly readable"
  ON public.price_points FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "Users can read their own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "Users can create their own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "Users can read their own collection"
  ON public.collection_items FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "Users can add to their own collection"
  ON public.collection_items FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "Users can update their own collection"
  ON public.collection_items FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "Users can remove from their own collection"
  ON public.collection_items FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
