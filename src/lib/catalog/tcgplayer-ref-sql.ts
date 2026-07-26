import { sql } from "drizzle-orm";

import { cardVariantExternalRefs, cardVariants } from "@/db/schema";

export function hasOneValidTcgplayerProductRef() {
  return sql`(
    select count(distinct trusted_ref.ref_value)
    from ${cardVariantExternalRefs} as trusted_ref
    where trusted_ref.card_variant_id = ${cardVariants.id}
      and trusted_ref.source = 'tcgplayer'
      and trusted_ref.ref_type = 'product_id'
      and trusted_ref.ref_value ~ '^[1-9][0-9]{0,14}$'
      and coalesce(
        trusted_ref.metadata ->> 'tcgcsvMappingStatus',
        ''
      ) <> 'stale'
  ) = 1 and not exists (
    select 1
    from ${cardVariantExternalRefs} as invalid_ref
    where invalid_ref.card_variant_id = ${cardVariants.id}
      and invalid_ref.source = 'tcgplayer'
      and invalid_ref.ref_type = 'product_id'
      and (
        invalid_ref.ref_value !~ '^[1-9][0-9]{0,14}$'
        or invalid_ref.metadata ->> 'tcgcsvMappingStatus' = 'stale'
      )
  )`;
}
