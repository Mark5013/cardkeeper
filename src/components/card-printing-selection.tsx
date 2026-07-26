"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type PrintingOption = {
  value: string;
  label: string;
};

type CardPrintingSelectionValue = {
  printing: string;
  printingOptions: readonly PrintingOption[];
  setPrinting: (printing: string) => void;
};

const CardPrintingSelectionContext = createContext<CardPrintingSelectionValue | null>(null);

export function CardPrintingSelectionProvider({
  children,
  initialPrinting,
  printingOptions,
}: {
  children: ReactNode;
  initialPrinting?: string;
  printingOptions: readonly PrintingOption[];
}) {
  const allowedPrintings = useMemo(
    () => new Set(printingOptions.map((option) => option.value)),
    [printingOptions],
  );
  const fallbackPrinting = printingOptions[0]?.value ?? "normal";
  const [printing, setPrintingState] = useState(
    initialPrinting && allowedPrintings.has(initialPrinting) ? initialPrinting : fallbackPrinting,
  );

  function setPrinting(nextPrinting: string) {
    if (!allowedPrintings.has(nextPrinting)) return;

    setPrintingState(nextPrinting);

    const url = new URL(window.location.href);
    url.searchParams.set("printing", nextPrinting);
    window.history.replaceState(null, "", url);
  }

  return (
    <CardPrintingSelectionContext value={{ printing, printingOptions, setPrinting }}>
      {children}
    </CardPrintingSelectionContext>
  );
}

export function useCardPrintingSelection() {
  const selection = useContext(CardPrintingSelectionContext);

  if (!selection) {
    throw new Error(
      "useCardPrintingSelection must be used within CardPrintingSelectionProvider.",
    );
  }

  return selection;
}
