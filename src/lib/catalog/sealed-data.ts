import "server-only";

import { cache } from "react";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  sealedCurrentPrices,
  sealedPriceSeries,
  sealedProducts,
} from "@/db/schema";
import { logError, measureDbQuery } from "@/lib/observability";

export type SealedCatalogProduct = {
  id: string;
  categoryId: number;
  groupId: number;
  groupName: string;
  languageCode: string;
  name: string;
  imageUrl: string | null;
  tcgplayerUrl: string | null;
  releaseDate: string | null;
  isPresale: boolean;
  marketPriceUsd: number | null;
  priceUpdatedAt: string | null;
};

export type SealedCatalogPage = {
  products: SealedCatalogProduct[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type SealedCatalogSet = {
  categoryId: number;
  groupId: number;
  name: string;
  languageCode: string;
  imageUrl: string | null;
  releaseDate: string | null;
  isPresale: boolean;
  productCount: number;
  pricedProductCount: number;
  startingPriceUsd: number | null;
  priceUpdatedAt: string | null;
};

export type SealedCatalogSetsPage = {
  sets: SealedCatalogSet[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type SealedPriceHistoryPoint = {
  observedAt: string;
  amountUsd: number;
};

export type SealedProductDetail = SealedCatalogProduct & {
  prices: Partial<Record<"low" | "mid" | "high" | "market" | "direct_low", number>>;
  history: SealedPriceHistoryPoint[];
};

function mapProduct(row: {
  product: typeof sealedProducts.$inferSelect;
  amountMinor: number | null;
  observedAt: Date | null;
}): SealedCatalogProduct {
  return {
    id: row.product.providerId,
    categoryId: row.product.categoryId,
    groupId: row.product.groupId,
    groupName: row.product.groupName,
    languageCode: row.product.languageCode,
    name: row.product.name,
    imageUrl: row.product.imageUrl,
    tcgplayerUrl: row.product.tcgplayerUrl,
    releaseDate: row.product.releaseDate,
    isPresale: row.product.isPresale,
    marketPriceUsd:
      row.amountMinor === null ? null : row.amountMinor / 100,
    priceUpdatedAt: row.observedAt?.toISOString() ?? null,
  };
}

function mapSet(row: {
  categoryId: number;
  groupId: number;
  name: string;
  languageCode: string;
  imageUrl: string | null;
  releaseDate: string | null;
  isPresale: boolean;
  productCount: number;
  pricedProductCount: number;
  startingPriceMinor: number | null;
  priceUpdatedAt: Date | string | null;
}): SealedCatalogSet {
  return {
    categoryId: row.categoryId,
    groupId: row.groupId,
    name: row.name,
    languageCode: row.languageCode,
    imageUrl: row.imageUrl,
    releaseDate: row.releaseDate,
    isPresale: row.isPresale,
    productCount: row.productCount,
    pricedProductCount: row.pricedProductCount,
    startingPriceUsd:
      row.startingPriceMinor === null ? null : row.startingPriceMinor / 100,
    priceUpdatedAt:
      row.priceUpdatedAt instanceof Date
        ? row.priceUpdatedAt.toISOString()
        : row.priceUpdatedAt
          ? new Date(row.priceUpdatedAt).toISOString()
          : null,
  };
}

export async function getSealedCatalogSetsPage(input?: {
  query?: string;
  languageCode?: "all" | "en" | "ja";
  page?: number;
  pageSize?: number;
}): Promise<SealedCatalogSetsPage> {
  const query = input?.query?.trim().slice(0, 100) ?? "";
  const languageCode = input?.languageCode ?? "all";
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(60, Math.max(1, input?.pageSize ?? 24));
  const offset = (page - 1) * pageSize;
  const conditions = [eq(sealedProducts.isActive, true)];

  if (languageCode !== "all") {
    conditions.push(eq(sealedProducts.languageCode, languageCode));
  }
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
    conditions.push(ilike(sealedProducts.groupName, pattern));
  }

  const where = and(...conditions);
  const [countRows, rows] = await Promise.all([
    measureDbQuery(
      "db.sealed_catalog_set_count",
      () =>
        db
          .select({
            count: sql<number>`
              count(
                distinct (
                  ${sealedProducts.categoryId},
                  ${sealedProducts.groupId},
                  ${sealedProducts.languageCode},
                  ${sealedProducts.groupName}
                )
              )::integer
            `,
          })
          .from(sealedProducts)
          .where(where),
      { hasQuery: Boolean(query), languageCode },
    ),
    measureDbQuery(
      "db.sealed_catalog_set_rows",
      () =>
        db
          .select({
            categoryId: sealedProducts.categoryId,
            groupId: sealedProducts.groupId,
            name: sealedProducts.groupName,
            languageCode: sealedProducts.languageCode,
            imageUrl: sql<string | null>`
              (
                array_agg(
                  ${sealedProducts.imageUrl}
                  order by ${sealedProducts.providerId}
                )
                filter (where ${sealedProducts.imageUrl} is not null)
              )[1]
            `,
            releaseDate: sql<string | null>`max(${sealedProducts.releaseDate})`,
            isPresale: sql<boolean>`bool_or(${sealedProducts.isPresale})`,
            productCount: sql<number>`count(*)::integer`,
            pricedProductCount: sql<number>`
              count(${sealedCurrentPrices.sealedProductId})::integer
            `,
            startingPriceMinor: sql<number | null>`
              min(${sealedCurrentPrices.amountMinor})::integer
            `,
            priceUpdatedAt: sql<Date | null>`
              max(${sealedCurrentPrices.observedAt})
            `,
          })
          .from(sealedProducts)
          .leftJoin(
            sealedCurrentPrices,
            and(
              eq(
                sealedCurrentPrices.sealedProductId,
                sealedProducts.id,
              ),
              eq(sealedCurrentPrices.source, "tcgcsv"),
              eq(sealedCurrentPrices.priceType, "market"),
              eq(sealedCurrentPrices.currency, "USD"),
            ),
          )
          .where(where)
          .groupBy(
            sealedProducts.categoryId,
            sealedProducts.groupId,
            sealedProducts.languageCode,
            sealedProducts.groupName,
          )
          .orderBy(
            sql`max(${sealedProducts.releaseDate}) desc nulls last`,
            asc(sealedProducts.groupName),
            asc(sealedProducts.groupId),
          )
          .limit(pageSize)
          .offset(offset),
      { hasQuery: Boolean(query), languageCode, page, pageSize },
    ),
  ]);
  const totalCount = countRows[0]?.count ?? 0;

  return {
    sets: rows.map(mapSet),
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

export const getSealedCatalogSet = cache(
  async (categoryId: number, groupId: number) => {
    if (
      !Number.isSafeInteger(categoryId) ||
      categoryId < 1 ||
      !Number.isSafeInteger(groupId) ||
      groupId < 1
    ) {
      return null;
    }

    const [row] = await db
      .select({
        categoryId: sealedProducts.categoryId,
        groupId: sealedProducts.groupId,
        name: sealedProducts.groupName,
        languageCode: sealedProducts.languageCode,
        imageUrl: sql<string | null>`
          (
            array_agg(
              ${sealedProducts.imageUrl}
              order by ${sealedProducts.providerId}
            )
            filter (where ${sealedProducts.imageUrl} is not null)
          )[1]
        `,
        releaseDate: sql<string | null>`max(${sealedProducts.releaseDate})`,
        isPresale: sql<boolean>`bool_or(${sealedProducts.isPresale})`,
        productCount: sql<number>`count(*)::integer`,
        pricedProductCount: sql<number>`
          count(${sealedCurrentPrices.sealedProductId})::integer
        `,
        startingPriceMinor: sql<number | null>`
          min(${sealedCurrentPrices.amountMinor})::integer
        `,
        priceUpdatedAt: sql<Date | null>`
          max(${sealedCurrentPrices.observedAt})
        `,
      })
      .from(sealedProducts)
      .leftJoin(
        sealedCurrentPrices,
        and(
          eq(sealedCurrentPrices.sealedProductId, sealedProducts.id),
          eq(sealedCurrentPrices.source, "tcgcsv"),
          eq(sealedCurrentPrices.priceType, "market"),
          eq(sealedCurrentPrices.currency, "USD"),
        ),
      )
      .where(
        and(
          eq(sealedProducts.categoryId, categoryId),
          eq(sealedProducts.groupId, groupId),
          eq(sealedProducts.isActive, true),
        ),
      )
      .groupBy(
        sealedProducts.categoryId,
        sealedProducts.groupId,
        sealedProducts.languageCode,
        sealedProducts.groupName,
      )
      .limit(1);

    return row ? mapSet(row) : null;
  },
);

export async function getSealedCatalogPage(input?: {
  query?: string;
  languageCode?: "all" | "en" | "ja";
  categoryId?: number;
  groupId?: number;
  page?: number;
  pageSize?: number;
}): Promise<SealedCatalogPage> {
  const query = input?.query?.trim().slice(0, 100) ?? "";
  const languageCode = input?.languageCode ?? "all";
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(60, Math.max(1, input?.pageSize ?? 24));
  const offset = (page - 1) * pageSize;
  const conditions = [eq(sealedProducts.isActive, true)];

  if (languageCode !== "all") {
    conditions.push(eq(sealedProducts.languageCode, languageCode));
  }
  if (input?.categoryId !== undefined) {
    conditions.push(eq(sealedProducts.categoryId, input.categoryId));
  }
  if (input?.groupId !== undefined) {
    conditions.push(eq(sealedProducts.groupId, input.groupId));
  }
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
    conditions.push(
      or(
        ilike(sealedProducts.name, pattern),
        ilike(sealedProducts.groupName, pattern),
      )!,
    );
  }

  const where = and(...conditions);
  const [countRows, rows] = await Promise.all([
    measureDbQuery(
      "db.sealed_catalog_count",
      () =>
        db
          .select({ count: sql<number>`count(*)::integer` })
          .from(sealedProducts)
          .where(where),
      {
        hasQuery: Boolean(query),
        languageCode,
        categoryId: input?.categoryId,
        groupId: input?.groupId,
      },
    ),
    measureDbQuery(
      "db.sealed_catalog_rows",
      () =>
        db
          .select({
            product: sealedProducts,
            amountMinor: sealedCurrentPrices.amountMinor,
            observedAt: sealedCurrentPrices.observedAt,
          })
          .from(sealedProducts)
          .leftJoin(
            sealedCurrentPrices,
            and(
              eq(
                sealedCurrentPrices.sealedProductId,
                sealedProducts.id,
              ),
              eq(sealedCurrentPrices.source, "tcgcsv"),
              eq(sealedCurrentPrices.priceType, "market"),
              eq(sealedCurrentPrices.currency, "USD"),
            ),
          )
          .where(where)
          .orderBy(
            sql`${sealedProducts.releaseDate} desc nulls last`,
            asc(sealedProducts.name),
            asc(sealedProducts.providerId),
          )
          .limit(pageSize)
          .offset(offset),
      {
        hasQuery: Boolean(query),
        languageCode,
        categoryId: input?.categoryId,
        groupId: input?.groupId,
        page,
        pageSize,
      },
    ),
  ]);
  const totalCount = countRows[0]?.count ?? 0;

  return {
    products: rows.map(mapProduct),
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

export const getSealedCatalogProduct = cache(async (id: string) => {
  try {
    const [row] = await db
      .select({
        product: sealedProducts,
        amountMinor: sealedCurrentPrices.amountMinor,
        observedAt: sealedCurrentPrices.observedAt,
      })
      .from(sealedProducts)
      .leftJoin(
        sealedCurrentPrices,
        and(
          eq(
            sealedCurrentPrices.sealedProductId,
            sealedProducts.id,
          ),
          eq(sealedCurrentPrices.source, "tcgcsv"),
          eq(sealedCurrentPrices.priceType, "market"),
          eq(sealedCurrentPrices.currency, "USD"),
        ),
      )
      .where(
        and(
          eq(sealedProducts.providerId, id),
          eq(sealedProducts.isActive, true),
        ),
      )
      .limit(1);

    if (!row) return null;

    const [priceRows, historyRows] = await Promise.all([
      db
        .select({
          priceType: sealedCurrentPrices.priceType,
          amountMinor: sealedCurrentPrices.amountMinor,
        })
        .from(sealedCurrentPrices)
        .where(
          and(
            eq(sealedCurrentPrices.sealedProductId, row.product.id),
            eq(sealedCurrentPrices.source, "tcgcsv"),
            eq(sealedCurrentPrices.currency, "USD"),
          ),
        ),
      db
        .select({
          observedOn: sealedPriceSeries.observedOn,
          amountsMinor: sealedPriceSeries.amountsMinor,
        })
        .from(sealedPriceSeries)
        .where(
          and(
            eq(sealedPriceSeries.sealedProductId, row.product.id),
            eq(sealedPriceSeries.source, "tcgcsv"),
            eq(sealedPriceSeries.priceType, "market"),
            eq(sealedPriceSeries.currency, "USD"),
          ),
        )
        .limit(1),
    ]);
    const historyRow = historyRows[0];
    const pointCount = Math.min(
      historyRow?.observedOn.length ?? 0,
      historyRow?.amountsMinor.length ?? 0,
    );
    const history = Array.from({ length: pointCount }, (_, index) => {
      const observedValue = historyRow!.observedOn[index] as string | Date;
      return {
        observedAt:
          observedValue instanceof Date
            ? observedValue.toISOString()
            : `${observedValue}T00:00:00.000Z`,
        amountUsd: historyRow!.amountsMinor[index] / 100,
      };
    });
    const allowedPriceTypes = new Set([
      "low",
      "mid",
      "high",
      "market",
      "direct_low",
    ]);
    const prices = Object.fromEntries(
      priceRows
        .filter((price) => allowedPriceTypes.has(price.priceType))
        .map((price) => [price.priceType, price.amountMinor / 100]),
    ) as SealedProductDetail["prices"];

    return {
      ...mapProduct(row),
      prices,
      history,
    } satisfies SealedProductDetail;
  } catch (error) {
    logError("catalog.local_sealed_product.failed", error, {
      sealedProductId: id,
    });
    throw error;
  }
});
