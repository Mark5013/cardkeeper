export const SET_CARD_SORT_OPTIONS = [
  { value: "number-asc", label: "Card number" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "price-asc", label: "Price: low to high" },
] as const;

export type SetCardSort = (typeof SET_CARD_SORT_OPTIONS)[number]["value"];

export function normalizeSetCardSort(value: string | null | undefined): SetCardSort {
  return SET_CARD_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as SetCardSort)
    : "number-asc";
}

export function getSetCardSortLabel(value: SetCardSort) {
  return SET_CARD_SORT_OPTIONS.find((option) => option.value === value)?.label ?? "Card number";
}
