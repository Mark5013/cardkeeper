import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CardSearch } from "@/components/card-search";
import { SearchResultsBrowser } from "@/components/search-results-browser";
import { SiteHeader } from "@/components/site-header";
import { searchCatalogPokemonCards } from "@/lib/catalog/data";

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

  if (query && rawPage) {
    redirect(`/search?${new URLSearchParams({ query })}`);
  }

  let result = null;
  let unavailable = false;

  if (query) {
    try {
      result = await searchCatalogPokemonCards({ query, mode: "search", page: 1, pageSize: 24 });
    } catch (error) {
      console.error("Search results page failed", error);
      unavailable = true;
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-8">
        <p className="eyebrow">Catalog results</p>
        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
          {query ? `Results for "${query}"` : "Search the catalog"}
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

        {result ? <SearchResultsBrowser key={query} query={query} initialResult={result} /> : null}
      </section>
    </main>
  );
}
