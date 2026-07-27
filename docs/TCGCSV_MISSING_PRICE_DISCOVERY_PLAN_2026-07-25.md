# TCGCSV missing-price discovery plan — 2026-07-25

## Pause and baseline

Do not make another TCGCSV provider request until at least the next build and
24-hour window. Resume by checking `last-updated.txt` once; if its timestamp has
not changed, stop without fetching groups, products, prices, or archives.

The current database-only baseline is:

- 20,418 of 20,581 active English cards have at least one trusted current price.
- 163 cards across 31 sets have no trusted current price.
- 34,742 of 35,013 application-visible finishes are priced.
- 271 finish gaps remain across 38 sets.
- 96 gaps have multiple product refs, none lack a local variant or product
  ref, and 175 have one trusted ref but no current market value.
- 30 wholly unpriced cards have neither a provider-advertised finish nor a
  trusted local finish and are recorded as card-level gaps in the manifest.

The corrected denominator includes three trusted local finishes that the
catalog provider does not advertise: Rocket's Raikou ex `ex8-108` Normal,
Gengar `ecard3-10` Reverse Holofoil, and Kingdra `ex7-12` Normal. Each has one
exact TCGplayer product ref and no current TCGCSV market row.

The first discovery pass should prioritize the five promo catalogs that account
for most wholly unpriced cards:

| Local set | Cards without a price | Finish gaps |
| --- | ---: | ---: |
| Scarlet & Violet Black Star Promos | 60 | 112 |
| SM Black Star Promos | 10 | 11 |
| SWSH Black Star Promos | 8 | 9 |
| BW Black Star Promos | 13 | 11 |
| XY Black Star Promos | 6 | 6 |

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

## Audit command status

The read-only database mode is implemented:

```text
npm run prices:audit-missing -- --database-only
```

It uses a repeatable-read, read-only transaction and writes a deterministic,
content-addressed JSON manifest under `.artifacts/tcgcsv/`. The manifest
contains the exact local sets, cards, provider finish keys, variants, TCGplayer
refs and metadata, TCGCSV current-price state, compressed-series state, and
database-only classification for every finish gap. It also records wholly
unpriced cards that have no provider-advertised or trusted local finish. The
command makes zero TCGCSV requests and cannot mutate the database.

## First reviewed repair batch — 2026-07-26

The database-only manifest identified one fully evidenced batch in TCGCSV group
`22872`, `Scarlet & Violet Black Star Promos`: 110 exact product refs across 55
cards. The product names distinguish the physical printings without relying on
collector-number-only or prefix-only matching:

| Product combination | Cards |
| --- | ---: |
| Prerelease + Prerelease Staff | 24 |
| ordinary + Pokémon Center | 16 |
| Cosmos Holofoil + ordinary | 5 |
| ordinary + Prerelease Staff | 5 |
| ordinary + Staff | 4 |
| World Championships + World Championships Staff | 1 |

The reviewed manifest is
`scripts/data/tcgcsv-sv-promo-printing-repairs-2026-07-26.json`. Its repair
command is dry-run by default:

```text
npm run prices:repair-sv-promo-printings
npm run prices:repair-sv-promo-printings -- --rollback
npm run prices:repair-sv-promo-printings -- --apply
```

Both the dry run and a real write transaction followed by intentional rollback
passed. Before applying, the command saved every affected source variant and
product-ref row to the content-addressed snapshot
`.artifacts/tcgcsv/tcgcsv-sv-promo-repair-before-2026-07-26-0735daa2c967.json`.
Preflight verification found zero collection rows, zero quantity-history rows,
zero current-price rows, zero compressed price series, and no pre-existing
destination variants on the targets.

The production transaction was applied on 2026-07-26. It retained 30 ordinary
refs, created 80 qualified variants, moved 80 refs, and retired 25 empty generic
source variants. A post-commit rerun reported the manifest fully applied and
made no changes.

The database-only post-repair audit reports the baseline at the top of this
document. The visible-finish count and gap count increased because the audit
now counts each newly modeled physical printing separately; it did not copy or
invent prices. Multiple-ref gaps fell from 232 to 176, while exact singleton
refs without a current market value rose from 28 to 138. The next changed-build
refresh can populate current prices, and the history rebuild must use
`--reset-stage` because the exact product-ref/printing identities changed.

## Second reviewed repair batch — 2026-07-26

The next database-only pass found 34 exact catalog-to-TCGplayer mappings across
14 sets:

- 17 existing variants lacked their catalog card's exact product ref; and
- 17 provider-advertised finishes lacked a local variant and needed both the
  variant and exact product ref created.

Every catalog price-proxy URL resolved to one exact TCGplayer product ID. Eight
of those IDs were independently present on the same card's sibling finish, and
none was placed on another card. Preflight verification found zero collection
rows, quantity-history rows, target current prices, or target price series.

The reviewed manifest is
`scripts/data/tcgcsv-catalog-product-ref-repairs-2026-07-26.json`. Its
fail-closed command is:

```text
npm run prices:repair-catalog-refs
npm run prices:repair-catalog-refs -- --rollback
npm run prices:repair-catalog-refs -- --apply
```

The command saved the exact before-state to
`.artifacts/tcgcsv/tcgcsv-catalog-product-ref-repair-before-2026-07-26-19762957daf6.json`.
Its locked write transaction passed rollback validation and was then applied,
creating 17 variants and attaching 34 exact refs. A post-commit rerun reported
the manifest fully applied.

The database-only post-audit reports zero missing local variants and zero
missing product refs. The total remains 348 gaps because the 34 repaired
identities are now correctly classified as exact singleton refs without a
current TCGCSV market value, increasing that bucket from 138 to 172. No price
was copied from the catalog provider.

## Third reviewed repair batch — 2026-07-26

The remaining promo ambiguity was queried by exact product ID through
TCGplayer's first-party product search. All 216 requested candidate IDs
returned one product record. A fail-closed allowlist selected only the 162
products that formed exact Prerelease and Prerelease Staff pairs on one local
card and in one expected promo group:

| TCGCSV group | Local set | Cards | Products |
| --- | --- | ---: | ---: |
| `1407`, Black and White Promos | `bwp` | 6 | 12 |
| `1451`, XY Promos | `xyp` | 11 | 22 |
| `1861`, SM Promos | `smp` | 44 | 88 |
| `2545`, SWSH: Sword & Shield Promo Cards | `swshp` | 20 | 40 |
| **Total** |  | **81** | **162** |

The reviewed product IDs and exact first-party names are checked in at
`scripts/data/tcgcsv-promo-prerelease-printing-repairs-2026-07-26.json`.
Unlisted products in the same groups remain ordinary; a reviewed product with
a changed group, name, qualifier, or subtype fails closed. The repair command
is:

```text
npm run prices:repair-promo-prerelease
npm run prices:repair-promo-prerelease -- --rollback
npm run prices:repair-promo-prerelease -- --apply
```

Preflight found zero collection rows, quantity-history rows, current-price
rows, compressed price series, or pre-existing destinations. The locked
transaction created 162 qualified variants, moved 162 exact refs, and retired
81 empty generic Holofoil variants. Rollback rehearsal passed before the
production apply. The exact before-state snapshot is
`.artifacts/tcgcsv/tcgcsv-promo-prerelease-repair-before-2026-07-26-2cbb7399752e.json`.
A post-commit rerun reported the manifest fully applied.

The first zero-request post-audit was
`.artifacts/tcgcsv/tcgcsv-missing-price-gaps-2026-07-25-9f762bb37f74.json`.
It reported 34,584 of 35,013 visible finishes priced and 429 gaps: 95
multiple-ref gaps and 334 trusted singletons without a current market value.
The 81-card increase in visible finishes was expected because each old generic
finish became two physical printings.

TCGCSV `last-updated.txt` remained `2026-07-25T20:14:30+0000`. An explicitly
requested same-build refresh then used the new `--group-ids` selector to fetch
only groups `1407`, `1451`, `1861`, and `2545`. A dry run prepared 910
observations and found zero stale refs. The identical write pass upserted 910
current-price rows and appended 159 compressed-history changes.

That refresh populated 159 of the 162 new qualified finishes. These three
reviewed Staff products have no current TCGCSV market row and remain trusted
singletons:

- Alolan Sandslash `smp-SM18`, product `131092`
- Persian `smp-SM182`, product `189458`
- Snorlax `swshp-SWSH068`, product `224362`

It also discovered that Champions Festival `bwp-BW95` Normal combines product
`84162`, `Worlds 13`, with Staff product `96572`. The importer invalidated its
old current price instead of combining those identities. That separate
qualified-printing repair still needs review.

The latest zero-request audit is
`.artifacts/tcgcsv/tcgcsv-missing-price-gaps-2026-07-25-4c2ffd0a1c21.json`.
It reports 34,742 of 35,013 visible finishes priced and 271 gaps: 96
multiple-ref gaps, zero missing variants, zero missing refs, and 175 trusted
singletons without a current market value. The standalone marker check plus
dry-run and write passes made 21 TCGCSV requests in total. Historical staging
must use `--reset-stage`.

The next implementation step is a separate provider-cache mode:

```text
npm run prices:audit-missing -- --provider-cache=<changed-build-cache>
```

That mode must consume one already downloaded, changed-build cache and produce
a deterministic candidate report. A separate reviewed repair manifest remains
the only input allowed to mutate the database.

## Completion criteria

- Every baseline gap is present in the final report with one disposition.
- No candidate crosses card-name, collector-prefix, or denominator identity.
- Every priced finish has exactly one positive, non-quarantined product ref.
- Repaired target sets report zero high-confidence stale refs.
- Collection quantities and quantity-history snapshots are unchanged.
- Request totals and the TCGCSV build timestamp are recorded in the audit.
