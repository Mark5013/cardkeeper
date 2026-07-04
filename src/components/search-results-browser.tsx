"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CardResultGrid } from "@/components/card-result-grid";
import {
  getSearchCardSortLabel,
  SEARCH_CARD_SORT_OPTIONS,
  type SearchCardSort,
} from "@/lib/catalog/search-card-sort";
import type { CardSearchPayload, CardSearchResult } from "@/lib/pokemon-tcg/types";

type SearchResponse = Partial<CardSearchPayload> & { error?: string };

function mergeUniqueCards(currentCards: CardSearchResult[], nextCards: CardSearchResult[]) {
  const seen = new Set(currentCards.map((card) => card.id));
  return [...currentCards, ...nextCards.filter((card) => !seen.has(card.id))];
}

export function SearchResultsBrowser({
  query,
  initialResult,
}: {
  query: string;
  initialResult: CardSearchPayload;
}) {
  const [cards, setCards] = useState(initialResult.cards);
  const [page, setPage] = useState(initialResult.page);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);
  const router = useRouter();
  const sort = initialResult.sort ?? "relevance";

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || page >= initialResult.totalPages) return;

    const controller = new AbortController();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || isLoadingRef.current) return;

        const nextPage = page + 1;
        isLoadingRef.current = true;
        setIsLoading(true);
        setError(null);

        const params = new URLSearchParams({
          query,
          mode: "search",
          page: String(nextPage),
          pageSize: String(initialResult.pageSize),
          sort,
        });

        fetch(`/api/cards/search?${params}`, { signal: controller.signal })
          .then(async (response) => {
            const payload = (await response.json()) as SearchResponse;
            if (!response.ok) throw new Error(payload.error ?? "Unable to load more cards.");
            return payload as CardSearchPayload;
          })
          .then((payload) => {
            setCards((currentCards) => mergeUniqueCards(currentCards, payload.cards));
            setPage(payload.page);
          })
          .catch((loadError) => {
            if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
              setError(loadError instanceof Error ? loadError.message : "Unable to load more cards.");
            }
          })
          .finally(() => {
            isLoadingRef.current = false;
            setIsLoading(false);
          });
      },
      { rootMargin: "900px 0px" },
    );

    observer.observe(sentinel);

    return () => {
      controller.abort();
      observer.disconnect();
    };
  }, [initialResult.pageSize, initialResult.totalPages, page, query, sort]);

  function updateSort(nextSort: SearchCardSort) {
    const params = new URLSearchParams({ query });
    if (nextSort !== "relevance") params.set("sort", nextSort);
    router.replace(`/search?${params}`, { scroll: false });
  }

  return (
    <div className="mt-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">
            {initialResult.matchType === "closest" ? "Closest matches" : "Catalog matches"}
          </p>
          <h2 className="mt-1 text-2xl font-bold">
            {initialResult.totalCount === 0
              ? "No cards found"
              : `${initialResult.totalCount.toLocaleString()} ${
                  initialResult.totalCount === 1 ? "card" : "cards"
                }`}
          </h2>
          {cards.length > 0 ? (
            <p className="mt-1 text-sm text-[var(--muted)]">
              Showing {cards.length.toLocaleString()} of {initialResult.totalCount.toLocaleString()}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          {initialResult.matchType === "closest" && cards.length > 0 ? (
            <p className="max-w-md text-sm text-[var(--muted)] sm:text-right">
              We couldn&apos;t find an exact name and number, so best-match results are ranked by similarity.
            </p>
          ) : null}
          {cards.length > 0 ? (
            <label className="catalog-sort-control">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(event) => updateSort(event.currentTarget.value as SearchCardSort)}
              >
                {SEARCH_CARD_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {cards.length > 0 ? (
        <>
          <CardResultGrid cards={cards} />
          <div ref={sentinelRef} className="h-12" aria-hidden="true" />
          {isLoading ? (
            <div className="mt-6 flex items-center justify-center gap-3 text-sm font-semibold text-[var(--muted)]" aria-live="polite">
              <span className="search-loading-spinner" aria-hidden="true" />
              Loading more cards
            </div>
          ) : null}
          {error ? (
            <p className="mt-6 text-center text-sm font-semibold text-[var(--danger)]" aria-live="polite">
              {error}
            </p>
          ) : null}
          {!isLoading && page >= initialResult.totalPages ? (
            <p className="mt-6 text-center text-sm text-[var(--muted)]">
              All matching cards are loaded by {getSearchCardSortLabel(sort).toLowerCase()}.
            </p>
          ) : null}
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
  );
}
