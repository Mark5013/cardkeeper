import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CardResultGrid } from "@/components/card-result-grid";
import { CardSearch } from "@/components/card-search";
import { SiteHeader } from "@/components/site-header";
import { SearchPagination } from "@/components/search-pagination";
import { searchPokemonCards } from "@/lib/pokemon-tcg/client";

export const metadata: Metadata = {
  title: "Card search",
  description: "Search the Pokemon card catalog.",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string | string[]; page?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const rawQuery = resolvedSearchParams.query;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim() ?? "";
  const rawPage = Array.isArray(resolvedSearchParams.page)
    ? resolvedSearchParams.page[0]
    : resolvedSearchParams.page;
  const parsedPage = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 1000) : 1;

  let result = null;
  let unavailable = false;

  if (query) {
    try {
      result = await searchPokemonCards({ query, mode: "search", page, pageSize: 24 });
    } catch (error) {
      console.error("Search results page failed", error);
      unavailable = true;
    }
  }

  if (result && result.totalPages > 0 && page > result.totalPages) {
    const params = new URLSearchParams({ query });
    if (result.totalPages > 1) params.set("page", String(result.totalPages));
    redirect(`/search?${params}`);
  }

  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-8">
        <p className="eyebrow">Catalog results</p>
        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
          {query ? `Results for “${query}”` : "Search the catalog"}
        </h1>

        <div className="mt-8">
          <CardSearch initialQuery={query} />
        </div>

        {unavailable ? (
          <div className="mt-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-7">
            <h2 className="font-bold">The catalog is temporarily unavailable.</h2>
            <p className="mt-2 text-[var(--muted)]">Please try the search again in a moment.</p>
          </div>
        ) : null}

        {result ? (
          <div className="mt-12">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--accent)]">
                  {result.matchType === "closest" ? "Closest matches" : "Catalog matches"}
                </p>
                <h2 className="mt-1 text-2xl font-bold">
                  {result.totalCount === 0
                    ? "No cards found"
                    : `${result.totalCount.toLocaleString()} ${result.totalCount === 1 ? "card" : "cards"}`}
                </h2>
                {result.cards.length > 0 ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Showing {(result.page - 1) * result.pageSize + 1}–{Math.min(result.page * result.pageSize, result.totalCount)}
                  </p>
                ) : null}
              </div>
              {result.matchType === "closest" && result.cards.length > 0 ? (
                <p className="max-w-md text-sm text-[var(--muted)]">
                  We couldn&apos;t find an exact name and number, so these are ranked by similarity.
                </p>
              ) : null}
            </div>

            {result.cards.length > 0 ? (
              <>
                <CardResultGrid cards={result.cards} />
                <SearchPagination
                  query={query}
                  currentPage={result.page}
                  totalPages={result.totalPages}
                />
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-[var(--muted)]">
                Try a shorter name, omit the card number, or return to the{" "}
                <Link className="font-semibold text-[var(--secondary)] underline" href="/">
                  homepage
                </Link>.
              </div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
