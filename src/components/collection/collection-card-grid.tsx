import Image from "next/image";
import Link from "next/link";

import { CARD_CONDITIONS } from "@/lib/collection/options";
import type { CollectionItemDto } from "@/lib/collection/types";
import { formatPrinting } from "@/lib/pokemon-tcg/printing";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatCondition(condition: string) {
  return CARD_CONDITIONS.find((option) => option.value === condition)?.label ?? condition;
}

export function CollectionCardGrid({ items }: { items: CollectionItemDto[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Link
          className="group overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] transition duration-200 hover:-translate-y-1 hover:border-[var(--secondary)]"
          href={`/cards/${encodeURIComponent(item.providerCardId)}`}
          key={item.id}
        >
          <div className="relative aspect-[4/3] overflow-hidden bg-[var(--surface-2)]">
            {item.imageSmallUrl ? (
              <Image
                src={item.imageSmallUrl}
                alt={`${item.cardName} card`}
                fill
                sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, (max-width: 1280px) 30vw, 22vw"
                className="object-contain p-5 transition duration-300 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="grid h-full place-items-center text-xs text-[var(--muted)]">No card image</div>
            )}
            <span className="absolute right-3 top-3 rounded-full border border-[var(--line)] bg-[var(--background)] px-2.5 py-0.5 text-xs font-bold text-[var(--ink)] shadow-[0_10px_24px_rgb(0_0_0_/_28%)]">
              × {item.quantity}
            </span>
          </div>

          <div className="p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
              {item.setName} · #{item.cardNumber}
            </p>
            <h2 className="mt-1.5 text-base font-bold leading-6">{item.cardName}</h2>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="collection-pill">{formatPrinting(item.printing)}</span>
              <span className="collection-pill">{formatCondition(item.condition)}</span>
            </div>

            <div className="mt-4 flex items-end justify-between gap-3 border-t border-[var(--line)] pt-3">
              <div>
                <p className="text-[0.68rem] text-[var(--muted)]">Market each</p>
                <p className="mt-1 text-sm font-semibold">
                  {item.unitPriceUsd === null ? "No price" : usd.format(item.unitPriceUsd)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[0.68rem] text-[var(--muted)]">Estimated value</p>
                <p className="mt-1 text-base font-bold text-[var(--secondary)]">
                  {item.estimatedValueUsd === null ? "—" : usd.format(item.estimatedValueUsd)}
                </p>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
