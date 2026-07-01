import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/auth/actions";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, preferred_currency")
    .eq("user_id", user.id)
    .maybeSingle();
  const passwordStatus = (await searchParams).password;

  return (
    <main className="min-h-screen overflow-x-hidden">
      <div className="hero-glow" aria-hidden="true" />
      <SiteHeader />
      <section className="mx-auto w-full max-w-4xl px-6 pb-20 pt-10 lg:px-8">
        <p className="eyebrow">Your account</p>
        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
          {profile?.display_name ? `Hello, ${profile.display_name}` : "Account settings"}
        </h1>
        <p className="mt-4 text-lg text-[var(--muted)]">Manage your Cardkeeper identity and security.</p>

        {passwordStatus === "updated" ? (
          <p className="auth-message-success mt-7">Your password was updated successfully.</p>
        ) : null}

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <article className="account-card">
            <p className="account-label">Email</p>
            <p className="mt-2 break-all font-semibold">{user.email ?? "No email available"}</p>
          </article>
          <article className="account-card">
            <p className="account-label">Preferred currency</p>
            <p className="mt-2 font-semibold">{profile?.preferred_currency ?? "USD"}</p>
          </article>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="auth-submit inline-flex justify-center" href="/collection">
            View collection
          </Link>
          <Link className="auth-submit inline-flex justify-center" href="/account/update-password">
            Change password
          </Link>
          <form action={logoutAction}>
            <button className="cursor-pointer rounded-xl border border-[var(--line)] px-5 py-3 font-semibold text-[var(--danger)] hover:border-[var(--danger)]" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
