# Cardkeeper session handoff — June 21, 2026

## Where we stopped

Cardkeeper now has a working public Pokemon card discovery flow. Users can search from one input, see autocomplete suggestions, open a full card page, and view a separate result page when a query is ambiguous or has no exact match.

The Supabase database is connected and secured, and the Next.js server-side authentication foundation is configured. Signup/login screens, persistent collection controls, and historical price collection have not been connected to the interface yet.

## Implemented today

### Project foundation

- Next.js 16 with React, TypeScript, Tailwind CSS, ESLint, and npm scripts
- PostgreSQL schema managed with Drizzle
- Initial generated SQL migration
- Server-only environment configuration through `.env.local`
- Pokemon TCG API key configured locally and excluded from Git

### Database design

The schema currently defines:

- `profiles`
- `card_sets`
- `cards`
- `card_variants`
- `collection_items`
- `current_prices`
- `price_points`

Cards are separated from variants so finish, condition, and language can be priced and collected independently later. Prices are stored in minor currency units such as cents.

The schema has been applied to Supabase. All seven application tables have Row Level Security enabled. Catalog and price tables are publicly readable, while profiles and collection items are restricted to their authenticated owner.

Supabase-specific database protections now include:

- `profiles.user_id` references `auth.users.id`
- New authenticated users receive a profile automatically
- Collection quantities must be greater than zero
- Price amounts cannot be negative
- Public roles cannot modify catalog or price records
- Authenticated users can only read or modify their own profile and collection rows

### Search experience

- One search input accepts queries such as `Pikachu 58` and `Charizard 4/102`
- The trailing number is parsed as the card number when appropriate
- Suggestions appear after a 300 ms typing pause
- Previous suggestion requests are cancelled while typing
- Mouse and keyboard navigation are supported
- Submitted searches always return the complete broad match set
- Partial and closest matches are returned when direct matches are unavailable
- Misspellings use a broader API query followed by local similarity ranking
- The suggestion dropdown scrolls, stays open during scrollbar interaction, and appears above result cards

### Navigation

- Clicking a suggestion opens `/cards/[id]`
- Every submitted search opens `/search?query=...`
- Direct card navigation is reserved for selecting an autocomplete suggestion or result tile
- Every result tile links to its card detail page
- Search result pages use URL-driven pagination with 24 cards per page
- Previous, next, numbered, and out-of-range page handling preserve the query

### Card detail pages

Detail pages display available provider information including:

- Large card image
- Name, set, number, rarity, artist, and release date
- HP, types, and subtypes
- Flavor text
- Abilities and attacks
- Weakness, resistance, and retreat cost
- Rules
- TCGplayer printing prices
- Cardmarket trend and 30-day average

The page currently shows placeholders for collection controls and historical price graphs.

### Authentication foundation

- Official `@supabase/supabase-js` and `@supabase/ssr` packages
- Separate browser and server clients
- Cookie-backed server sessions
- Next.js 16 `proxy.ts` session refresh
- Verified identity helper based on `supabase.auth.getClaims()`
- Non-cached `/api/auth/status` endpoint
- Shared TypeScript database types for Supabase queries
- No route trusts a user ID supplied by the browser

### Account flows

- Signup with display name, email, password, and confirmation
- Email confirmation callback supporting token-hash and PKCE code links
- Login with safe return-to-page behavior
- Generic signup and recovery messaging to reduce account enumeration
- Forgot-password email requests
- Verified password updates
- Session-aware account page and site navigation
- Logout from the header or account page
- Controlled authentication error page

### Protected collection boundary

- Authenticated `/collection` page with private summary metrics
- Anonymous visitors return to `/login?next=/collection`
- Authenticated, non-cached `GET /api/collection`
- Idempotent quantity updates through `PUT /api/collection/[variantId]`
- Card removal through `DELETE /api/collection/[variantId]`
- Mutation routes derive `user_id` exclusively from the verified session
- Same-origin enforcement on collection mutations
- UUID and quantity validation before database access
- Supabase Row Level Security remains the database-level ownership boundary

### Automated Row Level Security tests

- Rollback-only database integration test in `scripts/test-rls.mjs`
- Runs under Supabase's real `authenticated` and `anon` PostgreSQL roles
- Injects owner and non-owner JWT claims used by `auth.uid()`
- Verifies owner collection/profile reads and collection updates
- Verifies cross-user reads, updates, and inserts are denied
- Verifies anonymous catalog reads remain available
- Verifies anonymous collection access and catalog writes are denied
- Confirms fixtures and existing collection data are unchanged after rollback

### Card collection controls

- Signed-out card pages show a return-aware **Sign in to add** action
- Signed-in users can select finish, condition, and quantity
- Supported conditions: Near Mint, Lightly Played, Moderately Played, Heavily Played, and Damaged
- Finish options come from the card's actual TCGplayer price variants
- Existing finish/condition quantities are detected and can be updated
- Existing variants can be removed from the collection
- The selected external card, set, and variant are synchronized locally on first add
- Finish submissions are revalidated against fresh provider data on the server
- Collection ownership always comes from the verified session
- Condition is stored accurately, while the UI clearly labels current prices as not condition-specific

### Visual collection page

- Responsive owned-card grid rather than internal variant UUIDs
- Card artwork, name, set, and card number
- Quantity badge on each tile
- Finish and condition labels
- Click-through back to the card detail page
- Unique card, unique variant, and total-copy summaries
- Estimated per-variant and total collection values from cached marketplace data
- Explicit count of variants without available pricing
- Collection pricing is labeled as finish-level and not condition-adjusted

## Important files

- `src/app/page.tsx` — homepage
- `src/app/search/page.tsx` — search results page
- `src/app/cards/[id]/page.tsx` — card detail page
- `src/app/api/cards/search/route.ts` — server search endpoint
- `src/components/card-search.tsx` — search and autocomplete interface
- `src/components/card-result-grid.tsx` — reusable clickable result cards
- `src/components/site-header.tsx` — shared navigation
- `src/lib/pokemon-tcg/client.ts` — server-only provider integration and ranking
- `src/lib/pokemon-tcg/types.ts` — provider and application types
- `src/db/schema.ts` — database schema
- `src/lib/supabase/client.ts` — browser Supabase client
- `src/lib/supabase/server.ts` — cookie-aware server Supabase client
- `src/lib/supabase/proxy.ts` — session cookie refresh logic
- `src/lib/supabase/auth.ts` — verified current-user helper
- `src/lib/supabase/database.types.ts` — typed Supabase schema
- `src/proxy.ts` — Next.js 16 proxy entry point
- `src/app/auth/actions.ts` — validated authentication server actions
- `src/components/auth/auth-forms.tsx` — interactive account forms
- `src/app/auth/confirm/route.ts` — confirmation and recovery callback
- `src/app/account/page.tsx` — protected account page
- `docs/SUPABASE_AUTH_SETUP.md` — required dashboard and redirect settings
- `src/app/collection/page.tsx` — protected private collection page
- `src/app/api/collection/route.ts` — authenticated collection reads
- `src/app/api/collection/[variantId]/route.ts` — protected quantity update and removal
- `src/lib/collection/data.ts` — collection data-access layer
- `scripts/test-rls.mjs` — rollback-only ownership/security integration test
- `src/components/collection/collection-controls.tsx` — finish, condition, and quantity interface
- `src/app/api/collection/cards/[cardId]/route.ts` — secure sync-and-add endpoint
- `src/lib/catalog/sync.ts` — on-demand external card/set/variant synchronization
- `src/lib/collection/options.ts` — canonical condition values
- `src/lib/pokemon-tcg/printing.ts` — finish normalization and pricing options
- `src/components/collection/collection-card-grid.tsx` — visual owned-card grid
- `drizzle/0000_foamy_crystal.sql` — initial migration
- `src/app/globals.css` — shared styling

## Verification status

The following passed at the end of the session:

```bash
npm run lint
npm run typecheck
npm run build
```

Live checks also passed for:

- Exact `Pikachu 58` search
- Partial autocomplete search
- Misspelled `Pikchu` closest matches
- Broad `Mew` search returning 135 cards across 6 pages
- Distinct second-page search results and out-of-range page redirection
- Direct card detail rendering
- Closest-match result page
- Ambiguous exact-name result page
- Supabase Session pooler database connectivity
- Both database migrations and all seven tables
- Row Level Security on every application table
- Twelve ownership/public-read policies
- Auth user profile trigger and database constraints
- Repeatable `npm run db:migrate` command
- Anonymous auth-status and forged-cookie checks
- Next.js recognition of the session-refresh proxy
- Public signup, login, and recovery page rendering
- Protected account and update-password redirects
- Invalid confirmation-link handling
- Protected collection redirect behavior
- Anonymous collection reads return `401`
- Cross-origin collection mutations return `403`
- Anonymous same-origin mutations return `401`
- Existing auth user has a matching private profile row
- All 13 automated Row Level Security assertions
- Complete rollback of temporary security-test fixtures
- Anonymous card-detail controls and sign-in return path
- Anonymous card-add requests return `401`
- Cross-origin card-add requests return `403`
- Existing collection rows join successfully to cards, sets, variants, and images

## Current limitations

- English cards only
- Authentication code is implemented; a real confirmation-email round trip still needs manual testing
- No persistent collections
- Collection controls are connected; an authenticated add/update/remove click-through remains a manual browser check
- The database is connected, but the application does not query it yet
- Pokemon TCG API pricing is printing-specific but not condition-specific
- No historical price snapshots have been collected
- Fuzzy search is an approximation until the catalog is stored locally
- Pagination has not been added to result pages
- The Pokemon API key shared during development should be rotated before production

## Recommended starting point tomorrow

1. ~~Create a Supabase project.~~ Completed.
2. ~~Configure the Supabase project and Session pooler values.~~ Completed.
3. ~~Apply and verify the secured database schema.~~ Completed.
4. ~~Install and configure Supabase SSR authentication.~~ Completed.
5. ~~Implement signup, email confirmation, login, logout, and password reset.~~ Completed in code; manual email testing remains.
6. ~~Protect collection pages and collection mutation routes.~~ Completed.
7. ~~Test the existing Row Level Security policies with authenticated users.~~ Completed with 13/13 automated assertions.
8. ~~Add condition, finish, and quantity controls to the card detail page.~~ Completed in code; authenticated click-through remains.

Public card search and detail pages should remain available without an account. Authentication should only be required when a user tries to view or modify a collection.

## Resume commands

From `D:\pokemon`:

```bash
npm run dev
```

Then open `http://localhost:3000`.

Before making changes, it is useful to run:

```bash
npm run lint
npm run typecheck
```
