export const SEARCH_CARD_SORT_OPTIONS = [
  { value: "relevance", label: "Best match" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "price-asc", label: "Price: low to high" },
] as const;

export type SearchCardSort = (typeof SEARCH_CARD_SORT_OPTIONS)[number]["value"];

export function normalizeSearchCardSort(value: string | null | undefined): SearchCardSort {
  return SEARCH_CARD_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as SearchCardSort)
    : "relevance";
}

export function getSearchCardSortLabel(value: SearchCardSort) {
  return SEARCH_CARD_SORT_OPTIONS.find((option) => option.value === value)?.label ?? "Best match";
}
