export type TcgplayerPrintingProductRef = {
  printing: string;
  productId: string | number | null | undefined;
};

const TCGPLAYER_PRODUCT_URL_PREFIX = "https://www.tcgplayer.com/product/";
const TCGPLAYER_PRODUCT_URL_SUFFIX = "/-?Language=English";

function normalizeProductId(productId: TcgplayerPrintingProductRef["productId"]) {
  const rawProductId =
    typeof productId === "number"
      ? Number.isSafeInteger(productId) && productId > 0
        ? String(productId)
        : null
      : typeof productId === "string" && /^\d+$/.test(productId.trim())
        ? productId.trim()
        : null;

  if (rawProductId === null) return null;

  const numericProductId = Number(rawProductId);
  if (!Number.isSafeInteger(numericProductId) || numericProductId <= 0) return null;

  return String(numericProductId);
}

/**
 * Builds fail-closed listing URLs for card printings.
 *
 * A printing is included only when every one of its refs has a valid product ID
 * and those refs resolve to exactly one unique TCGplayer product.
 */
export function buildTcgplayerListingUrlsByPrinting(
  refs: readonly TcgplayerPrintingProductRef[],
): Record<string, string> {
  const productIdsByPrinting = new Map<string, Set<string>>();
  const invalidPrintings = new Set<string>();

  for (const ref of refs) {
    const printing = ref.printing.trim();
    if (!printing) continue;

    const productId = normalizeProductId(ref.productId);
    if (productId === null) {
      invalidPrintings.add(printing);
      continue;
    }

    const productIds = productIdsByPrinting.get(printing) ?? new Set<string>();
    productIds.add(productId);
    productIdsByPrinting.set(printing, productIds);
  }

  return Object.fromEntries(
    [...productIdsByPrinting.entries()]
      .filter(
        ([printing, productIds]) =>
          !invalidPrintings.has(printing) && productIds.size === 1,
      )
      .sort(([leftPrinting], [rightPrinting]) =>
        leftPrinting.localeCompare(rightPrinting, "en"),
      )
      .map(([printing, productIds]) => {
        const [productId] = productIds;
        return [
          printing,
          `${TCGPLAYER_PRODUCT_URL_PREFIX}${productId}${TCGPLAYER_PRODUCT_URL_SUFFIX}`,
        ];
      }),
  );
}
