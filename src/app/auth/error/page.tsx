import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Authentication error" };

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const rawReason = (await searchParams).reason;
  const reason = Array.isArray(rawReason) ? rawReason[0] : rawReason;
  const message =
    reason === "confirmation_failed"
      ? "This confirmation link is invalid or has expired. Request a new link and try again."
      : "We could not complete authentication. Please try again.";

  return (
    <main className="min-h-screen overflow-x-hidden">
      <SiteHeader />
      <div className="mx-auto grid w-full max-w-6xl place-items-center px-6 py-20 lg:px-8">
        <section className="auth-card">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">Something went wrong</p>
          <h1 className="mt-3 text-3xl font-bold">Authentication failed</h1>
          <p className="mt-3 leading-7 text-[var(--muted)]">{message}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link className="auth-submit inline-flex justify-center" href="/login">Return to sign in</Link>
            <Link className="rounded-xl border border-[var(--line)] px-5 py-3 font-semibold text-[var(--secondary)]" href="/forgot-password">Reset password</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
