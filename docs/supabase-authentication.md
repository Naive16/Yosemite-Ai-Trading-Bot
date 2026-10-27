# Single-Owner Supabase Authentication & Persistence Setup

Yosemite AI uses **Supabase** as its single unified backend platform for both **Email + Password owner authentication** and **PostgreSQL persistence** (`app_users`, `auth_sessions`, `audit_events`, `risk_*`, `trade_proposals`, `backtest_runs`, `paper_*`, `execution_*`, `operational_alerts`, `worker_leases`, `recovery_tasks`, and `rate_limit_buckets`). No browser-side Supabase SDK, database URL, or API key is exposed to frontend code, preserving the strict `default-src 'self'` Content Security Policy.

## 1. Required Server-Side Environment Variables

Copy `.env.example` to an untracked local `.env` file (ignored by `.gitignore`). Never commit `.env` or configure `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`.

| Variable | Purpose | Requirement |
| --- | --- | --- |
| `SUPABASE_URL` | Existing Supabase project HTTPS origin (`https://<project-ref>.supabase.co`) | Required (server-only) |
| `SUPABASE_ANON_KEY` | Public Supabase `anon` / `publishable` API key (`sb_publishable_...` or `anon` JWT; `service_role` and `sb_secret_*` keys are rejected) | Required (server-only) |
| `SUPABASE_OWNER_USER_ID` | Single authorized workspace owner's Supabase Auth user UUID | Required (server-only) |
| `SESSION_SECRET` | Cryptographically random secret (`>= 32` bytes) for HMAC session & CSRF hashing | Required (server-only) |
| `DATABASE_URL` | Supabase PostgreSQL Supavisor Transaction Mode URL (`:6543`, `?sslmode=require`) for runtime requests | Required (server-only) |
| `DIRECT_URL` | Supabase PostgreSQL Supavisor Session Mode URL (`:5432`, IPv4-compatible) or Direct URL (`:5432`, IPv6) for `npm run migrate` | Required for migrations (server-only) |

## 2. Authentication, Single-Owner Gate & RLS Defense-in-Depth

1. **Public sign-up disabled in application:** Neither the UI nor the API exposes any `/signup` or `/register` endpoint (`404`).
2. **Email + Password verification (`api/_lib/supabase.js`):**
   - `POST /api/auth/login` validates same-origin headers, rejects any client-supplied user ID field/header/query parameter (`400`), checks shared PostgreSQL rate limits (`429`), and submits `{ email, password }` to `POST ${SUPABASE_URL}/auth/v1/token?grant_type=password`.
   - The server independently verifies the issued access token via `GET ${SUPABASE_URL}/auth/v1/user` (requiring `aud === "authenticated"`, confirmed email, and valid UUID) and immediately revokes the temporary upstream GoTrue session (`POST /auth/v1/logout?scope=local`).
3. **Owner-only gate (`403 Forbidden`):**
   - Both `POST /api/auth/login` and `getSession()` (called by `GET /api/auth/me`, `POST /api/auth/logout`, and every `/api/private/*` route) compare the verified user ID against `SUPABASE_OWNER_USER_ID` in constant time.
   - Any non-owner user receives `403 Forbidden` (`code: "access_denied"`), is logged in `audit_events` (`auth.access.denied`), and never receives a `yosemite_session` cookie or `app_users` record.
4. **Single non-overwriting `app_users` record (`resolveSupabaseOwnerUser`):**
   - Reuses an existing `app_users` row matching `id = SUPABASE_OWNER_USER_ID` (`SELECT ... WHERE id = $1`) with zero writes.
   - On first login, inserts once via `INSERT INTO app_users ... ON CONFLICT DO NOTHING` (falling back to `supabase:<owner-uuid>` if an older row already holds that email under a different ID), preventing duplicates across repeated or concurrent logins and never overwriting existing user rows or foreign-key data.
5. **Session persistence & RLS hardening (`008_supabase_rls_hardening.sql`):**
   - Issues an opaque `HttpOnly; SameSite=Lax` (`Secure` in production) `yosemite_session` cookie backed by Supabase PostgreSQL `auth_sessions` and HMAC-derived `X-CSRF-Token` validation.
   - Migration `008_supabase_rls_hardening.sql` enables Row Level Security across all 21 `public` tables, revokes `PUBLIC`/`anon`/`authenticated` table privileges so Supabase's PostgREST Data API cannot read or mutate application tables, and installs restrictive + owner-UUID defense-in-depth policies.

## 3. Manual Supabase Project Steps (Owner & Database Setup)

1. Open **Supabase Dashboard -> Authentication -> Providers -> Email**:
   - Ensure **Enable Email provider** is **ON** and email confirmation is enabled.
2. Open **Authentication -> Sign In / Up**:
   - Turn **Allow new users to sign up** **OFF**.
3. Open **Authentication -> Users**:
   - Confirm your single owner email-and-password user exists and shows **Confirmed**. Copy its **User UID** into `SUPABASE_OWNER_USER_ID`.
4. Open **Project Settings -> API** and **Connect -> Connection String**:
   - Copy the **Project URL** (`SUPABASE_URL`) and **`anon` / `publishable`** key (`SUPABASE_ANON_KEY`) — never copy `service_role` / `secret`.
   - Copy the **Transaction Pooler (`:6543`)** URI into `DATABASE_URL` and **Session Pooler (`:5432`)** URI into `DIRECT_URL` (append `?sslmode=require`).
   - Follow [`docs/supabase-migration-plan.md`](supabase-migration-plan.md) when approved to apply migrations `001`–`008` and copy any existing Neon records.
