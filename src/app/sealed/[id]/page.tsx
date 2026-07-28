import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CardPrintingSelectionProvider } from "@/components/card-printing-selection";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { PriceHistoryChart } from "@/components/price-history-chart";
import { SiteHeader } from "@/components/site-header";
import { getSealedCatalogProduct } from "@/lib/catalog/sealed-data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function getSafeTcgplayerUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["tcgplayer.com", "www.tcgplayer.com"].includes(url.hostname.toLowerCase())
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/sealed/[id]">): Promise<Metadata> {
  const { id } = await params;
  const product = await getSealedCatalogProduct(id);
  return product
    ? {
        title: product.name,
        description: `${product.name}, a ${product.languageCode === "ja" ? "Japanese" : "English"} sealed Pokémon TCG product.`,
      }
    : { title: "Sealed product not found" };
}

export default async function SealedProductPage({
  params,
}: PageProps<"/sealed/[id]">) {
  const { id } = await params;
  const product = await getSealedCatalogProduct(id);
  if (!product) notFound();

  const tcgplayerUrl = getSafeTcgplayerUrl(product.tcgplayerUrl);
  const details = [
    ["Language", product.languageCode === "ja" ? "Japanese" : "English"],
    ["Sealed set", product.groupName],
    ["Release date", product.releaseDate],
    ["Status", product.isPresale ? "Presale" : "Released"],
    ["Market", product.prices.market === undefined ? null : usd.format(product.prices.market)],
    ["Low", product.prices.low === undefined ? null : usd.format(product.prices.low)],
    ["Mid", product.prices.mid === undefined ? null : usd.format(product.prices.mid)],
    ["High", product.prices.high === undefined ? null : usd.format(product.prices.high)],
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));
  const historySeries = [
    {
      printing: "sealed",
      condition: "sealed",
      label: "Sealed market price",
      points: product.history,
    },
  ];

  return (
    <CardPrintingSelectionProvider
      initialPrinting="sealed"
      printingOptions={[{ value: "sealed", label: "Sealed" }]}
    >
      <main className="min-h-screen overflow-x-hidden">
        <div className="hero-glow" aria-hidden="true" />
        <SiteHeader />

        <article className="mx-auto w-full max-w-6xl px-6 pb-24 pt-6 lg:px-8">
          <Link
            className="text-sm font-semibold text-[var(--secondary)] hover:underline"
            href={`/sealed/sets/${product.categoryId}/${product.groupId}`}
          >
            {product.groupName}
          </Link>

          <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(18rem,28rem)_minmax(0,1fr)] lg:gap-16">
            <div className="relative aspect-square overflow-hidden rounded-lg bg-white/95 shadow-[0_24px_60px_rgb(0_0_0_/_34%)]">
              <ImageWithFallback
                src={product.imageUrl}
                alt={product.name}
                fill
                preload
                sizes="(max-width: 1024px) 90vw, 448px"
                className="object-contain p-5"
              />
            </div>

            <div className="min-w-0">
              <p className="eyebrow">
                {product.languageCode === "ja" ? "Japanese" : "English"} sealed
                {product.isPresale ? " · Presale" : ""}
              </p>
              <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
                {product.name}
              </h1>
              <p className="mt-4 text-lg text-[var(--muted)]">
                {product.groupName}
              </p>
              <p className="mt-6 text-3xl font-black text-[var(--secondary)]">
                {product.marketPriceUsd === null
                  ? "No current market price"
                  : usd.format(product.marketPriceUsd)}
              </p>

              {tcgplayerUrl ? (
                <a
                  className="auth-submit mt-6 inline-flex min-h-11 items-center justify-center"
                  href={tcgplayerUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  View on TCGplayer
                </a>
              ) : null}

              <section className="detail-section">
                <h2 className="detail-heading">Product information</h2>
                <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
                  {details.map(([label, value]) => (
                    <div
                      className="border-t border-[var(--line)] py-3"
                      key={label}
                    >
                      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                        {label}
                      </dt>
                      <dd className="mt-1 font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="detail-section">
                <h2 className="detail-heading">Price history</h2>
                <PriceHistoryChart series={historySeries} />
              </section>
            </div>
          </div>
        </article>
      </main>
    </CardPrintingSelectionProvider>
  );
}
