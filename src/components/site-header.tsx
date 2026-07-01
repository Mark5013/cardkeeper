import Link from "next/link";

import { logoutAction } from "@/app/auth/actions";
import { getCurrentUser } from "@/lib/supabase/auth";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 lg:px-8">
      <Link className="flex items-center gap-3" href="/" aria-label="Cardkeeper home">
        <span className="grid size-10 place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-lg text-[var(--secondary)]">
          C
        </span>
        <span className="text-lg font-bold">Cardkeeper</span>
      </Link>
      <nav className="flex items-center gap-2 text-sm font-semibold">
        <Link className="hidden rounded-lg px-3 py-2 text-[var(--muted)] hover:text-[var(--secondary)] sm:inline-flex" href="/">
          Search cards
        </Link>
        <Link className="hidden rounded-lg px-3 py-2 text-[var(--muted)] hover:text-[var(--secondary)] sm:inline-flex" href="/sets">
          Search by set
        </Link>
        {user ? (
          <>
            <Link className="hidden rounded-lg px-3 py-2 text-[var(--muted)] hover:text-[var(--secondary)] sm:inline-flex" href="/collection">
              Collection
            </Link>
            <Link className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2 text-[var(--secondary)]" href="/account">
              Account
            </Link>
            <form action={logoutAction} className="hidden sm:block">
              <button className="cursor-pointer rounded-lg px-3 py-2 text-[var(--muted)] hover:text-[var(--danger)]" type="submit">Sign out</button>
            </form>
          </>
        ) : (
          <>
            <Link className="rounded-lg px-3 py-2 text-[var(--muted)] hover:text-[var(--secondary)]" href="/login">Sign in</Link>
            <Link className="rounded-lg bg-[var(--secondary)] px-4 py-2 text-[var(--secondary-contrast)]" href="/signup">Create account</Link>
          </>
        )}
      </nav>
    </header>
  );
}
