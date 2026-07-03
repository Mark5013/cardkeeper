import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CollectionBrowser } from "@/components/collection/collection-browser";
import { SiteHeader } from "@/components/site-header";
import { getCatalogPokemonSets } from "@/lib/catalog/data";
import { getCurrentCollection } from "@/lib/collection/data";

export const metadata: Metadata = { title: "My collection" };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const COLLECTION_PAGE_SIZE = 24;

export default async function CollectionPage() {
  const collection = await getCurrentCollection();
  if (!collection) redirect("/login?next=/collection");
  const collectionPage =
    collection.items.length > 0
      ? await getCurrentCollection({ page: 1, pageSize: COLLECTION_PAGE_SIZE })
      : collection;
  const setOptions =
    collection.items.length > 0
      ? (await getCatalogPokemonSets()).map((set) => ({ id: set.id, name: set.name }))
      : [];

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
          />
        )}
      </section>
    </main>
  );
}
