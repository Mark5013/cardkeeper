"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FieldSelect } from "@/components/ui/field-select";
import { CARD_CONDITIONS } from "@/lib/collection/options";
import type { OwnedCardVariantDto } from "@/lib/collection/types";
import type { CardPrintingOption } from "@/lib/pokemon-tcg/printing";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type SaveResponse = {
  item?: OwnedCardVariantDto;
  error?: string;
};

export function CollectionControls({
  cardId,
  printings,
  initialHoldings,
  isAuthenticated,
}: {
  cardId: string;
  printings: CardPrintingOption[];
  initialHoldings: OwnedCardVariantDto[];
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const initialHolding = initialHoldings[0];
  const [holdings, setHoldings] = useState(initialHoldings);
  const [printing, setPrinting] = useState(initialHolding?.printing ?? printings[0]?.value ?? "normal");
  const [condition, setCondition] = useState(initialHolding?.condition ?? "near_mint");
  const [quantity, setQuantity] = useState(String(initialHolding?.quantity ?? 1));
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const selectedHolding = holdings.find(
    (holding) => holding.printing === printing && holding.condition === condition,
  );
  const selectedPrinting = printings.find((option) => option.value === printing);
  const marketPrice =
    selectedPrinting?.price?.market ??
    selectedPrinting?.price?.mid ??
    selectedPrinting?.price?.low ??
    null;

  function updateSelection(nextPrinting: string, nextCondition: string) {
    setPrinting(nextPrinting);
    setCondition(nextCondition);
    const holding = holdings.find(
      (item) => item.printing === nextPrinting && item.condition === nextCondition,
    );
    setQuantity(String(holding?.quantity ?? 1));
    setMessage(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedQuantity = Number(quantity);

    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 9999) {
      setIsError(true);
      setMessage("Quantity must be a whole number between 1 and 9999.");
      return;
    }

    setIsPending(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/collection/cards/${encodeURIComponent(cardId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Cardkeeper-Request": "same-origin",
        },
        body: JSON.stringify({ printing, condition, quantity: parsedQuantity }),
      });
      const payload = (await response.json()) as SaveResponse;

      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? "Unable to update the collection.");
      }

      setHoldings((current) => [
        ...current.filter(
          (holding) =>
            !(holding.printing === payload.item?.printing && holding.condition === payload.item?.condition),
        ),
        payload.item!,
      ]);
      setIsError(false);
      setMessage(selectedHolding ? "Collection quantity updated." : "Card added to your collection.");
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Unable to update the collection.");
    } finally {
      setIsPending(false);
    }
  }

  async function handleRemove() {
    if (!selectedHolding) return;
    setIsPending(true);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/collection/${encodeURIComponent(selectedHolding.variantId)}`,
        {
          method: "DELETE",
          headers: { "X-Cardkeeper-Request": "same-origin" },
        },
      );

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to remove the card.");
      }

      setHoldings((current) =>
        current.filter((holding) => holding.variantId !== selectedHolding.variantId),
      );
      setQuantity("1");
      setIsError(false);
      setMessage("Card removed from your collection.");
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Unable to remove the card.");
    } finally {
      setIsPending(false);
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="collection-control-card">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Collection</p>
        <h2 className="mt-2 font-bold">Keep track of this card</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Sign in before adding cards so your quantities and conditions stay private.
        </p>
        <Link
          className="auth-submit mt-5 inline-flex w-full items-center justify-center"
          href={`/login?next=${encodeURIComponent(`/cards/${cardId}`)}`}
        >
          Sign in to add
        </Link>
      </div>
    );
  }

  return (
    <form className="collection-control-card" onSubmit={handleSave}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Collection</p>
          <h2 className="mt-2 font-bold">{selectedHolding ? `You own ${selectedHolding.quantity}` : "Add this card"}</h2>
        </div>
        {marketPrice !== null ? (
          <span className="rounded-full border border-[var(--line)] bg-[rgb(143_183_255_/_10%)] px-3 py-1 text-sm font-bold text-[var(--secondary)]">
            {usd.format(marketPrice)}
          </span>
        ) : null}
      </div>

      <label className="mt-5 block">
        <span className="auth-label">Finish</span>
        <FieldSelect
          label="Finish"
          options={printings}
          value={printing}
          onValueChange={(nextPrinting) => updateSelection(nextPrinting, condition)}
        />
      </label>

      <label className="mt-4 block">
        <span className="auth-label">Condition</span>
        <FieldSelect
          label="Condition"
          options={CARD_CONDITIONS}
          value={condition}
          onValueChange={(nextCondition) => updateSelection(printing, nextCondition)}
        />
      </label>

      <label className="mt-4 block">
        <span className="auth-label">Quantity</span>
        <input
          className="auth-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={9999}
          step={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          required
        />
      </label>

      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
        The marketplace price reflects finish, but the Pokemon TCG API does not provide condition-specific prices.
      </p>

      {message ? (
        <p className={isError ? "auth-message-error mt-4" : "auth-message-success mt-4"} aria-live="polite">
          {message}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-2">
        <button className="auth-submit" type="submit" disabled={isPending}>
          {isPending ? "Saving…" : selectedHolding ? "Update quantity" : "Add to collection"}
        </button>
        {selectedHolding ? (
          <button
            className="cursor-pointer rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold text-[var(--danger)] hover:border-[var(--danger)]"
            type="button"
            onClick={handleRemove}
            disabled={isPending}
          >
            Remove this variant
          </button>
        ) : null}
      </div>
    </form>
  );
}
