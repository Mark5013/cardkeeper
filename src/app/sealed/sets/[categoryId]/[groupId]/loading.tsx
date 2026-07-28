import { SiteHeader } from "@/components/site-header";

export default function LoadingSealedSet() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />
      <section
        aria-busy="true"
        className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 lg:px-8"
      >
        <p className="eyebrow">Sealed catalog</p>
        <h1 className="mt-4 text-4xl font-bold">Loading sealed set…</h1>
      </section>
    </main>
  );
}
