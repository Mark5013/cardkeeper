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
type StoredSearchResultsState = {
  version: 1;
  savedAt: number;
  query: string;
  sort: SearchCardSort;
  cards: CardSearchResult[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  matchType: CardSearchPayload["matchType"];
  scrollY: number;
};

const searchStateVersion = 1;
const searchStateMaxAgeMs = 30 * 60 * 1000;

function getSearchStateKey(query: string, sort: SearchCardSort) {
  return `cardkeeper:search-results:${encodeURIComponent(query)}:${sort}`;
}

function readStoredSearchState(key: string) {
  if (typeof window === "undefined") return null;

  try {
    const rawState = window.sessionStorage.getItem(key);
    if (!rawState) return null;

    const state = JSON.parse(rawState) as Partial<StoredSearchResultsState>;
    const isExpired = typeof state.savedAt !== "number" || Date.now() - state.savedAt > searchStateMaxAgeMs;

    if (
      state.version !== searchStateVersion ||
      isExpired ||
      !Array.isArray(state.cards) ||
      typeof state.page !== "number" ||
      typeof state.pageSize !== "number" ||
      typeof state.totalCount !== "number" ||
      typeof state.totalPages !== "number" ||
      typeof state.scrollY !== "number" ||
      (state.matchType !== "matches" && state.matchType !== "closest" && state.matchType !== "suggestions")
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return state as StoredSearchResultsState;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

function restoreScrollPosition(scrollY: number, onRestored: () => void) {
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  const scrollOptions: ScrollToOptions = { top: scrollY, left: 0, behavior: "auto" };

  root.style.scrollBehavior = "auto";

  const scroll = () => {
    window.scrollTo(scrollOptions);
  };

  scroll();
  window.requestAnimationFrame(() => {
    scroll();
    window.requestAnimationFrame(() => {
      scroll();

      window.setTimeout(() => {
        scroll();
        root.style.scrollBehavior = previousScrollBehavior;
        onRestored();
      }, 0);
    });
  });
}

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
  const restoreAttemptedRef = useRef(false);
  const isRestoringRef = useRef(false);
  const isNavigatingToCardRef = useRef(false);
  const snapshotRef = useRef<StoredSearchResultsState | null>(null);

  function persistSearchState(scrollY = typeof window === "undefined" ? 0 : window.scrollY) {
    if (typeof window === "undefined") return;

    const snapshot = snapshotRef.current;
    if (!snapshot) return;

    try {
      window.sessionStorage.setItem(
        getSearchStateKey(snapshot.query, snapshot.sort),
        JSON.stringify({
          ...snapshot,
          savedAt: Date.now(),
          scrollY,
        }),
      );
    } catch {
      // Storage can be unavailable or full; navigation should still work normally.
    }
  }

  function handleCardNavigate() {
    isNavigatingToCardRef.current = true;
    persistSearchState(window.scrollY);
  }

  useEffect(() => {
    return () => {
      refreshControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    const storedState = readStoredSearchState(getSearchStateKey(query, sort));
    if (!storedState || storedState.query !== query || storedState.sort !== sort) return;
    if (storedState.pageSize !== initialResult.pageSize) return;

    isRestoringRef.current = true;
    snapshotRef.current = storedState;

    window.requestAnimationFrame(() => {
      setCards(storedState.cards);
      setPage(storedState.page);
      setTotalCount(storedState.totalCount);
      setTotalPages(storedState.totalPages);
      setMatchType(storedState.matchType);

      window.requestAnimationFrame(() => {
        restoreScrollPosition(storedState.scrollY, () => {
          isRestoringRef.current = false;
          persistSearchState(storedState.scrollY);
        });
      });
    });
  }, [initialResult.pageSize, query, sort]);

  useEffect(() => {
    if (isRestoringRef.current || isRefreshing) return;

    snapshotRef.current = {
      version: searchStateVersion,
      savedAt: Date.now(),
      query,
      sort,
      cards,
      page,
      pageSize: initialResult.pageSize,
      totalCount,
      totalPages,
      matchType,
      scrollY: typeof window === "undefined" ? 0 : window.scrollY,
    };

    persistSearchState();
  }, [cards, initialResult.pageSize, isRefreshing, matchType, page, query, sort, totalCount, totalPages]);

  useEffect(() => {
    let animationFrame = 0;

    function schedulePersist() {
      if (isNavigatingToCardRef.current) return;
      if (animationFrame) return;

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        persistSearchState();
      });
    }

    window.addEventListener("scroll", schedulePersist, { passive: true });
    window.addEventListener("pagehide", schedulePersist);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", schedulePersist);
      window.removeEventListener("pagehide", schedulePersist);
      if (!isNavigatingToCardRef.current) {
        persistSearchState();
      }
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
          {isRefreshing ? <LoadingCardGrid /> : <CardResultGrid cards={cards} onCardNavigate={handleCardNavigate} />}
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
