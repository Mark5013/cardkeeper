import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentCollection, normalizeCollectionSort } from "@/lib/collection/data";

const collectionPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  query: z.string().trim().max(100).optional().default(""),
  setIds: z.string().trim().max(2000).optional().default(""),
  sort: z.string().optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = collectionPageSchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid collection page." }, { status: 400 });
  }

  try {
    const collection = await getCurrentCollection({
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      query: parsed.data.query,
      setIds: parsed.data.setIds
        .split(",")
        .map((setId) => setId.trim())
        .filter(Boolean)
        .slice(0, 100),
      sort: normalizeCollectionSort(parsed.data.sort),
    });

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
