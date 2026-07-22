import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CollectionBrowser } from "@/components/collection/collection-browser";
import { CollectionValueHistoryChart } from "@/components/collection/collection-value-history-chart";
import { SiteHeader } from "@/components/site-header";
import { getCatalogPokemonSets } from "@/lib/catalog/data";
import {
  getCurrentCollection,
  getCurrentCollectionValueHistory,
} from "@/lib/collection/data";
import { formatPrinting } from "@/lib/pokemon-tcg/printing";

export const metadata: Metadata = { title: "My collection" };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const COLLECTION_PAGE_SIZE = 24;

export default async function CollectionPage() {
  const [collection, collectionValueHistory] = await Promise.all([
    getCurrentCollection(),
    getCurrentCollectionValueHistory(),
  ]);
  if (!collection) redirect("/login?next=/collection");
  const collectionPage =
    collection.items.length > 0
      ? await getCurrentCollection({ page: 1, pageSize: COLLECTION_PAGE_SIZE })
      : collection;
  const setOptions =
    collection.items.length > 0
      ? (await getCatalogPokemonSets()).map((set) => ({ id: set.id, name: set.name }))
      : [];
  const finishOptions = Array.from(
    new Map(
      collection.items.map((item) => [
        item.printing,
        { id: item.printing, name: formatPrinting(item.printing) },
      ]),
    ).values(),
  ).sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
  const conditionOptions = Array.from(
    new Map(
      collection.items.map((item) => [
        item.condition,
        { id: item.condition, name: item.condition },
      ]),
    ).values(),
  );

  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-10 lg:px-8">
        <p className="eyebrow">Private collection</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-4xl font-bold sm:text-5xl">My collection</h1>
            <p className="mt-4 text-lg text-[var(--muted)]">Only you can view and change these records.</p>
          </div>
          <Link className="auth-submit inline-flex items-center justify-center" href="/">
            Find cards
          </Link>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <article className="account-card">
            <p className="account-label">Unique cards</p>
            <p className="mt-2 text-3xl font-bold">{collection.uniqueCards}</p>
          </article>
          <article className="account-card">
            <p className="account-label">Total cards</p>
            <p className="mt-2 text-3xl font-bold">{collection.totalCopies}</p>
          </article>
          <article className="account-card">
            <p className="account-label">Estimated value</p>
            <p className="mt-2 text-3xl font-bold">{usd.format(collection.estimatedValueUsd)}</p>
            {collection.unpricedVariants > 0 ? (
              <p className="mt-1 text-xs text-[var(--muted)]">{collection.unpricedVariants} unpriced {collection.unpricedVariants === 1 ? "variant" : "variants"}</p>
            ) : null}
          </article>
        </div>

        {collection.items.length > 0 ? (
          <section className="mt-10" aria-labelledby="collection-value-history-heading">
            <p className="text-sm font-semibold text-[var(--accent)]">Market history</p>
            <h2 className="mt-1 text-2xl font-bold" id="collection-value-history-heading">
              Collection value history
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Historical market value of the cards you own now. Adding or removing a card
              recalculates the full chart.
            </p>
            <CollectionValueHistoryChart
              history={
                collectionValueHistory ?? {
                  points: [],
                  pricedVariants: 0,
                  totalVariants: collection.uniqueVariants,
                }
              }
            />
          </section>
        ) : null}

        {collection.items.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-16 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">A clean binder</p>
            <h2 className="mt-3 text-2xl font-bold">Your collection is empty</h2>
            <p className="mx-auto mt-3 max-w-md leading-7 text-[var(--muted)]">
              Search the catalog, open a card, choose its finish and condition, then add the quantity you own.
            </p>
            <Link className="mt-6 inline-flex font-semibold text-[var(--secondary)] hover:underline" href="/">
              Search for your first card →
            </Link>
          </div>
        ) : (
          <CollectionBrowser
            initialItems={collectionPage?.items ?? []}
            setOptions={setOptions}
            initialPage={collectionPage?.page ?? 1}
            pageSize={collectionPage?.pageSize ?? COLLECTION_PAGE_SIZE}
            totalItems={collectionPage?.totalItems ?? collection.uniqueVariants}
            initialHasNextPage={collectionPage?.hasNextPage ?? false}
            finishOptions={finishOptions}
            conditionOptions={conditionOptions}
          />
        )}
      </section>
    </main>
  );
}
