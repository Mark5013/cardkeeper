import Link from "next/link";

import { CardSearch } from "@/components/card-search";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { SiteHeader } from "@/components/site-header";
import { getWeeklyMarketMovers } from "@/lib/catalog/market-movers";

export const revalidate = 3_600;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const usdChange = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  signDisplay: "always",
});

const percentage = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  signDisplay: "always",
});

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export default async function Home() {
  const marketMovers = await getWeeklyMarketMovers();
  const marketPeriod =
    marketMovers.length > 0
      ? `${shortDate.format(new Date(marketMovers[0].periodStart))}–${shortDate.format(
          new Date(marketMovers[0].periodEnd),
        )}`
      : null;

  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />

      <SiteHeader />

      <section id="top" className="mx-auto w-full max-w-6xl px-6 pb-20 pt-12 lg:px-8 lg:pt-20">
        <div className="max-w-3xl">
          <p className="eyebrow">Your collection, finally organized</p>
          <h1 className="mt-5 text-balance text-5xl font-bold leading-[0.98] text-[var(--ink)] sm:text-7xl">
            Know every card.<br />Know what it&apos;s worth.
          </h1>
          <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-[var(--muted)] sm:text-xl">
            Collect smarter. Explore English and Japanese cards, browse sealed
            products, track prices, and manage your collection in one place.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="pagination-link" href="/sets">
              Browse card sets
            </Link>
            <Link className="pagination-link" href="/sealed">
              Browse sealed products
            </Link>
          </div>
        </div>

        <div className="mt-12">
          <CardSearch />
        </div>

        <section className="mt-16" aria-labelledby="weekly-market-movers-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Market pulse</p>
              <h2
                className="mt-3 text-3xl font-bold text-[var(--ink)] sm:text-4xl"
                id="weekly-market-movers-heading"
              >
                Weekly market movers
              </h2>
              <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">
                The strongest seven-day gains among cards currently valued at $10 or more.
              </p>
            </div>
            {marketPeriod ? (
              <p className="text-sm font-semibold text-[var(--muted)]">{marketPeriod}</p>
            ) : null}
          </div>

          {marketMovers.length > 0 ? (
            <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {marketMovers.map((mover, index) => (
                <article
                  className="group relative overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] transition duration-200 hover:-translate-y-1 hover:border-[var(--secondary)]"
                  key={`${mover.cardId}:${mover.printing}`}
                >
                  <Link
                    className="grid h-full grid-cols-[6rem_minmax(0,1fr)] gap-4 p-4"
                    href={`/cards/${encodeURIComponent(mover.cardId)}?printing=${encodeURIComponent(
                      mover.printing,
                    )}`}
                    prefetch={false}
                  >
                    <div className="relative aspect-[245/342] overflow-hidden rounded-md bg-[var(--surface-2)] shadow-[0_12px_28px_rgb(0_0_0_/_28%)]">
                      <ImageWithFallback
                        src={mover.imageSmallUrl || mover.imageLargeUrl}
                        alt={`${mover.name} card`}
                        fill
                        sizes="96px"
                        unoptimized
                        className="object-contain transition duration-300 group-hover:scale-[1.03]"
                      />
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-[var(--background)] px-2 py-0.5 text-xs font-black text-[var(--ink)] shadow-md">
                        #{index + 1}
                      </span>
                    </div>

                    <div className="min-w-0 self-center">
                      <p className="truncate text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--accent)]">
                        {mover.setName}
                      </p>
                      <h3 className="mt-1.5 text-lg font-bold leading-6 text-[var(--ink)]">
                        {mover.name}
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        #{mover.number} · {mover.printingLabel}
                      </p>
                      <p className="mt-3 text-lg font-black text-[var(--ink)]">
                        {usd.format(mover.currentPriceUsd)}
                      </p>
                      <p className="mt-1 font-bold text-emerald-400">
                        {percentage.format(mover.percentageChange)}%
                        <span className="ml-2 text-xs font-semibold">
                          {usdChange.format(mover.priceChangeUsd)}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        From {usd.format(mover.previousPriceUsd)}
                      </p>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-7 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-12 text-center text-[var(--muted)]">
              Weekly market movers are unavailable right now.
            </div>
          )}

          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
            Based on TCGCSV market prices. Thinly traded cards can show sharp changes.
          </p>
        </section>
      </section>

      <footer className="border-t border-[var(--line)] px-6 py-6 text-center text-xs text-[var(--muted)]">
        Cardkeeper is an independent project and is not affiliated with Nintendo, The Pokemon Company, or Game Freak.
      </footer>
    </main>
  );
}
