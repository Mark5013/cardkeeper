function LoadingCollectionCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="aspect-[4/3] bg-[var(--surface-2)]" />
      <div className="p-4">
        <div className="h-3 w-32 rounded-full bg-[var(--surface-2)]" />
        <div className="mt-4 h-5 w-40 max-w-full rounded-full bg-[var(--surface-2)]" />
        <div className="mt-4 flex gap-2">
          <div className="h-6 w-20 rounded-full bg-[var(--surface-2)]" />
          <div className="h-6 w-24 rounded-full bg-[var(--surface-2)]" />
        </div>
        <div className="mt-5 flex justify-between gap-4 border-t border-[var(--line)] pt-4">
          <div className="h-8 w-20 rounded-full bg-[var(--surface-2)]" />
          <div className="h-8 w-24 rounded-full bg-[var(--surface-2)]" />
        </div>
      </div>
    </div>
  );
}

export default function CollectionLoading() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-lg text-[var(--secondary)]">
            C
          </span>
          <span className="text-lg font-bold">Cardkeeper</span>
        </div>
        <div className="hidden h-9 w-64 rounded-lg bg-[var(--surface-2)] sm:block" />
      </header>

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-10 lg:px-8">
        <p className="eyebrow">Private collection</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="h-12 w-72 max-w-full rounded-full bg-[var(--surface-2)]" />
            <div className="mt-5 flex items-center gap-3 text-sm font-semibold text-[var(--muted)]">
              <span className="search-loading-spinner" aria-hidden="true" />
              Loading your collection
            </div>
          </div>
          <div className="h-12 w-28 rounded-lg bg-[var(--surface-2)]" />
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="account-card" key={index}>
              <div className="h-3 w-24 rounded-full bg-[var(--surface-2)]" />
              <div className="mt-4 h-8 w-28 rounded-full bg-[var(--surface-2)]" />
            </div>
          ))}
        </div>

        <div className="mt-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="h-4 w-24 rounded-full bg-[var(--surface-2)]" />
              <div className="mt-3 h-7 w-32 rounded-full bg-[var(--surface-2)]" />
            </div>
            <div className="h-11 w-64 rounded-lg bg-[var(--surface-2)]" />
          </div>

          <div className="collection-filter-panel">
            <div className="collection-filter-grid">
              <div>
                <div className="h-3 w-24 rounded-full bg-[var(--surface-2)]" />
                <div className="mt-3 h-12 rounded-lg bg-[var(--surface-2)]" />
              </div>
              <div>
                <div className="h-3 w-14 rounded-full bg-[var(--surface-2)]" />
                <div className="mt-3 h-12 rounded-lg bg-[var(--surface-2)]" />
              </div>
              <div className="h-6 w-28 rounded-full bg-[var(--surface-2)]" />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <LoadingCollectionCard key={index} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
