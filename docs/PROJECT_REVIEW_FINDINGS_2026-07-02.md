# Cardkeeper Project Review Findings - July 2, 2026

## Scope

This review used the session handoff docs from June 21, June 22, July 1, and July 2, then checked the current codebase across app routes, API routes, auth, collection, catalog import/search, database schema, migrations, styling, and project tooling.

Because this repo is on Next.js 16.2.9, I also checked the local Next docs in `node_modules/next/dist/docs/` for page/route async params, Proxy, Link prefetching, Image, and version 16 upgrade notes before making recommendations.

Verification run during review:

```bash
npm run lint
npm run typecheck
npm run build
```

All three passed. I did not run `npm run db:test-rls` during this review because it exercises the configured database connection; the existing handoffs already record that it has passed previously.

## Overall Read

Cardkeeper has a strong foundation for the stage it is in. The project is already beyond a prototype in several important ways: auth is server-verified, collection writes derive ownership from the session, RLS is tested, collection and catalog data have clear boundaries, and the app has moved expensive provider reads into a local catalog. The most valuable next work is not a broad rewrite. It is tightening local search correctness/performance, activating the price tables deliberately, consolidating collection reads, and adding automated browser/API coverage so the manually verified flows stay trustworthy.

## Highest Priority Improvements

### 1. Fix local multi-word search and DB pagination

Status: Implemented on July 3, 2026.

Implemented:

- Local search now normalizes punctuation/spacing before matching, so queries such as `Mr Mime` can match names like `Mr. Mime`.
- Local search now tries full normalized phrase-prefix matching first, then falls back to first-token prefix plus later-token containment.
- Infinite-scroll API requests now use DB-native `count`, `limit`, and `offset` for matched local results instead of slicing a capped 250-row in-memory list.
- Added migration `drizzle/0002_search_indexes.sql` with normalized-name prefix/trigram indexes, lower-number index, and `(set_id, number)` index.
- Applied the migration to the configured database with `npm run db:migrate`.
- Added rollback-only catalog search coverage in `scripts/test-catalog-search.mjs` for multi-word names, name plus number, punctuation variants, token fallback, and broad queries over 250 results.

Verification:

```bash
npm run catalog:test-search
```

Passed 7/7 checks, including fixture rollback.

Follow-up implemented on July 3, 2026:

- The local closest-match path now uses Postgres trigram similarity instead of relaxed prefix candidates plus JavaScript Levenshtein sorting.
- Closest-match queries now use DB-native count, limit, and offset, preserving pagination behavior for fuzzy results.
- `scripts/test-catalog-search.mjs` now covers misspelled names, fuzzy name plus exact number filtering, and multi-word fuzzy queries.

The original local catalog search tokenized the name and applied each token as `lower(cards.name) like token%` against the full name. That worked for a single leading token, but multi-word names could miss exact local matches because the same full string cannot start with every token at once. Queries like `Mr Mime`, `Pikachu ex`, or a multi-word name plus number could fall through to closest-match behavior.

The same path also loads up to 250 local rows and then paginates in memory (`src/lib/catalog/data.ts:286`, `src/lib/catalog/data.ts:102-119`). That makes broad result counts and infinite-scroll depth cap out at the first 250 matches even if the database has more.

Recommended direction:

- Build SQL around DB-native pagination: a count query plus `limit`/`offset`, or a window count if it stays readable.
- Treat the full normalized name as the primary phrase, then use token matching as a fallback. For example, first-token prefix plus subsequent token containment is safer than requiring every token to be a prefix of the whole name.
- Add expression or generated-column indexes for normalized search fields. The current `cards_name_idx` and `cards_number_idx` (`src/db/schema.ts:72-73`) are unlikely to help `lower(name) like ...` well.
- Add `pg_trgm` indexes for fuzzy local search once the exact/prefix behavior is fixed.
- Add tests for multi-word names, name plus number, punctuation variants, and broad queries over 250 results.

### 2. Consolidate collection reads before collections grow

Status: Partially implemented on July 3, 2026.

Implemented:

- `getCurrentCollection()` now uses one nested Supabase select for collection items, variants, cards, and sets instead of four dependent reads.
- Collection reads now include an explicit `user_id` filter in addition to the existing RLS boundary.
- The collection DTO and UI behavior are unchanged.
- Collection filtering by card text and set is implemented in the client collection browser.
- Set filtering uses the full local catalog set list, not only sets already represented in the user's collection.
- Collection grid items now load through server-side pages, with the first page rendered by `/collection` and additional pages fetched from `/api/collection`.
- Added `src/app/collection/loading.tsx` so navigation to the collection page shows an immediate skeleton while private collection data loads.

Still pending:

- Defer finish, condition, and unpriced-status filters until collection grouping or server-side filtering makes them more useful.
- Revisit server-side filter/sort parameters when collections are large enough that client filtering over loaded pages is not sufficient.
- Move collection valuation to `current_prices` after the price refresh design is implemented.

`getCurrentCollection()` fetches collection rows, variants, cards, and sets through multiple dependent Supabase queries (`src/lib/collection/data.ts:71-120`). That is fine for small data, but it will become a noticeable latency source as collections grow. The July 2 work already improved set progress with one nested select (`src/lib/collection/data.ts:22-55`); the main collection view would benefit from the same treatment.

Recommended direction:

- Use a single nested Supabase select or a Drizzle join for collection cards.
- Add server-side pagination and filtering before very large binders become common.
- Move valuation reads toward `current_prices` once price refresh exists, instead of recomputing from `cards.provider_data`.
- Keep the current client-side sort for small collections, then switch to server-side sort for large collections or high-cardinality filters.

### 3. Turn the existing price tables into the source of truth when ready

The July 2 handoff is explicit that pricing still comes from the imported Pokemon TCG payload (`docs/SESSION_HANDOFF_2026-07-02.md:161-164`). The schema already has `current_prices` and `price_points` (`src/db/schema.ts:122-170`), and card detail still shows a placeholder history panel (`src/app/cards/[id]/page.tsx:218`).

Recommended direction:

- Design the refresh job before coding: source, cadence, retry policy, and whether refreshes track all catalog variants or only collected variants.
- Write latest values to `current_prices` and append observations to `price_points`.
- Keep missing prices as missing, never zero.
- Preserve source, currency, price type, finish, and `observed_at`.
- Defer condition-specific pricing until a real condition-aware provider is chosen.

### 4. Improve local catalog freshness and reconciliation

The importer is capable and has useful resume/missing-only modes (`scripts/import-catalog.mjs:47-61`, `scripts/import-catalog.mjs:233-241`), but the catalog has no import run metadata, active/deleted marker, or reconciliation history. Cards are upserted with full `provider_data` (`scripts/import-catalog.mjs:384-449`), which is good for snapshots but makes it harder to answer "when was this card last verified?"

Recommended direction:

- Add a `catalog_import_runs` table or equivalent metadata log.
- Store `last_imported_at` or `provider_updated_at` on sets/cards.
- Add an `is_active` flag or tombstone strategy for cards removed or no longer returned by the provider.
- Make the missing-only check part of an operational checklist or CI/manual release checklist.

## Security And Production Hardening

The auth and ownership boundaries are solid for this stage. Collection routes validate sessions and same-origin mutation requests (`src/app/api/collection/[variantId]/route.ts:19-43`, `src/app/api/collection/cards/[cardId]/route.ts:27-51`), and RLS coverage exists in `scripts/test-rls.mjs`.

Recommended improvements:

- Add rate limiting or abuse protection for public search/autocomplete and mutation routes. Search inputs are bounded (`src/app/api/cards/search/route.ts:7-10`), but a public DB-backed endpoint still needs operational protection.
- Restrict external marketplace URLs by host. `getSafeExternalUrl()` currently allows any HTTPS URL from provider data (`src/app/cards/[id]/page.tsx:27-34`). For TCGplayer links, an allow-list is safer.
- Keep route-level auth checks even though Proxy refreshes sessions. The local Next docs explicitly warn not to rely on Proxy alone for auth coverage.
- If sitemap, robots, or metadata routes are added, revisit the Proxy matcher (`src/proxy.ts:9-12`) so session refresh does not unnecessarily process metadata/static requests.
- Generate Supabase database types from the live schema periodically. The current helper has empty relationship metadata (`src/lib/supabase/database.types.ts:13`), which is why nested selects need manual `.returns<...>()` typing.

## Next.js 16 Cleanup And Performance

The project is mostly aligned with Next 16: async params/searchParams are used, `proxy.ts` is in place, ESLint uses the CLI, and the build runs with Turbopack.

Recommended improvements:

- Replace deprecated `next/image` `priority` with `preload` on the card detail hero image (`src/app/cards/[id]/page.tsx:118-122`). Next 16 keeps it working, but the local docs mark `priority` as deprecated.
- Consider `PageProps` and `RouteContext` helpers after `next typegen` for dynamic pages/routes. Current Promise typing is valid; the helper just reduces drift.
- Reevaluate blanket `prefetch={false}` over time. It is sensible for large grids (`src/components/card-result-grid.tsx:19`, `src/app/sets/page.tsx:67`), but Next 16 has incremental prefetching, so header and small navigation links may be safe to prefetch again after measuring.
- Consider splitting public catalog data from user-specific progress on `/sets`. The current `connection()` calls (`src/app/sets/page.tsx:16`, `src/app/sets/[id]/page.tsx:28`) force request-time rendering, which is reasonable now, but public catalog shells may eventually benefit from caching while personal progress stays dynamic.

## Data Model And Database Improvements

Recommended improvements:

- Add a generic `updated_at` trigger. The schema defines `updated_at` defaults (`src/db/schema.ts:19`), and many app writes update it manually, but database-level automation would reduce future drift.
- Add check constraints or enums for `card_variants.condition` and possibly `printing`. API routes validate these today, but the database accepts arbitrary values.
- Add search-focused indexes: lower/normalized name, normalized number, `(set_id, number)`, and eventually trigram indexes.
- Consider a generated numeric card number sort key. Several queries sort by regex/substr numeric extraction at query time (`src/lib/catalog/data.ts:185-187`), which is useful but not index-friendly.
- Review `bigint(..., { mode: "number" })` for price amounts if future providers can create values outside JS safe integer range. For card prices it is likely fine, but it is a conscious tradeoff.

## UX And Product Polish

Recommended improvements:

- Implemented: update stale product copy. The homepage previously described the collection as "Ready to connect" and said search was backed by the Pokemon TCG API (`src/app/page.tsx:7-36`), while the app now has local catalog search and connected collection persistence. The README also said auth and collection persistence were the next milestone (`README.md:27`), which is no longer true.
- Add a "Load more" fallback to infinite scroll and preserve search scroll/results state when returning from a card page. The July 2 handoff already notes the scroll restoration limitation.
- Add collection filters by card name, set, finish, condition, and unpriced status.
- Consider grouping variants of the same card in collection views once users can own several finishes/conditions.
- Revisit empty collection copy in `src/app/collection/page.tsx`; it still says controls are the next feature even though controls exist.

Status:

- Implemented stale-copy cleanup on July 3, 2026. Updated homepage milestone/intro copy, empty collection guidance, and README feature/setup/check descriptions to match local catalog search, connected collection persistence, infinite scroll, set browsing, and the catalog search regression script.
- Implemented collection navigation loading feedback on July 3, 2026 with a static route-level skeleton for `/collection`.

## Testing And Observability

Current automated coverage is mostly lint, typecheck, build, and the RLS integration script (`package.json:5-14`). There are no app/unit/browser test files beyond `scripts/test-rls.mjs`.

Recommended additions:

- Unit tests for `parseCardSearchQuery`, local search ranking, printing normalization, condition mapping, and safe redirect handling.
- Route handler tests for search validation, collection mutation validation, unauthenticated responses, and same-origin rejection.
- Playwright smoke tests for signup/login happy path, search, card detail, add/update/remove collection item, and collection sort.
- A lightweight catalog import dry-run check in deployment or release docs.
- Production monitoring for route errors, DB connection saturation, slow queries, and provider/import failures.

## Suggested Next Pass

1. Add server-side collection filter/sort parameters once larger binders need filtering beyond loaded pages.
2. Add an `updated_at` trigger migration.
3. Add Playwright smoke coverage for the core user journey.
4. Design the price refresh job and then wire `current_prices`/`price_points`.
5. Revisit eBay listing cards after developer approval and keep outbound search links as fallback.

## Next Session Starting Point

Start with the next database hygiene improvement:

- Add a generic `updated_at` trigger migration for tables that rely on manually maintained `updated_at` values.
- Keep app-level explicit `updated_at` writes where they are already harmless, but let the database protect future writes from drift.
- Verify the migration against the configured database and rerun the standard checks.
- Verify with:

```bash
npm run db:migrate
npm run typecheck
npm run lint
npm run build
```
