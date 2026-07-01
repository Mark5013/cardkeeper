# Cardkeeper session handoff — June 22, 2026

The previous handoff is preserved in `docs/SESSION_HANDOFF_2026-06-21.md`. This document reflects the current project state after the database, authentication, private collection, and paginated search work.

## Where we stopped

Cardkeeper now has a working end-to-end account and collection flow:

1. A visitor can search and view cards without an account.
2. A visitor can create and confirm an account.
3. Signed-in users can select a card's finish, condition, and quantity.
4. Cards are synchronized into PostgreSQL when first added.
5. Users can add, update, remove, and visually browse their private collection.
6. Submitted searches always open a complete paginated result set.

The next major system is scheduled pricing and historical price snapshots.

## Implemented today

### Supabase database

- Connected through the IPv4-compatible Session pooler
- Applied two tracked Drizzle migrations
- Created seven application tables:
  - `profiles`
  - `card_sets`
  - `cards`
  - `card_variants`
  - `collection_items`
  - `current_prices`
  - `price_points`
- Linked `profiles.user_id` to `auth.users.id`
- Added automatic profile creation after signup
- Added positive-quantity and non-negative-price constraints
- Added a reliable programmatic migration runner

### Database security

- Enabled Row Level Security on every application table
- Public catalog and price tables are read-only to visitors
- Profiles and collections are owner-only
- Collection APIs derive ownership from the verified session, never request data
- Same-origin checks protect collection mutations
- Added `npm run db:test-rls`
- The rollback-only RLS suite passes 13/13 assertions
- Test fixtures are removed automatically and existing collection data remains unchanged

### Authentication

- Supabase cookie-backed server-side sessions
- Next.js 16 session-refresh proxy
- Signup with display name, email, and password
- Email confirmation supporting token-hash and PKCE code links
- Login and logout
- Forgot-password and update-password flows
- Safe internal return paths after authentication
- Protected account page
- Session-aware site navigation
- Generic account/recovery responses to reduce account enumeration

The complete dashboard setup is documented in `docs/SUPABASE_AUTH_SETUP.md`.

### Protected collection

- Protected `/collection` page
- Authenticated collection read endpoint
- Quantity upsert and variant removal endpoints
- Anonymous reads return `401`
- Cross-origin writes return `403`
- On-demand card, set, and variant synchronization
- Server validation ensures a submitted finish exists for that card
- Finish options come from actual marketplace variants
- Supported conditions:
  - Near Mint
  - Lightly Played
  - Moderately Played
  - Heavily Played
  - Damaged
- Existing finish/condition quantities are detected when revisiting a card

### Visual collection page

- Responsive owned-card grid
- Card image, name, set, and number
- Finish and condition labels
- Quantity badge
- Click-through to card details
- Unique-card, unique-variant, and total-copy summaries
- Cached marketplace price and estimated value when available
- Explicit unpriced-variant count
- Clear notice that prices are not condition-adjusted

### Search and navigation

- One combined search input
- Debounced autocomplete with mouse and keyboard navigation
- Autocomplete selection opens a specific card directly
- Pressing Search always opens the complete result set
- Partial and closest-match fallback behavior
- URL-driven pagination with 24 cards per page
- Previous, next, and numbered page controls
- Query and page state survive refresh, sharing, and browser navigation
- Out-of-range pages redirect to the final valid page

## Manual verification completed

The following were confirmed manually in the browser:

- Signup and email confirmation
- Login and logout
- Account page
- Adding a card to a collection
- Updating a card quantity
- Removing a card
- Visual collection rendering

Automated/live checks also confirmed:

- Anonymous and forged-cookie auth state
- Protected page redirects
- Invalid confirmation-link handling
- Anonymous/cross-origin collection API rejection
- Auth user/profile trigger linkage
- 13/13 PostgreSQL RLS assertions
- Exact, partial, and misspelled catalog searches
- `Mew` returning 135 cards over 6 result pages
- Distinct second-page results
- Out-of-range pagination correction
- ESLint, TypeScript, and production builds

## Important files

### Database and security

- `src/db/schema.ts`
- `drizzle/0000_foamy_crystal.sql`
- `drizzle/0001_great_randall.sql`
- `scripts/migrate.mjs`
- `scripts/test-rls.mjs`

### Authentication

- `src/proxy.ts`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/proxy.ts`
- `src/lib/supabase/auth.ts`
- `src/app/auth/actions.ts`
- `src/components/auth/auth-forms.tsx`
- `src/app/auth/confirm/route.ts`

### Collection

- `src/app/collection/page.tsx`
- `src/components/collection/collection-card-grid.tsx`
- `src/components/collection/collection-controls.tsx`
- `src/lib/collection/data.ts`
- `src/lib/catalog/sync.ts`
- `src/app/api/collection/route.ts`
- `src/app/api/collection/[variantId]/route.ts`
- `src/app/api/collection/cards/[cardId]/route.ts`

### Search and cards

- `src/components/card-search.tsx`
- `src/components/search-pagination.tsx`
- `src/app/search/page.tsx`
- `src/lib/pokemon-tcg/client.ts`
- `src/app/cards/[id]/page.tsx`

## Known limitations

- English cards only
- Pokemon TCG API prices distinguish finish but not condition
- Some newly released cards have no TCGplayer price and appear as unpriced
- Collection prices currently come from provider data cached when the card was added
- No scheduled price refresh job
- No historical price snapshots or graph data
- No historical collection-value graph
- Search still depends on the external Pokemon TCG API
- Closest-match search is approximate until the catalog is searchable locally
- Collection grid has no filtering, sorting, or pagination yet
- Email/password is the only authentication method
- Production SMTP and deployment settings are not configured

## Pending eBay listing integration

As of July 1, 2026, the eBay Developer account has been created and is waiting on eBay review. The review is expected to take about one business day.

When the eBay account is approved:

1. Create or open the eBay Developer app/keyset.
2. Copy the Production `Client ID` and `Client Secret`.
3. Add these values to `.env.local` without committing them:

```bash
EBAY_CLIENT_ID=your_client_id
EBAY_CLIENT_SECRET=your_client_secret
EBAY_MARKETPLACE_ID=EBAY_US
```

4. Implement server-only eBay OAuth using the client credentials grant.
5. Add a server route for individual listings, likely `/api/marketplaces/ebay-listings?cardId=...`.
6. Query eBay Browse API item search with a card-specific query such as:

```text
{card.name} {card.set.name} {card.number} Pokemon TCG card
```

7. Return listing summaries to the card page, including title, image, price, shipping if available, condition, seller if available, and item URL.
8. Render individual eBay listing cards on `src/app/cards/[id]/page.tsx`.
9. Keep the existing eBay search link as a fallback when the API is unavailable or returns no listings.

Relevant docs:

- eBay Browse API item search: `https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search`
- eBay OAuth client credentials flow: `https://developer.ebay.com/develop/guides-v2/authorization#the-client-credentials-grant-flow`

## Recommended next steps

### 1. eBay individual listings after account approval

- Add server-only eBay OAuth token handling
- Add an eBay listings API route
- Render individual eBay listing cards on card detail pages
- Preserve the current outbound eBay search link as a fallback
- Do not expose eBay credentials to the browser or commit them to source

### 2. Price synchronization foundation

- Decide on the daily price source and refresh cadence
- Refresh only variants currently tracked by collections
- Write latest values to `current_prices`
- Append daily observations to `price_points`
- Preserve source, currency, price type, finish, and observation time
- Never treat missing prices as zero

The initial source can remain the Pokemon TCG API. Condition-specific pricing should be added later through a provider such as JustTCG rather than estimated with arbitrary percentages.

### 3. Historical card-price graphs

- Add a price-history query endpoint
- Render 7-, 30-, and 90-day views
- Display source and last-updated information
- Handle sparse or missing history honestly

### 4. Collection valuation

- Calculate collection value from `current_prices`
- Show priced and unpriced totals separately
- Add daily portfolio snapshots if historical collection value is desired

### 5. Collection usability

- Filter by name, set, condition, and finish
- Sort by value, name, date added, and quantity
- Add pagination when collections grow
- Consider grouping multiple variants of the same card

### 6. Catalog and search independence

- Import the English card catalog locally
- Search PostgreSQL instead of the provider for every request
- Add indexed fuzzy matching using `pg_trgm`
- Keep the provider API for catalog refreshes and detail updates

### 7. Production readiness

- Configure production URL allowlists
- Configure custom SMTP
- Rotate the Pokemon API key shared during development
- Add request monitoring and rate limiting
- Add automated browser tests for auth and collection flows
- Choose hosting for Next.js and scheduled jobs

## Resume commands

From `D:\pokemon`:

```bash
npm run dev
```

Quality checks:

```bash
npm run lint
npm run typecheck
npm run build
npm run db:test-rls
```

Apply future migrations with:

```bash
npm run db:migrate
```

Do not commit `.env.local` or paste database passwords, session tokens, or service-role keys into chat or source files.
