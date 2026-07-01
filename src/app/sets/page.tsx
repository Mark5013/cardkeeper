import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";

import { SiteHeader } from "@/components/site-header";
import { getPokemonSets } from "@/lib/pokemon-tcg/client";

export const metadata: Metadata = {
  title: "Search by set",
  description: "Browse Pokemon cards by set.",
};

export default async function SetsPage() {
  await connection();

  let sets = null;
  let unavailable = false;

  try {
    sets = await getPokemonSets();
  } catch (error) {
    console.error("Set catalog page failed", error);
    unavailable = true;
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

        {sets ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((set) => (
              <Link
                className="group flex min-h-36 flex-col justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 transition duration-200 hover:-translate-y-1 hover:border-[var(--secondary)]"
                href={`/sets/${encodeURIComponent(set.id)}`}
                key={set.id}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
                      {set.series}
                    </p>
                    <h2 className="mt-2 text-xl font-bold">{set.name}</h2>
                  </div>
                  {set.images?.symbol ? (
                    <span className="relative size-10 shrink-0">
                      <Image
                        src={set.images.symbol}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-contain"
                      />
                    </span>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
                  <span>{set.total.toLocaleString()} cards</span>
                  <span>{set.releaseDate}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
