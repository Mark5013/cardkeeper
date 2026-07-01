"use client";

import { useMemo, useState } from "react";

import { CollectionCardGrid } from "@/components/collection/collection-card-grid";
import type { CollectionItemDto } from "@/lib/collection/types";

type CollectionSortOption = "created-desc" | "created-asc" | "price-desc" | "price-asc";

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

export function CollectionBrowser({ items }: { items: CollectionItemDto[] }) {
  const [sort, setSort] = useState<CollectionSortOption>("created-desc");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const selectedOption = SORT_OPTIONS.find((option) => option.value === sort) ?? SORT_OPTIONS[0];
  const sortedItems = useMemo(() => sortCollectionItems(items, sort), [items, sort]);

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
                setIsMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              className="sort-menu-button"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((current) => !current)}
            >
              <span>Sort by: {selectedOption.label}</span>
              <span aria-hidden="true">v</span>
            </button>
            {isMenuOpen ? (
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
                      setIsMenuOpen(false);
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
      <CollectionCardGrid items={sortedItems} />
    </div>
  );
}
