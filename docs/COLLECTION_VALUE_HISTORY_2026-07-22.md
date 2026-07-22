# Collection value history — 2026-07-22

## Decision

Collection value history reflects the cards actually held on each UTC calendar day. Adding a card, removing it, or changing its quantity changes the chart from that day forward and does not rewrite earlier collection values.

## Daily quantity history

`collection_quantity_history` stores one row per user, card variant, and UTC day. Each row contains the end-of-day quantity, including zero when a variant is removed. A database trigger on `collection_items` records inserts, quantity updates, and deletes in the same transaction as the collection mutation.

The primary key is `(user_id, card_variant_id, effective_on)`. Repeated changes on the same day update that day's row instead of appending unbounded mutation events. Users can read only their own history through row-level security and cannot write history directly; the security-definer trigger is the sole writer.

## Chart calculation

For each historically owned variant, the chart combines two sparse timelines:

- TCGCSV market-price changes for the card and printing.
- Collection quantity changes for the user's condition-specific variant.

The latest price before an ownership change is carried into that day. The end-of-day quantity is then applied until the next quantity change. Price observations before the first ownership record are used only to establish the add-day price and never contribute value to earlier collection dates.

Removed variants remain in quantity history with a zero balance, allowing the chart to preserve their earlier contribution even when they are no longer present in `collection_items`.

## Existing-data limitation

Migration `0011_collection_quantity_history.sql` creates a baseline for every current collection item using its original `created_at` date and current quantity. This is the closest recoverable approximation for existing holdings. Exact quantity changes and previously removed cards from before the migration were not recorded and cannot be reconstructed. All mutations after the migration are tracked transactionally and exactly at daily resolution.
