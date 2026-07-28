function LoadingSealedSetCard() {
  return (
    <div className="flex min-h-36 flex-col justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
      <div>
        <div className="h-3 w-24 rounded-full bg-[var(--surface-2)]" />
        <div className="mt-4 h-6 w-48 max-w-full rounded-full bg-[var(--surface-2)]" />
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <div className="h-4 w-20 rounded-full bg-[var(--surface-2)]" />
        <div className="h-4 w-24 rounded-full bg-[var(--surface-2)]" />
      </div>
    </div>
  );
}

export default function SealedSetsLoading() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-lg text-[var(--secondary)]">
            C
          </span>
          <span className="text-lg font-bold">Cardkeeper</span>
        </div>
        <div className="hidden h-9 w-64 rounded-lg bg-[var(--surface-2)] sm:block" />
      </header>

      <section
        aria-busy="true"
        className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-8"
      >
        <p className="eyebrow">Sealed catalog</p>
        <div className="mt-4 h-12 w-[36rem] max-w-full rounded-full bg-[var(--surface-2)]" />
        <div className="mt-5 flex items-center gap-3 text-sm font-semibold text-[var(--muted)]">
          <span className="search-loading-spinner" aria-hidden="true" />
          Loading English and Japanese sealed sets
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }, (_, index) => (
            <LoadingSealedSetCard key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
