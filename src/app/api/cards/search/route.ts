import { NextResponse } from "next/server";
import { z } from "zod";

import { searchCatalogPokemonCards } from "@/lib/catalog/data";
import { normalizeSearchCardSort } from "@/lib/catalog/search-card-sort";
import { rateLimitRequest } from "@/lib/rate-limit";

const searchSchema = z.object({
  query: z.string().trim().min(1, "Enter a card name or number.").max(110),
  mode: z.enum(["search", "suggest"]).default("search"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  sort: z.string().optional(),
});

export async function GET(request: Request) {
  const limitedResponse = rateLimitRequest(request, {
    keyPrefix: "api:cards-search",
    limit: 120,
    windowMs: 60_000,
  });

  if (limitedResponse) {
    return limitedResponse;
  }

  const url = new URL(request.url);
  const parsed = searchSchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid search." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await searchCatalogPokemonCards({
        ...parsed.data,
        sort: normalizeSearchCardSort(parsed.data.sort),
      }),
    );
  } catch (error) {
    console.error("Card search failed", error);
    return NextResponse.json(
      { error: "The card catalog is temporarily unavailable." },
      { status: 502 },
    );
  }
}
