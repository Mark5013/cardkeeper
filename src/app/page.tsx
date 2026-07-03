import { CardSearch } from "@/components/card-search";
import { SiteHeader } from "@/components/site-header";

const milestones = [
  {
    label: "Catalog",
    value: "Local search",
    detail: "Imported English catalog",
  },
  {
    label: "Collection",
    value: "Private binder",
    detail: "Finish, condition, and quantity",
  },
  {
    label: "Pricing",
    value: "Market snapshots",
    detail: "History tables are ready",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />

      <SiteHeader />

      <section id="top" className="mx-auto w-full max-w-6xl px-6 pb-20 pt-12 lg:px-8 lg:pt-20">
        <div className="max-w-3xl">
          <p className="eyebrow">Your collection, finally organized</p>
          <h1 className="mt-5 text-balance text-5xl font-bold leading-[0.98] text-[var(--ink)] sm:text-7xl">
            Know every card.<br />Know what it&apos;s worth.
          </h1>
          <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-[var(--muted)] sm:text-xl">
            Search the imported Pokemon TCG catalog, open detailed card pages, and keep a private collection with finish, condition, quantity, and estimated value tracking.
          </p>
        </div>

        <div className="mt-12">
          <CardSearch />
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {milestones.map((milestone) => (
            <article key={milestone.label} className="status-card">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
                {milestone.label}
              </p>
              <p className="mt-3 font-semibold text-[var(--ink)]">{milestone.value}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{milestone.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-[var(--line)] px-6 py-6 text-center text-xs text-[var(--muted)]">
        Cardkeeper is an independent project and is not affiliated with Nintendo, The Pokemon Company, or Game Freak.
      </footer>
    </main>
  );
}
