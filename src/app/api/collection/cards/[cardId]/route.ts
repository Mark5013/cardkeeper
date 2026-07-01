import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureCardVariant } from "@/lib/catalog/sync";
import { CARD_CONDITIONS, type CardCondition } from "@/lib/collection/options";
import { isSameOriginRequest } from "@/lib/http/security";
import { getPokemonCard } from "@/lib/pokemon-tcg/client";
import { getCardPrintingOptions } from "@/lib/pokemon-tcg/printing";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

const cardIdSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const conditionValues = CARD_CONDITIONS.map((condition) => condition.value) as [
  CardCondition,
  ...CardCondition[],
];
const bodySchema = z.object({
  printing: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/),
  condition: z.enum(conditionValues),
  quantity: z.number().int().min(1).max(9999),
});

type RouteContext = { params: Promise<{ cardId: string }> };

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function PUT(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin collection changes are not allowed." },
      { status: 403, headers: privateHeaders },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401, headers: privateHeaders },
    );
  }

  const { cardId: rawCardId } = await context.params;
  const cardId = cardIdSchema.safeParse(rawCardId);
  if (!cardId.success) {
    return NextResponse.json(
      { error: "Invalid card identifier." },
      { status: 400, headers: privateHeaders },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON request body." },
      { status: 400, headers: privateHeaders },
    );
  }

  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Choose a valid finish, condition, and quantity." },
      { status: 400, headers: privateHeaders },
    );
  }

  const card = await getPokemonCard(cardId.data);
  if (!card) {
    return NextResponse.json(
      { error: "Card not found." },
      { status: 404, headers: privateHeaders },
    );
  }

  const availablePrintings = getCardPrintingOptions(card).map((printing) => printing.value);
  if (!availablePrintings.includes(parsedBody.data.printing)) {
    return NextResponse.json(
      { error: "That finish is not available for this card." },
      { status: 400, headers: privateHeaders },
    );
  }

  let variantId: string;
  try {
    variantId = await ensureCardVariant({
      card,
      printing: parsedBody.data.printing,
      condition: parsedBody.data.condition,
    });
  } catch (error) {
    console.error("Failed to synchronize card variant", error);
    return NextResponse.json(
      { error: "Unable to prepare this card for collection tracking." },
      { status: 500, headers: privateHeaders },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collection_items")
    .upsert(
      {
        user_id: user.id,
        card_variant_id: variantId,
        quantity: parsedBody.data.quantity,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,card_variant_id" },
    )
    .select("id, card_variant_id, quantity, created_at, updated_at")
    .single();

  if (error) {
    console.error("Failed to save collection item", { code: error.code });
    return NextResponse.json(
      { error: "Unable to update the collection." },
      { status: 500, headers: privateHeaders },
    );
  }

  return NextResponse.json(
    {
      item: {
        id: data.id,
        variantId: data.card_variant_id,
        printing: parsedBody.data.printing,
        condition: parsedBody.data.condition,
        quantity: data.quantity,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    },
    { headers: privateHeaders },
  );
}
