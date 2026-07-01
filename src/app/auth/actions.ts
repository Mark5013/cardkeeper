"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getSafeNextPath, getSiteUrl } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.");

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128),
  next: z.string().optional(),
});

const signupSchema = z
  .object({
    displayName: z.string().trim().min(2, "Enter at least 2 characters.").max(50),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    next: z.string().optional(),
  })
  .refine((input) => input.password === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

const forgotPasswordSchema = z.object({ email: emailSchema });
const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((input) => input.password === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

function fields(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

function validationError(error: z.ZodError): AuthActionState {
  return {
    status: "error",
    message: "Please correct the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors,
  };
}

export async function loginAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return {
      status: "error",
      message: "The email or password is incorrect, or the email has not been confirmed.",
    };
  }

  revalidatePath("/", "layout");
  redirect(getSafeNextPath(parsed.data.next));
}

export async function signupAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signupSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError(parsed.error);

  const next = getSafeNextPath(parsed.data.next);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return {
      status: "error",
      message: "We could not create the account. Please wait a moment and try again.",
    };
  }

  if (data.session) {
    revalidatePath("/", "layout");
    redirect(next);
  }

  redirect("/signup/success");
}

export async function requestPasswordResetAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent("/account/update-password")}`,
  });

  if (error) {
    return {
      status: "error",
      message: "We could not send a reset email right now. Please wait and try again.",
    };
  }

  return {
    status: "success",
    message: "If an account exists for that email, password reset instructions are on the way.",
  };
}

export async function updatePasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = updatePasswordSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError(parsed.error);

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    return {
      status: "error",
      message: "Your password-reset session has expired. Request a new reset link.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      status: "error",
      message: "We could not update the password. Please request a new reset link.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/account?password=updated");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
