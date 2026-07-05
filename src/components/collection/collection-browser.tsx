"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CollectionCardGrid } from "@/components/collection/collection-card-grid";
import type { CollectionSummaryDto } from "@/lib/collection/types";
import type { CollectionItemDto } from "@/lib/collection/types";

type CollectionSortOption = "created-desc" | "created-asc" | "price-desc" | "price-asc";
type CollectionSetOption = { id: string; name: string };

const SORT_OPTIONS: { value: CollectionSortOption; label: string }[] = [
  { value: "created-desc", label: "Newest added" },
  { value: "created-asc", label: "Oldest added" },
  { value: "price-desc", label: "Card price: high to low" },
  { value: "price-asc", label: "Card price: low to high" },
];

export function CollectionBrowser({
  initialItems,
  setOptions,
  initialPage,
  pageSize,
  totalItems,
  initialHasNextPage,
}: {
  initialItems: CollectionItemDto[];
  setOptions: CollectionSetOption[];
  initialPage: number;
  pageSize: number;
  totalItems: number;
  initialHasNextPage: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [sort, setSort] = useState<CollectionSortOption>("created-desc");
  const [query, setQuery] = useState("");
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const [loadedPage, setLoadedPage] = useState(initialPage);
  const [visibleTotalItems, setVisibleTotalItems] = useState(totalItems);
  const [hasNextPage, setHasNextPage] = useState(initialHasNextPage);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [decrementingVariantIds, setDecrementingVariantIds] = useState<Set<string>>(() => new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasMountedRef = useRef(false);
  const selectedOption = SORT_OPTIONS.find((option) => option.value === sort) ?? SORT_OPTIONS[0];
  const hasActiveFilters = query.trim().length > 0 || selectedSetIds.length > 0;

  const buildCollectionParams = useCallback((page: number) => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
    });
    const trimmedQuery = query.trim();

    if (trimmedQuery) params.set("query", trimmedQuery);
    if (selectedSetIds.length > 0) params.set("setIds", selectedSetIds.join(","));

    return params;
  }, [pageSize, query, selectedSetIds, sort]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsRefreshing(true);
      setLoadError(null);

      try {
        const response = await fetch(`/api/collection?${buildCollectionParams(1)}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Unable to refresh your collection.");
        }

        const payload = (await response.json()) as CollectionSummaryDto;
        setItems(payload.items);
        setLoadedPage(payload.page);
        setVisibleTotalItems(payload.totalItems);
        setHasNextPage(payload.hasNextPage);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError(error instanceof Error ? error.message : "Unable to refresh your collection.");
        }
      } finally {
        setIsRefreshing(false);
      }
    }, query.trim() ? 250 : 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [buildCollectionParams, query]);

  function toggleSet(setId: string) {
    setSelectedSetIds((current) =>
      current.includes(setId) ? current.filter((id) => id !== setId) : [...current, setId],
    );
  }

  function clearFilters() {
    setQuery("");
    setSelectedSetIds([]);
  }

  async function loadMore() {
    if (isLoadingMore || !hasNextPage) return;

    setIsLoadingMore(true);
    setLoadError(null);

    try {
      const nextPage = loadedPage + 1;
      const params = buildCollectionParams(nextPage);
      const response = await fetch(`/api/collection?${params}`, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error("Unable to load more cards.");
      }

      const payload = (await response.json()) as CollectionSummaryDto;
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...payload.items.filter((item) => !seen.has(item.id))];
      });
      setLoadedPage(payload.page);
      setVisibleTotalItems(payload.totalItems);
      setHasNextPage(payload.hasNextPage);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load more cards.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function decrementItem(item: CollectionItemDto) {
    if (decrementingVariantIds.has(item.cardVariantId)) return;

    setDecrementingVariantIds((current) => new Set(current).add(item.cardVariantId));
    setLoadError(null);
    let didUpdate = false;

    try {
      const nextQuantity = item.quantity - 1;

      if (nextQuantity > 0) {
        const response = await fetch(`/api/collection/${encodeURIComponent(item.cardVariantId)}`, {
          method: "PUT",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ quantity: nextQuantity }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Unable to update this card.");
        }

        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? {
                  ...currentItem,
                  quantity: nextQuantity,
                  estimatedValueUsd:
                    currentItem.unitPriceUsd === null
                      ? null
                      : (Math.round(currentItem.unitPriceUsd * 100) * nextQuantity) / 100,
                }
              : currentItem,
          ),
        );
        didUpdate = true;
      } else {
        const response = await fetch(`/api/collection/${encodeURIComponent(item.cardVariantId)}`, {
          method: "DELETE",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Unable to remove this card.");
        }

        setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
        setVisibleTotalItems((current) => Math.max(0, current - 1));
        didUpdate = true;
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to update this card.");
    } finally {
      setDecrementingVariantIds((current) => {
        const next = new Set(current);
        next.delete(item.cardVariantId);
        return next;
      });
      if (didUpdate) router.refresh();
    }
  }

  return (
    <div className="mt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">Owned cards</p>
          <h2 className="mt-1 text-2xl font-bold">Your binder</h2>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <p className="max-w-md text-sm text-[var(--muted)] sm:text-right">
            Values use general finish-level market prices and do not yet adjust for condition. Unpriced variants sort after priced variants when sorting by price.
          </p>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="sort-menu-button" type="button">
              <span>Sort by: {selectedOption.label}</span>
              <span className="control-chevron" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="control-menu" align="end" sideOffset={6}>
                <DropdownMenu.RadioGroup
                  value={sort}
                  onValueChange={(value) => setSort(value as CollectionSortOption)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <DropdownMenu.RadioItem
                      className="control-menu-option"
                      value={option.value}
                      key={option.value}
                    >
                      {option.label}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <div className="collection-filter-panel">
        <div className="collection-filter-grid">
          <label>
            <span className="auth-label">Card name</span>
            <input
              className="auth-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your cards"
            />
          </label>

          <div>
            <span className="auth-label">Set</span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="sort-menu-button collection-filter-button" type="button">
                <span>{selectedSetIds.length === 0 ? "All sets" : `${selectedSetIds.length} selected`}</span>
                <span className="control-chevron" aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="control-menu collection-set-menu" align="start" sideOffset={6}>
                  {setOptions.map((set) => {
                    const isSelected = selectedSetIds.includes(set.id);

                    return (
                      <DropdownMenu.CheckboxItem
                        className="control-menu-option collection-set-option"
                        checked={isSelected}
                        key={set.id}
                        onCheckedChange={() => toggleSet(set.id)}
                        onSelect={(event) => event.preventDefault()}
                      >
                        <input
                          className="collection-set-checkbox"
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          tabIndex={-1}
                          aria-hidden="true"
                        />
                        <span>{set.name}</span>
                      </DropdownMenu.CheckboxItem>
                    );
                  })}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          <div className="collection-filter-actions">
            <p className="text-sm font-semibold text-[var(--muted)]">
              Showing {items.length} of {visibleTotalItems} matching
            </p>
            {hasActiveFilters ? (
              <button type="button" className="collection-clear-button" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {items.length > 0 ? (
        <>
          <CollectionCardGrid
            items={items}
            decrementingVariantIds={decrementingVariantIds}
            onDecrementItem={decrementItem}
          />
          <div className="collection-pagination">
            <p className="text-sm font-semibold text-[var(--muted)]">
              {isRefreshing ? "Refreshing..." : `Loaded ${items.length} of ${visibleTotalItems}`}
            </p>
            {loadError ? <p className="text-sm font-semibold text-[var(--danger)]">{loadError}</p> : null}
            {hasNextPage ? (
              <button
                type="button"
                className="auth-submit"
                disabled={isLoadingMore}
                onClick={loadMore}
              >
                {isLoadingMore ? "Loading..." : "Load more"}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-12 text-center">
          <h3 className="text-xl font-bold">No cards match these filters</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
            Try a different card name or set.
          </p>
          <button type="button" className="mt-5 font-semibold text-[var(--secondary)] hover:underline" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
