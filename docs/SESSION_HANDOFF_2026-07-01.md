# Cardkeeper session handoff - July 1, 2026

The previous handoff is preserved in `docs/SESSION_HANDOFF_2026-06-22.md`. This document reflects today's UI, collection usability, marketplace-linking, and eBay integration planning work.

## Where we stopped

Cardkeeper still has the completed account, search, card-detail, and private collection flow from the June 22 handoff.

Today's active stopping point:

1. Collection sorting is implemented client-side.
2. The app has a dark, minimal visual theme.
3. Card detail pages link out to TCGplayer and eBay search listings.
4. Individual eBay listing cards are planned but blocked on eBay Developer account approval.

The eBay Developer account has been created and is under eBay review as of July 1, 2026. Expected review time is about one business day.

## Implemented today

### Collection sorting

- Added client-side collection sorting without re-fetching collection data.
- Default sort is newest added to oldest added.
- Added sort options:
  - Newest added
  - Oldest added
  - Card price: high to low
  - Card price: low to high
- Unpriced variants sort after priced variants when sorting by price.
- Server collection query now defaults to `created_at` descending.

Important files:

- `src/components/collection/collection-browser.tsx`
- `src/components/collection/collection-card-grid.tsx`
- `src/app/collection/page.tsx`
- `src/lib/collection/data.ts`
- `src/lib/collection/types.ts`

### Visual design refresh

- Reworked the app from warm light styling to a dark/minimal baseline.
- Removed the old hero glow.
- Reduced oversized radii on cards and panels.
- Replaced pale card surfaces with dark surfaces.
- Trimmed heavy warm shadows.
- Normalized old negative letter-spacing utility classes.
- Changed the secondary color from green to blue.
- Removed the warm red/amber decorative accent from normal labels by aliasing `--accent` to the blue secondary color.
- Kept red-family color only for true error/destructive states through `--danger`.

Current key theme tokens in `src/app/globals.css`:

```css
--background: #080a09;
--surface: #111512;
--surface-2: #171d19;
--ink: #eef3ed;
--muted: #97a39b;
--line: #28322d;
--secondary: #8fb7ff;
--secondary-hover: #abc6ff;
--secondary-contrast: #07101f;
--accent: var(--secondary);
--accent-strong: var(--secondary-hover);
--danger: #ff7a8a;
```

Important files:

- `src/app/globals.css`
- `src/components/site-header.tsx`
- `src/components/card-result-grid.tsx`
- `src/components/card-search.tsx`
- `src/components/collection/collection-card-grid.tsx`
- `src/components/collection/collection-browser.tsx`
- `src/components/collection/collection-controls.tsx`
- `src/components/auth/auth-card.tsx`
- `src/components/auth/auth-forms.tsx`
- `src/app/page.tsx`
- `src/app/search/page.tsx`
- `src/app/collection/page.tsx`
- `src/app/cards/[id]/page.tsx`
- `src/app/account/page.tsx`
- `src/app/auth/error/page.tsx`

### Card marketplace links

- Added a `Listings` panel to card detail pages.
- TCGplayer links use `card.tcgplayer.url` from the Pokemon TCG API when available.
- eBay links use a generated eBay search URL for:

```text
{card.name} {card.set.name} {card.number} Pokemon TCG card
```

- External URLs are validated server-side before rendering.
- TCGplayer link gracefully falls back to a message when the API does not provide a URL.
- eBay search link remains available for every card.

Important file:

- `src/app/cards/[id]/page.tsx`

Reference:

- Pokemon TCG API card object docs: `https://docs.pokemontcg.io/api-reference/cards/card-object/`

## Pending eBay individual listing integration

Individual eBay listing cards are not implemented yet because the eBay Developer account is still awaiting review.

When eBay approves the account:

1. Create or open the eBay Developer app/keyset.
2. Copy the Production `Client ID` and `Client Secret`.
3. Add these values to `.env.local` without committing them:

```bash
EBAY_CLIENT_ID=your_client_id
EBAY_CLIENT_SECRET=your_client_secret
EBAY_MARKETPLACE_ID=EBAY_US
```

4. Implement server-only eBay OAuth using the client credentials grant.
5. Add a server route, likely:

```text
/api/marketplaces/ebay-listings?cardId=...
```

6. Query eBay Browse API item search with a card-specific query.
7. Return listing summaries including title, image, price, shipping if available, condition, seller if available, item URL, and buying option when available.
8. Render individual listing cards on `src/app/cards/[id]/page.tsx`.
9. Keep the current outbound eBay search link as the fallback when the API is unavailable or returns no listings.

Relevant docs:

- eBay Browse API item search: `https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search`
- eBay OAuth client credentials flow: `https://developer.ebay.com/develop/guides-v2/authorization#the-client-credentials-grant-flow`

## Verification completed today

The following checks passed after the changes:

```bash
npm run lint
npm run typecheck
npm run build
```

Manual/live smoke checks:

- `http://127.0.0.1:3000` returned `200 OK`
- `/collection` returned the expected auth redirect when not signed in
- `/cards/swsh4-25` returned `200 OK`
- Rendered card detail HTML included:
  - `TCGplayer listings`
  - `eBay listings`
  - `ebay.com`
  - `prices.pokemontcg.io`

## Known limitations

- English cards only.
- Pokemon TCG API prices distinguish finish but not condition.
- Some newly released cards have no TCGplayer price and appear as unpriced.
- Collection prices currently come from provider data cached when the card was added.
- No scheduled price refresh job.
- No historical price snapshots or graph data.
- No historical collection-value graph.
- Search still depends on the external Pokemon TCG API.
- Closest-match search is approximate until the catalog is searchable locally.
- Collection grid still has no filtering or pagination.
- Individual eBay listing cards are blocked until eBay Developer account approval.
- Email/password is the only authentication method.
- Production SMTP and deployment settings are not configured.

## Recommended next steps

### 1. eBay individual listings after account approval

- Add eBay server-only credentials to `.env.local`.
- Add OAuth token request and short-lived token caching.
- Add an eBay listings API route.
- Render individual listing cards on card detail pages.
- Keep the current eBay search link as fallback.
- Do not expose eBay credentials to the browser or commit them to source.

### 2. Collection usability

- Add filters by name, set, condition, and finish.
- Add pagination when collections grow.
- Consider grouping multiple variants of the same card.
- Add sort options for name, quantity, and total value if useful.

### 3. Price synchronization foundation

- Decide on the daily price source and refresh cadence.
- Refresh only variants currently tracked by collections.
- Write latest values to `current_prices`.
- Append daily observations to `price_points`.
- Preserve source, currency, price type, finish, and observation time.
- Never treat missing prices as zero.

The initial source can remain the Pokemon TCG API. Condition-specific pricing should be added later through a provider such as JustTCG rather than estimated with arbitrary percentages.

### 4. Historical card-price graphs

- Add a price-history query endpoint.
- Render 7-, 30-, and 90-day views.
- Display source and last-updated information.
- Handle sparse or missing history honestly.

### 5. Collection valuation

- Calculate collection value from `current_prices`.
- Show priced and unpriced totals separately.
- Add daily portfolio snapshots if historical collection value is desired.

### 6. Catalog and search independence

- Import the English card catalog locally.
- Search PostgreSQL instead of the provider for every request.
- Add indexed fuzzy matching using `pg_trgm`.
- Keep the provider API for catalog refreshes and detail updates.

### 7. Production readiness

- Configure production URL allowlists.
- Configure custom SMTP.
- Rotate the Pokemon API key shared during development.
- Add request monitoring and rate limiting.
- Add automated browser tests for auth and collection flows.
- Choose hosting for Next.js and scheduled jobs.

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

Do not commit `.env.local` or paste database passwords, session tokens, Pokemon API keys, eBay client secrets, or service-role keys into chat or source files.
