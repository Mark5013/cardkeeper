import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/auth-forms";
import { getSafeNextPath } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect("/account");

  const rawNext = (await searchParams).next;
  const nextPath = getSafeNextPath(Array.isArray(rawNext) ? rawNext[0] : rawNext);

  return (
    <AuthCard eyebrow="Start collecting" title="Create your account" description="Your account keeps collection quantities, conditions, and values private and synchronized.">
      <SignupForm nextPath={nextPath} />
    </AuthCard>
  );
}
