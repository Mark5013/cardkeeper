import type { Metadata } from "next";

import { SealedSetsBrowser } from "@/components/sealed-sets-browser";
import { SiteHeader } from "@/components/site-header";
import {
  getSealedCatalogSets,
  type SealedCatalogSet,
} from "@/lib/catalog/sealed-data";

export const metadata: Metadata = {
  title: "Sealed sets",
  description:
    "Browse English and Japanese sealed Pokémon TCG products grouped by set.",
};

export default async function SealedSetsPage() {
  let sets: SealedCatalogSet[] | null = null;
  let unavailable = false;

  try {
    sets = await getSealedCatalogSets();
  } catch (error) {
    unavailable = true;
    console.error("Sealed set catalog page failed", error);
  }

  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-8">
        <p className="eyebrow">Sealed catalog</p>
        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
          English and Japanese sealed sets
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--muted)]">
          Browse boxes, packs, tins, collections, and other physical sealed
          Pokémon TCG products grouped by their TCGplayer set.
        </p>

        {unavailable ? (
          <div className="mt-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-7">
            <h2 className="font-bold">
              The sealed set catalog is temporarily unavailable.
            </h2>
            <p className="mt-2 text-[var(--muted)]">
              Please try browsing sealed sets again in a moment.
            </p>
          </div>
        ) : null}

        {sets ? <SealedSetsBrowser sets={sets} /> : null}
      </section>
    </main>
  );
}
