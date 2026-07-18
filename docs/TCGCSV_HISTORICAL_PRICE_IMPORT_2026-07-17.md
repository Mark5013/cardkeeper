# TCGCSV historical price import — 2026-07-17

## Outcome

TCGCSV daily market-price archives from 2024-02-08 through 2026-07-17 were imported oldest-first into `price_series`.

- 891 daily archives processed
- 34,486 variant price series
- 7,017,196 stored changes
- Unchanged days are not duplicated; charts carry the last observation forward
- Latest staged values matched 34,260 comparable `current_prices` rows
- Uploaded arrays were verified as aligned and strictly date-ordered
- 107,078 original legacy TCGCSV `price_points` rows were removed after upload verification
- Post-cleanup sizes were `price_series` 76 MB, `price_points` 32 kB, and total database 221 MB
- Because the currently deployed Vercel build still reads `price_points`, a corrected July 10–17 compatibility window was then restored: 108,762 rows occupying 33 MB

The verified resumable stage is stored outside the repository at:

`C:\Users\mark1\AppData\Local\Temp\cardkeeper-tcgcsv-history-full\tcgcsv-history-stage.sqlite`

## Storage design

`price_series` has one row for each `(card_variant_id, source, price_type, currency)` identity. Each row contains parallel `date[]` and `integer[]` arrays. Amounts are USD cents. The table has checks for equal array cardinality and nonnegative values.

This avoids repeating UUID, source, type, currency, timestamp, and index overhead for every observation while retaining exact change dates and values. Currency conversion, if added later, should use USD history plus dated exchange rates rather than duplicating the card history for every display currency.

## Mapping behavior

The importer uses existing TCGplayer product/printing references. Multiple products mapping to the same variant are averaged only within one TCGCSV group. Groups are processed in the same `publishedOn` descending order as the nightly refresh, so the later processed group supplies the final value.

Forty multi-product variants differed from the legacy row history on 181 carried-forward daily comparisons. The old row writer could preserve an earlier group write when multiple groups wrote the same variant at the same observation timestamp. The compressed result intentionally preserves the final nightly value instead. The latest compressed values matched `current_prices` exactly.

## TCGCSV request compliance

The importer:

- uses a descriptive custom User-Agent;
- makes backend-only requests;
- enforces at least 100 ms between TCGCSV requests (250 ms by default);
- processes archives sequentially;
- calculates the retry-inclusive worst-case request count before starting and refuses runs that could reach 10,000 requests;
- retries with bounded exponential backoff; and
- checkpoints locally so completed archives are not requested again when a run resumes.

## Verification and recovery

Run the database integrity check against the retained stage:

```bash
npm run prices:backfill -- --from=2024-02-08 --to=2026-07-17 --verify-upload --temp-dir=C:\Users\mark1\AppData\Local\Temp\cardkeeper-tcgcsv-history-full
```

The upload is idempotent: each complete compressed series is upserted using its composite identity. The retained SQLite stage can therefore restore `price_series` without downloading the archives again.

Legacy cleanup is deliberately guarded and requires upload verification in the same command:

```bash
npm run prices:backfill -- --from=2024-02-08 --to=2026-07-17 --verify-upload --remove-legacy --temp-dir=C:\Users\mark1\AppData\Local\Temp\cardkeeper-tcgcsv-history-full
```

The cleanup refuses to truncate `price_points` unless every remaining row is a TCGCSV USD market observation.

Do not run the cleanup command until the code that reads `price_series` has been pushed and deployed. Until then, the compatibility window keeps the existing production chart reader working. It was restored with:

```bash
npm run prices:backfill -- --from=2024-02-08 --to=2026-07-17 --verify-upload --restore-legacy-from=2026-07-10 --temp-dir=C:\Users\mark1\AppData\Local\Temp\cardkeeper-tcgcsv-history-full
```
