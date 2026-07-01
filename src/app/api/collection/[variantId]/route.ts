import { NextResponse } from "next/server";
import { z } from "zod";

import { isSameOriginRequest } from "@/lib/http/security";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

const variantIdSchema = z.string().uuid();
const quantitySchema = z.object({
  quantity: z.number().int().min(1).max(9999),
});

type RouteContext = { params: Promise<{ variantId: string }> };

function mutationHeaders() {
  return { "Cache-Control": "private, no-store" };
}

export async function PUT(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin collection changes are not allowed." },
      { status: 403, headers: mutationHeaders() },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401, headers: mutationHeaders() },
    );
  }

  const { variantId: rawVariantId } = await context.params;
  const variantId = variantIdSchema.safeParse(rawVariantId);
  if (!variantId.success) {
    return NextResponse.json(
      { error: "Invalid card variant." },
      { status: 400, headers: mutationHeaders() },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON request body." },
      { status: 400, headers: mutationHeaders() },
    );
  }

  const parsedBody = quantitySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Quantity must be a whole number between 1 and 9999." },
      { status: 400, headers: mutationHeaders() },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collection_items")
    .upsert(
      {
        user_id: user.id,
        card_variant_id: variantId.data,
        quantity: parsedBody.data.quantity,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,card_variant_id" },
    )
    .select("id, card_variant_id, quantity, created_at, updated_at")
    .single();

  if (error) {
    const status = error.code === "23503" ? 404 : 500;
    return NextResponse.json(
      { error: status === 404 ? "Card variant not found." : "Unable to update the collection." },
      { status, headers: mutationHeaders() },
    );
  }

  return NextResponse.json(
    {
      item: {
        id: data.id,
        cardVariantId: data.card_variant_id,
        quantity: data.quantity,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    },
    { headers: mutationHeaders() },
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin collection changes are not allowed." },
      { status: 403, headers: mutationHeaders() },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401, headers: mutationHeaders() },
    );
  }

  const { variantId: rawVariantId } = await context.params;
  const variantId = variantIdSchema.safeParse(rawVariantId);
  if (!variantId.success) {
    return NextResponse.json(
      { error: "Invalid card variant." },
      { status: 400, headers: mutationHeaders() },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("collection_items")
    .delete()
    .eq("user_id", user.id)
    .eq("card_variant_id", variantId.data);

  if (error) {
    return NextResponse.json(
      { error: "Unable to remove the card." },
      { status: 500, headers: mutationHeaders() },
    );
  }

  return new NextResponse(null, { status: 204, headers: mutationHeaders() });
}
