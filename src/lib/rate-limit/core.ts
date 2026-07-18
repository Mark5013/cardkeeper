import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type RateLimitOptions = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

export type TrustedProxyPolicy = "none" | "vercel";

type Bucket = {
  count: number;
  resetAt: number;
};

type RedisConfig = {
  keyPrefix: string;
  restToken: string;
  restUrl: string;
  timeoutMs: number;
};

type RateLimitDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
};

type RateLimitResult = {
  decision: RateLimitDecision;
  fallbackError?: unknown;
  source: "local" | "local-fallback" | "redis";
};

const localCleanupIntervalMs = 60_000;
const fallbackLimitRatio = 0.5;

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

export function getClientIp(headers: Headers, policy: TrustedProxyPolicy) {
  if (policy !== "vercel") return "unknown";

  const candidate = firstHeaderValue(headers.get("x-vercel-forwarded-for"));
  return candidate && isIP(candidate) ? candidate : "unknown";
}

export function getRateLimitHeaders(decision: RateLimitDecision) {
  return {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(Math.ceil(decision.resetAt / 1000)),
  };
}

export class LocalRateLimitStore {
  readonly #buckets = new Map<string, Bucket>();
  readonly #maxBuckets: number;
  #nextCleanupAt = 0;

  constructor(maxBuckets: number) {
    if (!Number.isInteger(maxBuckets) || maxBuckets < 1) {
      throw new Error("Local rate-limit bucket count must be a positive integer");
    }

    this.#maxBuckets = maxBuckets;
  }

  get size() {
    return this.#buckets.size;
  }

  check(key: string, options: RateLimitOptions, now = Date.now()): RateLimitDecision {
    const existingBucket = this.#buckets.get(key);

    if (existingBucket && existingBucket.resetAt > now) {
      existingBucket.count += 1;
      this.#buckets.delete(key);
      this.#buckets.set(key, existingBucket);
      return this.#decision(existingBucket, options.limit);
    }

    if (existingBucket) {
      this.#buckets.delete(key);
    }

    this.#pruneExpiredBuckets(now);

    while (this.#buckets.size >= this.#maxBuckets) {
      const leastRecentlyUsedKey = this.#buckets.keys().next().value;
      if (leastRecentlyUsedKey === undefined) break;
      this.#buckets.delete(leastRecentlyUsedKey);
    }

    const bucket = { count: 1, resetAt: now + options.windowMs };
    this.#buckets.set(key, bucket);
    return this.#decision(bucket, options.limit);
  }

  #decision(bucket: Bucket, limit: number): RateLimitDecision {
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  #pruneExpiredBuckets(now: number) {
    if (now < this.#nextCleanupAt && this.#buckets.size < this.#maxBuckets) return;

    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) {
        this.#buckets.delete(key);
      }
    }

    this.#nextCleanupAt = now + localCleanupIntervalMs;
  }
}

function getRedisKey(
  config: RedisConfig,
  options: RateLimitOptions,
  clientIp: string,
) {
  const clientHash = createHmac("sha256", config.restToken)
    .update(`rate-limit-client:${clientIp}`)
    .digest("hex");

  return `${config.keyPrefix}:rate-limit:${options.keyPrefix}:${clientHash}`;
}

async function checkRedisRateLimit(
  clientIp: string,
  options: RateLimitOptions,
  config: RedisConfig,
  dependencies: RateLimitDependencies,
) {
  const redisKey = getRedisKey(config, options, clientIp);
  const now = (dependencies.now ?? Date.now)();
  const response = await (dependencies.fetch ?? fetch)(`${config.restUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.restToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["PEXPIRE", redisKey, String(options.windowMs), "NX"],
      ["PTTL", redisKey],
    ]),
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Redis rate limit store returned ${response.status}`);
  }

  const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  const resultError = results.find((result) => result.error)?.error;
  if (resultError) {
    throw new Error(`Redis rate limit command failed: ${resultError}`);
  }

  const count = results[0]?.result;
  const ttlMs = results[2]?.result;

  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    typeof ttlMs !== "number" ||
    !Number.isFinite(ttlMs)
  ) {
    throw new Error("Redis rate limit store returned an invalid response");
  }

  const resetAt = now + Math.max(1000, ttlMs > 0 ? ttlMs : options.windowMs);
  return {
    allowed: count <= options.limit,
    limit: options.limit,
    remaining: Math.max(0, options.limit - count),
    resetAt,
  } satisfies RateLimitDecision;
}

export async function checkRateLimit(
  clientIp: string,
  options: RateLimitOptions,
  localStore: LocalRateLimitStore,
  redisConfig?: RedisConfig,
  dependencies: RateLimitDependencies = {},
): Promise<RateLimitResult> {
  if (redisConfig) {
    try {
      return {
        decision: await checkRedisRateLimit(clientIp, options, redisConfig, dependencies),
        source: "redis",
      };
    } catch (fallbackError) {
      const fallbackOptions = {
        ...options,
        limit: Math.max(1, Math.floor(options.limit * fallbackLimitRatio)),
      };

      return {
        decision: localStore.check(
          `${fallbackOptions.keyPrefix}:${clientIp}`,
          fallbackOptions,
          (dependencies.now ?? Date.now)(),
        ),
        fallbackError,
        source: "local-fallback",
      };
    }
  }

  return {
    decision: localStore.check(
      `${options.keyPrefix}:${clientIp}`,
      options,
      (dependencies.now ?? Date.now)(),
    ),
    source: "local",
  };
}
