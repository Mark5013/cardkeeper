import "server-only";

import { NextResponse } from "next/server";

import { logError, logWarn } from "@/lib/observability";

type RateLimitOptions = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const maxBuckets = 5000;
const redisRestUrl = process.env.RATE_LIMIT_REDIS_REST_URL?.replace(/\/$/, "");
const redisRestToken = process.env.RATE_LIMIT_REDIS_REST_TOKEN;
const redisKeyPrefix = process.env.RATE_LIMIT_REDIS_KEY_PREFIX?.trim() || "cardkeeper";

function getClientIp(request: Request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwardedIp = forwardedFor?.split(",")[0]?.trim();

  return forwardedIp || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function createRateLimitedResponse(options: RateLimitOptions, resetAt: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(options.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
      },
    },
  );
}

function pruneExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function localRateLimitRequest(request: Request, options: RateLimitOptions) {
  const now = Date.now();

  if (buckets.size > maxBuckets) {
    pruneExpiredBuckets(now);
  }

  const key = `${options.keyPrefix}:${getClientIp(request)}`;
  const existingBucket = buckets.get(key);
  const bucket =
    existingBucket && existingBucket.resetAt > now
      ? existingBucket
      : { count: 0, resetAt: now + options.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count <= options.limit) {
    return null;
  }

  return createRateLimitedResponse(options, bucket.resetAt);
}

async function redisRateLimitRequest(request: Request, options: RateLimitOptions) {
  if (!redisRestUrl || !redisRestToken) return null;

  const now = Date.now();
  const key = `${redisKeyPrefix}:rate-limit:${options.keyPrefix}:${getClientIp(request)}`;
  const response = await fetch(`${redisRestUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisRestToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["PEXPIRE", key, String(options.windowMs), "NX"],
      ["PTTL", key],
    ]),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Redis rate limit store returned ${response.status}`);
  }

  const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  const count = Number(results[0]?.result);
  const ttlMs = Number(results[2]?.result);

  if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
    throw new Error("Redis rate limit store returned an invalid response");
  }

  if (count <= options.limit) return null;

  return createRateLimitedResponse(
    options,
    now + Math.max(1000, ttlMs > 0 ? ttlMs : options.windowMs),
  );
}

export async function rateLimitRequest(request: Request, options: RateLimitOptions) {
  if (redisRestUrl && redisRestToken) {
    try {
      return await redisRateLimitRequest(request, options);
    } catch (error) {
      logError("rate_limit.distributed_failed", error, { keyPrefix: options.keyPrefix });
      logWarn("rate_limit.falling_back_to_local", { keyPrefix: options.keyPrefix });
    }
  }

  return localRateLimitRequest(request, options);
}
