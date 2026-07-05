import { SiteHeader } from "@/components/site-header";

function LoadingLine({ className = "" }: { className?: string }) {
  return <div className={`rounded-full bg-[var(--surface-2)] ${className}`} />;
}

export default function CardDetailLoading() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />

      <article className="mx-auto w-full max-w-6xl px-6 pb-24 pt-6 lg:px-8" aria-label="Loading card details">
        <LoadingLine className="h-4 w-36" />

        <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(17rem,25rem)_minmax(0,1fr)] lg:gap-16">
          <div>
            <div className="mx-auto aspect-[245/342] w-full max-w-[25rem] rounded-lg bg-[var(--surface-2)] shadow-[0_24px_60px_rgb(0_0_0_/_34%)]" />
            <div className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
              <LoadingLine className="h-3 w-28" />
              <LoadingLine className="mt-5 h-11 w-full rounded-lg" />
              <LoadingLine className="mt-3 h-11 w-full rounded-lg" />
            </div>
          </div>

          <div className="min-w-0">
            <LoadingLine className="h-4 w-32" />
            <LoadingLine className="mt-5 h-12 w-3/4" />
            <LoadingLine className="mt-5 h-5 w-1/2" />

            <div className="mt-7 flex flex-wrap gap-2">
              <LoadingLine className="h-8 w-20" />
              <LoadingLine className="h-8 w-24" />
              <LoadingLine className="h-8 w-28" />
            </div>

            <section className="detail-section">
              <LoadingLine className="h-7 w-44" />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="border-t border-[var(--line)] py-3" key={index}>
                    <LoadingLine className="h-3 w-24" />
                    <LoadingLine className="mt-3 h-5 w-36" />
                  </div>
                ))}
              </div>
            </section>

            <section className="detail-section">
              <LoadingLine className="h-7 w-36" />
              <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
                <LoadingLine className="h-4 w-full" />
                <LoadingLine className="mt-4 h-4 w-5/6" />
                <LoadingLine className="mt-4 h-4 w-2/3" />
              </div>
            </section>
          </div>
        </div>
      </article>
    </main>
  );
}
