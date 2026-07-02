import { NextResponse } from "next/server";
import { z } from "zod";

import { getPokemonCardsBySetPage } from "@/lib/pokemon-tcg/client";

const setCardsSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(250).default(250),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
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
      await getPokemonCardsBySetPage({
        setId: id,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    );
  } catch (error) {
    console.error("Set cards API failed", { setId: id, error });
    return NextResponse.json(
      { error: "The cards in this set are temporarily unavailable." },
      { status: 502 },
    );
  }
}
