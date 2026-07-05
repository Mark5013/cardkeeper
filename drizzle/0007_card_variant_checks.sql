ALTER TABLE "card_variants"
ADD CONSTRAINT "card_variants_condition_check"
CHECK ("condition" IN (
  'unspecified',
  'near_mint',
  'lightly_played',
  'moderately_played',
  'heavily_played',
  'damaged'
)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "card_variants"
VALIDATE CONSTRAINT "card_variants_condition_check";
--> statement-breakpoint
ALTER TABLE "card_variants"
ADD CONSTRAINT "card_variants_printing_format_check"
CHECK ("printing" ~ '^[a-z0-9_]{1,60}$') NOT VALID;
--> statement-breakpoint
ALTER TABLE "card_variants"
VALIDATE CONSTRAINT "card_variants_printing_format_check";
