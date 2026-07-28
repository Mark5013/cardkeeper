const UNNUMBERED_CARD_PATTERN = /^unnumbered(?:-\d+)?$/i;

export function isUnnumberedCardNumber(value: string) {
  return UNNUMBERED_CARD_PATTERN.test(value.trim());
}

export function formatCardNumber(
  value: string,
  printedTotal?: number | null,
) {
  if (isUnnumberedCardNumber(value)) return "Unnumbered";

  return `#${value}${
    printedTotal && !value.includes("/") ? ` / ${printedTotal}` : ""
  }`;
}
