# Codebase Review and Improvement Plan

**Date:** 2026-07-14  
**Scope:** Representative review of application configuration, database access and schema, catalog/collection data paths, API routes, authentication middleware, security and rate-limiting helpers, large client components, scheduled workflows, and end-to-end tests.

## Executive summary

The codebase has a solid foundation: TypeScript is used consistently, request data is validated with Zod, database writes use transactions and conflict-safe upserts, private collection responses disable caching, expensive operations have structured timing/error logs, and scheduled import jobs use concurrency controls. The main opportunities are to harden trust boundaries, reduce repeated database work, avoid unnecessary middleware and query load, improve production rate-limit behavior, and add deterministic lower-level tests.

No confirmed critical vulnerability was found in the reviewed sample. The security items below are important because their actual severity depends on deployment configuration and how the helpers are used by mutation routes.

## Prioritized recommendations

### 1. Harden same-origin request verification

**Relevant file:** `src/lib/http/security.ts`  
**Priority:** High, if this helper protects state-changing routes

**Implementation status (2026-07-17): Complete**

- `isSameOriginRequest` now requires `x-cardkeeper-request: same-origin` as an additional browser-CSRF signal; the header no longer bypasses origin validation.
- When `Origin` is present, it takes precedence and must be a valid serialized origin that exactly matches the request URL's origin. Malformed, opaque, and cross-origin values fail closed without consulting fallback headers.
- When `Origin` is absent, `Sec-Fetch-Site` is checked next and only `same-origin` is accepted. `Referer` is used only when both `Origin` and `Sec-Fetch-Site` are absent, and its parsed origin must exactly match the request origin. Requests without any supported browser metadata fail closed.
- Collection-browser update and delete requests now send the required custom header, matching the existing card-detail and quick-add mutation clients.
- Focused unit coverage was added in `tests/unit/http/security.test.mjs` for valid requests, missing and forged custom headers, malformed and cross-origin values, header precedence, fetch-metadata fallbacks, referer fallbacks, and missing browser metadata.
- The mutation routes still perform authenticated user checks and user-scoped database operations after this CSRF gate; same-origin validation is not used as authorization.

**Deployment CORS policy:** The application does not currently configure `Access-Control-Allow-Origin` in `next.config.ts` or its route handlers. Keep collection mutation endpoints same-origin-only: do not add wildcard or reflected origins, and do not allow `X-Cardkeeper-Request` in cross-origin preflight responses. Any future CORS change must be reviewed against this CSRF model.

**Verification (2026-07-17):** `npm run test:unit` (17 tests passed), `npm run typecheck` (passed), `npm run lint` (passed), and `git diff --check` (passed).

Before this change, `isSameOriginRequest` immediately accepted any request containing `x-cardkeeper-request: same-origin`. A custom header can be a useful browser-CSRF signal when cross-origin CORS is strictly disabled, but it is not authentication and should not be treated as independently authoritative. A permissive future CORS change, a proxy that injects/preserves the header unexpectedly, or non-browser clients could bypass the intended origin checks.

Recommended changes:

- Prefer an exact `Origin` comparison whenever the header is present.
- Use `Sec-Fetch-Site` and `Referer` only as documented fallbacks for clients that omit `Origin`.
- If the custom header remains, require it in addition to origin/fetch-metadata validation rather than allowing it to short-circuit all checks.
- Document the deployment CORS policy and ensure no API response grants arbitrary origins.
- Add unit tests for valid same-origin requests, malformed origins, cross-origin requests, missing browser metadata, and forged custom headers.
- Keep authorization checks on every mutation; same-origin verification is only CSRF defense.

### 2. Make rate limiting safe behind proxies and strictly memory-bounded

**Relevant file:** `src/lib/rate-limit.ts`  
**Priority:** High

**Implementation status (2026-07-17): Complete**

- Client identity now follows an explicit `none` or `vercel` trusted-proxy policy. Vercel deployments are auto-detected from `VERCEL=1`; outside Vercel, forwarding headers are ignored unless the policy is explicitly configured. Invalid policy values fail closed to `none`.
- Under the Vercel policy, only the platform-owned `x-vercel-forwarded-for` value is accepted, and it must be a valid IPv4 or IPv6 address. `cf-connecting-ip`, ordinary `x-forwarded-for`, and `x-real-ip` no longer influence buckets. This follows [Vercel's request-header contract](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for), including deployments placed behind another proxy.
- The local fallback is encapsulated in a store with a hard configurable bound (`RATE_LIMIT_LOCAL_MAX_BUCKETS`, default `5000`), periodic expiry cleanup, and deterministic least-recently-used eviction. The map cannot grow beyond the configured count even when every bucket is still active.
- Redis REST calls use an abort deadline (`RATE_LIMIT_REDIS_TIMEOUT_MS`, default `1000` ms), validate both HTTP and individual pipeline-command results, and continue to use the documented `INCR`/`PEXPIRE NX`/`PTTL` pipeline.
- Redis failure now has an explicit fail-degraded policy: log the store error and enforce a per-runtime local allowance at 50% of the route's normal limit. This is stricter than the normal allowance but remains available during a distributed-store outage.
- Redis keys use an HMAC-SHA-256 client identifier keyed by the Redis REST token, so raw IP addresses are not stored in Redis key names. Rotating the token also rotates the identifier namespace.
- Successful rate-limited route responses now include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`; rejected responses retain those headers plus `Retry-After`.
- Pure rate-limit logic was moved to `src/lib/rate-limit/core.ts`, with deterministic tests for trusted proxy handling, spoofed headers, malformed IPs, expiry boundaries, concurrent increments, the maximum bucket count and LRU eviction, Redis key hashing, Redis transport/command failure fallback, and successful-response header values.

**Deployment policy:** Production is hosted behind Vercel's managed edge, which overwrites its client-IP headers before the request reaches the function. Keep the function reachable only through that edge. Set `RATE_LIMIT_TRUSTED_PROXY=none` for any environment where requests can reach the application directly; do not change the policy to trust arbitrary `x-forwarded-for` values.

**Configuration:** `.env.example` now documents `RATE_LIMIT_TRUSTED_PROXY`, `RATE_LIMIT_REDIS_TIMEOUT_MS`, and `RATE_LIMIT_LOCAL_MAX_BUCKETS`. Existing Redis URL, token, and key-prefix variables are unchanged.

**Verification (2026-07-17):** `npm run test:unit` (27 tests passed, including 10 focused rate-limit tests), `npm run typecheck` (passed), `npm run lint` (passed), and `git diff --check` (passed).

Before this change, client identity was selected from `cf-connecting-ip`, then the first `x-forwarded-for` value, then `x-real-ip`. Forwarding headers are trustworthy only when the application is reachable exclusively through a proxy that removes user-supplied versions. Otherwise, clients can rotate a forged header and evade limits.

The previous local fallback also pruned only expired entries after the map had exceeded its target size. If many buckets remained active, pruning did not reduce the map and it could continue growing. This was especially relevant during Redis outages, when the fallback is most likely to receive heavy traffic.

Recommended changes:

- Define a deployment-specific trusted-proxy policy and accept only the platform-provided client-IP header at the trusted edge.
- Do not blindly trust `x-forwarded-for` when the service can be reached directly.
- Add a hard map bound with deterministic eviction (for example, oldest-reset-first or LRU), plus periodic expiry cleanup.
- Add timeouts to the Redis request so a slow rate-limit store cannot consume the API latency budget.
- Decide and document whether Redis failure should fail open, fail closed, or use a reduced local allowance per endpoint.
- Consider hashing IP addresses before using them as Redis keys if operational policy treats them as personal data.
- Return remaining-limit headers on successful requests as well as limit responses for easier client behavior and debugging.
- Add tests for expiry boundaries, concurrent increments, Redis failure, spoofed proxy headers, and maximum bucket count.

### 3. Avoid catalog upserts on every collection mutation

**Relevant file:** `src/lib/catalog/sync.ts`  
**Priority:** Medium for correctness; low for write throughput at the current observed usage

**Implementation status (2026-07-17): Complete, with the narrower scope established during reassessment.**

What the code shows:

- `getCatalogPokemonCard` normally reads the local `cards` row, but it deliberately falls back to the live Pokémon TCG API when the local card is missing. The full set/card creation path in `ensureCardVariant` therefore has a legitimate purpose and should not be removed outright.
- For a local card, `getCatalogPokemonCard` enriches the returned provider object with current local pricing before passing it to `ensureCardVariant`. Writing that derived object back to `cards.provider_data` during a collection mutation can blur the boundary between the imported provider payload and locally derived price data.
- Every call still conflict-updates the set, card, and variant. This advances `lastImportedAt`/`updatedAt`, fires update triggers, rewrites the card JSON, and takes row locks even when the requested variant already exists. A collection action should not make an existing catalog row appear freshly imported.
- The price refresh intentionally owns only `condition = 'unspecified'` market-price variants. User-selected condition variants remain legitimately on-demand; pre-creating every printing/condition combination in the catalog import is unnecessary.

A read-only aggregate check of the configured database on 2026-07-17 found 20,479 cards with an average `provider_data` size of about 1,488 bytes, 35,009 `unspecified` variants, and 155,105 condition-specific variants, while only 8 collection items referenced condition-specific variants. This is not evidence of a current throughput emergency, but it does mean the normal collection mutation is overwhelmingly likely to encounter an existing card and variant, making three unconditional conflict-updates wasteful.

Implemented narrow change:

1. Look up the local card ID and requested variant ID by provider card ID, language, printing, and condition.
2. Return immediately without writes when the variant exists.
3. When the local card exists but the variant does not, insert only the variant with `ON CONFLICT DO NOTHING RETURNING`; if a concurrent request won the race, select the existing ID.
4. `getCatalogPokemonCardWithSource` explicitly identifies locally mapped versus live-provider cards. Only a provider-sourced card can enter the current conflict-safe set/card/variant transaction; a local derived card is never written back as provider data.
5. Preserve all current unique constraints. The resolver logs `existing`, `variant-created`, `variant-race`, or `catalog-fallback` with duration so production path frequency and latency can be measured.

The branch coordinator lives in `src/lib/catalog/variant-resolution.ts` so the behavior is deterministic to test without a live database. Six focused tests cover the existing variant, missing variant, provider fallback, disappearing local row, concurrent winner, and unresolved-conflict paths. The Drizzle adapter in `src/lib/catalog/sync.ts` retains the database unique constraint as the final race-safety boundary and no longer updates an existing variant merely to retrieve its ID.

**Verification (2026-07-17):** `npm run test:unit` (33 tests passed), `npm run typecheck` (passed), `npm run lint` (passed), `npm run build` (completed successfully), and `git diff --check` (passed). During sandboxed builds, the existing catalog page fallback logged blocked database/API network access, but all 19 static pages and the production build still completed with exit code 0.

Changes that do **not** currently make sense:

- Do not remove live-API on-demand catalog creation; it supports cards that have not reached the scheduled import yet.
- Do not bulk-create all five user conditions for every printing during catalog import; most such rows would remain unreferenced.
- Do not treat this as a high-priority scaling project without mutation latency, lock, or write-volume evidence. The small lookup-first refactor is justified by data ownership and freshness semantics even before a performance benchmark.

Original finding:

`ensureCardVariant` performs an upsert for the set, an upsert for the card (including the full provider payload), and an upsert for the variant inside every transaction. This is race-safe, but it creates repeated writes, row locks, index maintenance, and enlarged database write volume when a user adds a card that is already present in the imported catalog.

### 4. Review the global authentication proxy scope

**Relevant file:** `src/proxy.ts`  
**Priority:** Medium to high

The matcher sends nearly every non-static request through `updateSession`, including public catalog pages and APIs. If session refresh performs cookie parsing or a Supabase network operation, this adds latency and another failure dependency to otherwise public traffic.

Recommended changes:

- Measure proxy duration and determine whether `updateSession` performs network I/O for anonymous requests.
- Narrow the matcher to routes that need refreshed authentication, or add an inexpensive early return for clearly public traffic.
- Preserve token-refresh behavior for routes that need it; test login redirects and authenticated collection access after changing the matcher.
- Exclude health checks and scheduled/internal endpoints where session handling is unnecessary.

### 5. Add caching for immutable or slowly changing catalog reads

**Relevant files:** `src/app/api/cards/search/route.ts`, catalog page/data modules  
**Priority:** Medium

Catalog search is public and the underlying data appears to change on scheduled imports, yet the search response does not set an explicit cache policy. Repeated popular queries can therefore reach the application and database unnecessarily.

Recommended changes:

- Normalize query parameters and add a short shared-cache TTL with `stale-while-revalidate` for public catalog results where product behavior permits it.
- Keep collection and user-specific data `private, no-store`; never share-cache responses containing ownership or session state.
- Invalidate or version catalog cache keys after imports.
- Consider server-side caching of set metadata and other small reference lists.
- Load-test common searches before and after caching to quantify database and latency reductions.

### 6. Tune database concurrency from measurements

**Relevant file:** `src/db/index.ts`  
**Priority:** Medium

The database client defaults to one connection per process. That is a conservative serverless default and can protect a small database, but it can also serialize concurrent queries within a warm instance. Raising it without a pooler can cause the opposite problem by exhausting database sessions.

Recommended changes:

- Record query wait time, execution time, function concurrency, and database session saturation.
- Use a transaction/session pooler appropriate to the deployment before materially increasing per-instance connections.
- Set `DATABASE_MAX_CONNECTIONS` per environment rather than relying on one value everywhere.
- Include a query/application name and connection telemetry if supported by the driver/provider.
- Keep the existing defensive validation of the environment value.

### 7. Validate cross-field collection filters

**Relevant file:** `src/app/api/collection/route.ts`  
**Priority:** Medium-low

The route validates minimum and maximum price independently, but it does not reject `minPrice > maxPrice`. That can produce an empty result with no explanation and needlessly execute a query. Duplicate query keys are also collapsed by `Object.fromEntries`, which should be an explicit API choice rather than accidental behavior.

Recommended changes:

- Add a Zod refinement requiring minimum price to be less than or equal to maximum price.
- Return the first useful validation issue consistently, as the search route already does.
- Decide whether duplicate scalar parameters should be rejected.
- Centralize comma-list parsing and validation if other routes use the same format.

### 8. Apply consistent abuse controls to expensive reads

**Relevant files:** `src/app/api/cards/search/route.ts`, `src/app/api/sets/progress/route.ts`, `src/app/api/collection/route.ts`  
**Priority:** Medium

Search and set-progress reads are rate-limited, while the collection page route has no visible route-level rate limit. Authentication reduces exposure but does not prevent an account, compromised session, or UI bug from producing expensive repeated queries.

Recommended changes:

- Add per-user limits for authenticated endpoints, with IP as a fallback rather than the primary key.
- Use endpoint-specific budgets based on measured query cost.
- Keep mutation limits stricter than inexpensive reads.
- Coordinate client retries/backoff with `429` and `Retry-After`.

### 9. Make error serialization unable to mask the original failure

**Relevant file:** `src/lib/observability.ts`  
**Priority:** Medium

`hasDbSaturationSignal` stringifies serialized error data, and `logError` stringifies the final log object. A circular value, `BigInt`, unusual error cause, or unserializable field can make logging throw while handling the original exception.

Recommended changes:

- Use a safe, bounded serializer that handles circular references, `BigInt`, and oversized values.
- Cap stack/message/field lengths and redact known secret-bearing keys.
- Ensure logging failures never replace the application error.
- Add a request/correlation ID to API logs and propagate it through measured database operations.

### 10. Remove duplicate failure logging

**Relevant files:** `src/lib/observability.ts`, `src/app/api/sets/progress/route.ts`  
**Priority:** Low

`measureOperation` logs `<event>.failed` and rethrows. The set-progress route then logs `api.set_progress.failed` again in its catch block, producing two error records for one failure. This inflates alerts and makes incident counts inaccurate.

Recommended changes:

- Let `measureOperation` own the failure log and have the route only translate the error into an HTTP response, or add an option that clearly assigns logging ownership to the caller.
- Standardize this pattern across routes.

### 11. Profile and split the largest client component

**Relevant file:** `src/components/collection/collection-browser.tsx`  
**Priority:** Medium for maintainability; performance impact should be profiled

The collection browser is a large client component that combines substantial state and UI behavior. Large client boundaries increase shipped JavaScript and make unnecessary rerenders harder to identify. Splitting code alone does not guarantee better runtime performance, so use React profiling and bundle analysis to guide the work.

Recommended changes:

- Separate URL/filter state, data fetching, selection/mutation state, filter controls, and result rendering into focused hooks/components.
- Keep static display work in server components where practical.
- Lazy-load infrequently opened filter or detail panels.
- Stabilize callbacks and memoize only components shown by the profiler to rerender expensively.
- For autocomplete/search requests, verify that stale requests are aborted and input is debounced without harming keyboard accessibility.

### 12. Audit query plans and indexes with production-like data

**Relevant files:** `src/db/schema.ts`, `src/lib/catalog/data.ts`, `src/lib/collection/data.ts`  
**Priority:** Medium

The data modules are sizeable and serve search, filtering, sorting, progress, and pagination. Static review cannot prove which indexes are missing; this should be driven by real query plans.

Recommended changes:

- Capture `EXPLAIN (ANALYZE, BUFFERS)` for common search, collection-filter, price-sort, and set-progress queries using production-like cardinality.
- Verify composite indexes match equality filters followed by sort/range columns.
- Check whether text search uses an appropriate PostgreSQL full-text or trigram index instead of broad wildcard scans.
- Watch for offset pagination becoming slower on deep pages; use stable cursor pagination where users can navigate large result sets.
- Avoid selecting large provider JSON fields in list endpoints unless the response needs them.
- Add query-count and duration regression checks around the most important data functions.

### 13. Improve scheduled-job resilience and supply-chain controls

**Relevant files:** `.github/workflows/import-catalog.yml`, `.github/workflows/refresh-prices.yml`  
**Priority:** Medium-low

The workflows already have useful concurrency groups, timeouts, dependency caching, and skip-if-current behavior. The catalog workflow's inline upstream request has no explicit timeout or retry, and actions are referenced by mutable major tags.

Recommended changes:

- Add bounded retry with exponential backoff and an abort timeout for upstream API/data downloads.
- Pin third-party actions to full commit SHAs and use dependency-update automation to advance them.
- Emit imported/refreshed row counts and source revision as job summaries.
- Alert after repeated scheduled failures; a failed daily job should not remain silent.
- Consider separating dependency installation/build validation from the long-running import when that reduces recovery time.

### 14. Expand deterministic automated coverage

**Relevant files:** `tests/e2e/catalog-smoke.spec.ts`, `tests/e2e/authenticated-collection.spec.ts`  
**Priority:** Medium

The existing browser tests cover important user flows, including search, card details, anonymous redirects, and authenticated collection behavior. The highest-risk helpers and API edge cases need faster, deterministic tests as well.

Recommended additions:

- Unit tests for same-origin validation, IP extraction/trusted proxies, local rate-limit eviction, sort normalization, comma-list parsing, and price-range refinement.
- API integration tests for authentication failures, malformed input, cache headers, rate limits, and safe error responses.
- Database tests for idempotent catalog/variant creation, concurrent inserts, ownership isolation, and transaction rollback.
- Deterministic fixtures or seeded test data so browser tests do not depend on the live catalog or external services.
- Performance smoke tests for representative search and collection queries.

## Existing strengths worth preserving

- Zod schemas bound page sizes, page numbers, text lengths, and numeric ranges.
- Collection responses explicitly use `private, no-store`.
- Database writes use transactions, unique-conflict handling, and returned identifiers.
- `server-only` guards reduce accidental client bundling of database and observability modules.
- Structured operation timing already provides a useful base for slow-query visibility.
- User lookup is cached within React's request/render context.
- Workflow concurrency prevents overlapping catalog and price jobs.
- E2E tests cover both public and authenticated product paths.
- API errors avoid returning raw internal exception details to clients.

## Suggested implementation order

### Phase 1: safety and visibility

1. Confirm the trusted-proxy and CORS threat models.
2. Harden same-origin checks and client-IP derivation.
3. Strictly bound the local rate-limit store and add Redis timeouts.
4. Make error logging serialization safe and remove duplicate logs.
5. Add focused tests for all four changes.

### Phase 2: database load reduction

1. Measure slow/query-heavy endpoints and inspect query plans.
2. Add safe public catalog caching.
3. Replace unconditional catalog upserts in collection mutations with lookup-first behavior.
4. Add or adjust indexes only from measured plans.
5. Tune connection concurrency with database-session telemetry.

### Phase 3: application and operational quality

1. Measure and narrow authentication proxy work.
2. Split/profile the collection browser and inspect the client bundle.
3. Add deterministic API/database tests and performance smoke tests.
4. Add workflow retries, summaries, alerts, and pinned action revisions.

## How to verify improvements

Track a baseline and compare after each phase:

- API p50/p95/p99 latency and error rate by route.
- Database query duration, lock time, rows read/written, connection utilization, and saturation events.
- Cache hit ratio and catalog-search request reduction.
- Rate-limit store latency, fallback activations, bucket count, and rejected requests.
- Catalog/collection mutation transaction duration and write volume.
- Proxy/session refresh duration for public versus authenticated traffic.
- Client JavaScript size and collection-browser interaction/render timings.
- Scheduled-job duration, row counts, source revision, and consecutive failures.

## Review limitations

This is a static, representative review rather than a production benchmark or exhaustive security audit. Recommendations about indexes, connection counts, middleware scope, and component memoization should be validated with production-like data and profiling before rollout. The original review was documentation-only; commands listed in an implementation-status section were run later for that specific change, while the other recommendations remain statically assessed.
