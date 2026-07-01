# Supabase authentication setup

The application code supports email/password signup, email confirmation, login, logout, password recovery, and password updates. Complete the dashboard settings below before testing a real email flow.

## Local redirect configuration

In the Supabase dashboard, open **Authentication → URL Configuration**.

Set:

```text
Site URL: http://localhost:3000
```

Add this development redirect URL:

```text
http://localhost:3000/**
```

The wildcard is useful for local development. In production, add the exact production callback URL instead:

```text
https://your-domain.example/auth/confirm
```

Also set the deployed application's environment variable:

```dotenv
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

## Email provider

Supabase's built-in email sender is suitable for initial development and has restrictive rate limits. Configure a custom SMTP provider before production.

Email confirmation should remain enabled. The `/auth/confirm` route accepts both Supabase token-hash links and PKCE `code` links, so the default hosted templates can be used initially.

## Local test checklist

1. Start the site with `npm run dev`.
2. Open `http://localhost:3000/signup`.
3. Create an account using an email inbox you can access.
4. Open the confirmation email in the same browser.
5. Confirm that the link opens `/account`.
6. Confirm that the header shows **Account** and **Sign out**.
7. Sign out, then sign back in at `/login`.
8. Request a reset at `/forgot-password`.
9. Open the reset email and choose a new password.

The `profiles` database row is created automatically by the `on_auth_user_created` trigger. Collection data remains protected by Row Level Security throughout these flows.
