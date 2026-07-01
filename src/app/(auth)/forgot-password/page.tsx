import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard eyebrow="Account recovery" title="Reset your password" description="Enter your email and we’ll send instructions if it belongs to an account.">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
