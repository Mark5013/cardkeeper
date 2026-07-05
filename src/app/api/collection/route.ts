import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentCollection, normalizeCollectionSort } from "@/lib/collection/data";
import { measureOperation } from "@/lib/observability";

const collectionPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  query: z.string().trim().max(100).optional().default(""),
  setIds: z.string().trim().max(2000).optional().default(""),
  printings: z.string().trim().max(1000).optional().default(""),
  conditions: z.string().trim().max(1000).optional().default(""),
  minPrice: z.coerce.number().min(0).max(100000).optional(),
  maxPrice: z.coerce.number().min(0).max(100000).optional(),
  sort: z.string().optional(),
});

function parseCommaList(value: string, limit: number) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = collectionPageSchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid collection page." }, { status: 400 });
  }

  try {
    const collection = await measureOperation(
      "api.collection_page",
      () =>
        getCurrentCollection({
          page: parsed.data.page,
          pageSize: parsed.data.pageSize,
          query: parsed.data.query,
          setIds: parseCommaList(parsed.data.setIds, 100),
          printings: parseCommaList(parsed.data.printings, 50),
          conditions: parseCommaList(parsed.data.conditions, 20),
          minPriceUsd: parsed.data.minPrice,
          maxPriceUsd: parsed.data.maxPrice,
          sort: normalizeCollectionSort(parsed.data.sort),
        }),
      { page: parsed.data.page, pageSize: parsed.data.pageSize },
    );

    if (!collection) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return NextResponse.json(collection, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Unable to load the collection." }, { status: 500 });
  }
}
