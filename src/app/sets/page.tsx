import type { Metadata } from "next";
import Link from "next/link";

import { SetsBrowser } from "@/components/sets-browser";
import { SiteHeader } from "@/components/site-header";
import { getCatalogPokemonSets } from "@/lib/catalog/data";
import type { PokemonTcgSet } from "@/lib/pokemon-tcg/types";

export const metadata: Metadata = {
  title: "Search by set",
  description: "Browse Pokemon cards by set.",
};

export default async function SetsPage() {
  let sets: PokemonTcgSet[] | null = null;
  let unavailable = false;

  try {
    sets = await getCatalogPokemonSets();
  } catch (error) {
    unavailable = true;
    console.error("Set catalog page failed", error);
  }

  return (
    <main className="min-h-screen overflow-x-hidden">
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-8">
        <p className="eyebrow">Set browser</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-4xl font-bold sm:text-5xl">Search by set</h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              Pick a Pokemon TCG set to view every card currently available from the catalog.
            </p>
          </div>
          <Link className="auth-submit inline-flex items-center justify-center" href="/">
            Search cards
          </Link>
        </div>

        {unavailable ? (
          <div className="mt-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-7">
            <h2 className="font-bold">The set catalog is temporarily unavailable.</h2>
            <p className="mt-2 text-[var(--muted)]">Please try browsing sets again in a moment.</p>
          </div>
        ) : null}

        {sets ? <SetsBrowser sets={sets} /> : null}
      </section>
    </main>
  );
}
