import Link from "next/link";

import { ImageWithFallback } from "@/components/image-with-fallback";
import type { SealedCatalogProduct } from "@/lib/catalog/sealed-data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function SealedProductCard({
  product,
}: {
  product: SealedCatalogProduct;
}) {
  return (
    <Link
      className="group overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 transition duration-200 hover:-translate-y-1 hover:border-[var(--secondary)]"
      href={`/sealed/${encodeURIComponent(product.id)}`}
      prefetch={false}
    >
      <div className="relative aspect-square overflow-hidden rounded-md bg-white/95">
        <ImageWithFallback
          src={product.imageUrl}
          alt={product.name}
          fill
          sizes="(max-width: 640px) 90vw, 280px"
          className="object-contain p-3 transition duration-300 group-hover:scale-[1.03]"
        />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
        {product.languageCode === "ja" ? "Japanese" : "English"}
        {product.isPresale ? " · Presale" : ""}
      </p>
      <h2 className="mt-2 text-lg font-bold">{product.name}</h2>
      <p className="mt-4 font-bold text-[var(--secondary)]">
        {product.marketPriceUsd === null
          ? "No current market price"
          : usd.format(product.marketPriceUsd)}
      </p>
    </Link>
  );
}
