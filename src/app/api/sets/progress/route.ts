import { NextResponse } from "next/server";

import { getCurrentSetCollectionProgress } from "@/lib/collection/data";
import { logError, measureOperation } from "@/lib/observability";
import { rateLimitRequest } from "@/lib/rate-limit";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const limitedResponse = await rateLimitRequest(request, {
    keyPrefix: "api:set-progress",
    limit: 120,
    windowMs: 60_000,
  });

  if (limitedResponse) {
    return limitedResponse;
  }

  try {
    const progress = await measureOperation(
      "api.set_progress",
      () => getCurrentSetCollectionProgress(),
      {},
    );

    return NextResponse.json(
      { progress: progress ? Object.fromEntries(progress) : null },
      { headers: privateHeaders },
    );
  } catch (error) {
    logError("api.set_progress.failed", error);
    return NextResponse.json(
      { error: "Unable to load set collection progress." },
      { status: 500, headers: privateHeaders },
    );
  }
}
