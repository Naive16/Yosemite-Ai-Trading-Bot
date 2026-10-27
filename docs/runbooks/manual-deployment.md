# Yosemite Manual Vercel + Supabase Deployment Runbook

This runbook is for a manually approved deployment of the request-driven Yosemite dashboard and API using Supabase Auth + Supabase PostgreSQL. It does not authorize deployment, remote Supabase DDL, Neon modification, migration application, provider calls, broker access, worker activation, or trading.

## 1. Local release gate

Use Node.js 20 or newer. From the project root, run:

```powershell
npm run check
npm run verify
npm run deployment-check
```

Expected results:

- `npm run check` exits 0 and reports no syntax errors.
- `npm run verify` exits 0 with all tests passing.
- `npm run deployment-check` must print `Deployment preflight passed` before deployment. It prints no secret values.

The preflight is expected to fail in an ordinary local development shell when production `APP_ENV`, HTTPS `APP_ORIGIN`, and `DATABASE_URL` are absent. That is an environment blocker, not a code failure. Migrations `001` through `008` must be reviewed and verified on the target Supabase project.

## 2. Create or select the Vercel project

In Vercel, manually create or select the intended project and record its final production origin. Do not configure a preview origin as `APP_ORIGIN` for production.

The checked-in `vercel.json` configures `api/**/*.js` as Node.js 20 functions. This covers nested routes such as `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, and `/api/private/*`.

Do not add a browser API key or database URL. The dashboard uses same-origin API requests.

## 3. Configure Vercel production variables

In Vercel’s encrypted Production environment settings, configure the following names. Enter values directly in the provider UI; do not print them in a terminal, commit them, or place them in frontend files.

| Variable | Purpose | Required |
| --- | --- | --- |
| `APP_ENV` | Must be `production`. | Yes |
| `APP_ORIGIN` | Exact final HTTPS deployment origin. | Yes |
| `SUPABASE_URL` | Existing Supabase project HTTPS origin (`https://<ref>.supabase.co`). | Yes |
| `SUPABASE_ANON_KEY` | Public Supabase `anon` / `publishable` key (`service_role` / `secret` keys are rejected). | Yes |
| `SUPABASE_OWNER_USER_ID` | Single authorized workspace owner's Supabase Auth UUID. | Yes |
| `SESSION_SECRET` | Random server-side secret of at least 32 bytes. | Yes |
| `DATABASE_URL` | Supabase Supavisor Transaction Mode (`:6543`) runtime connection URL. | Yes |
| `DIRECT_URL` | Supabase Session Mode (`:5432`) or Direct (`:5432`) URL for migrations only. | Yes for migration workflow |
| `TRADING_MODE` | Keep `disabled`. | Yes |
| `LIVE_TRADING_ENABLED` | Keep `false`. | Yes |
| `WORKER_ENABLED` | Keep `false` for request-driven Vercel deployment. | Yes |
| `MT5_EXECUTION_ENABLED` | Keep `false`. | Yes |
| `TRUSTED_PROXY_MODE` | Keep `none` until Vercel forwarded-header behavior is confirmed. | Recommended |

Never place database passwords, `SESSION_SECRET`, or `service_role` keys in Vercel frontend variables, source, logs, or documentation. Optional AI, market-data, news, and MT5 read-only credentials should remain unset until separately approved and verified.

## 4. Review the Supabase target before touching it

Before any migration command:

1. Open the Supabase Dashboard and select the intended project.
2. Confirm Email + Password authentication is enabled, public sign-ups are disabled, and your single owner UUID is confirmed.
3. Confirm backup/restore settings and keep the legacy Neon database untouched as a read-only fallback.
4. Review every SQL file in `db/migrations/` in order:
   - `001_initial_schema.sql`
   - `002_risk_engine.sql`
   - `003_trade_proposals.sql`
   - `004_paper_backtest.sql`
   - `005_execution_reconciliation.sql`
   - `006_operations.sql`
   - `007_rate_limit_buckets.sql`
   - `008_supabase_rls_hardening.sql`
5. Confirm migrations are additive, migration `007` creates the shared rate-limit table, and migration `008` enables Row Level Security across all 21 `public` tables.
6. Obtain explicit approval for the migration event.

Do not use the Transaction Mode (`:6543`) URL for migrations. The migration runner rejects `:6543` transaction poolers and legacy `*.neon.tech` hosts, using `DIRECT_URL` (`:5432`) first.

## 5. Apply migrations only after approval

Only after the branch, backup path, and migration set are approved, run from an environment containing the direct URL:

```powershell
npm run migrate
```

Expected result: each unapplied migration is reported as applied, or already-applied versions are reported as skipped. Stop immediately on any error. Do not delete rows, drop tables, or manually reverse a migration.

Afterward, verify in Supabase PostgreSQL that `schema_migrations` records versions `000001` through `000008`, Row Level Security is enabled across all 21 `public` tables, and sessions, audit events, and `rate_limit_buckets` exist with their expected indexes and constraints.

## 6. Run the production preflight

With the approved production variables available to the process, run:

```powershell
npm run deployment-check
```

Expected result:

```text
Deployment preflight passed. No secrets were printed.
```

Any `FAIL` line blocks deployment. Warnings require review, especially proxy trust and migrations `001`–`008` verification.

## 7. Deploy manually

Deploy through the manually selected Vercel workflow only after the preflight and Supabase review gates pass. Do not enable optional providers, workers, MT5 execution, or trading as part of this deployment.

Expected result: Vercel reports a successful deployment and exposes the recorded HTTPS origin. This step was not performed by this audit.

## 8. Post-deployment smoke tests

Run these against the final HTTPS origin without recording credentials, cookies, or tokens:

1. `GET /api/health` returns the expected safe health response.
2. The login page loads over HTTPS.
3. Login succeeds with the configured account.
4. Browser developer tools show the session cookie as `HttpOnly`, `SameSite=Lax`, and `Secure`.
5. `/api/private/status` and other protected routes return `401` without a session.
6. Same-origin authenticated requests succeed where the database is available.
7. Cross-origin state-changing requests are rejected.
8. Logout clears the cookie and revokes the server-side session.
9. The revoked session cannot access protected routes.
10. Repeated failed login attempts reach the configured rate limit.
11. Rate-limit behavior is shared across instances after migration 007 verification.
12. Security headers include CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, Referrer Policy, and the configured Permissions Policy.
13. The dashboard continues to show unavailable/blocked states for unconfigured providers and execution.

`/api/health` is not proof that AI, market data, MT5, or trading execution is ready.

## 9. AI, market data, and MT5 boundaries

- Keep AI provider credentials server-side and unset until the selected provider is individually approved and tested.
- A missing, timed-out, refused, truncated, or schema-invalid AI response must remain unavailable and must not become a trade signal.
- Keep market-data providers unavailable until credentials, symbol support, freshness, rate limits, and costs are verified.
- Keep `MT5_EXECUTION_ENABLED=false`; the current adapter blocks order submission.
- Keep `TRADING_MODE=disabled`, `LIVE_TRADING_ENABLED=false`, and `WORKER_ENABLED=false`.
- No AI output, strategy result, risk `PASS`, or approval record independently authorizes execution.

## 10. Rollback and recovery

- Application rollback: redeploy the last known compatible application version through the approved Vercel workflow. Confirm schema compatibility first.
- Migration failure: stop, preserve the error and migration state, and do not retry blindly or delete data. Use Supabase's approved recovery/restore process.
- Schema rollback: do not create a destructive reverse migration without a separate review and authorization.
- Database outage: leave the application fail-closed; do not bypass authentication, rate limits, risk blocks, or execution guards.
- Unknown execution outcome: preserve `submission_unknown` / `reconciliation_required` and reconcile before any retry. Do not resubmit blindly.
- Credential exposure: revoke/rotate the affected credential through the provider, then review logs and deployment variables without copying the secret into incident notes.

## Current audit status and costs

Vercel, Cloudflare, Supabase, AI providers, market-data providers, MT5 connectors, and brokers may incur usage or subscription costs. No paid plan upgrade was enabled.
