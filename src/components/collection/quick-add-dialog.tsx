"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { FieldSelect } from "@/components/ui/field-select";
import { CARD_CONDITIONS } from "@/lib/collection/options";
import type { OwnedCardVariantDto } from "@/lib/collection/types";
import type { CardSearchResult } from "@/lib/pokemon-tcg/types";

type SaveResponse = {
  item?: OwnedCardVariantDto;
  error?: string;
};

type AuthStatusResponse = {
  authenticated?: boolean;
};

function getCurrentPath() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function QuickAddDialog({
  card,
  open,
  onClose,
}: {
  card: CardSearchResult;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [printing, setPrinting] = useState(card.printings[0]?.value ?? "normal");
  const [condition, setCondition] = useState("near_mint");
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    let active = true;

    async function loadAuthStatus() {
      try {
        const response = await fetch("/api/auth/status", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const payload = (await response.json()) as AuthStatusResponse;
        if (active) setIsAuthenticated(Boolean(response.ok && payload.authenticated));
      } catch {
        if (active) setIsAuthenticated(false);
      }
    }

    void loadAuthStatus();

    return () => {
      active = false;
    };
  }, [card.id, card.printings, open]);

  if (!open) return null;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedQuantity = Number(quantity);

    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 9999) {
      setIsError(true);
      setMessage("Copies must be a whole number between 1 and 9999.");
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/collection/cards/${encodeURIComponent(card.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Cardkeeper-Request": "same-origin",
        },
        body: JSON.stringify({
          printing,
          condition,
          quantity: parsedQuantity,
          operation: "increment",
        }),
      });
      const payload = (await response.json()) as SaveResponse;

      if (response.status === 401) {
        setIsAuthenticated(false);
        throw new Error("Sign in before adding cards to your collection.");
      }

      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? "Unable to add this card.");
      }

      setIsError(false);
      setMessage(
        `Collection now has ${payload.item.quantity.toLocaleString()} ${
          payload.item.quantity === 1 ? "copy" : "copies"
        } for this variant.`,
      );
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Unable to add this card.");
    } finally {
      setIsSaving(false);
    }
  }

  const selectedPrinting = card.printings.find((option) => option.value === printing) ?? card.printings[0];
  const loginPath = `/login?next=${encodeURIComponent(getCurrentPath())}`;

  return (
    <div className="quick-add-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="quick-add-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`quick-add-title-${card.id}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
              Add to collection
            </p>
            <h2 id={`quick-add-title-${card.id}`} className="mt-2 text-xl font-bold">
              {card.name}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {card.set.name} - #{card.number}
            </p>
          </div>
          <button className="quick-add-close" type="button" onClick={onClose} aria-label="Close quick add">
            x
          </button>
        </div>

        {isAuthenticated === null ? (
          <div className="mt-6 flex items-center gap-3 text-sm font-semibold text-[var(--muted)]" aria-live="polite">
            <span className="search-loading-spinner" aria-hidden="true" />
            Checking account
          </div>
        ) : isAuthenticated ? (
          <form className="mt-6" onSubmit={handleSave}>
            <label className="block">
              <span className="auth-label">Finish</span>
              <FieldSelect
                label="Finish"
                options={card.printings}
                value={printing}
                onValueChange={setPrinting}
              />
            </label>

            <label className="mt-4 block">
              <span className="auth-label">Condition</span>
              <FieldSelect
                label="Condition"
                options={CARD_CONDITIONS}
                value={condition}
                onValueChange={setCondition}
              />
            </label>

            <label className="mt-4 block">
              <span className="auth-label">Copies to add</span>
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
              This adds to any copies already saved for {selectedPrinting?.label ?? "this finish"} in the selected condition.
            </p>

            {message ? (
              <p className={isError ? "auth-message-error mt-4" : "auth-message-success mt-4"} aria-live="polite">
                {message}
              </p>
            ) : null}

            <button className="auth-submit mt-5 w-full" type="submit" disabled={isSaving}>
              {isSaving ? "Adding..." : "Add to collection"}
            </button>
          </form>
        ) : (
          <div className="mt-6">
            <p className="text-sm leading-6 text-[var(--muted)]">
              Sign in before adding cards so your quantities, finishes, and conditions stay private.
            </p>
            <Link className="auth-submit mt-5 inline-flex w-full items-center justify-center" href={loginPath}>
              Sign in to add
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
