import { SiteHeader } from "@/components/site-header";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />
      <div className="mx-auto grid w-full max-w-6xl place-items-center px-6 pb-20 pt-8 lg:px-8">
        {children}
      </div>
    </main>
  );
}
