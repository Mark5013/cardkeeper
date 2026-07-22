# Base Set Shadowless / Unlimited split — 2026-07-18

## Decision

The existing Pokémon TCG API `base1` catalog records represent the Shadowless artwork, while their generic TCGplayer links and prices represented the later Unlimited printing. Cardkeeper now models these as two separate 102-card sets instead of combining two images and market identities on one card page.

- `base1` becomes **Base Set (Shadowless)**. Every card name receives the idempotent ` (Shadowless)` suffix and keeps the existing Pokémon TCG API images.
- `base1-unlimited` is the local synthetic **Base Set (Unlimited)** set. Its cards use provider IDs such as `base1-4-unlimited` and exact TCGplayer product images.
- The TCGCSV/TCGplayer Base Set group `604` maps to Unlimited.
- The TCGCSV/TCGplayer Base Set (Shadowless) group `1663` maps to Shadowless.
- Base Set Machamp is a documented exception because TCGplayer places it in Deck Exclusives (`1840`). Product `42425` maps to Unlimited and product `107004` maps to Shadowless.

TCGplayer product matching requires both the normalized card name and collector number. Three known naming exceptions are explicit and number-scoped: Machamp's listing suffix, `Nidoran M` versus `Nidoran ♂`, and `Imposter` versus `Impostor`. The migration never falls back to collector number alone, so error and variation listings cannot silently replace a canonical card.

## Images and links

Shadowless cards retain the high-resolution Pokémon TCG API scans already in the catalog. Unlimited cards use the canonical TCGplayer product's `200w` image for grids and the corresponding `_in_1000x1000.jpg` asset for detail pages. TCGplayer CDN images bypass Vercel Image Optimization, consistent with the existing direct delivery of small card scans and avoiding a new transformation cost.

Card detail listing links prefer the normalized local `card_variant_external_refs` product ID over stale provider JSON. Future Pokémon catalog imports also preserve the Shadowless naming and remove the old ambiguous card-level TCGplayer payload from `base1`.

## Variant and price preservation

The existing generic `normal` and `holofoil` Base variants contain Unlimited prices, so the migration moves those variant rows to their matching Unlimited card. It does not delete and recreate them. Their UUIDs, price-series relationships, and any future collection references therefore remain stable.

The `1st_edition`, `1st_edition_holofoil`, `unlimited`, and `unlimited_holofoil` variant keys stay on the Shadowless cards because those are the internal printing values supplied by TCGCSV group `1663`. TCGplayer's `unlimited` value in this group means the non-1st-Edition Shadowless SKU; it does **not** represent an "Unlimited Shadowless" printing. Cardkeeper therefore displays these as **1st Edition Shadowless**, **1st Edition Shadowless Holofoil**, **Shadowless**, and **Shadowless Holofoil** while retaining the source keys for stable price identity. The separate `base1-unlimited` catalog continues to represent the later Unlimited printing. The migration then replaces Base Set TCGplayer product references and current TCGCSV prices with the exact canonical edition mappings.

## Guarded migration

The command is dry-run by default:

```powershell
npm run catalog:sync-base-editions -- --dry-run
```

`--rollback` executes every database write inside a transaction and deliberately rolls it back. `--apply` commits it:

```powershell
npm run catalog:sync-base-editions -- --rollback
npm run catalog:sync-base-editions -- --apply
```

The migration follows TCGCSV's access guidance: it identifies Cardkeeper with a custom User-Agent, performs back-end requests, spaces requests by at least 250 ms, and uses bounded retries.

## Validation and deployment order

On 2026-07-18, the live dry run uniquely resolved all 102 Shadowless and all 102 Unlimited cards. It prepared 304 current market-price identities: 202 Shadowless printing identities and 102 Unlimited identities. The full write path also completed successfully inside a forced-rollback transaction.

Apply the production migration only after this code is pushed and deployed, because the deployed Next.js image allowlist must recognize `tcgplayer-cdn.tcgplayer.com`. After applying it, rebuild the compressed TCGCSV historical stage oldest-first and upload it so both editions have canonical history. Use a fresh or reset stage; a stage created before the split contains the old product-to-variant mapping.

## Production completion

Commit `7a8984c` was pushed to `main` on 2026-07-18, after which the guarded migration was applied to the configured production database.

- Both sets contain 102 cards and 102 unique canonical TCGplayer products.
- Shadowless has 202 current and historical printing identities; Unlimited has 102.
- Shadowless history contains 27,446 changed prices and Unlimited history contains 58,937, both spanning 2024-02-08 through 2026-07-17.
- Shadowless Machamp maps to product `107004`; Unlimited Machamp maps to product `42425`.
- A fresh complete stage rebuilt 891 daily archives into 34,687 compressed series containing 7,044,396 changed prices.
- The exact upload verifier passed with no malformed arrays, invalid date ordering, or latest-value mismatches against `current_prices`.

The first exact-count verification exposed one obsolete 194-point `normal` series for Unlimited Machamp. It had no current price and no canonical product reference. That single stale pre-split series was removed, after which the retained stage passed exact verification. The recovery stage remains at `C:\Users\mark1\AppData\Local\Temp\cardkeeper-tcgcsv-history-base-editions\tcgcsv-history-stage.sqlite`.
