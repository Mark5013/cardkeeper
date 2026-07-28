# TCGCSV English mapping audit — 2026-07-25

## Status

The English card mapping closeout was completed on 2026-07-27. The final
database-only audit reports zero multiple-product-ref gaps and zero missing
product refs. Seventy-nine remaining finish gaps have one exact trusted
product whose latest TCGCSV market value is null. The only remaining structural
gap is Lokix `sv7-16` Holofoil: the catalog advertises that finish, while
TCGCSV product `567242` publishes only Normal and Reverse Holofoil. No Holofoil
variant or price was fabricated.

The Pikachu `np-35` mapping is repaired in the database, and current English
pricing now fails closed when a card finish cannot be tied to exactly one valid
TCGplayer product. Poké Ball Pattern, Master Ball Pattern, and the reviewed
Holiday Calendar printing are now first-class variants in Prismatic Evolutions,
Black Bolt, and White Flare. Japanese cards and sealed products have not been
added.

Verified current state for Pikachu δ:

- Normal: TCGplayer product `88109`, market price `$249.66`
- Holofoil: TCGplayer product `88109`, market price `$197.76`
- Removed: Ivysaur product `118882` and Bayleef product `232876`
- The rendered Normal card page links to product `88109` and contains neither bad product ID nor the old `$110.81` averaged value.

## Root cause

The importer normalized only the numerator of a collector number. In Nintendo Promos, all of these became `35`:

- Pikachu `035`, product `88109`
- Ivysaur `35/100`, product `118882`
- Bayleef `35/115`, product `232876`

The Normal market prices were silently averaged:

`($249.66 + $54.98 + $27.80) / 3 = $110.81`

The card page independently selected the lexicographically lowest product ID across every finish, so it linked to Ivysaur `118882`.

## Applied safeguards

- Every product-to-card mapping requires exact normalized card-name identity. Prefix matches such as `Pikachu` → `Pikachu ex` or `Pikachu V` are rejected.
- Full collector-number denominators disambiguate groups mapped to several local sets. Products without denominator evidence require an explicit set/number allowlist.
- Known source/catalog spelling and symbol differences are normalized narrowly, including `δ`/`Delta Species`, gender symbols, and reviewed spelling aliases.
- A price-bearing candidate is checked against both existing product refs and every price-bearing product discovered for that variant during the current run. More than one distinct product ID is ambiguous and receives no price. A product with a known subtype is retained as an exact ref even when its current market price is null; a product with no subtype rows still cannot be attached to a finish safely.
- Price-bearing ambiguous candidates are retained as refs for a future physical-qualifier model, but their TCGCSV current-price rows are invalidated. The three reviewed modern sets are no longer ambiguous because their patterned products now use explicit variants.
- All local TCGCSV display and valuation paths require exactly one positive numeric, non-quarantined product ID. This is a syntactic trust gate, not proof that an ordinary/Staff/Prerelease physical identity is modeled correctly. Search and collection no longer fall back to imported provider JSON prices when the gate fails.
- If a normal refresh detects a high-confidence stale singleton ref, it marks that ref stale, invalidates its current price, and exits nonzero before writing that group’s prices.
- TCGplayer listing URLs are selected by finish. Ambiguous finishes and database lookup failures suppress the link instead of falling back to a potentially stale card-level URL.
- Correct existing refs are not removed merely because a finish has no price observation today. Product `85928`, for example, has valid Normal and Holofoil history even though TCGCSV currently reports only Normal.
- Auditing is read-only. The reviewed repair manifest verifies every exact product/card/finish identity before applying.
- The live refresh uses the configured identifiable User-Agent and enforces at least 250 ms between TCGCSV requests.

## Audit and database result

The reviewed repair manifest contained 41 invalid refs across 32 variants:

- Nintendo and Wizards promo collector-number collisions
- Eight Shrouded Fable Basic Energy products attached to cards numbered 1–8
- Pelipper `svp-22` attached to Sinistcha product `553715`
- League products attached to sets with the wrong printed-total denominator

The repair removed those 41 refs and reset 31 affected current-price rows. It did not delete historical rows.

The first hardened refresh then:

- upserted 31,639 current-price rows;
- appended 10,688 changed compressed-history observations;
- reported zero remaining high-confidence cross-card/denominator issues in the matched groups.

A follow-up global check found 554 TCGCSV current-price rows whose variants did not have exactly one valid product ref. These were invalidated on 2026-07-25. The refs and historical rows remain available for later qualified-variant modeling, but the application does not display them as trustworthy prices.

The audit also found a set-name coverage bug. TCGCSV prefixes several sets with `EX`, while the local catalog does not. Twelve English EX-era groups are now matched, adding or refreshing 2,448 current-price rows with no new identity issues in the targeted audits.

Post-hardening dry runs matched all 108 EX Power Keepers products, excluded the eight unrelated Shrouded Fable Basic Energy products, and reported zero high-confidence stale refs in Nintendo Promos and League & Championship Cards.

The zero-issue audit count is not a proof that every physical printing is modeled correctly. It covers the implemented card-name, collector-number, denominator, and known-finish evidence. Staff, Prerelease, league placement, unreviewed patterned foils, metal cards, and similar qualified products still require first-class identities.

## Modern-set physical printing repair

The official product feeds showed why Prismatic Evolutions, Black Bolt, and
White Flare could not be treated as ordinary Holofoil variants:

- Prismatic Evolutions has 100 Poké Ball Pattern products, 67 Master Ball
  Pattern products, and one Holiday Calendar Glaceon ex.
- Black Bolt has 80 Poké Ball Pattern and 72 Master Ball Pattern products.
- White Flare has 80 Poké Ball Pattern and 72 Master Ball Pattern products.
- The eight Poké Ball-only products in each of Black Bolt and White Flare are
  Trainers or Energy cards; they do not have Master Ball products.

TCGCSV reports these qualified products with the generic `Holofoil` price
subtype. The importer now combines the exact reviewed terminal product-name
qualifier with that independent subtype evidence and writes one of:

- `poke_ball_holofoil`
- `master_ball_holofoil`
- `holiday_calendar_holofoil`

The classifier is intentionally limited to official groups `23821`, `24325`,
and `24326`. Unknown qualifier spelling, a new qualifier, a qualifier in the
wrong group, or a qualified product with a non-Holofoil subtype fails closed.
Ref reconciliation applies the same classifier, so a qualified product cannot
later drift back onto a generic Holofoil variant.

The idempotent repair transaction:

- created 472 explicit variants across 261 cards;
- moved 471 exact TCGplayer product refs from generic Holofoil variants;
- created the one missing ref for Antique Cover Fossil, product `644864`;
- corrected Antique Cover Fossil `zsv10pt5-80` from local/provider-data number
  `60` to its official number `80`;
- invalidated 48 current prices and 260 compressed generic-Holofoil series
  whose physical identity was no longer trustworthy; and
- verified that affected variants had zero collection rows and zero collection
  quantity-history rows before and after the repair.

Catalog import applies the Antique Cover Fossil number correction
persistently, so a later provider sync cannot restore the bad number.

The three scoped refreshes then matched every card product with zero ambiguous
or stale refs:

- Prismatic Evolutions: 348/348 products, 448/448 current finish prices.
- Black Bolt: 324/324 products, 405/405 current finish prices.
- White Flare: 325/325 products, 407/407 current finish prices.

A production-build smoke test returned HTTP 200 for the repaired Antique Cover
Fossil page and confirmed card number `80`, the Poké Ball Pattern label, price
history, and TCGplayer product `644864`. Prismatic Evolutions #83 rendered both
Poké Ball Pattern and Master Ball Pattern options with price history.

## Historical data handling

Before the v3 rebuild, thirty-one repaired card/finish histories contained old
observations that may have incorporated a wrong product. The application still
uses conservative `2026-07-25` trust cutoffs for those identities even though
the compressed database series have now been rebuilt from the corrected exact
product mappings.

Pikachu δ Holofoil is not quarantined because the bad Ivysaur product supplied no Holofoil observation. Pikachu δ Normal begins its trusted visible history with the corrected `2026-07-25` observation.

Weekly movers use the same date-aware trust cutoff. A repaired finish becomes eligible again once the full seven-day comparison window is on or after the trusted date.

The historical backfill excludes variants without exactly one valid product ref
and drops distinct-product collisions instead of averaging them, including
collisions across groups. Qualified local printings map their exact product ID
to the archive's independent `Holofoil` subtype; Normal and Reverse Holofoil
rows cannot populate them.

The v3 replacement was rebuilt from all 898 daily archives from `2024-02-08`
through `2026-07-24`. The verified stage contained 7,133,755 changed prices
across 34,604 safe series. It transactionally replaced 35,014 old TCGCSV USD
market series, and an independent post-commit verification confirmed aligned,
ordered arrays through the `2026-07-25` current observations.

All 472 qualified variants have history. Their first available archive dates
are:

- Prismatic Poké Ball Pattern: `2025-01-15`
- Prismatic Master Ball Pattern: `2025-01-17`
- Prismatic Holiday Calendar: `2025-08-26`
- Black Bolt and White Flare patterns: `2025-07-18`

The production database was 277,015,699 bytes (about 264 MiB) after the
replacement. `price_series` was 123,846,656 bytes and contains the expected
7,133,755 change points. No legacy TCGCSV `price_points` rows remain.

The backfill rejects old or unversioned staging databases and fingerprints the
exact eligible product-ref mapping. A resumed stage or upload fails closed if
that mapping changes.

## Current English price coverage

The application-visible coverage audit counts the finish keys advertised by the
catalog provider, plus any trusted local finish. It does not count obsolete
database variants that the application no longer offers.

Before this follow-up, 275 of 20,581 active English cards had no trusted current
price. Two reviewed set-mapping gaps were safe to repair:

- TCGCSV group `2782`, `McDonald's 25th Anniversary Promos`, maps exactly to the
  local `McDonald's Collection 2021`. All 25 products matched, adding 50 finish
  prices.
- TCGCSV group `2374`, `Miscellaneous Cards & Products`, contains the five
  `Pokemon Futsal` cards among hundreds of unrelated products. A constrained
  matcher accepts only collector numbers 1 through 5 with the `Pokemon Futsal`
  qualifier and `/005` denominator. All five reviewed products matched, adding
  five Normal finish prices.

After those imports and the modern qualified-printing repair:

- 20,338 of 20,581 active cards have at least one trusted current price.
- 243 cards have no trusted current price, and another 78 have at least one
  priced finish and at least one unpriced finish.
- 34,584 of 34,879 application-visible finishes are priced: 99.15% coverage.
- 295 application-visible finishes remain unpriced.
- Prismatic Evolutions, Black Bolt, and White Flare have zero finish gaps.

The 295 remaining finish gaps are:

- 232 with multiple TCGplayer product refs. These are primarily distinct
  physical products such as Staff, Prerelease, placement, unreviewed foil
  patterns, and promo variants. Selecting one ref arbitrarily would attach the
  wrong market to some cards.
- 18 where the provider advertises a finish for which no local variant row
  exists.
- 17 existing variants with no TCGplayer product ref.
- 28 with one exact trusted product ref but no current TCGCSV market value.

The first documented denominator omitted three trusted local finishes because
the catalog provider does not advertise their finish keys. A repeatable-read,
database-only audit on 2026-07-26 confirmed that the application still offers
them through their exact local TCGplayer refs:

- Rocket's Raikou ex `ex8-108`, Normal, product `88785`
- Gengar `ecard3-10`, Reverse Holofoil, product `85669`
- Kingdra `ex7-12`, Normal, product `86445`

All three lack a current TCGCSV market row. Adding them corrects the finish
denominator and singleton/no-market bucket without changing the 243 wholly
unpriced cards or any ambiguous-ref count.

Targeted audits of Skyridge, BW Promos, and Nintendo Promos confirmed that the
remaining gaps are not a simple collector-number matching failure. Some exact
products currently have no market row, while others represent several physical
products that the current finish model cannot distinguish. The importer does
not substitute old provider snapshots, copy a price across finishes, or choose
one of several products merely to increase coverage.

### Reviewed Scarlet & Violet promo batch

The database-only gap manifest produced a first safe qualified-printing batch
for TCGCSV group `22872`, `Scarlet & Violet Black Star Promos`: 110 exact
products across 55 cards. Exact product-name qualifiers distinguish
Prerelease, Prerelease Staff, Pokémon Center, Cosmos Holofoil, Staff, World
Championships, and World Championships Staff printings.

The reviewed repair retained 30 ordinary refs, created 80 qualified variants,
moved 80 refs, and retired 25 empty generic variants. Its dry run and
transactional rollback validation passed with zero collection rows, quantity
history rows, current prices, or compressed price series on the source
variants. An exact pre-repair row snapshot was saved under `.artifacts/tcgcsv/`
before the production transaction was applied on 2026-07-26.

The post-commit command reports the repair fully applied. A database-only audit
then reported:

- 34,584 of 34,932 application-visible finishes priced;
- 348 finish gaps across 38 sets;
- 176 multiple-ref gaps, 17 missing variants, 17 missing refs, and 138 exact
  singleton refs without current market values; and
- 243 wholly unpriced cards and 76 cards with partial finish coverage.

This expectedly increases visible gaps until a later changed-build refresh:
each physical printing is now represented independently, but the repair did
not fabricate or copy current prices.

### Reviewed catalog product-ref batch

Catalog price-proxy evidence resolved another 34 exact product identities
across 14 sets. Seventeen existing variants needed a ref; seventeen
provider-advertised finishes needed both a variant and a ref. Eight product IDs
were independently corroborated by the same card's sibling finish, with no
cross-card placements.

The locked repair transaction created 17 variants and attached all 34 exact
refs after saving a content-addressed before-state snapshot. Rollback
validation, post-commit idempotency verification, and the database-only audit
all passed. Current coverage is now:

- 34,584 of 34,932 application-visible finishes priced;
- 348 finish gaps across 38 sets;
- 176 multiple-ref gaps, zero missing variants, zero missing refs, and 172
  exact singleton refs without current market values; and
- 243 wholly unpriced cards and 76 cards with partial finish coverage.

The unchanged total is intentional: mapping defects became trusted singleton
identities, but no stale catalog price was copied into current TCGCSV data.

### Reviewed promo Prerelease/Staff batch

Exact TCGplayer first-party product-ID evidence identified 81 unambiguous
Prerelease plus Prerelease Staff pairs across Black and White Promos, XY
Promos, SM Promos, and SWSH Promo Cards. The checked-in allowlist contains 162
exact product IDs and names; it does not classify other products by a broad
name pattern.

The locked repair transaction created 162 first-class qualified variants,
moved all 162 refs, and retired 81 empty generic Holofoil sources. Preflight
and rollback validation confirmed zero collection, quantity-history,
current-price, or compressed-series rows on the sources. The production
transaction used the content-addressed snapshot
`.artifacts/tcgcsv/tcgcsv-promo-prerelease-repair-before-2026-07-26-2cbb7399752e.json`
and passed post-commit idempotency verification.

An explicitly requested same-build refresh then pulled only those four groups.
Its dry run found zero stale refs; the write pass upserted 910 TCGCSV
current-price rows and appended 159 compressed-history changes. It populated
159 of the 162 new qualified finishes. Alolan Sandslash `smp-SM18` Staff,
Persian `smp-SM182` Staff, and Snorlax `swshp-SWSH068` Staff have no current
market row in that build.

The zero-request database-only audit now reports:

- 34,742 of 35,013 application-visible finishes priced;
- 271 finish gaps across 38 sets;
- 96 multiple-ref gaps, zero missing variants, zero missing refs, and 175
  exact singleton refs without current market values; and
- 163 wholly unpriced cards and 79 cards with partial finish coverage.

The refresh also found a separate exact Worlds 2013 plus Staff pair on
Champions Festival `bwp-BW95`. That identity was resolved in the final English
closeout below.

## Final English closeout and history rebuild â€” 2026-07-27

Three exact, fail-closed qualified-printing manifests completed the remaining
English card mappings:

- `tcgcsv-english-qualified-printing-repairs-2026-07-27.json` reviewed 213
  exact products on 86 cards, including Champions Festival, league and
  championship placements, alternate holo patterns, stamped promos, deck
  printings, and World Championships identities.
- `tcgcsv-english-qualified-printing-followup-2026-07-27.json` split ordinary
  and Cosmos Holo Slowking `xy9-21`.
- `tcgcsv-english-qualified-printing-final-2026-07-27.json` reviewed 27 product
  placements on seven cards. It resolved Steam Siege tournament printings and
  modeled Aquapolis `a`/`b` artwork identities plus the High Plains and Meadow
  Vivillon forms across their exact source finishes.

The final manifest permits the same product ID on two reviewed source finishes
only when the product, group, card, source finish, and destination printing all
match its exact allowlist entry. Rollback rehearsal passed before each
production apply. The final seven-card batch created 24 qualified/form variants,
moved 24 refs, retired eight empty ambiguous variants, and found zero collection
or quantity-history rows on its sources.

Two Morpeko V-UNION set-of-four bundle products, `268450` and `495215`, were
removed again after a scoped refresh rediscovered them. The nightly importer
now excludes those exact bundle IDs, so they cannot be reattached to one card.
Prism Star name normalization also recognizes the catalog's `◇` symbol as
TCGplayer's `Prism Star`, eliminating 21 false stale-ref warnings.

The validated 24-group refresh prepared and wrote 4,153 current observations.
A final five-group refresh prepared and wrote 1,222 observations for the form,
tournament, and bundle changes. Both completed with zero high-confidence stale
refs.

The final immutable database-only audit is
`.artifacts/tcgcsv/tcgcsv-missing-price-gaps-2026-07-27-71099ab67d8b.json`
with fingerprint
`71099ab67d8b1ec762e67c7f2250372c80f73fe22194bd1a824952b0aad344ef`:

- 35,079 of 35,159 visible English finishes are priced;
- 80 finish gaps remain across 29 sets;
- zero multiple-ref gaps, zero missing refs, and zero other untrusted refs;
- 79 exact singleton refs have no current TCGCSV market value; and
- one catalog-only Holofoil finish lacks a matching TCGCSV subtype: Lokix
  `sv7-16`.

Historical staging used a new mapping-fingerprinted recovery directory and
`--reset-stage`. It processed all 901 archives from 2024-02-08 through
2026-07-27. The atomic upload replaced 35,099 prior TCGCSV series with 34,791
safe series containing 7,208,900 changed prices and synchronized 34,730
existing current rows to the latest completed archive. It did not create
current rows for products with null current markets. In-transaction and
independent post-commit verification both passed. The retained stage uses
mapping policy `single-positive-product-ref-qualified-printing-v4` and mapping
fingerprint
`b54d46d8083a4b8183d29a315ad8c4536a6b6ecdb17ee5d1b1d743e94185f9a0`.

This final phase made 1,064 TCGCSV requests, including the 901 archive
downloads. Exact product-name discovery used TCGplayer's first-party product
search separately. No full provider pull was repeated after the final
same-build verification.

## Remaining work before JP and sealed expansion

The database-first investigation sequence is documented in
[`TCGCSV_MISSING_PRICE_DISCOVERY_PLAN_2026-07-25.md`](./TCGCSV_MISSING_PRICE_DISCOVERY_PLAN_2026-07-25.md).

1. Treat the Lokix `sv7-16` Holofoil mismatch as an upstream catalog/TCGCSV
   discrepancy unless TCGCSV begins publishing that subtype. Do not synthesize
   a variant or copy a price from another finish.
2. Review and retire static history quarantine cutoffs only when their repaired
   series have enough verified post-repair history for the intended UI window.
3. Add language-aware card, variant, price, and marketplace-link identities.
   Current catalog queries and TCGplayer URLs intentionally assume English.
4. Give sealed products their own catalog identity and UI path. The card
   importer currently filters non-card products out.
5. Re-run the full English audit after those modeling changes, then begin
   Japanese-card and sealed-product ingestion.

## JP and sealed expansion completed — 2026-07-28

Items 3 through 5 above are complete. The application now has language-aware
card, variant, price, collection, and marketplace-link resolution; sealed
products have their own catalog and UI path; and the production database
contains English sealed products plus Japanese cards and sealed products.

The zero-request English audit remained unchanged after the expansion. Full
import counts, identity rules, integrity checks, and operations are documented
in
[`TCGCSV_PRODUCT_IMPORT_2026-07-28.md`](./TCGCSV_PRODUCT_IMPORT_2026-07-28.md).

## Operations

TCGCSV asks consumers to identify requests, rate-limit them, and avoid unnecessary full syncs; see the [TCGCSV docs](https://tcgcsv.com/docs).

```text
# Full read-only mapping audit. Inspect the reported issue count:
npm run prices:audit-mappings

# Database-only missing-price manifest. Makes no TCGCSV provider requests:
npm run prices:audit-missing -- --database-only

# Reviewed one-time repair; now reports safely when already applied:
npm run prices:repair-mappings
npm run prices:repair-mappings -- --apply

# Reviewed modern-set physical-printing repair; dry-run by default:
npm run prices:repair-modern-printings
npm run prices:repair-modern-printings -- --apply

# Applied Scarlet & Violet promo-printing repair; now reports safely when already applied:
npm run prices:repair-sv-promo-printings
npm run prices:repair-sv-promo-printings -- --rollback
npm run prices:repair-sv-promo-printings -- --apply

# Applied catalog product-ref repair; now reports safely when already applied:
npm run prices:repair-catalog-refs
npm run prices:repair-catalog-refs -- --rollback
npm run prices:repair-catalog-refs -- --apply

# Applied BW/XY/SM/SWSH promo Prerelease/Staff repair:
npm run prices:repair-promo-prerelease
npm run prices:repair-promo-prerelease -- --rollback
npm run prices:repair-promo-prerelease -- --apply

# Applied final English qualified-printing/form repairs:
npm run prices:repair-english-closeout
npm run prices:repair-english-followup
npm run prices:repair-english-final

# Routine daily refresh:
npm run prices:refresh -- --skip-if-current

# Explicitly scoped multi-group refresh:
npm run prices:refresh -- --group-ids=1407,1451,1861,2545

# Rebuild after an intentional product-ref/printing identity change:
npm run prices:backfill -- --from=2024-02-08 --to=YYYY-MM-DD --reset-stage --stage-only --verify-legacy --temp-dir=<new-recovery-directory>
npm run prices:backfill -- --from=2024-02-08 --to=YYYY-MM-DD --temp-dir=<same-recovery-directory>
npm run prices:backfill -- --from=2024-02-08 --to=YYYY-MM-DD --verify-upload --temp-dir=<same-recovery-directory>

# If scoped refreshes left existing current rows older than the latest staged
# archive, synchronize only those existing rows in the atomic upload:
npm run prices:backfill -- --from=2024-02-08 --to=YYYY-MM-DD --verify-legacy --sync-current --temp-dir=<same-recovery-directory>
```

Operational notes:

- `prices:audit-mappings` is a full provider pull. It exits nonzero when high-confidence stale refs are found; read the warnings for the exact identities.
- Do not run another full audit/refresh for the same TCGCSV build merely to repeat verification. Prefer auditing one build, applying its reviewed repair, and letting the next daily build repopulate invalidated current rows.
- Take a database snapshot and stop concurrent refresh jobs before applying a new repair manifest.
- If an immediate same-build post-repair refresh is explicitly necessary, it must omit `--skip-if-current`; account for that extra full pull under TCGCSV’s rules.
- Use `--reset-stage` whenever product refs or physical-qualifier mappings intentionally change. The stage stores both the mapping-policy version and a fingerprint of the exact eligible database mapping; it refuses to resume or upload when either differs.
- `--verify-upload` verifies an existing upload; it does not perform the upload. The command without `--stage-only` or `--verify-upload` performs the transactional replacement.
- `--sync-current` is permitted only on an upload with `--verify-legacy`, and only when `--to` is TCGCSV's latest completed archive. It updates existing current rows atomically from the staged latest values; it never creates a current row for a product absent from the latest current table.
- Keep ref-changing audit, repair, and refresh jobs stopped during a historical staging run. The script rechecks the mapping after staging and immediately before upload. The replacement transaction then takes shared locks on the variant and external-ref tables before its final fingerprint check, so mapping writes cannot race the upload.
- The checked-in repair plan is `scripts/data/tcgcsv-mapping-repairs-2026-07-25.json`. It is idempotent only when all reviewed refs are present or all are already absent; a partially applied state fails closed.
