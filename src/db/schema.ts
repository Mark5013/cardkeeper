import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(),
  displayName: text("display_name"),
  preferredCurrency: varchar("preferred_currency", { length: 3 }).default("USD").notNull(),
  ...timestamps,
});

export const cardSets = pgTable(
  "card_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: text("provider_id").notNull(),
    languageCode: varchar("language_code", { length: 10 }).default("en").notNull(),
    name: text("name").notNull(),
    series: text("series"),
    printedTotal: integer("printed_total"),
    total: integer("total"),
    releaseDate: date("release_date"),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
    symbolUrl: text("symbol_url"),
    logoUrl: text("logo_url"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("card_sets_provider_language_idx").on(table.providerId, table.languageCode),
    index("card_sets_name_idx").on(table.name),
    index("card_sets_active_idx").on(table.isActive),
  ],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: text("provider_id").notNull(),
    setId: uuid("set_id")
      .notNull()
      .references(() => cardSets.id, { onDelete: "cascade" }),
    languageCode: varchar("language_code", { length: 10 }).default("en").notNull(),
    name: text("name").notNull(),
    number: text("number").notNull(),
    numberSortKey: integer("number_sort_key").generatedAlwaysAs(sql`
      case
        when "number" ~ '^[0-9]+'
          then substring("number" from '^[0-9]+')::integer
        else null
      end
    `),
    supertype: text("supertype"),
    subtypes: text("subtypes").array(),
    rarity: text("rarity"),
    artist: text("artist"),
    imageSmallUrl: text("image_small_url"),
    imageLargeUrl: text("image_large_url"),
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
    providerData: jsonb("provider_data").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("cards_provider_language_idx").on(table.providerId, table.languageCode),
    index("cards_name_idx").on(table.name),
    index("cards_number_idx").on(table.number),
    index("cards_set_idx").on(table.setId),
    index("cards_set_number_sort_idx").on(table.setId, table.numberSortKey, table.number, table.providerId),
    index("cards_active_idx").on(table.isActive),
  ],
);

export const cardVariants = pgTable(
  "card_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    printing: text("printing").default("normal").notNull(),
    condition: text("condition").default("unspecified").notNull(),
    languageCode: varchar("language_code", { length: 10 }).default("en").notNull(),
    externalVariantId: text("external_variant_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("card_variants_identity_idx").on(
      table.cardId,
      table.printing,
      table.condition,
      table.languageCode,
    ),
    index("card_variants_card_idx").on(table.cardId),
    check(
      "card_variants_condition_check",
      sql`${table.condition} in ('unspecified', 'near_mint', 'lightly_played', 'moderately_played', 'heavily_played', 'damaged')`,
    ),
    check("card_variants_printing_format_check", sql`${table.printing} ~ '^[a-z0-9_]{1,60}$'`),
  ],
);

export const cardVariantExternalRefs = pgTable(
  "card_variant_external_refs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardVariantId: uuid("card_variant_id")
      .notNull()
      .references(() => cardVariants.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    refType: text("ref_type").notNull(),
    refValue: text("ref_value").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("card_variant_external_refs_identity_idx").on(
      table.cardVariantId,
      table.source,
      table.refType,
      table.refValue,
    ),
    index("card_variant_external_refs_ref_idx").on(table.source, table.refType, table.refValue),
    index("card_variant_external_refs_variant_idx").on(table.cardVariantId),
    check("card_variant_external_refs_source_format_check", sql`${table.source} ~ '^[a-z0-9_]{1,60}$'`),
    check("card_variant_external_refs_ref_type_format_check", sql`${table.refType} ~ '^[a-z0-9_]{1,60}$'`),
  ],
);

export const collectionItems = pgTable(
  "collection_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    cardVariantId: uuid("card_variant_id")
      .notNull()
      .references(() => cardVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("collection_user_variant_idx").on(table.userId, table.cardVariantId),
    index("collection_user_idx").on(table.userId),
    check("collection_items_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

export const collectionQuantityHistory = pgTable(
  "collection_quantity_history",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    cardVariantId: uuid("card_variant_id")
      .notNull()
      .references(() => cardVariants.id, { onDelete: "cascade" }),
    effectiveOn: date("effective_on").notNull(),
    quantity: integer("quantity").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "collection_quantity_history_pkey",
      columns: [table.userId, table.cardVariantId, table.effectiveOn],
    }),
    index("collection_quantity_history_user_date_idx").on(table.userId, table.effectiveOn),
    index("collection_quantity_history_variant_idx").on(table.cardVariantId),
    check("collection_quantity_history_quantity_nonnegative", sql`${table.quantity} >= 0`),
  ],
);

export const currentPrices = pgTable(
  "current_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardVariantId: uuid("card_variant_id")
      .notNull()
      .references(() => cardVariants.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    priceType: text("price_type").default("market").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("current_prices_identity_idx").on(
      table.cardVariantId,
      table.source,
      table.priceType,
      table.currency,
    ),
    index("current_prices_variant_idx").on(table.cardVariantId),
    check("current_prices_amount_nonnegative", sql`${table.amountMinor} >= 0`),
  ],
);

export const pricePoints = pgTable(
  "price_points",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardVariantId: uuid("card_variant_id")
      .notNull()
      .references(() => cardVariants.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    priceType: text("price_type").default("market").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("price_points_observation_idx").on(
      table.cardVariantId,
      table.source,
      table.priceType,
      table.currency,
      table.observedAt,
    ),
    index("price_points_variant_date_idx").on(table.cardVariantId, table.observedAt),
    check("price_points_amount_nonnegative", sql`${table.amountMinor} >= 0`),
  ],
);

export const priceSeries = pgTable(
  "price_series",
  {
    cardVariantId: uuid("card_variant_id")
      .notNull()
      .references(() => cardVariants.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    priceType: text("price_type").default("market").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    observedOn: date("observed_on").array().default(sql`'{}'::date[]`).notNull(),
    amountsMinor: integer("amounts_minor").array().default(sql`'{}'::integer[]`).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      name: "price_series_pkey",
      columns: [table.cardVariantId, table.source, table.priceType, table.currency],
    }),
    check("price_series_source_format_check", sql`${table.source} ~ '^[a-z0-9_]{1,60}$'`),
    check("price_series_price_type_format_check", sql`${table.priceType} ~ '^[a-z0-9_]{1,60}$'`),
    check(
      "price_series_cardinality_check",
      sql`cardinality(${table.observedOn}) = cardinality(${table.amountsMinor})`,
    ),
    check("price_series_amounts_nonnegative", sql`0 <= all(${table.amountsMinor})`),
  ],
);

export const catalogImportRuns = pgTable(
  "catalog_import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").default("pokemon_tcg_api").notNull(),
    mode: text("mode").notNull(),
    status: text("status").default("running").notNull(),
    options: jsonb("options").$type<Record<string, unknown>>(),
    setsProcessed: integer("sets_processed").default(0).notNull(),
    cardsProcessed: integer("cards_processed").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    index("catalog_import_runs_started_at_idx").on(table.startedAt),
    index("catalog_import_runs_status_idx").on(table.status),
    check("catalog_import_runs_status_check", sql`${table.status} in ('running', 'succeeded', 'failed')`),
    check("catalog_import_runs_sets_processed_nonnegative", sql`${table.setsProcessed} >= 0`),
    check("catalog_import_runs_cards_processed_nonnegative", sql`${table.cardsProcessed} >= 0`),
  ],
);
