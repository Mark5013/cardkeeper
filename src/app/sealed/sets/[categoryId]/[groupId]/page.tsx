import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SealedProductCard } from "@/components/sealed-product-card";
import { SiteHeader } from "@/components/site-header";
import {
  getSealedCatalogPage,
  getSealedCatalogSet,
} from "@/lib/catalog/sealed-data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const date = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInteger(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function buildPageHref(input: {
  categoryId: number;
  groupId: number;
  query: string;
  page: number;
}) {
  const params = new URLSearchParams();
  if (input.query) params.set("query", input.query);
  if (input.page > 1) params.set("page", String(input.page));
  const queryString = params.toString();
  const pathname = `/sealed/sets/${input.categoryId}/${input.groupId}`;
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export async function generateMetadata({
  params,
}: PageProps<"/sealed/sets/[categoryId]/[groupId]">): Promise<Metadata> {
  const values = await params;
  const categoryId = parsePositiveInteger(values.categoryId);
  const groupId = parsePositiveInteger(values.groupId);
  if (categoryId === null || groupId === null) {
    return { title: "Sealed set not found" };
  }

  const set = await getSealedCatalogSet(categoryId, groupId);
  return set
    ? {
        title: `${set.name} sealed products`,
        description: `Browse ${set.productCount} ${set.languageCode === "ja" ? "Japanese" : "English"} sealed Pokémon TCG products in ${set.name}.`,
      }
    : { title: "Sealed set not found" };
}

export default async function SealedSetPage({
  params,
  searchParams,
}: PageProps<"/sealed/sets/[categoryId]/[groupId]">) {
  const [values, queryValues] = await Promise.all([params, searchParams]);
  const categoryId = parsePositiveInteger(values.categoryId);
  const groupId = parsePositiveInteger(values.groupId);
  if (categoryId === null || groupId === null) notFound();

  const set = await getSealedCatalogSet(categoryId, groupId);
  if (!set) notFound();

  const query =
    firstParam(queryValues.query)?.trim().slice(0, 100) ?? "";
  const rawPage = Number(firstParam(queryValues.page));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const result = await getSealedCatalogPage({
    categoryId,
    groupId,
    query,
    page,
  });

  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-6 lg:px-8">
        <Link
          className="text-sm font-semibold text-[var(--secondary)] hover:underline"
          href="/sealed"
        >
          Sealed sets
        </Link>

        <p className="eyebrow mt-8">
          {set.languageCode === "ja" ? "Japanese" : "English"} sealed set
          {set.isPresale ? " · Presale" : ""}
        </p>
        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">{set.name}</h1>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[var(--muted)]">
          <span>
            {set.productCount.toLocaleString()}{" "}
            {set.productCount === 1 ? "product" : "products"}
          </span>
          {set.releaseDate ? (
            <span>{date.format(new Date(`${set.releaseDate}T00:00:00Z`))}</span>
          ) : null}
          <strong className="text-[var(--secondary)]">
            {set.startingPriceUsd === null
              ? "No current market prices"
              : `From ${usd.format(set.startingPriceUsd)}`}
          </strong>
        </div>

        <form
          action={`/sealed/sets/${categoryId}/${groupId}`}
          className="mt-8 grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
        >
          <label>
            <span className="auth-label">Find a product in this set</span>
            <input
              className="auth-input"
              defaultValue={query}
              name="query"
              placeholder="Booster box, bundle, pack…"
              type="search"
            />
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
            No products in this sealed set matched your search.
          </div>
        )}

        {result.totalPages > 1 ? (
          <nav
            aria-label={`${set.name} product pages`}
            className="mt-10 flex items-center justify-center gap-3"
          >
            {result.page > 1 ? (
              <Link
                className="pagination-link"
                href={buildPageHref({
                  categoryId,
                  groupId,
                  query,
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
                  categoryId,
                  groupId,
                  query,
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
