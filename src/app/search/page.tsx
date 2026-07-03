import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { CardSearch } from "@/components/card-search";
import { SearchResultsBrowser } from "@/components/search-results-browser";
import { SiteHeader } from "@/components/site-header";
import { searchCatalogPokemonCards } from "@/lib/catalog/data";

export const metadata: Metadata = {
  title: "Card search",
  description: "Search the Pokemon card catalog.",
};

function LoadingCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-5 p-5">
        <div className="aspect-[245/342] rounded-md bg-[var(--surface-2)]" />
        <div className="self-center">
          <div className="h-3 w-24 rounded-full bg-[var(--surface-2)]" />
          <div className="mt-4 h-5 w-36 rounded-full bg-[var(--surface-2)]" />
          <div className="mt-4 h-3 w-28 rounded-full bg-[var(--surface-2)]" />
          <div className="mt-5 h-4 w-20 rounded-full bg-[var(--surface-2)]" />
        </div>
      </div>
    </div>
  );
}

function SearchResultsSkeleton() {
  return (
    <div className="mt-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="h-4 w-28 rounded-full bg-[var(--surface-2)]" />
          <div className="mt-3 h-7 w-44 rounded-full bg-[var(--surface-2)]" />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <LoadingCard key={index} />
        ))}
      </div>
    </div>
  );
}

async function SearchResultsSection({ query }: { query: string }) {
  if (!query) return null;

  let result;

  try {
    result = await searchCatalogPokemonCards({ query, mode: "search", page: 1, pageSize: 24 });
  } catch (error) {
    console.error("Search results page failed", error);

    return (
      <div className="mt-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-7">
        <h2 className="font-bold">The catalog is temporarily unavailable.</h2>
        <p className="mt-2 text-[var(--muted)]">Please try the search again in a moment.</p>
      </div>
    );
  }

  return <SearchResultsBrowser key={query} query={query} initialResult={result} />;
}

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
          <CardSearch key={query} initialQuery={query} />
        </div>

        <Suspense key={query} fallback={query ? <SearchResultsSkeleton /> : null}>
          <SearchResultsSection query={query} />
        </Suspense>
      </section>
    </main>
  );
}
