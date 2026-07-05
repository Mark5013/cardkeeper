"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CollectionCardGrid } from "@/components/collection/collection-card-grid";
import { CARD_CONDITIONS } from "@/lib/collection/options";
import type { CollectionSummaryDto } from "@/lib/collection/types";
import type { CollectionItemDto } from "@/lib/collection/types";

type CollectionSortOption = "created-desc" | "created-asc" | "price-desc" | "price-asc";
type CollectionSetOption = { id: string; name: string };
type CollectionFilterOption = { id: string; name: string };

const SORT_OPTIONS: { value: CollectionSortOption; label: string }[] = [
  { value: "created-desc", label: "Newest added" },
  { value: "created-asc", label: "Oldest added" },
  { value: "price-desc", label: "Card price: high to low" },
  { value: "price-asc", label: "Card price: low to high" },
];

function getConditionLabel(condition: string) {
  return CARD_CONDITIONS.find((option) => option.value === condition)?.label ?? condition;
}

function normalizePriceInput(value: string) {
  if (value.trim() === "") return "";

  const price = Number(value);
  if (!Number.isFinite(price)) return value;
  if (price < 0) return "0";

  return value;
}

function FilterSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="collection-filter-section">
      <h4 className="text-sm font-bold">{title}</h4>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function FilterCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="collection-filter-checkbox">
      <input
        className="collection-set-checkbox"
        type="checkbox"
        checked={checked}
        onChange={onChange}
      />
      <span>{label}</span>
    </label>
  );
}

export function CollectionBrowser({
  initialItems,
  setOptions,
  initialPage,
  pageSize,
  totalItems,
  initialHasNextPage,
  finishOptions,
  conditionOptions,
}: {
  initialItems: CollectionItemDto[];
  setOptions: CollectionSetOption[];
  initialPage: number;
  pageSize: number;
  totalItems: number;
  initialHasNextPage: boolean;
  finishOptions: CollectionFilterOption[];
  conditionOptions: CollectionFilterOption[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [sort, setSort] = useState<CollectionSortOption>("created-desc");
  const [query, setQuery] = useState("");
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const [selectedPrintings, setSelectedPrintings] = useState<string[]>([]);
  const [selectedConditions, setSelectedConditions] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [showAllSets, setShowAllSets] = useState(false);
  const [setFilterQuery, setSetFilterQuery] = useState("");
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [loadedPage, setLoadedPage] = useState(initialPage);
  const [visibleTotalItems, setVisibleTotalItems] = useState(totalItems);
  const [hasNextPage, setHasNextPage] = useState(initialHasNextPage);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [decrementingVariantIds, setDecrementingVariantIds] = useState<Set<string>>(() => new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasMountedRef = useRef(false);
  const resultsContentRef = useRef<HTMLDivElement | null>(null);
  const [reservedResultsHeight, setReservedResultsHeight] = useState<number | null>(null);
  const selectedOption = SORT_OPTIONS.find((option) => option.value === sort) ?? SORT_OPTIONS[0];
  const hasPriceRangeFilter = minPrice.trim().length > 0 || maxPrice.trim().length > 0;
  const activeCheckboxFilterCount =
    selectedSetIds.length + selectedPrintings.length + selectedConditions.length;
  const activeFilterCount = activeCheckboxFilterCount + (hasPriceRangeFilter ? 1 : 0);
  const hasActiveFilters = query.trim().length > 0 || activeFilterCount > 0;
  const defaultVisibleSetCount = 12;
  const trimmedSetFilterQuery = setFilterQuery.trim().toLowerCase();
  const matchingSetOptions = trimmedSetFilterQuery
    ? setOptions.filter(
        (set) =>
          set.name.toLowerCase().includes(trimmedSetFilterQuery) ||
          set.id.toLowerCase().includes(trimmedSetFilterQuery),
      )
    : setOptions;
  const defaultSetOptions = matchingSetOptions.slice(0, defaultVisibleSetCount);
  const visibleSetOptionMap = new Map(
    (showAllSets || trimmedSetFilterQuery ? matchingSetOptions : defaultSetOptions).map((set) => [set.id, set]),
  );

  if (!showAllSets && !trimmedSetFilterQuery) {
    for (const setId of selectedSetIds) {
      const selectedSet = setOptions.find((set) => set.id === setId);
      if (selectedSet) visibleSetOptionMap.set(selectedSet.id, selectedSet);
    }
  }

  const visibleSetOptions = Array.from(visibleSetOptionMap.values());
  const hasHiddenSetOptions = matchingSetOptions.length > visibleSetOptions.length;

  const buildCollectionParams = useCallback((page: number) => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
    });
    const trimmedQuery = query.trim();

    if (trimmedQuery) params.set("query", trimmedQuery);
    if (selectedSetIds.length > 0) params.set("setIds", selectedSetIds.join(","));
    if (selectedPrintings.length > 0) params.set("printings", selectedPrintings.join(","));
    if (selectedConditions.length > 0) params.set("conditions", selectedConditions.join(","));
    if (minPrice.trim()) params.set("minPrice", minPrice.trim());
    if (maxPrice.trim()) params.set("maxPrice", maxPrice.trim());

    return params;
  }, [maxPrice, minPrice, pageSize, query, selectedConditions, selectedPrintings, selectedSetIds, sort]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      const resultsHeight = resultsContentRef.current?.getBoundingClientRect().height ?? 0;
      setReservedResultsHeight(resultsHeight > 0 ? resultsHeight : null);
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

  useEffect(() => {
    if (isRefreshing || reservedResultsHeight === null) return;

    const releaseReserve = () => setReservedResultsHeight(null);
    const frame = window.requestAnimationFrame(() => {
      const viewportBottom = window.scrollY + window.innerHeight;
      const pageBottom = document.documentElement.scrollHeight;

      if (pageBottom > viewportBottom + 120) {
        releaseReserve();
      }
    });

    window.addEventListener("wheel", releaseReserve, { once: true });
    window.addEventListener("touchstart", releaseReserve, { once: true });
    window.addEventListener("keydown", releaseReserve, { once: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("wheel", releaseReserve);
      window.removeEventListener("touchstart", releaseReserve);
      window.removeEventListener("keydown", releaseReserve);
    };
  }, [isRefreshing, reservedResultsHeight]);

  function toggleFilterValue(value: string, updateValues: (updater: (current: string[]) => string[]) => void) {
    updateValues((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function clearFilters() {
    setQuery("");
    setSelectedSetIds([]);
    setSelectedPrintings([]);
    setSelectedConditions([]);
    setMinPrice("");
    setMaxPrice("");
  }

  const filterSections = (
    <>
      <FilterSection title="Finish">
        {finishOptions.map((finish) => (
          <FilterCheckbox
            checked={selectedPrintings.includes(finish.id)}
            key={finish.id}
            label={finish.name}
            onChange={() => toggleFilterValue(finish.id, setSelectedPrintings)}
          />
        ))}
      </FilterSection>

      <FilterSection title="Condition">
        {conditionOptions.map((condition) => (
          <FilterCheckbox
            checked={selectedConditions.includes(condition.id)}
            key={condition.id}
            label={getConditionLabel(condition.id)}
            onChange={() => toggleFilterValue(condition.id, setSelectedConditions)}
          />
        ))}
      </FilterSection>

      <FilterSection title="Price range">
        <div className="collection-price-range">
          <label>
            <span className="auth-label">Min</span>
            <input
              className="auth-input"
              inputMode="decimal"
              min="0"
              step="0.01"
              type="number"
              value={minPrice}
              onChange={(event) => setMinPrice(normalizePriceInput(event.target.value))}
              placeholder="0.00"
            />
          </label>
          <label>
            <span className="auth-label">Max</span>
            <input
              className="auth-input"
              inputMode="decimal"
              min="0"
              step="0.01"
              type="number"
              value={maxPrice}
              onChange={(event) => setMaxPrice(normalizePriceInput(event.target.value))}
              placeholder="100.00"
            />
          </label>
        </div>
      </FilterSection>

      <FilterSection title="Sets">
        <label className="collection-set-search-field">
          <span className="sr-only">Search sets</span>
          <input
            className="auth-input"
            type="search"
            value={setFilterQuery}
            onChange={(event) => setSetFilterQuery(event.target.value)}
            placeholder="Search sets"
          />
        </label>
        {visibleSetOptions.length > 0 ? (
          visibleSetOptions.map((set) => (
            <FilterCheckbox
              checked={selectedSetIds.includes(set.id)}
              key={set.id}
              label={set.name}
              onChange={() => toggleFilterValue(set.id, setSelectedSetIds)}
            />
          ))
        ) : (
          <p className="px-2 py-1 text-sm font-semibold text-[var(--muted)]">No matching sets</p>
        )}
        {!trimmedSetFilterQuery && (hasHiddenSetOptions || showAllSets) ? (
          <button
            className="collection-filter-text-button"
            type="button"
            onClick={() => setShowAllSets((current) => !current)}
          >
            {showAllSets ? "Show fewer sets" : `Show all sets (${setOptions.length})`}
          </button>
        ) : null}
      </FilterSection>
    </>
  );

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
      </div>

      <div className="collection-browser-layout">
        <aside className="collection-filter-sidebar" aria-label="Collection filters">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Filters</p>
              <h3 className="mt-1 text-lg font-bold">
                Refine collection{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </h3>
            </div>
            {hasActiveFilters ? (
              <button className="collection-clear-button" type="button" onClick={clearFilters}>
                Clear
              </button>
            ) : null}
          </div>

          <div className="collection-filter-sidebar-body">
            {filterSections}
          </div>
        </aside>

        <div className="collection-results-column">
          <div className="collection-filter-panel">
            <div className="collection-search-row">
              <label className="collection-search-field">
                <span className="auth-label">Card name</span>
                <input
                  className="auth-input"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search your cards"
                />
              </label>

              <div className="collection-filter-actions">
                <button
                  type="button"
                  className="sort-menu-button collection-mobile-filter-button"
                  onClick={() => setIsFilterPanelOpen(true)}
                >
                  <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</span>
                  <span className="control-chevron" aria-hidden="true" />
                </button>
                <p className="text-sm font-semibold text-[var(--muted)]">
                  Showing {items.length} of {visibleTotalItems} matching
                </p>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger className="sort-menu-button collection-sort-button" type="button">
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
          </div>

          {isFilterPanelOpen ? (
            <div className="collection-filter-drawer-wrap" role="presentation">
              <button
                className="collection-filter-backdrop"
                type="button"
                aria-label="Close filters"
                onClick={() => setIsFilterPanelOpen(false)}
              />
              <aside className="collection-filter-drawer" aria-label="Collection filters">
                <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Filters</p>
                    <h3 className="mt-1 text-xl font-bold">
                      Refine collection{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                    </h3>
                  </div>
                  <button
                    className="collection-clear-button"
                    type="button"
                    onClick={() => setIsFilterPanelOpen(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="collection-filter-drawer-body">{filterSections}</div>

                <div className="border-t border-[var(--line)] pt-4">
                  <button
                    type="button"
                    className="auth-submit w-full"
                    onClick={() => setIsFilterPanelOpen(false)}
                  >
                    Show results
                  </button>
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      className="mt-3 w-full text-sm font-semibold text-[var(--secondary)] hover:underline"
                      onClick={clearFilters}
                    >
                      Clear all filters
                    </button>
                  ) : null}
                </div>
              </aside>
            </div>
          ) : null}

          <div
            aria-busy={isRefreshing}
            className={isRefreshing ? "collection-results-stack is-refreshing" : "collection-results-stack"}
            ref={resultsContentRef}
            style={reservedResultsHeight === null ? undefined : { minHeight: reservedResultsHeight }}
          >
            {isRefreshing ? (
              <div className="collection-refresh-status" role="status">
                <span className="search-loading-spinner" aria-hidden="true" />
                <span>Updating results</span>
              </div>
            ) : null}
            {items.length > 0 ? (
              <div className="collection-results-content">
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
              </div>
            ) : (
              <div className="collection-empty-state">
                <h3 className="text-xl font-bold">
                  {hasActiveFilters ? "No cards match these filters" : "Your collection is empty"}
                </h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
                  {hasActiveFilters
                    ? "Try a wider range or clear filters to get back to your full binder."
                    : "Cards you add to your collection will appear here."}
                </p>
                {hasActiveFilters ? (
                  <button type="button" className="auth-submit mt-5" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
