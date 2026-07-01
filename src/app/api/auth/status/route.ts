import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase/auth";

export async function GET() {
  const user = await getCurrentUser();

  return NextResponse.json(
    {
      authenticated: user !== null,
      user,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
