# TCGCSV expanded historical price import — 2026-07-28

## Outcome

The production historical market-price backfill completed for:

- Japanese cards;
- English sealed products; and
- Japanese sealed products.

The retained stage processed all 901 TCGCSV daily archives from 2024-02-08
through 2026-07-27. It contains:

- 892,761 changed Japanese-card market prices across 23,539 series, spanning
  2024-12-11 through 2026-07-27; and
- 206,626 changed sealed-product market prices across 1,827 series, spanning
  2024-02-08 through 2026-07-27.

Unchanged daily values are not duplicated. The application carries the latest
recorded value forward when rendering daily history.

The importer mapped 34,724 exact local targets:

- 32,453 Japanese card variants; and
- 2,271 English/Japanese sealed products.

Every one of the 22,537 current market rows matched the final staged value
before upload.

## Identity and safety model

Japanese card histories require the exact TCGplayer category, group, product,
and normalized finish stored on the existing Japanese variant. Sealed product
histories require the exact category, group, and product. The importer does not
match names, copy prices between products, or average identities.

The stage fails closed when:

- a target no longer has one exact source identity;
- a category, group, product, or card finish drifts;
- one sealed product publishes conflicting subtype evidence in an archive;
- the mapping fingerprint changes during staging or upload;
- an archive has already been checkpointed after a gap;
- arrays are empty, misaligned, duplicated, or not strictly date ordered; or
- the latest staged value differs from a current market value.

The upload replaces only TCGCSV USD `market` series for Japanese card variants
and category 3/85 sealed products. Current low, mid, high, direct-low, and
market rows are not changed. Collection and quantity-history tables are not
read or written by the upload transaction.

The first full upload was rehearsed inside an intentional rollback transaction.
That rehearsal inserted and verified all 25,366 series before rolling back.
The identical production transaction then committed and passed its in-
transaction verification.

## Verification

The independent retained-stage verifier passed after commit with the exact
series, point, and date bounds above. It also reported zero latest-value
mismatches.

The general product-import verifier subsequently reported:

- 103,626 Japanese current-price rows;
- 106,024 Japanese price-series rows across all current price types plus
  historical-only market series;
- 6,361 sealed current-price rows;
- 6,792 sealed price-series rows across all current price types plus
  historical-only market series;
- zero malformed or duplicate card/sealed series;
- zero Japanese mapping or language mismatches;
- zero digital products in the sealed catalog; and
- zero inconsistent sealed-set metadata.

The durable local stage is intentionally ignored by Git and retained at:

`D:\pokemon\.artifacts\tcgcsv\expanded-history-full\tcgcsv-expanded-history-stage.sqlite`

It can verify or restore the exact upload without making any additional
TCGCSV archive requests.

## Commands

The importer is stage-only unless `--upload` is explicitly supplied:

```text
npm run prices:backfill-expanded -- --from=2024-02-08 --to=2026-07-27 --temp-dir=D:\pokemon\.artifacts\tcgcsv\expanded-history-full
```

Run a full write rehearsal that intentionally rolls back:

```text
npm run prices:backfill-expanded -- --from=2024-02-08 --to=2026-07-27 --upload --rollback --temp-dir=D:\pokemon\.artifacts\tcgcsv\expanded-history-full
```

Upload or independently re-verify the retained stage:

```text
npm run prices:backfill-expanded -- --from=2024-02-08 --to=2026-07-27 --upload --temp-dir=D:\pokemon\.artifacts\tcgcsv\expanded-history-full
npm run prices:backfill-expanded -- --from=2024-02-08 --to=2026-07-27 --verify-upload --temp-dir=D:\pokemon\.artifacts\tcgcsv\expanded-history-full
```
