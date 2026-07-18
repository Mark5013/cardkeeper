import { NextResponse } from "next/server";
import { z } from "zod";

import { getCatalogPokemonCard } from "@/lib/catalog/data";
import { ensureCardVariant } from "@/lib/catalog/sync";
import { CARD_CONDITIONS, type CardCondition } from "@/lib/collection/options";
import { isSameOriginRequest } from "@/lib/http/security";
import { logError, measureOperation } from "@/lib/observability";
import { getCardPrintingOptions } from "@/lib/pokemon-tcg/printing";
import { applyRateLimitHeaders, rateLimitRequest } from "@/lib/rate-limit";
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
  operation: z.enum(["set", "increment"]).optional().default("set"),
});

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function PUT(request: Request, context: RouteContext<"/api/collection/cards/[cardId]">) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin collection changes are not allowed." },
      { status: 403, headers: privateHeaders },
    );
  }

  const rateLimit = await rateLimitRequest(request, {
    keyPrefix: "api:collection-mutation",
    limit: 60,
    windowMs: 60_000,
  });

  if (rateLimit.limitedResponse) {
    return rateLimit.limitedResponse;
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

  const card = await getCatalogPokemonCard(cardId.data);
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
    logError("api.collection_card.ensure_variant.failed", error, { cardId: cardId.data });
    return NextResponse.json(
      { error: "Unable to prepare this card for collection tracking." },
      { status: 500, headers: privateHeaders },
    );
  }

  const supabase = await createClient();
  let quantity = parsedBody.data.quantity;

  if (parsedBody.data.operation === "increment") {
    const { data: existingItem, error: existingError } = await measureOperation(
      "api.collection_card.existing",
      async () =>
        await supabase
          .from("collection_items")
          .select("quantity")
          .eq("user_id", user.id)
          .eq("card_variant_id", variantId)
          .maybeSingle(),
      { cardId: cardId.data, variantId },
    );

    if (existingError) {
      logError("api.collection_card.existing.failed", existingError, { cardId: cardId.data, variantId });
      return NextResponse.json(
        { error: "Unable to update the collection." },
        { status: 500, headers: privateHeaders },
      );
    }

    quantity = Math.min((existingItem?.quantity ?? 0) + parsedBody.data.quantity, 9999);
  }

  const { data, error } = await measureOperation(
    "api.collection_card.put",
    async () =>
      await supabase
        .from("collection_items")
        .upsert(
          {
            user_id: user.id,
            card_variant_id: variantId,
            quantity,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,card_variant_id" },
        )
        .select("id, card_variant_id, quantity, created_at, updated_at")
        .single(),
    { cardId: cardId.data, variantId, operation: parsedBody.data.operation },
  );

  if (error) {
    logError("api.collection_card.put.failed", error, { cardId: cardId.data, variantId });
    return NextResponse.json(
      { error: "Unable to update the collection." },
      { status: 500, headers: privateHeaders },
    );
  }

  return applyRateLimitHeaders(
    NextResponse.json(
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
    ),
    rateLimit,
  );
}
