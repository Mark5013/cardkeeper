"use client";

import { useMemo } from "react";

import { useCardPrintingSelection } from "@/components/card-printing-selection";
import { formatPrinting } from "@/lib/pokemon-tcg/printing";

export function TcgplayerListingLink({
  canUseProviderFallback,
  fallbackHref,
  urlsByPrinting,
}: {
  canUseProviderFallback: boolean;
  fallbackHref?: string | null;
  urlsByPrinting: Record<string, string>;
}) {
  const { printing } = useCardPrintingSelection();
  const listingUrl = useMemo(() => {
    const href =
      urlsByPrinting[printing] ??
      (canUseProviderFallback ? fallbackHref : undefined);

    if (!href) return null;

    const url = new URL(href);

    if (
      ["tcgplayer.com", "www.tcgplayer.com"].includes(url.hostname.toLowerCase()) &&
      url.pathname.startsWith("/product/")
    ) {
      url.searchParams.set("Language", "English");
      url.searchParams.set("Printing", formatPrinting(printing));
    }

    return url.toString();
  }, [canUseProviderFallback, fallbackHref, printing, urlsByPrinting]);

  if (!listingUrl) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--line)] px-4 py-3 text-sm text-[var(--muted)]">
        TCGplayer listings are not available for this finish.
      </p>
    );
  }

  return (
    <a
      className="auth-submit inline-flex min-h-11 items-center justify-center"
      href={listingUrl}
      target="_blank"
      rel="noreferrer"
    >
      TCGplayer listings
    </a>
  );
}
