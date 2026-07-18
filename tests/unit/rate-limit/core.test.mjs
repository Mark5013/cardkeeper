import assert from "node:assert/strict";
import test from "node:test";

import {
  checkRateLimit,
  getClientIp,
  getRateLimitHeaders,
  LocalRateLimitStore,
} from "../../../src/lib/rate-limit/core.ts";

const options = {
  keyPrefix: "test",
  limit: 2,
  windowMs: 1_000,
};

const redisConfig = {
  keyPrefix: "cardkeeper-test",
  restToken: "test-secret-token",
  restUrl: "https://redis.example.com",
  timeoutMs: 100,
};

test("trusts only the Vercel-owned client IP header under the Vercel policy", () => {
  const headers = new Headers({
    "CF-Connecting-IP": "198.51.100.1",
    "X-Forwarded-For": "198.51.100.2",
    "X-Real-IP": "198.51.100.3",
    "X-Vercel-Forwarded-For": "203.0.113.10",
  });

  assert.equal(getClientIp(headers, "vercel"), "203.0.113.10");
  assert.equal(getClientIp(headers, "none"), "unknown");
});

test("rejects malformed Vercel client IP values instead of falling back to spoofable headers", () => {
  const headers = new Headers({
    "X-Forwarded-For": "203.0.113.20",
    "X-Vercel-Forwarded-For": "not-an-ip",
  });

  assert.equal(getClientIp(headers, "vercel"), "unknown");
});

test("resets a local bucket exactly at the expiry boundary", () => {
  const store = new LocalRateLimitStore(10);
  const singleRequestOptions = { ...options, limit: 1 };

  assert.equal(store.check("client", singleRequestOptions, 1_000).allowed, true);
  assert.equal(store.check("client", singleRequestOptions, 1_999).allowed, false);

  const resetDecision = store.check("client", singleRequestOptions, 2_000);
  assert.equal(resetDecision.allowed, true);
  assert.equal(resetDecision.resetAt, 3_000);
});

test("counts concurrent local checks without losing increments", async () => {
  const store = new LocalRateLimitStore(10);
  const concurrentOptions = { ...options, limit: 5 };
  const decisions = await Promise.all(
    Array.from({ length: 20 }, () =>
      checkRateLimit("203.0.113.30", concurrentOptions, store, undefined, {
        now: () => 1_000,
      }),
    ),
  );

  assert.equal(decisions.filter((result) => result.decision.allowed).length, 5);
  assert.equal(decisions.at(-1)?.decision.remaining, 0);
  assert.equal(store.size, 1);
});

test("keeps the local store strictly bounded with deterministic LRU eviction", () => {
  const store = new LocalRateLimitStore(3);
  const singleRequestOptions = { ...options, limit: 1 };

  store.check("a", singleRequestOptions, 1_000);
  store.check("b", singleRequestOptions, 1_000);
  store.check("c", singleRequestOptions, 1_000);
  store.check("a", singleRequestOptions, 1_001);
  store.check("d", singleRequestOptions, 1_002);

  assert.equal(store.size, 3);
  assert.equal(store.check("b", singleRequestOptions, 1_003).allowed, true);
  assert.equal(store.size, 3);
});

test("uses hashed client identifiers in Redis keys and returns remaining quota", async () => {
  let requestBody = "";
  const fetchMock = async (_input, init) => {
    requestBody = String(init?.body);
    return Response.json([{ result: 2 }, { result: 1 }, { result: 5_000 }]);
  };

  const result = await checkRateLimit(
    "203.0.113.40",
    { ...options, limit: 3 },
    new LocalRateLimitStore(10),
    redisConfig,
    { fetch: fetchMock, now: () => 10_000 },
  );
  const commands = JSON.parse(requestBody);

  assert.equal(result.source, "redis");
  assert.equal(result.decision.allowed, true);
  assert.equal(result.decision.remaining, 1);
  assert.equal(requestBody.includes("203.0.113.40"), false);
  assert.equal(commands[0][1], commands[1][1]);
  assert.equal(commands[1][1], commands[2][1]);
});

test("falls back to a reduced local allowance when Redis fails", async () => {
  const store = new LocalRateLimitStore(10);
  const fetchMock = async () => {
    throw new Error("Redis unavailable");
  };
  const fallbackOptions = { ...options, limit: 4 };
  const dependencies = { fetch: fetchMock, now: () => 1_000 };

  const first = await checkRateLimit(
    "203.0.113.50",
    fallbackOptions,
    store,
    redisConfig,
    dependencies,
  );
  const second = await checkRateLimit(
    "203.0.113.50",
    fallbackOptions,
    store,
    redisConfig,
    dependencies,
  );
  const third = await checkRateLimit(
    "203.0.113.50",
    fallbackOptions,
    store,
    redisConfig,
    dependencies,
  );

  assert.equal(first.source, "local-fallback");
  assert.equal(first.fallbackError instanceof Error, true);
  assert.equal(first.decision.limit, 2);
  assert.equal(first.decision.allowed, true);
  assert.equal(second.decision.allowed, true);
  assert.equal(third.decision.allowed, false);
});

test("aborts a slow Redis request before using the local fallback", async () => {
  let redisSignal;
  const fetchMock = async (_input, init) => {
    redisSignal = init?.signal;

    return await new Promise((_resolve, reject) => {
      redisSignal.addEventListener("abort", () => reject(redisSignal.reason), { once: true });
    });
  };

  const result = await checkRateLimit(
    "203.0.113.55",
    options,
    new LocalRateLimitStore(10),
    { ...redisConfig, timeoutMs: 10 },
    { fetch: fetchMock, now: () => 1_000 },
  );

  assert.equal(redisSignal.aborted, true);
  assert.equal(result.source, "local-fallback");
  assert.equal(result.fallbackError?.name, "TimeoutError");
});

test("surfaces Redis command errors to the reduced local fallback", async () => {
  const fetchMock = async () =>
    Response.json([
      { result: 1 },
      { error: "ERR expiry failed" },
      { result: 1_000 },
    ]);

  const result = await checkRateLimit(
    "203.0.113.60",
    options,
    new LocalRateLimitStore(10),
    redisConfig,
    { fetch: fetchMock, now: () => 1_000 },
  );

  assert.equal(result.source, "local-fallback");
  assert.match(result.fallbackError.message, /expiry failed/);
});

test("formats remaining-limit headers for allowed decisions", () => {
  assert.deepEqual(
    getRateLimitHeaders({
      allowed: true,
      limit: 10,
      remaining: 7,
      resetAt: 12_345,
    }),
    {
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "7",
      "X-RateLimit-Reset": "13",
    },
  );
});
