import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Check your email" };

export default function SignupSuccessPage() {
  return (
    <AuthCard eyebrow="Almost there" title="Check your email" description="We sent a confirmation link if the address can be registered. Open it in the same browser to finish creating your account.">
      <Link className="auth-submit inline-flex justify-center" href="/login">Return to sign in</Link>
    </AuthCard>
  );
}
