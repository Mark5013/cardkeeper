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
- Collection filtering by card text and set is implemented through the paged collection API.
- Set filtering uses the full local catalog set list, not only sets already represented in the user's collection.
- Collection grid items now load through server-side pages, with the first page rendered by `/collection` and additional pages fetched from `/api/collection`.
- Added `src/app/collection/loading.tsx` so navigation to the collection page shows an immediate skeleton while private collection data loads.
- Follow-up implemented on July 3, 2026: `getCurrentCollection()` now uses a Drizzle join for collection items, variants, cards, and sets; `/api/collection` accepts `query`, `setIds`, and `sort`; and `CollectionBrowser` refetches filtered/sorted pages from the server instead of filtering only the loaded client page.

Still pending:

- Defer finish, condition, and unpriced-status filters until collection grouping or server-side filtering makes them more useful.
- Add unpriced-status filtering now that collection valuation reads from `current_prices`.

`getCurrentCollection()` fetches collection rows, variants, cards, and sets through multiple dependent Supabase queries (`src/lib/collection/data.ts:71-120`). That is fine for small data, but it will become a noticeable latency source as collections grow. The July 2 work already improved set progress with one nested select (`src/lib/collection/data.ts:22-55`); the main collection view would benefit from the same treatment.

Recommended direction:

- Implemented: use a Drizzle join for collection cards.
- Implemented: add server-side pagination, filtering, and sorting before very large binders become common.
- Implemented: move valuation reads toward `current_prices`, with imported provider data as fallback.
- Keep price sorting on the server for now, then make it database-native once `current_prices` becomes the source of truth.

### 3. Turn the existing price tables into the source of truth when ready

Status: Implemented on July 3, 2026.

Implemented:

- Added `scripts/refresh-prices-tcgcsv.mjs` to import TCGCSV-backed TCGplayer prices into `current_prices` and `price_points`.
- Added `npm run prices:refresh`.
- Ran a full TCGCSV refresh after a dry run and safer set-matching pass.
- Current database coverage after refresh:
  - 20,359 total cards
  - 18,028 cards with at least one TCGCSV market price
  - 88.55% card-level market-price coverage
  - 32,106 total variants
  - 31,373 variants with a TCGCSV market price
  - 97.72% variant-level market-price coverage
- Catalog search, set, card detail, and collection valuation paths now prefer refreshed TCGCSV prices from `current_prices`, with imported Pokemon TCG provider data as fallback.
- Added `.github/workflows/refresh-prices.yml` to run the refresh nightly and on manual dispatch.
- The scheduled workflow runs `npm run prices:refresh -- --skip-if-current`, checks TCGCSV `last-updated.txt`, and skips the full sync when the local TCGCSV prices already match the latest build.
- The script sets a custom TCGCSV `User-Agent`, throttles requests, uses server-side ingestion into Supabase, and stays well under TCGCSV's 10,000-request guidance. A full Pokemon refresh is roughly 436 TCGCSV requests before retries.
- README now documents manual refreshes, dry runs, `--reset-source`, and the scheduled workflow.
- Card detail pages now render an interactive Recharts price history graph from `price_points`, with date on the x-axis, USD market price on the y-axis, printing selection, and cursor tooltip readout.
- Follow-up implemented on July 3, 2026: TCGCSV set matching now includes explicit aliases for provider/local set naming differences, including Rumble, Black Star promo eras, Best of Game/Best of Promos, `and`/`&` set names, McDonald's promo naming, SM Base Set, SM Burning Shadows, and split EX Trainer Kit groups.
- Split EX Trainer Kit TCGCSV groups now map to multiple local sets using stricter card name plus number matching so shared card numbers do not attach prices to the wrong half-deck.
- Current zero-price set-level gaps after reconciliation are `fut20` Pokemon Futsal Collection and `mcd21` McDonald's Collection 2021. TCGCSV did not expose an obvious Futsal group, and the 2021 McDonald's set was not mapped because TCGCSV does not list a 2021 McDonald's promo group.
- Card detail pages now tolerate provider payloads where `cardmarket` exists but nested `prices` is absent.
- Set detail pages and global search results now support DB-backed card sorting by current market price, with unpriced cards sorted after priced cards.
- Search, set, and collection dropdown menus now use Radix UI primitives for accessible select/dropdown behavior while keeping Cardkeeper's existing visual styling.
- Set detail sort changes now update the URL with `window.history.replaceState` instead of triggering a Next route navigation, avoiding duplicate set-page reloads and dropdown remounts after quick sort changes.
- Search result sort changes now refresh the card grid through the cards API and update the URL with `window.history.replaceState`, keeping the result heading/count and sort dropdown mounted while sorted cards load. The redundant "Showing x of x" line was removed from search results.
- Follow-up implemented on July 5, 2026: TCGCSV price matching now handles additional supplemental mappings and card-number quirks, including Aquapolis `a`/`b` variants, SM Base unnumbered 2017 energies, Base Machamp via Deck Exclusives, League & Championship placement variants, and additional Alternate Art Promo aliases for Flashfire, Roaring Skies, and Shining Legends.
- Multiple TCGCSV products that collapse to one local card/printing are now averaged instead of whichever product was processed last winning arbitrarily.
- Current TCGCSV-backed card-level coverage is now 20,290 / 20,329 cards, or about 99.81%, excluding the known no-coverage sets `fut20` Pokemon Futsal Collection and `mcd21` McDonald's Collection 2021.
- Follow-up audit on July 5, 2026 found four current no-price cards with no plausible TCGplayer/TCGCSV product mapping after a product-list scan and manual review: DP Black Star Promos `Beginning Door #DP54`, DP Black Star Promos `Ultimate Zone #DP55`, BW Black Star Promos `Pikachu #BW77`, and BW Black Star Promos `Raichu #BW78`.
- Other remaining card-level gaps are treated as TCGCSV product-without-price-row cases or low-priority special listings to revisit later. Confirmed product-without-price-row examples include Team Up `Pokemon Communication #152a`, DP Black Star Promos `Tropical Wind #DP05`, and Nintendo Black Star Promos `Tropical Tidal Wave #36`.

Operational notes:

- GitHub Actions needs a `DATABASE_URL` repository secret under **Settings > Secrets and variables > Actions**.
- The database password was pasted into chat during setup. Rotate the Supabase database password and update both `.env.local` and the GitHub `DATABASE_URL` secret.
- Use `--reset-source` only when deliberately replacing the existing TCGCSV snapshot; normal scheduled refreshes should use `--skip-if-current`.

Original finding: the July 2 handoff was explicit that pricing still came from the imported Pokemon TCG payload (`docs/SESSION_HANDOFF_2026-07-02.md:161-164`). The schema already had `current_prices` and `price_points` (`src/db/schema.ts:122-170`), and card detail still showed a placeholder history panel (`src/app/cards/[id]/page.tsx:218`).

Recommended direction:

- Implemented: design the refresh job before coding. Source is TCGCSV, cadence is nightly GitHub Actions, retries are exponential with capped attempts, and refreshes track catalog variants rather than only collected variants.
- Implemented: write latest values to `current_prices` and append observations to `price_points`.
- Implemented: keep missing prices as missing, never zero.
- Implemented: preserve source, currency, price type, finish, and `observed_at`.
- Current TCGCSV-backed prices are finish/printing-aware when TCGplayer exposes separate subtypes, but they are not condition-specific. Collection valuation still treats selected card condition as metadata rather than applying LP/MP/HP/Damaged adjustments.
- Defer condition-specific pricing until a real condition-aware provider is chosen.

### 4. Improve local catalog freshness and reconciliation

Status: Started on July 5, 2026.

Implemented:

- Added migration `drizzle/0004_catalog_import_runs.sql` and schema model `catalogImportRuns` for catalog import operational history.
- Catalog imports now create a run record before provider reads, then mark the run `succeeded` or `failed` with mode, options, processed set/card counts, duration, and error details.
- The import-run table is private operational data: RLS is enabled and no anon/authenticated grants are added.
- Added migration `drizzle/0005_catalog_row_freshness.sql` with `last_imported_at` on `card_sets` and `cards`, plus `provider_updated_at` on `card_sets` where the Pokemon TCG API exposes a set timestamp.
- Catalog import and on-demand card sync paths now stamp row-level freshness fields when they upsert local catalog rows.
- Added migration `drizzle/0006_catalog_active_flags.sql` with `is_active` tombstone flags on `card_sets` and `cards`.
- Normal catalog imports and on-demand card syncs mark seen rows active, while public catalog search/set/card reads filter to active rows. Marking missing rows inactive is intentionally reserved for a future explicit reconciliation command rather than normal new-set imports.
- Added `.github/workflows/import-catalog.yml`, which polls the upstream `PokemonTCG/pokemon-tcg-data` repository daily, records the latest upstream commit SHA in the catalog import run options, and runs the sets plus `--cards-by-set --missing-only` import only when that upstream SHA has not already imported successfully.
- The first scheduled catalog workflow run after deployment will import once to seed the upstream SHA in `catalog_import_runs`; later runs skip until the upstream data repo commit changes.

The importer is capable and has useful resume/missing-only modes (`scripts/import-catalog.mjs:47-61`, `scripts/import-catalog.mjs:233-241`), but the catalog has no import run metadata, active/deleted marker, or reconciliation history. Cards are upserted with full `provider_data` (`scripts/import-catalog.mjs:384-449`), which is good for snapshots but makes it harder to answer "when was this card last verified?"

Recommended direction:

- Implemented: add a `catalog_import_runs` table or equivalent metadata log.
- Implemented: store `last_imported_at` on sets/cards and `provider_updated_at` on sets.
- Implemented foundation: add an `is_active` flag/tombstone strategy for cards removed or no longer returned by the provider. Still pending: build the explicit reconciliation command that marks missing rows inactive after a deliberate full comparison.
- Implemented: make the missing-only check part of an operational checklist or CI/manual release checklist through the scheduled upstream commit polling workflow.

## Security And Production Hardening

The auth and ownership boundaries are solid for this stage. Collection routes validate sessions and same-origin mutation requests (`src/app/api/collection/[variantId]/route.ts:19-43`, `src/app/api/collection/cards/[cardId]/route.ts:27-51`), and RLS coverage exists in `scripts/test-rls.mjs`.

Recommended improvements:

- Implemented conservative first pass on July 5, 2026: public DB-backed catalog APIs now use a shared per-IP in-memory limiter and return `429` with `Retry-After` when exceeded. This currently covers card search/autocomplete (`/api/cards/search`) and set-card pagination/sorting (`/api/sets/[id]/cards`) at 120 requests per minute per route group.
- Add distributed rate limiting or provider-level abuse protection before serious production traffic. The current limiter is intentionally lightweight and per runtime instance; it is useful for local/self-hosted bursts but not a substitute for Redis/Upstash, Vercel Firewall, Cloudflare, or another shared edge/backend limiter.
- Consider adding similar protection for authenticated mutation routes if abuse patterns appear. Collection routes already require a session and same-origin mutation headers, so they were left out of the conservative first pass.
- Implemented on July 5, 2026: external TCGplayer listing URLs are now restricted to HTTPS links on known TCGplayer/PokemonTCG price-link hosts, instead of accepting any HTTPS URL from provider data.
- Keep route-level auth checks even though Proxy refreshes sessions. The local Next docs explicitly warn not to rely on Proxy alone for auth coverage.
- If sitemap, robots, or metadata routes are added, revisit the Proxy matcher (`src/proxy.ts:9-12`) so session refresh does not unnecessarily process metadata/static requests.
- Generate Supabase database types from the live schema periodically. The current helper has empty relationship metadata (`src/lib/supabase/database.types.ts:13`), which is why nested selects need manual `.returns<...>()` typing.

## Next.js 16 Cleanup And Performance

The project is mostly aligned with Next 16: async params/searchParams are used, `proxy.ts` is in place, ESLint uses the CLI, and the build runs with Turbopack.

Recommended improvements:

- Implemented on July 5, 2026: replaced deprecated `next/image` `priority` with `preload` on the card detail hero image.
- Consider `PageProps` and `RouteContext` helpers after `next typegen` for dynamic pages/routes. Current Promise typing is valid; the helper just reduces drift.
- Reevaluate blanket `prefetch={false}` over time. It is sensible for large grids (`src/components/card-result-grid.tsx:19`, `src/app/sets/page.tsx:67`), but Next 16 has incremental prefetching, so header and small navigation links may be safe to prefetch again after measuring.
- Consider splitting public catalog data from user-specific progress on `/sets`. The current `connection()` calls (`src/app/sets/page.tsx:16`, `src/app/sets/[id]/page.tsx:28`) force request-time rendering, which is reasonable now, but public catalog shells may eventually benefit from caching while personal progress stays dynamic.

## Data Model And Database Improvements

Recommended improvements:

- Implemented: add a generic `updated_at` trigger. Migration `drizzle/0003_updated_at_triggers.sql` adds a reusable trigger function and attaches it to `profiles`, `card_sets`, `cards`, `card_variants`, `collection_items`, and `current_prices`.
- Implemented on July 5, 2026: added database check constraints for `card_variants.condition` and normalized `card_variants.printing`, so scripts/manual writes cannot insert unsupported conditions or unnormalized finish keys.
- Implemented: add search-focused indexes for normalized card names, trigram search, lower card number, and `(set_id, number)`.
- Implemented on July 5, 2026: added a stored generated `cards.number_sort_key` column plus set/order index, and updated catalog/collection ordering to use it instead of repeating regex/substr extraction at query time.
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
- Implemented `/sets` page filtering on July 5, 2026. The set browser now includes a client-side search input that filters the already-loaded local set list by set name, series, set id, and release year/date while preserving collection progress counts.

## Testing And Observability

Current automated coverage is mostly lint, typecheck, build, and the RLS integration script (`package.json:5-14`). There are no app/unit/browser test files beyond `scripts/test-rls.mjs`.

Recommended additions:

- Unit tests for `parseCardSearchQuery`, local search ranking, printing normalization, condition mapping, and safe redirect handling.
- Route handler tests for search validation, collection mutation validation, unauthenticated responses, and same-origin rejection.
- Implemented initial Playwright smoke tests on July 3, 2026 for public search, card detail, anonymous collection redirect, and the search input prefill behavior on results.
- Implemented seeded authenticated Playwright coverage on July 3, 2026 for login, collection access, add/update/remove through authenticated collection routes, and collection filter/sort UI verification.
- Add Playwright coverage for signup happy path once test-user lifecycle and email confirmation handling are finalized.
- A lightweight catalog import dry-run check in deployment or release docs.
- Production monitoring for route errors, DB connection saturation, slow queries, and provider/import failures.

## Suggested Next Pass

1. Revisit eBay listing cards after developer approval and keep outbound search links as fallback.
2. Add signup happy-path coverage once test-user lifecycle and email confirmation handling are finalized.
3. Add unpriced-status filtering now that collection valuation reads from `current_prices`.

## Next Session Starting Point

Next product pass:

- Browser smoke coverage is in place for public search, card detail, anonymous collection redirect, seeded login, collection page access, authenticated add/update/remove route flows, and collection filter/sort controls.
- Price history UI is in place using populated `price_points`.
- TCGCSV price coverage is about 99.81% excluding `fut20` and `mcd21`; the remaining no-price cards are either confirmed no-mapping cases or TCGCSV product-without-price-row/special-listing follow-ups.
- Keep signup happy-path coverage pending until test-user lifecycle and email confirmation handling are finalized.
- Verify with:

```bash
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```
