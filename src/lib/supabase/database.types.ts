export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type TimestampColumns = {
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        TimestampColumns & {
          user_id: string;
          display_name: string | null;
          preferred_currency: string;
        },
        {
          user_id: string;
          display_name?: string | null;
          preferred_currency?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      card_sets: Table<
        TimestampColumns & {
          id: string;
          provider_id: string;
          language_code: string;
          name: string;
          series: string | null;
          printed_total: number | null;
          total: number | null;
          release_date: string | null;
          symbol_url: string | null;
          logo_url: string | null;
        }
      >;
      cards: Table<
        TimestampColumns & {
          id: string;
          provider_id: string;
          set_id: string;
          language_code: string;
          name: string;
          number: string;
          supertype: string | null;
          subtypes: string[] | null;
          rarity: string | null;
          artist: string | null;
          image_small_url: string | null;
          image_large_url: string | null;
          provider_data: Json | null;
        }
      >;
      card_variants: Table<
        TimestampColumns & {
          id: string;
          card_id: string;
          printing: string;
          condition: string;
          language_code: string;
          external_variant_id: string | null;
        }
      >;
      collection_items: Table<
        TimestampColumns & {
          id: string;
          user_id: string;
          card_variant_id: string;
          quantity: number;
        },
        {
          id?: string;
          user_id: string;
          card_variant_id: string;
          quantity?: number;
          created_at?: string;
          updated_at?: string;
        }
      >;
      current_prices: Table<
        TimestampColumns & {
          id: string;
          card_variant_id: string;
          source: string;
          price_type: string;
          currency: string;
          amount_minor: number;
          observed_at: string;
        }
      >;
      price_points: Table<{
        id: string;
        card_variant_id: string;
        source: string;
        price_type: string;
        currency: string;
        amount_minor: number;
        observed_at: string;
        created_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
