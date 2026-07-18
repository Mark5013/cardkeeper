import "server-only";

import { NextResponse } from "next/server";

import { logError, logWarn } from "@/lib/observability";
import {
  checkRateLimit,
  getClientIp,
  getRateLimitHeaders,
  LocalRateLimitStore,
  type RateLimitOptions,
  type TrustedProxyPolicy,
} from "@/lib/rate-limit/core";

type RateLimitResult = {
  headers: Record<string, string>;
  limitedResponse: NextResponse | null;
};

function getPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getTrustedProxyPolicy(): TrustedProxyPolicy {
  const configuredPolicy = process.env.RATE_LIMIT_TRUSTED_PROXY?.trim().toLowerCase();

  if (configuredPolicy === "vercel" || configuredPolicy === "none") {
    return configuredPolicy;
  }

  if (!configuredPolicy) {
    return process.env.VERCEL === "1" ? "vercel" : "none";
  }

  return "none";
}

const localStore = new LocalRateLimitStore(
  getPositiveIntegerEnv("RATE_LIMIT_LOCAL_MAX_BUCKETS", 5000),
);
const redisRestUrl = process.env.RATE_LIMIT_REDIS_REST_URL?.replace(/\/$/, "");
const redisRestToken = process.env.RATE_LIMIT_REDIS_REST_TOKEN;
const redisKeyPrefix = process.env.RATE_LIMIT_REDIS_KEY_PREFIX?.trim() || "cardkeeper";
const redisTimeoutMs = getPositiveIntegerEnv("RATE_LIMIT_REDIS_TIMEOUT_MS", 1000);
const trustedProxyPolicy = getTrustedProxyPolicy();

function createRateLimitedResponse(headers: Record<string, string>, resetAt: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        ...headers,
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

export function applyRateLimitHeaders<T extends Response>(
  response: T,
  rateLimit: RateLimitResult,
) {
  for (const [name, value] of Object.entries(rateLimit.headers)) {
    response.headers.set(name, value);
  }

  return response;
}

export async function rateLimitRequest(
  request: Request,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const clientIp = getClientIp(request.headers, trustedProxyPolicy);
  const redisConfig =
    redisRestUrl && redisRestToken
      ? {
          keyPrefix: redisKeyPrefix,
          restToken: redisRestToken,
          restUrl: redisRestUrl,
          timeoutMs: redisTimeoutMs,
        }
      : undefined;
  const result = await checkRateLimit(clientIp, options, localStore, redisConfig);

  if (result.fallbackError) {
    logError("rate_limit.distributed_failed", result.fallbackError, {
      keyPrefix: options.keyPrefix,
      timeoutMs: redisTimeoutMs,
    });
    logWarn("rate_limit.falling_back_to_local", {
      keyPrefix: options.keyPrefix,
      limit: result.decision.limit,
    });
  }

  const headers = getRateLimitHeaders(result.decision);
  return {
    headers,
    limitedResponse: result.decision.allowed
      ? null
      : createRateLimitedResponse(headers, result.decision.resetAt),
  };
}
