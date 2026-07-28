import type { Metadata } from "next";
import Link from "next/link";

import { ImageWithFallback } from "@/components/image-with-fallback";
import { SiteHeader } from "@/components/site-header";
import {
  getSealedCatalogPage,
  type SealedCatalogProduct,
} from "@/lib/catalog/sealed-data";

export const metadata: Metadata = {
  title: "Sealed products",
  description: "Browse English and Japanese sealed Pokémon TCG products.",
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildPageHref(input: {
  query: string;
  language: string;
  page: number;
}) {
  const params = new URLSearchParams();
  if (input.query) params.set("query", input.query);
  if (input.language !== "all") params.set("language", input.language);
  if (input.page > 1) params.set("page", String(input.page));
  const queryString = params.toString();
  return queryString ? `/sealed?${queryString}` : "/sealed";
}

function SealedProductCard({ product }: { product: SealedCatalogProduct }) {
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
      <p className="mt-2 text-sm text-[var(--muted)]">{product.groupName}</p>
      <p className="mt-4 font-bold text-[var(--secondary)]">
        {product.marketPriceUsd === null
          ? "No current market price"
          : usd.format(product.marketPriceUsd)}
      </p>
    </Link>
  );
}

export default async function SealedProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string | string[];
    language?: string | string[];
    page?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const query = firstParam(params.query)?.trim().slice(0, 100) ?? "";
  const languageValue = firstParam(params.language);
  const language =
    languageValue === "en" || languageValue === "ja"
      ? languageValue
      : "all";
  const rawPage = Number(firstParam(params.page));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const result = await getSealedCatalogPage({
    query,
    languageCode: language,
    page,
  });

  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-8">
        <p className="eyebrow">Sealed catalog</p>
        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
          English and Japanese sealed products
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--muted)]">
          Browse boxes, packs, tins, collections, and other physical sealed
          Pokémon TCG products with current TCGplayer market prices.
        </p>

        <form
          action="/sealed"
          className="mt-8 grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
        >
          <label>
            <span className="auth-label">Find sealed products</span>
            <input
              className="auth-input"
              defaultValue={query}
              name="query"
              placeholder="Booster box, Elite Trainer Box…"
              type="search"
            />
          </label>
          <label>
            <span className="auth-label">Language</span>
            <select className="auth-input" defaultValue={language} name="language">
              <option value="all">All languages</option>
              <option value="en">English</option>
              <option value="ja">Japanese</option>
            </select>
          </label>
          <button className="auth-submit self-end" type="submit">
            Search
          </button>
        </form>

        <div className="mt-8 flex items-end justify-between gap-4">
          <h2 className="text-2xl font-bold">
            {result.totalCount.toLocaleString()}{" "}
            {result.totalCount === 1 ? "product" : "products"}
          </h2>
          {result.totalPages > 0 ? (
            <p className="text-sm font-semibold text-[var(--muted)]">
              Page {result.page.toLocaleString()} of{" "}
              {result.totalPages.toLocaleString()}
            </p>
          ) : null}
        </div>

        {result.products.length > 0 ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {result.products.map((product) => (
              <SealedProductCard
                key={`${product.categoryId}:${product.id}`}
                product={product}
              />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[var(--muted)]">
            No sealed products matched this search.
          </div>
        )}

        {result.totalPages > 1 ? (
          <nav
            aria-label="Sealed product pages"
            className="mt-10 flex items-center justify-center gap-3"
          >
            {result.page > 1 ? (
              <Link
                className="pagination-link"
                href={buildPageHref({
                  query,
                  language,
                  page: result.page - 1,
                })}
              >
                Previous
              </Link>
            ) : null}
            {result.page < result.totalPages ? (
              <Link
                className="pagination-link"
                href={buildPageHref({
                  query,
                  language,
                  page: result.page + 1,
                })}
              >
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
