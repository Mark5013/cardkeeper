import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentCollection } from "@/lib/collection/data";

const collectionPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = collectionPageSchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid collection page." }, { status: 400 });
  }

  try {
    const collection = await getCurrentCollection(parsed.data);

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
