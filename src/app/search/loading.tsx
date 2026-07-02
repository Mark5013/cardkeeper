import { CardSearch } from "@/components/card-search";
import { SiteHeader } from "@/components/site-header";

function LoadingCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-5 p-5">
        <div className="aspect-[245/342] rounded-md bg-[var(--surface-2)]" />
        <div className="self-center">
          <div className="h-3 w-24 rounded-full bg-[var(--surface-2)]" />
          <div className="mt-4 h-5 w-36 rounded-full bg-[var(--surface-2)]" />
          <div className="mt-4 h-3 w-28 rounded-full bg-[var(--surface-2)]" />
          <div className="mt-5 h-4 w-20 rounded-full bg-[var(--surface-2)]" />
        </div>
      </div>
    </div>
  );
}

export default function SearchLoading() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-8">
        <p className="eyebrow">Catalog results</p>
        <div className="mt-5 h-12 max-w-md rounded-full bg-[var(--surface-2)]" />

        <div className="mt-8">
          <CardSearch />
        </div>

        <div className="mt-12">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="h-4 w-28 rounded-full bg-[var(--surface-2)]" />
              <div className="mt-3 h-7 w-44 rounded-full bg-[var(--surface-2)]" />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <LoadingCard key={index} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
