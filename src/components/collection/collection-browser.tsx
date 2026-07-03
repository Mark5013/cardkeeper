"use client";

import { useMemo, useState } from "react";

import { CollectionCardGrid } from "@/components/collection/collection-card-grid";
import type { CollectionItemDto } from "@/lib/collection/types";

type CollectionSortOption = "created-desc" | "created-asc" | "price-desc" | "price-asc";
type CollectionSetOption = { id: string; name: string };

const SORT_OPTIONS: { value: CollectionSortOption; label: string }[] = [
  { value: "created-desc", label: "Newest added" },
  { value: "created-asc", label: "Oldest added" },
  { value: "price-desc", label: "Card price: high to low" },
  { value: "price-asc", label: "Card price: low to high" },
];

function compareCardIdentity(left: CollectionItemDto, right: CollectionItemDto) {
  return (
    left.cardName.localeCompare(right.cardName, "en", { sensitivity: "base" }) ||
    left.setName.localeCompare(right.setName, "en", { sensitivity: "base" }) ||
    left.cardNumber.localeCompare(right.cardNumber, "en", { numeric: true })
  );
}

function getTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeFilterText(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function sortCollectionItems(items: CollectionItemDto[], sort: CollectionSortOption) {
  return [...items].sort((left, right) => {
    if (sort === "created-desc" || sort === "created-asc") {
      const dateDelta = getTimestamp(left.createdAt) - getTimestamp(right.createdAt);
      if (dateDelta !== 0) return sort === "created-asc" ? dateDelta : -dateDelta;
      return compareCardIdentity(left, right);
    }

    if (left.unitPriceUsd === null && right.unitPriceUsd === null) return compareCardIdentity(left, right);
    if (left.unitPriceUsd === null) return 1;
    if (right.unitPriceUsd === null) return -1;

    const priceDelta = left.unitPriceUsd - right.unitPriceUsd;
    if (priceDelta !== 0) return sort === "price-asc" ? priceDelta : -priceDelta;
    return compareCardIdentity(left, right);
  });
}

function filterCollectionItems(input: {
  items: CollectionItemDto[];
  query: string;
  selectedSetIds: string[];
}) {
  const normalizedQuery = normalizeFilterText(input.query);
  const selectedSetIds = new Set(input.selectedSetIds);

  return input.items.filter((item) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      normalizeFilterText(`${item.cardName} ${item.cardNumber}`).includes(normalizedQuery);
    const matchesSet = selectedSetIds.size === 0 || selectedSetIds.has(item.providerSetId);

    return matchesQuery && matchesSet;
  });
}

export function CollectionBrowser({
  items,
  setOptions,
}: {
  items: CollectionItemDto[];
  setOptions: CollectionSetOption[];
}) {
  const [sort, setSort] = useState<CollectionSortOption>("created-desc");
  const [query, setQuery] = useState("");
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [isSetMenuOpen, setIsSetMenuOpen] = useState(false);
  const selectedOption = SORT_OPTIONS.find((option) => option.value === sort) ?? SORT_OPTIONS[0];
  const filteredItems = useMemo(
    () => filterCollectionItems({ items, query, selectedSetIds }),
    [items, query, selectedSetIds],
  );
  const sortedItems = useMemo(() => sortCollectionItems(filteredItems, sort), [filteredItems, sort]);
  const hasActiveFilters = query.trim().length > 0 || selectedSetIds.length > 0;

  function toggleSet(setId: string) {
    setSelectedSetIds((current) =>
      current.includes(setId) ? current.filter((id) => id !== setId) : [...current, setId],
    );
  }

  function clearFilters() {
    setQuery("");
    setSelectedSetIds([]);
    setIsSetMenuOpen(false);
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
          <div
            className="sort-menu-wrap"
            onBlur={(event) => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                setIsSortMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              className="sort-menu-button"
              aria-haspopup="menu"
              aria-expanded={isSortMenuOpen}
              onClick={() => setIsSortMenuOpen((current) => !current)}
            >
              <span>Sort by: {selectedOption.label}</span>
              <span aria-hidden="true">v</span>
            </button>
            {isSortMenuOpen ? (
              <div className="sort-menu" role="menu">
                {SORT_OPTIONS.map((option) => (
                  <button
                    type="button"
                    className="sort-menu-option"
                    data-active={option.value === sort}
                    role="menuitemradio"
                    aria-checked={option.value === sort}
                    key={option.value}
                    onClick={() => {
                      setSort(option.value);
                      setIsSortMenuOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
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

          <div
            className="sort-menu-wrap"
            onBlur={(event) => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                setIsSetMenuOpen(false);
              }
            }}
          >
            <span className="auth-label">Set</span>
            <button
              type="button"
              className="sort-menu-button collection-filter-button"
              aria-haspopup="menu"
              aria-expanded={isSetMenuOpen}
              onClick={() => setIsSetMenuOpen((current) => !current)}
            >
              <span>{selectedSetIds.length === 0 ? "All sets" : `${selectedSetIds.length} selected`}</span>
              <span aria-hidden="true">v</span>
            </button>
            {isSetMenuOpen ? (
              <div className="sort-menu collection-set-menu" role="menu">
                {setOptions.map((set) => {
                  const isSelected = selectedSetIds.includes(set.id);

                  return (
                    <button
                      type="button"
                      className="sort-menu-option collection-set-option"
                      data-active={isSelected}
                      role="menuitemcheckbox"
                      aria-checked={isSelected}
                      key={set.id}
                      onClick={() => toggleSet(set.id)}
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
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="collection-filter-actions">
            <p className="text-sm font-semibold text-[var(--muted)]">
              Showing {sortedItems.length} of {items.length}
            </p>
            {hasActiveFilters ? (
              <button type="button" className="collection-clear-button" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {sortedItems.length > 0 ? (
        <CollectionCardGrid items={sortedItems} />
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
