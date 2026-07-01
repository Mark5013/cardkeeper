import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { UpdatePasswordForm } from "@/components/auth/auth-forms";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Update password" };

export default async function UpdatePasswordPage() {
  if (!(await getCurrentUser())) redirect("/forgot-password");

  return (
    <main className="min-h-screen overflow-x-hidden">
      <SiteHeader />
      <div className="mx-auto grid w-full max-w-6xl place-items-center px-6 py-16 lg:px-8">
        <AuthCard eyebrow="Account security" title="Choose a new password" description="Use at least 8 characters and avoid reusing a password from another service.">
          <UpdatePasswordForm />
        </AuthCard>
      </div>
    </main>
  );
}
