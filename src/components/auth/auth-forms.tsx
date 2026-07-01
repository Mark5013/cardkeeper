"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  loginAction,
  requestPasswordResetAction,
  signupAction,
  updatePasswordAction,
  type AuthActionState,
} from "@/app/auth/actions";

const initialState: AuthActionState = { status: "idle", message: "" };

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="auth-field-error">{errors[0]}</p>;
}

function FormMessage({ state }: { state: AuthActionState }) {
  if (!state.message) return null;
  return (
    <p
      className={state.status === "success" ? "auth-message-success" : "auth-message-error"}
      aria-live="polite"
    >
      {state.message}
    </p>
  );
}

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="auth-form">
      <input type="hidden" name="next" value={nextPath ?? "/account"} />
      <label>
        <span className="auth-label">Email</span>
        <input className="auth-input" name="email" type="email" autoComplete="email" required />
        <FieldError errors={state.fieldErrors?.email} />
      </label>
      <label>
        <span className="flex items-center justify-between gap-3">
          <span className="auth-label">Password</span>
          <Link className="text-xs font-semibold text-[var(--secondary)] hover:underline" href="/forgot-password">
            Forgot password?
          </Link>
        </span>
        <input className="auth-input" name="password" type="password" autoComplete="current-password" required />
        <FieldError errors={state.fieldErrors?.password} />
      </label>
      <FormMessage state={state} />
      <button className="auth-submit" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm text-[var(--muted)]">
        New to Cardkeeper?{" "}
        <Link className="font-semibold text-[var(--secondary)] hover:underline" href={`/signup${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`}>
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignupForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <form action={formAction} className="auth-form">
      <input type="hidden" name="next" value={nextPath ?? "/account"} />
      <label>
        <span className="auth-label">Display name</span>
        <input className="auth-input" name="displayName" type="text" autoComplete="name" required minLength={2} maxLength={50} />
        <FieldError errors={state.fieldErrors?.displayName} />
      </label>
      <label>
        <span className="auth-label">Email</span>
        <input className="auth-input" name="email" type="email" autoComplete="email" required />
        <FieldError errors={state.fieldErrors?.email} />
      </label>
      <label>
        <span className="auth-label">Password</span>
        <input className="auth-input" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
        <FieldError errors={state.fieldErrors?.password} />
      </label>
      <label>
        <span className="auth-label">Confirm password</span>
        <input className="auth-input" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
        <FieldError errors={state.fieldErrors?.confirmPassword} />
      </label>
      <p className="text-xs leading-5 text-[var(--muted)]">Use at least 8 characters. A longer, unique passphrase is even better.</p>
      <FormMessage state={state} />
      <button className="auth-submit" type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p className="text-center text-sm text-[var(--muted)]">
        Already have an account?{" "}
        <Link className="font-semibold text-[var(--secondary)] hover:underline" href={`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`}>
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.status === "success") {
    return (
      <div aria-live="polite">
        <p className="auth-message-success">{state.message}</p>
        <Link className="mt-5 inline-block text-sm font-semibold text-[var(--secondary)] hover:underline" href="/login">
          Return to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="auth-form">
      <label>
        <span className="auth-label">Email</span>
        <input className="auth-input" name="email" type="email" autoComplete="email" required />
        <FieldError errors={state.fieldErrors?.email} />
      </label>
      <FormMessage state={state} />
      <button className="auth-submit" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset email"}
      </button>
      <Link className="text-center text-sm font-semibold text-[var(--secondary)] hover:underline" href="/login">
        Return to sign in
      </Link>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);

  return (
    <form action={formAction} className="auth-form">
      <label>
        <span className="auth-label">New password</span>
        <input className="auth-input" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
        <FieldError errors={state.fieldErrors?.password} />
      </label>
      <label>
        <span className="auth-label">Confirm new password</span>
        <input className="auth-input" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
        <FieldError errors={state.fieldErrors?.confirmPassword} />
      </label>
      <FormMessage state={state} />
      <button className="auth-submit" type="submit" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
