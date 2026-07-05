import { NextResponse } from "next/server";
import { z } from "zod";

import { getCatalogPokemonCardsBySetPage } from "@/lib/catalog/data";
import { normalizeSetCardSort } from "@/lib/catalog/set-card-sort";
import { measureOperation } from "@/lib/observability";
import { rateLimitRequest } from "@/lib/rate-limit";

const setCardsSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(250),
  sort: z.string().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const limitedResponse = await rateLimitRequest(request, {
    keyPrefix: "api:set-cards",
    limit: 120,
    windowMs: 60_000,
  });

  if (limitedResponse) {
    return limitedResponse;
  }

  const { id } = await context.params;
  const url = new URL(request.url);
  const parsed = setCardsSchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid set card request." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await measureOperation(
        "api.set_cards",
        () =>
          getCatalogPokemonCardsBySetPage({
            setId: id,
            page: parsed.data.page,
            pageSize: parsed.data.pageSize,
            sort: normalizeSetCardSort(parsed.data.sort),
          }),
        { setId: id, page: parsed.data.page, pageSize: parsed.data.pageSize },
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "The cards in this set are temporarily unavailable." },
      { status: 502 },
    );
  }
}
