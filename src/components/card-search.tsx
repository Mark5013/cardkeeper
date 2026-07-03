"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";

import type { CardSearchPayload, CardSearchResult } from "@/lib/pokemon-tcg/types";

type SearchResponse = Partial<CardSearchPayload> & { error?: string };

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function CardSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<CardSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isFocused, setIsFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchFormRef = useRef<HTMLFormElement>(null);

  const showSuggestions = isFocused && suggestions.length > 0;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!searchFormRef.current?.contains(event.target as Node)) {
        setIsFocused(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!isFocused || trimmedQuery.length < 2) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          query: trimmedQuery,
          mode: "suggest",
          pageSize: "6",
        });
        const response = await fetch(`/api/cards/search?${params}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as SearchResponse;

        if (!response.ok) return;
        setSuggestions(payload.cards ?? []);
        setActiveSuggestion(-1);
      } catch (suggestionError) {
        if (!(suggestionError instanceof DOMException && suggestionError.name === "AbortError")) {
          setSuggestions([]);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isFocused, query]);

  function openCard(card: CardSearchResult) {
    setSuggestions([]);
    setActiveSuggestion(-1);
    router.push(`/cards/${encodeURIComponent(card.id)}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Escape") {
      setSuggestions([]);
      setActiveSuggestion(-1);
    } else if (event.key === "Enter" && activeSuggestion >= 0) {
      event.preventDefault();
      openCard(suggestions[activeSuggestion]);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuggestions([]);
    setActiveSuggestion(-1);

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError("Enter a card name or number.");
      return;
    }

    startTransition(() => {
      router.push(`/search?${new URLSearchParams({ query: trimmedQuery })}`);
    });
  }

  return (
    <section className="search-panel p-5 sm:p-7" aria-labelledby="card-search-heading">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">Catalog search</p>
          <h2 id="card-search-heading" className="mt-2 text-2xl font-bold">
            Find your first card
          </h2>
        </div>
        <p className="text-sm text-[var(--muted)]">English catalog · USD prices</p>
      </div>

      <form
        ref={searchFormRef}
        className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        action="/search"
        method="get"
        onSubmit={handleSubmit}
      >
        <label className="combobox-wrap">
          <span className="field-label">Card name and optional number</span>
          <input
            className="search-input"
            name="query"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (nextQuery.trim().length < 2) {
                setSuggestions([]);
                setActiveSuggestion(-1);
              }
            }}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Pikachu 58"
            maxLength={110}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls="card-search-suggestions"
            aria-activedescendant={
              activeSuggestion >= 0 ? `card-suggestion-${activeSuggestion}` : undefined
            }
          />

          {showSuggestions ? (
            <ul className="suggestion-list" id="card-search-suggestions" role="listbox">
              {suggestions.map((card, index) => (
                <li key={card.id} role="presentation">
                  <button
                    id={`card-suggestion-${index}`}
                    className="suggestion-item"
                    data-active={activeSuggestion === index}
                    type="button"
                    role="option"
                    aria-selected={activeSuggestion === index}
                    onClick={() => openCard(card)}
                  >
                    <span className="suggestion-art">
                      <Image src={card.imageSmallUrl} alt="" fill sizes="40px" className="object-cover" />
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block truncate font-semibold text-[var(--ink)]">{card.name}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">
                        {card.set.name} · #{card.number}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 text-sm font-semibold text-[var(--secondary)]">
                      {card.startingPriceUsd === null ? "—" : usd.format(card.startingPriceUsd)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </label>

        <button className="search-button" type="submit" disabled={isPending}>
          {isPending ? "Searching…" : "Search cards"}
        </button>
      </form>

      {error ? <p className="mt-4 text-sm font-medium text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}
