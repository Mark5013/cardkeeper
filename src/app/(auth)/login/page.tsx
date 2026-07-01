import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/auth-forms";
import { getSafeNextPath } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect("/account");

  const rawNext = (await searchParams).next;
  const nextPath = getSafeNextPath(Array.isArray(rawNext) ? rawNext[0] : rawNext);

  return (
    <AuthCard eyebrow="Welcome back" title="Sign in" description="Access your collection and keep every card in one place.">
      <LoginForm nextPath={nextPath} />
    </AuthCard>
  );
}
