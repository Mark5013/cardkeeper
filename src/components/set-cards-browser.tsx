"use client";

import { useEffect, useRef, useState } from "react";

import { CardResultGrid } from "@/components/card-result-grid";
import type { CardSearchResult, SetCardsPayload } from "@/lib/pokemon-tcg/types";

type SetCardsResponse = Partial<SetCardsPayload> & { error?: string };

function mergeAndSortCards(currentCards: CardSearchResult[], nextCards: CardSearchResult[]) {
  const cardsById = new Map(currentCards.map((card) => [card.id, card]));

  for (const card of nextCards) {
    cardsById.set(card.id, card);
  }

  return Array.from(cardsById.values()).sort(
    (left, right) =>
      left.number.localeCompare(right.number, "en", { numeric: true }) ||
      left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
  );
}

export function SetCardsBrowser({
  setId,
  initialResult,
}: {
  setId: string;
  initialResult: SetCardsPayload;
}) {
  const [cards, setCards] = useState(initialResult.cards);
  const [page, setPage] = useState(initialResult.page);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);
  const hasMoreCards = page < initialResult.totalPages && cards.length < initialResult.totalCount;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMoreCards) return;

    const controller = new AbortController();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || isLoadingRef.current) return;

        const nextPage = page + 1;
        isLoadingRef.current = true;
        setIsLoading(true);
        setError(null);

        const params = new URLSearchParams({
          page: String(nextPage),
          pageSize: String(initialResult.pageSize),
        });

        fetch(`/api/sets/${encodeURIComponent(setId)}/cards?${params}`, {
          signal: controller.signal,
        })
          .then(async (response) => {
            const payload = (await response.json()) as SetCardsResponse;
            if (!response.ok) throw new Error(payload.error ?? "Unable to load more cards.");
            return payload as SetCardsPayload;
          })
          .then((payload) => {
            setCards((currentCards) => mergeAndSortCards(currentCards, payload.cards));
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
  }, [hasMoreCards, initialResult.pageSize, page, setId]);

  return (
    <div className="mt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">Set cards</p>
          <h2 className="mt-1 text-2xl font-bold">
            {initialResult.totalCount.toLocaleString()}{" "}
            {initialResult.totalCount === 1 ? "card" : "cards"}
          </h2>
          {cards.length > 0 ? (
            <p className="mt-1 text-sm text-[var(--muted)]">
              Showing {cards.length.toLocaleString()} of{" "}
              {initialResult.totalCount.toLocaleString()}
            </p>
          ) : null}
        </div>
        <p className="max-w-md text-sm text-[var(--muted)]">
          Cards are sorted by printed card number.
        </p>
      </div>

      <CardResultGrid cards={cards} />
      {hasMoreCards ? <div ref={sentinelRef} className="h-12" aria-hidden="true" /> : null}
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
      {!isLoading && !hasMoreCards ? (
        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          All cards in this set are loaded.
        </p>
      ) : null}
    </div>
  );
}
