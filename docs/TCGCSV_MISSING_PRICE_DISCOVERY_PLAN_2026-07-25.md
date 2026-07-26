# TCGCSV missing-price discovery plan — 2026-07-25

## Pause and baseline

Do not make another TCGCSV provider request until at least the next build and
24-hour window. Resume by checking `last-updated.txt` once; if its timestamp has
not changed, stop without fetching groups, products, prices, or archives.

The current database-only baseline is:

- 20,338 of 20,581 active English cards have at least one trusted current price.
- 243 cards across 31 sets have no trusted current price.
- 34,584 of 34,876 application-visible finishes are priced.
- 292 finish gaps remain across 40 sets.
- 232 gaps have multiple product refs, 18 have no local variant, 17 have no
  product ref, and 25 have one trusted ref but no current market value.

The first discovery pass should prioritize the five promo catalogs that account
for most wholly unpriced cards:

| Local set | Cards without a price | Finish gaps |
| --- | ---: | ---: |
| Scarlet & Violet Black Star Promos | 60 | 57 |
| SM Black Star Promos | 54 | 53 |
| SWSH Black Star Promos | 28 | 28 |
| BW Black Star Promos | 18 | 16 |
| XY Black Star Promos | 17 | 17 |

Prismatic Evolutions, Black Bolt, and White Flare are complete and should not
be pulled again for this investigation.

## Likely causes to test

1. **Different group or set names.** A local promo catalog may be split across
   the main TCGCSV promo group, box/deck products, league products, collection
   products, or another supplemental group. Prefixes such as `SV:`, `SWSH:`,
   `SM`, or `EX` may also differ without indicating a different set.
2. **Collector-number formatting.** Treat the prefix, numerator, suffix, and
   denominator as separate evidence. Compare forms such as `SM59`, `SM-59`,
   `SM 59`, and a product name containing `59/...`; do not strip the prefix and
   accidentally collide unrelated card 59s.
3. **Collector-number evidence stored in a different field.** Check both the
   product `extendedData.Number` and the full product name. Some promo products
   expose useful prefix or denominator evidence in only one of them.
4. **Narrow name differences.** Test punctuation, gender symbols, `δ` versus
   `Delta Species`, accented characters, reviewed spelling differences, and
   TCGplayer qualifiers without accepting prefix-only card-name matches.
5. **Distinct physical products.** Staff, Prerelease, league placement, stamped
   promos, alternate patterns, and metal cards may share a generic subtype but
   require first-class variants rather than choosing or averaging refs.
6. **No live market value.** A correct product and subtype may exist while
   `marketPrice` is null because of low sales volume. This is not a mapping bug.
7. **Local catalog defects.** A missing variant, wrong collector number, or
   provider-data error may prevent an otherwise exact match.

## Discovery workflow

### 1. Produce a database-only gap manifest

For every missing card/finish, record:

- local set ID/name, card ID/name/number, and provider card ID;
- provider-advertised finish keys;
- local variant IDs and printing identities;
- every TCGplayer product ref and its stale/quarantine metadata;
- whether a current price or compressed series exists; and
- the current gap classification.

This becomes the immutable before-state. It must not contact TCGCSV.

### 2. Pull one cached provider snapshot

On the next changed TCGCSV build:

1. Fetch `last-updated.txt` once.
2. Fetch the Pokémon groups collection once.
3. Select candidate groups locally using normalized names, reviewed aliases,
   release dates, promo prefixes, and supplemental-group terms.
4. Fetch products and prices once for only those candidate groups.
5. Save the build timestamp, group identities, products, and prices to a local
   audit cache. All matching experiments after that use the cache.

Use the identifiable Cardkeeper User-Agent, at least 250 ms request spacing,
and a precomputed request budget. Abort before starting if the planned total
could approach 10,000 requests. Do not repeat a pull for the same build.

### 3. Generate evidence, not automatic mappings

For each local gap, generate candidates with explicit evidence columns:

- exact/aliased set-name match;
- exact parsed collector prefix, numerator, suffix, and denominator match;
- exact normalized card-name match;
- product group and supplemental-group reason;
- product qualifier;
- available TCGCSV subtypes; and
- whether a non-null market value exists.

Reject collector-number-only or name-prefix-only matches. A candidate is safe
only when the combined evidence identifies one local card and one physical
printing.

### 4. Classify every result

Each original gap must end in exactly one reviewed bucket:

- exact singleton mapping ready for repair;
- qualified physical product requiring a new variant;
- correct product with a null market price;
- no provider product found;
- local catalog correction required; or
- ambiguous and intentionally left unpriced.

The report should make missing data distinguishable from mapping bugs.

### 5. Apply only a reviewed manifest

The eventual repair should:

- list exact group, product, card, and printing identities;
- dry-run by default and fail on partial state or provider drift;
- preserve collections and quantity history;
- retain unique constraints and race-safe conflicts;
- never average distinct products or copy prices across finishes; and
- invalidate only histories whose old physical identity was ambiguous.

After applying it, run one targeted current-price refresh for the affected
groups. Rebuild historical series only if product refs or printing identities
changed, and verify the staged replacement before upload.

## Suggested implementation

Add a read-only audit command with two modes:

```text
npm run prices:audit-missing -- --database-only
npm run prices:audit-missing -- --provider-cache=<changed-build-cache>
```

The first command produces the gap manifest. The second consumes an already
downloaded provider cache and produces a deterministic candidate report. A
separate reviewed repair manifest remains the only input allowed to mutate the
database.

## Completion criteria

- Every baseline gap is present in the final report with one disposition.
- No candidate crosses card-name, collector-prefix, or denominator identity.
- Every priced finish has exactly one positive, non-quarantined product ref.
- Repaired target sets report zero high-confidence stale refs.
- Collection quantities and quantity-history snapshots are unchanged.
- Request totals and the TCGCSV build timestamp are recorded in the audit.
