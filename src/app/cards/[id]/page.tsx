import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ImageWithFallback } from "@/components/image-with-fallback";
import { PriceHistoryChart } from "@/components/price-history-chart";
import { SiteHeader } from "@/components/site-header";
import { CollectionControls } from "@/components/collection/collection-controls";
import { getCatalogPokemonCard, getCatalogPokemonCardPriceHistory } from "@/lib/catalog/data";
import { getOwnedCardVariants } from "@/lib/collection/data";
import { getCardPrintingOptions } from "@/lib/pokemon-tcg/printing";
import type { PokemonTcgCard, PokemonTcgPrice } from "@/lib/pokemon-tcg/types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const eur = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" });

function titleCase(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayPrice(price: number | undefined, formatter = usd) {
  return typeof price === "number" ? formatter.format(price) : "—";
}

function getSafeExternalUrl(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildEbaySearchUrl(card: PokemonTcgCard) {
  const url = new URL("https://www.ebay.com/sch/i.html");
  url.searchParams.set("_nkw", `${card.name} ${card.set.name} ${card.number} Pokemon TCG card`);
  return url.toString();
}

function ListingLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="auth-submit inline-flex min-h-11 items-center justify-center"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  );
}

function PriceRow({ name, price }: { name: string; price: PokemonTcgPrice }) {
  return (
    <tr className="border-t border-[var(--line)]">
      <th className="py-3 pr-4 text-left font-semibold">{titleCase(name)}</th>
      <td className="px-3 py-3 text-right">{displayPrice(price.low)}</td>
      <td className="px-3 py-3 text-right font-bold text-[var(--secondary)]">{displayPrice(price.market)}</td>
      <td className="pl-3 py-3 text-right">{displayPrice(price.high)}</td>
    </tr>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const card = await getCatalogPokemonCard(id);

  if (!card) return { title: "Card not found" };

  return {
    title: `${card.name} #${card.number}`,
    description: `${card.name} from ${card.set.name}, card number ${card.number}.`,
  };
}

export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await getCatalogPokemonCard(id);

  if (!card) notFound();

  const ownedVariants = await getOwnedCardVariants(card.id);
  const priceHistory = await getCatalogPokemonCardPriceHistory(card.id);
  const printings = getCardPrintingOptions(card);
  const tcgplayerPrices = Object.entries(card.tcgplayer?.prices ?? {});
  const tcgplayerUrl = getSafeExternalUrl(card.tcgplayer?.url);
  const ebayUrl = buildEbaySearchUrl(card);
  const details = [
    ["Set", card.set.name],
    ["Series", card.set.series],
    ["Card number", `#${card.number}${card.set.printedTotal ? ` / ${card.set.printedTotal}` : ""}`],
    ["Rarity", card.rarity],
    ["Illustrator", card.artist],
    ["Release date", card.set.releaseDate],
    ["Regulation mark", card.regulationMark],
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));

  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />

      <article className="mx-auto w-full max-w-6xl px-6 pb-24 pt-6 lg:px-8">
        <Link className="text-sm font-semibold text-[var(--secondary)] hover:underline" href={`/sets/${encodeURIComponent(card.set.id)}`}>
          {card.set.name}
        </Link>

        <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(17rem,25rem)_minmax(0,1fr)] lg:gap-16">
          <div>
            <div className="relative mx-auto aspect-[245/342] w-full max-w-[25rem] overflow-hidden rounded-lg bg-[var(--surface-2)] shadow-[0_24px_60px_rgb(0_0_0_/_34%)]">
              <ImageWithFallback
                src={card.images.large}
                alt={`${card.name} card from ${card.set.name}`}
                fill
                priority
                sizes="(max-width: 1024px) 90vw, 400px"
                className="object-cover"
              />
            </div>

            <div className="mt-6">
              <CollectionControls
                cardId={card.id}
                printings={printings}
                initialHoldings={ownedVariants ?? []}
                isAuthenticated={ownedVariants !== null}
              />
            </div>

            <section className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Listings</p>
              <h2 className="mt-2 font-bold">Find this card</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Compare live marketplace listings before buying or valuing your copy.
              </p>
              <div className="mt-5 grid gap-2">
                {tcgplayerUrl ? (
                  <ListingLink href={tcgplayerUrl} label="TCGplayer listings" />
                ) : (
                  <p className="rounded-lg border border-dashed border-[var(--line)] px-4 py-3 text-sm text-[var(--muted)]">
                    TCGplayer listings are not available for this card.
                  </p>
                )}
                <ListingLink href={ebayUrl} label="eBay listings" />
              </div>
            </section>
          </div>

          <div className="min-w-0">
            <p className="eyebrow">{card.supertype ?? "Pokemon card"}</p>
            <h1 className="mt-4 text-5xl font-bold sm:text-6xl">{card.name}</h1>
            <p className="mt-4 text-lg text-[var(--muted)]">
              {card.set.name} · #{card.number}{card.rarity ? ` · ${card.rarity}` : ""}
            </p>

            <div className="mt-7 flex flex-wrap gap-2">
              {card.hp ? <span className="detail-pill">{card.hp} HP</span> : null}
              {card.types?.map((type) => <span className="detail-pill" key={type}>{type}</span>)}
              {card.subtypes?.map((subtype) => <span className="detail-pill" key={subtype}>{subtype}</span>)}
            </div>

            {card.flavorText ? (
              <blockquote className="mt-8 border-l-2 border-[var(--accent)] pl-5 text-lg italic leading-8 text-[var(--muted)]">
                {card.flavorText}
              </blockquote>
            ) : null}

            <section className="detail-section">
              <h2 className="detail-heading">Card information</h2>
              <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
                {details.map(([label, value]) => (
                  <div className="border-t border-[var(--line)] py-3" key={label}>
                    <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{label}</dt>
                    <dd className="mt-1 font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="detail-section">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="detail-heading">Market prices</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">General marketplace prices, not yet condition-specific.</p>
                </div>
                {card.tcgplayer?.updatedAt ? <p className="text-xs text-[var(--muted)]">Updated {card.tcgplayer.updatedAt}</p> : null}
              </div>

              {tcgplayerPrices.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-sm">
                    <thead className="text-xs uppercase tracking-[0.1em] text-[var(--muted)]">
                      <tr><th className="pb-3 text-left">Printing</th><th className="px-3 pb-3 text-right">Low</th><th className="px-3 pb-3 text-right">Market</th><th className="pb-3 pl-3 text-right">High</th></tr>
                    </thead>
                    <tbody>{tcgplayerPrices.map(([name, price]) => <PriceRow key={name} name={name} price={price} />)}</tbody>
                  </table>
                </div>
              ) : <p className="mt-4 text-[var(--muted)]">No current TCGplayer prices are available.</p>}

              {card.cardmarket ? (
                <div className="mt-5 flex flex-wrap gap-x-7 gap-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm">
                  <span>Cardmarket trend: <strong>{displayPrice(card.cardmarket.prices.trendPrice, eur)}</strong></span>
                  <span>30-day average: <strong>{displayPrice(card.cardmarket.prices.avg30, eur)}</strong></span>
                </div>
              ) : null}
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">Price history</h2>
              <PriceHistoryChart series={priceHistory} />
            </section>

            {card.abilities?.length ? (
              <section className="detail-section">
                <h2 className="detail-heading">Abilities</h2>
                <div className="mt-4 space-y-4">
                  {card.abilities.map((ability) => (
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5" key={ability.name}>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">{ability.type}</p>
                      <h3 className="mt-1 font-bold">{ability.name}</h3>
                      <p className="mt-2 leading-7 text-[var(--muted)]">{ability.text}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {card.attacks?.length ? (
              <section className="detail-section">
                <h2 className="detail-heading">Attacks</h2>
                <div className="mt-4 space-y-4">
                  {card.attacks.map((attack) => (
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5" key={attack.name}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold text-[var(--muted)]">{attack.cost.join(" · ") || "No energy cost"}</p>
                          <h3 className="mt-1 font-bold">{attack.name}</h3>
                        </div>
                        {attack.damage ? <span className="text-xl font-bold text-[var(--accent)]">{attack.damage}</span> : null}
                      </div>
                      {attack.text ? <p className="mt-3 leading-7 text-[var(--muted)]">{attack.text}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {(card.weaknesses?.length || card.resistances?.length || card.retreatCost?.length) ? (
              <section className="detail-section">
                <h2 className="detail-heading">Battle details</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div className="detail-stat"><span>Weakness</span><strong>{card.weaknesses?.map((item) => `${item.type} ${item.value}`).join(", ") || "—"}</strong></div>
                  <div className="detail-stat"><span>Resistance</span><strong>{card.resistances?.map((item) => `${item.type} ${item.value}`).join(", ") || "—"}</strong></div>
                  <div className="detail-stat"><span>Retreat</span><strong>{card.retreatCost?.join(" · ") || "None"}</strong></div>
                </div>
              </section>
            ) : null}

            {card.rules?.length ? (
              <section className="detail-section">
                <h2 className="detail-heading">Rules</h2>
                <ul className="mt-4 space-y-2 text-[var(--muted)]">
                  {card.rules.map((rule) => <li key={rule}>• {rule}</li>)}
                </ul>
              </section>
            ) : null}

          </div>
        </div>
      </article>
    </main>
  );
}
