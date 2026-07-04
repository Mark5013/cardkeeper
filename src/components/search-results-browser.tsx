"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { CardResultGrid } from "@/components/card-result-grid";
import { SortSelect } from "@/components/ui/sort-select";
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

function LoadingCardGrid() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite" aria-label="Loading sorted cards">
      {Array.from({ length: 6 }, (_, index) => (
        <LoadingCard key={index} />
      ))}
    </div>
  );
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
  const [totalCount, setTotalCount] = useState(initialResult.totalCount);
  const [totalPages, setTotalPages] = useState(initialResult.totalPages);
  const [matchType, setMatchType] = useState(initialResult.matchType);
  const [sort, setSort] = useState<SearchCardSort>(initialResult.sort ?? "relevance");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);
  const refreshControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      refreshControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || page >= totalPages || isRefreshing) return;

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
            setTotalCount(payload.totalCount);
            setTotalPages(payload.totalPages);
            setMatchType(payload.matchType);
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
  }, [initialResult.pageSize, isRefreshing, page, query, sort, totalPages]);

  async function updateSort(nextSort: SearchCardSort) {
    if (nextSort === sort) return;

    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;

    setSort(nextSort);
    setIsRefreshing(true);
    setIsLoading(false);
    isLoadingRef.current = false;
    setError(null);

    const params = new URLSearchParams({ query });
    if (nextSort !== "relevance") params.set("sort", nextSort);
    window.history.replaceState(null, "", `/search?${params}`);

    const requestParams = new URLSearchParams({
      query,
      mode: "search",
      page: "1",
      pageSize: String(initialResult.pageSize),
      sort: nextSort,
    });

    try {
      const response = await fetch(`/api/cards/search?${requestParams}`, { signal: controller.signal });
      const payload = (await response.json()) as SearchResponse;
      if (!response.ok) throw new Error(payload.error ?? "Unable to sort cards.");

      const result = payload as CardSearchPayload;
      setCards(result.cards);
      setPage(result.page);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
      setMatchType(result.matchType);
    } catch (sortError) {
      if (!(sortError instanceof DOMException && sortError.name === "AbortError")) {
        setError(sortError instanceof Error ? sortError.message : "Unable to sort cards.");
      }
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
        setIsRefreshing(false);
      }
    }
  }

  return (
    <div className="mt-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">
            {matchType === "closest" ? "Closest matches" : "Catalog matches"}
          </p>
          <h2 className="mt-1 text-2xl font-bold">
            {totalCount === 0
              ? "No cards found"
              : `${totalCount.toLocaleString()} ${totalCount === 1 ? "card" : "cards"}`}
          </h2>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          {matchType === "closest" && cards.length > 0 ? (
            <p className="max-w-md text-sm text-[var(--muted)] sm:text-right">
              We couldn&apos;t find an exact name and number, so best-match results are ranked by similarity.
            </p>
          ) : null}
          {cards.length > 0 ? (
            <SortSelect
              label="Sort"
              options={SEARCH_CARD_SORT_OPTIONS}
              value={sort}
              onValueChange={updateSort}
            />
          ) : null}
        </div>
      </div>

      {cards.length > 0 ? (
        <>
          {isRefreshing ? <LoadingCardGrid /> : <CardResultGrid cards={cards} />}
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
          {!isLoading && !isRefreshing && page >= totalPages ? (
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
