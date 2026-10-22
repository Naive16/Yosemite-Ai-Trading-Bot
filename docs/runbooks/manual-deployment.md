# Yosemite Manual Vercel + Neon Deployment Runbook

This runbook is for a manually approved deployment of the request-driven Yosemite dashboard and API. It does not authorize deployment, Neon access, migration application, provider calls, broker access, worker activation, or trading.

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

The preflight is expected to fail in an ordinary local development shell when production `APP_ENV`, HTTPS `APP_ORIGIN`, and `DATABASE_URL` are absent. That is an environment blocker, not a code failure. Migration 007 must still be reviewed and verified on the target Neon branch.

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
| `AUTH_USERNAME` | Single configured login username. | Yes |
| `AUTH_PASSWORD_HASH` | Locally generated scrypt password hash. | Yes |
| `SESSION_SECRET` | Random server-side secret of at least 32 bytes. | Yes |
| `DATABASE_URL` | Pooled Neon runtime connection URL. | Yes |
| `DATABASE_URL_UNPOOLED` | Direct, non-pooled Neon URL for migrations only. | Yes for migration workflow |
| `TRADING_MODE` | Keep `disabled`. | Yes |
| `LIVE_TRADING_ENABLED` | Keep `false`. | Yes |
| `WORKER_ENABLED` | Keep `false` for request-driven Vercel deployment. | Yes |
| `MT5_EXECUTION_ENABLED` | Keep `false`. | Yes |
| `TRUSTED_PROXY_MODE` | Keep `none` until Vercel forwarded-header behavior is confirmed. | Recommended |

Generate the password hash locally with `npm run hash-password`; never place the plaintext password in Vercel, source, logs, or documentation. Optional AI, market-data, news, and MT5 read-only credentials should remain unset until separately approved and verified.

## 4. Review the Neon target before touching it

Before any migration command:

1. Open the Neon console and select the intended project and branch.
2. Confirm the branch is the deployment target, not a development or personal branch.
3. Confirm backup/restore and retention settings.
4. Record the branch identity and current migration state without copying credentials into notes.
5. Review every SQL file in `db/migrations/` in order:
   - `001_initial_schema.sql`
   - `002_risk_engine.sql`
   - `003_trade_proposals.sql`
   - `004_paper_backtest.sql`
   - `005_execution_reconciliation.sql`
   - `006_operations.sql`
   - `007_rate_limit_buckets.sql`
6. Confirm migrations are additive and that migration 007 creates the indexed, constrained shared rate-limit table.
7. Obtain explicit approval for the migration event.

Do not use the pooled URL for migrations. The migration runner rejects pooled Neon hostnames and uses `DATABASE_URL_UNPOOLED` first.

## 5. Apply migrations only after approval

Only after the branch, backup path, and migration set are approved, run from an environment containing the direct URL:

```powershell
npm run migrate
```

Expected result: each unapplied migration is reported as applied, or already-applied versions are reported as skipped. Stop immediately on any error. Do not delete rows, drop tables, or manually reverse a migration.

Afterward, verify in Neon that `schema_migrations` records the expected versions and that sessions, audit events, and `rate_limit_buckets` exist with their expected indexes and constraints.

## 6. Run the production preflight

With the approved production variables available to the process, run:

```powershell
npm run deployment-check
```

Expected result:

```text
Deployment preflight passed. No secrets were printed.
```

Any `FAIL` line blocks deployment. Warnings require review, especially proxy trust and migration 007 verification.

## 7. Deploy manually

Deploy through the manually selected Vercel workflow only after the preflight and Neon review gates pass. Do not enable optional providers, workers, MT5 execution, or trading as part of this deployment.

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
- Migration failure: stop, preserve the error and migration state, and do not retry blindly or delete data. Use Neon’s approved recovery/restore process.
- Schema rollback: do not create a destructive reverse migration without a separate review and authorization.
- Database outage: leave the application fail-closed; do not bypass authentication, rate limits, risk blocks, or execution guards.
- Unknown execution outcome: preserve `submission_unknown` / `reconciliation_required` and reconcile before any retry. Do not resubmit blindly.
- Credential exposure: revoke/rotate the affected credential through the provider, then review logs and deployment variables without copying the secret into incident notes.

## Current audit status and costs

No deployment or remote verification was performed. The local checks passed with 91 tests and no failures. The local deployment preflight failed because this audit did not provide production environment variables; it also warned that migration 007 requires target-branch verification.

Vercel, Neon, AI providers, market-data providers, MT5 connectors, and brokers may incur usage or subscription costs. No plan, billing status, or free-tier eligibility was verified here.
