import { NextResponse } from "next/server";

import { getCurrentCollection } from "@/lib/collection/data";

export async function GET() {
  try {
    const collection = await getCurrentCollection();

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
