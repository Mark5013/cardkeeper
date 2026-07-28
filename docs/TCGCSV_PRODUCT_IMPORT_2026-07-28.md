# TCGCSV English sealed and Japanese catalog import — 2026-07-28

## Status

The first production import of English sealed products, Japanese cards, and
Japanese sealed products completed successfully against TCGCSV build
`2026-07-27T20:09:27.000Z`.

The importer processed all 667 groups in TCGplayer categories `3` (Pokémon)
and `85` (Pokémon Japan) with 1,337 provider requests:

- 441 active Japanese sets;
- 29,858 active Japanese cards;
- 32,453 Japanese card variants;
- 103,626 Japanese current-price rows and aligned compressed series;
- 1,970 active English sealed products;
- 301 active Japanese sealed products; and
- 6,361 sealed current-price rows and aligned compressed series.

It excluded 2,160 digital/code-card products and reported zero sealed products
with conflicting price subtypes.

## Model

Japanese cards reuse the existing card, variant, external-ref, collection, and
price tables with explicit `ja` language identities. Their local provider IDs
are namespaced as `tcgplayer-85-{groupId}` and
`tcgplayer-85-{productId}`, so lookups cannot collide with English Pokémon TCG
API IDs.

Each Japanese card variant has exactly one direct TCGplayer product reference.
The importer never maps or averages several products onto one identity.
Numbered products and unnumbered products with independent card metadata are
cards. Digital/code-card evidence is excluded before card/sealed
classification.

Sealed products are not represented as fake cards. They use the first-class
tables:

- `sealed_products`
- `sealed_current_prices`
- `sealed_price_series`

English and Japanese sealed products share this model but keep explicit
language and TCGplayer category identities.

## Application paths

- Card search and set browsing include English and Japanese cards with language
  labels.
- Japanese card details, exact finish prices, price history, collection
  controls, and Japanese TCGplayer listing URLs use the Japanese identity.
- `/sealed` loads the complete sealed set catalog for continuous scrolling,
  with instant set-name search and a styled client-side language filter.
- `/sealed/sets/{categoryId}/{groupId}` provides the products within one sealed
  set, including product-name search and pagination.
- `/sealed/{productId}` provides product details, current low/mid/high/market
  values, price history, and the exact TCGplayer listing.

TCGplayer's
[Pokémon Japan catalog](https://www.tcgplayer.com/categories/trading-and-collectible-card-games/pokemon-japan)
currently keeps product names in English because Japanese characters are not
supported in those listings, as documented in its
[Japanese Pokémon FAQ](https://help.tcgplayer.com/hc/en-us/articles/27144507093271-Japanese-Pok%C3%A9mon-FAQ).
The application therefore labels the catalog language explicitly instead of
pretending those source names are translations.

## Safety and operations

`catalog:import-tcgcsv-products` is dry-run by default and requires `--apply`
to write. It follows the [TCGCSV usage guidance](https://tcgcsv.com/docs) and:

- checks `last-updated.txt` before fetching groups;
- uses an identifiable User-Agent and at least 250 ms request spacing;
- computes both the planned and retry-inclusive worst-case request budgets;
- rejects a run that could approach 10,000 requests;
- writes each group transactionally;
- removes stale current values when a product no longer publishes a price;
- deactivates missing products only after a complete unscoped import succeeds;
  and
- records every apply in `catalog_import_runs`.

The changed-build guard was verified immediately after production import. It
made only the marker request and skipped the already-current build.

The scheduled GitHub workflow applies migrations, imports only when the TCGCSV
build changed, and runs the independent integrity verifier.

## Verification

The follow-up catalog audit found 2,442 Japanese cards whose TCGplayer source
omits a collector number. Of those, 2,429 have direct gameplay metadata and
the remaining 13 resolve as real cards from their exact product and group
identities. None were sealed products and none had collection rows. The repair
normalized all 2,442 stored values from synthetic
`Unnumbered-{tcgplayerProductId}` strings to `Unnumbered`; the application now
displays that label without a misleading `#` and omits it from marketplace
search terms.

The sealed catalog now groups 1,970 English products into 169 sets and 301
Japanese products into 152 sets. Group identity is the existing TCGplayer
`categoryId` plus `groupId`; no lossy name-only grouping or schema migration is
required. The sealed set browser uses the same compact metadata-card treatment
as the card set browser; product artwork is shown only after entering a set.

`catalog:verify-tcgcsv-products` reported zero:

- card/variant language mismatches;
- Japanese variants without exactly one valid product ref;
- malformed card or sealed series;
- duplicate card or sealed series dates;
- digital/code products in the sealed catalog;
- malformed Japanese provider payloads;
- synthetic Japanese unnumbered values; and
- sealed sets with inconsistent language or name metadata.

The rollback-only RLS suite passed 21/21 checks, including public reads and
denied writes for sealed products and prices. Catalog search passed 10/10
integration checks. Unit tests passed 128/128, and typecheck, lint, and the
Next.js production build passed.

The read-only English history upload verifier also continued to pass at
7,208,900 ordered changes across 34,791 series, proving the English rebuild
tools ignore the new Japanese series.

Production smoke tests returned HTTP 200 for:

- `/sealed`
- `/sealed/sets/3/24722`
- `/sealed/704150`
- `/cards/tcgplayer-85-674320`
- `/sets/tcgplayer-85-24600`

The zero-request English missing-price audit remained unchanged after the
expansion: 35,079/35,159 visible finishes priced, zero multiple refs, zero
missing refs, 79 exact products with no current market value, and the one
documented Lokix provider discrepancy.

The first import seeds current and compressed history with the current TCGCSV
build. Scheduled changed builds append price changes going forward. Historical
archives from before this first import have not been backfilled for Japanese
cards or sealed products.
