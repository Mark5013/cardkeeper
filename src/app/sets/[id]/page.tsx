import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { SetCardsBrowser } from "@/components/set-cards-browser";
import { SiteHeader } from "@/components/site-header";
import { getPokemonCardsBySetPage, getPokemonSet } from "@/lib/pokemon-tcg/client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const set = await getPokemonSet(id);

  if (!set) return { title: "Set not found" };

  return {
    title: `${set.name} cards`,
    description: `Browse Pokemon cards from ${set.name}.`,
  };
}

export default async function SetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();

  const { id } = await params;
  const set = await getPokemonSet(id);

  if (!set) notFound();

  let cards = null;
  let unavailable = false;

  try {
    cards = await getPokemonCardsBySetPage({ setId: set.id });
  } catch (error) {
    console.error("Set cards page failed", { setId: id, error });
    unavailable = true;
  }

  return (
    <main className="min-h-screen overflow-x-hidden">
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-8">
        <Link className="text-sm font-semibold text-[var(--secondary)] hover:underline" href="/sets">
          Back to sets
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="eyebrow">{set.series}</p>
            <h1 className="mt-4 text-4xl font-bold sm:text-5xl">{set.name}</h1>
            <p className="mt-4 text-lg text-[var(--muted)]">
              {set.total.toLocaleString()} cards · Released {set.releaseDate}
            </p>
          </div>
          {set.images?.logo ? (
            <div className="relative h-20 w-48 shrink-0">
              <Image src={set.images.logo} alt="" fill sizes="192px" className="object-contain" />
            </div>
          ) : null}
        </div>

        {unavailable ? (
          <div className="mt-10 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-7">
            <h2 className="font-bold">The cards in this set are temporarily unavailable.</h2>
            <p className="mt-2 text-[var(--muted)]">Please try this set again in a moment.</p>
          </div>
        ) : null}

        {cards ? <SetCardsBrowser key={set.id} setId={set.id} initialResult={cards} /> : null}
      </section>
    </main>
  );
}
