import Link from "next/link";

import { ImageWithFallback } from "@/components/image-with-fallback";
import type { CardSearchResult } from "@/lib/pokemon-tcg/types";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function CardResultGrid({
  cards,
  onCardNavigate,
}: {
  cards: CardSearchResult[];
  onCardNavigate?: () => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Link
          className="group overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] transition duration-200 hover:-translate-y-1 hover:border-[var(--secondary)]"
          href={`/cards/${encodeURIComponent(card.id)}`}
          key={card.id}
          onClick={onCardNavigate}
          prefetch={false}
        >
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-5 p-5">
            <div className="relative aspect-[245/342] overflow-hidden rounded-md bg-[var(--surface-2)] shadow-[0_12px_28px_rgb(0_0_0_/_28%)]">
              <ImageWithFallback
                src={card.imageSmallUrl}
                alt={`${card.name} card`}
                fill
                sizes="112px"
                className="object-cover transition duration-300 group-hover:scale-[1.03]"
              />
            </div>
            <div className="min-w-0 self-center">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
                {card.rarity ?? "Pokemon card"}
              </p>
              <h2 className="mt-2 text-xl font-bold text-[var(--ink)]">{card.name}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {card.set.name}<br />#{card.number}
              </p>
              <p className="mt-4 font-bold text-[var(--secondary)]">
                {card.startingPriceUsd === null ? "No current price" : `From ${usd.format(card.startingPriceUsd)}`}
              </p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
