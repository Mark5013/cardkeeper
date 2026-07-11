# Cardkeeper

Cardkeeper is a Pokemon card collection manager built with Next.js, TypeScript, PostgreSQL, Supabase, and Drizzle. The local catalog is English-only and imported from the Pokemon TCG API, while the schema keeps card language explicit for future catalogs.

## What works

- Responsive project landing page
- Server-only Pokemon TCG API integration for catalog imports and fallback reads
- Local PostgreSQL-backed card and set browsing
- Single-field card search supporting queries such as `Pikachu 58`
- Debounced card suggestions with keyboard navigation
- Exact-match detection and ranked closest-match fallbacks
- Dedicated search-results pages for ambiguous and closest matches
- Broad submitted-search results with infinite scroll and shareable URLs
- Clickable card results and full card-detail pages
- Card images and imported TCGCSV-backed TCGplayer market prices
- Collection, variant, and historical pricing database schema
- Supabase SSR browser/server clients and session-refresh proxy
- Verified, non-cached authentication status endpoint
- Email/password signup, confirmation, login, logout, and password recovery
- Protected account settings and session-aware navigation
- Protected private collection page and summary
- Owner-derived collection read, quantity update, and removal APIs
- On-demand card catalog synchronization when a user adds a card
- Finish, condition, and quantity controls on card detail pages
- Visual owned-card collection grid with quantities, variants, and estimated values
- Collection sorting by added date and estimated price
- Set browsing with signed-in collection progress

The hosted database schema and Row Level Security policies are applied. Authentication, private collection persistence, local catalog search, and set browsing are connected in the interface.

## Local setup

Requirements:

- Node.js 24 or newer
- A Pokemon TCG API key for catalog import or provider fallback reads
- A PostgreSQL database when enabling persistence

Install and configure:

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open http://localhost:3000.

Add secrets to `.env.local`:

```dotenv
POKEMON_TCG_API_KEY=your_key_here
DATABASE_URL=postgresql://user:password@host:5432/database
DATABASE_MAX_CONNECTIONS=1
```

Never prefix these values with `NEXT_PUBLIC_`; both must remain server-only.

## Database

After providing `DATABASE_URL`, apply the schema during local development:

```bash
npm run db:push
```

For reviewed migrations:

```bash
npm run db:generate
npm run db:migrate
```

Import or refresh the local English Pokemon TCG catalog:

```bash
npm run catalog:import
```

Refresh TCGCSV-backed TCGplayer prices into `current_prices` and `price_points`:

```bash
npm run prices:refresh
```

The scheduled GitHub Action runs nightly with:

```bash
npm run prices:refresh -- --skip-if-current
```

Configure `DATABASE_URL` as a GitHub Actions secret before relying on the workflow.

Useful price refresh test runs:

```bash
npm run prices:refresh -- --dry-run --limit=25
npm run prices:refresh -- --dry-run --only-missing
```

Useful test runs:

```bash
npm run catalog:import -- --dry-run --max-pages=1
npm run catalog:import -- --set-id=base1 --max-pages=1
npm run catalog:import -- --cards-only --start-card-page=6
npm run catalog:import -- --cards-only --cards-by-set
npm run catalog:import -- --cards-only --cards-by-set --missing-only
```

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
npm run catalog:test-search
npm run db:test-rls
```

`catalog:test-search` creates temporary catalog fixtures inside a transaction, checks local search behavior, and rolls everything back.

`db:test-rls` creates temporary fixtures inside a transaction, exercises owner, non-owner, and anonymous policies, and rolls everything back.

## Data model

- `card_sets` and `cards` hold catalog records.
- `card_variants` separates finish, condition, and language.
- `collection_items` stores a user's quantity for a specific variant.
- `current_prices` stores the latest value by source and price type.
- `price_points` stores historical observations for graphs.

All monetary amounts are stored in minor currency units, such as cents.
