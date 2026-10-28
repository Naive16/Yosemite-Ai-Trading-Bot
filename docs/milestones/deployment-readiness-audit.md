> Historical milestone record. The active backend is now Supabase Auth and Data API. Use [the current release runbook](../runbooks/cloudflare-deployment.md); legacy Neon/custom-password instructions below are not current deployment guidance.

# Deployment readiness audit

Audit date: 2026-10-22

Target: Vercel for the request-driven web/API surface and Neon PostgreSQL for server-side persistence.

Scope: local inspection and verification only. No Vercel deployment, Git operation, Neon connection, remote migration, paid-service action, or trading activation was performed.

## Overall status

**BLOCKED for production deployment.** The application has a sound local, read-only deployment boundary, but the deployment cannot be safely approved from this workspace. The concrete blockers are the absence of source-control/deployment project configuration, no production environment/origin, no live Neon verification in this audit, and the need to confirm recursive function coverage and shared rate limiting in an actual Vercel/Neon environment.

## Readiness matrix

| Area | Status | Evidence and interpretation |
| --- | --- | --- |
| Static frontend exists | PASS | `index.html` and `src/` are present and served by the local static preview. |
| Frontend build/output configuration | UNVERIFIED | No `build` script or framework output directory exists. Vercel static serving was not run in this audit. Smallest resolution: verify a preview deployment or add only the platform configuration required by the selected project. Local-only: yes for a static smoke check; production confirmation requires Vercel access. |
| API handler shape | PASS | API route files export Vercel-style default `(request, response)` handlers and use supported Node APIs in local syntax/tests. |
| Explicit Vercel function coverage | PASS locally / UNVERIFIED on Vercel | `vercel.json` now uses the recursive `api/**/*.js` function pattern and a local test enumerates nested authentication/private route directories. Actual Vercel route discovery still requires a Vercel preview. |
| Persistent worker compatibility | PASS for current scope / UNVERIFIED for worker | The worker is disabled by default and the current dashboard/API boundary does not require a continuously running process. A persistent worker is not provided by Vercel and was not started. |
| Local filesystem/process state | PASS for current scope | No runtime API path was found writing files or requiring a long-lived process. Process-local caches and limiters are documented as non-durable. |
| Serverless database client | PASS locally | `api/_lib/database.js` uses `@neondatabase/serverless`, caches only the client object, applies bounded query timeouts, and converts failures to safe errors. |
| Database environment validation | PASS locally | `api/_lib/config.js` validates PostgreSQL URLs, requires `DATABASE_URL` in production, and distinguishes pooled application access from `DATABASE_URL_UNPOOLED` migration access. |
| Migration ordering/idempotence | PASS locally / UNVERIFIED remotely | Migrations are numeric and additive with `IF NOT EXISTS`/indexed constraints; migration tests pass. Remote branch state was not checked during this audit. |
| Neon live connectivity | UNVERIFIED | This audit did not connect to Neon, query it, or run migrations, per instruction. Historical milestone documentation records an earlier authorized verification, but it is not a new audit observation. |
| Session persistence | PASS locally / UNVERIFIED live | Sessions are stored and revoked through repository SQL against the configured database client; simulated cross-instance expiry/revocation tests pass. Live Neon behavior was not tested here. |
| Production startup fallback behavior | PASS | Production configuration rejects missing auth/database configuration; no local or in-memory session fallback is present. |
| Secure production cookies | PASS locally | `setSessionCookie` adds `HttpOnly`, `SameSite=Lax`, and `Secure` when `APP_ENV=production`; tests cover cookie attributes in the simulated auth path. |
| CSRF and origin protection | PASS locally | State-changing auth/proposal/simulation paths enforce same-origin and CSRF checks; focused tests pass. |
| Authentication secrets | PASS locally / UNVERIFIED deployment store | Production requires configured username, scrypt hash, session secret, database URL, and HTTPS origin. No production secret store is configured in this workspace. |
| Rate limiting | PASS locally / UNVERIFIED live | Login, market-data, AI, risk, strategy, backtest, and paper limits now use the shared `rate_limit_buckets` PostgreSQL table with atomic upserts, expiry, indexed cleanup, and fail-closed database errors. Migration application and multi-instance behavior against real Neon remain unverified. |
| Audit logging | PASS locally / UNVERIFIED live | Login/session actions and operational records have repository/schema support and redaction tests. Live persistence was not exercised in this audit. |
| Health/diagnostics leakage | PASS locally | Public health is minimal; protected operations diagnostics require authentication; structured logging redacts security material. |
| Tenant isolation | PASS for declared single-user scope | The configured product is single-user and protected routes resolve the authenticated session user. Multi-tenant isolation is not implemented or claimed. |
| Trading disabled | PASS | Defaults and tests keep `TRADING_MODE=disabled`; live trading is rejected, MT5 execution is rejected, and paper operation reports unavailable without a worker/live source. |
| Broker/MT5 credentials | PASS | No broker execution path is enabled; optional provider credentials are server-side and absent by default. |
| Background automation | PASS | `WORKER_ENABLED=false` by default and deployment preflight rejects enabling it for the request-driven deployment boundary. |
| Local verification | PASS | `npm run verify` passed; focused deployment/security tests passed. |
| Deployment preflight | BLOCKED as expected locally | `npm run deployment-check` failed because the current process environment is development, uses a non-HTTPS local origin, and has no process-level `DATABASE_URL`; it printed no secret values. |
| Build/lint verification | NOT STARTED / unavailable | `npm run build` and `npm run lint` are not defined in `package.json`; no build or lint result can be claimed. |
| Source control | BLOCKED | The workspace is not a Git repository and has no visible `.git` or remote metadata. Smallest resolution: place the reviewed project in an authorized Git repository; requires external access. |
| Vercel project/domain/secrets | BLOCKED | No Vercel CLI/project/origin or encrypted production environment is configured. Smallest resolution: select the project, domain, and secret store; requires external access and authorization. |
| Post-deployment verification | NOT STARTED | No deployed URL exists and no production smoke test was authorized. |

## Mandatory blockers versus deferrable improvements

### Mandatory before public deployment

1. Establish authorized source control and a reviewed deployment source.
2. Select a Vercel project and final HTTPS origin; configure server-side production variables and run the preflight in that environment.
3. Run the additive `007_rate_limit_buckets.sql` migration through the approved direct Neon migration process; do not apply it from this local task.
4. Confirm that all nested `api/auth/*` and `api/private/*` routes are deployed as functions in a Vercel preview.
5. Run an authorized preview/production smoke test covering health, login, protected routes, logout/revocation, secure cookies, CSRF, rate-limit backend failure, and safe database failure responses.
6. Perform a separately authorized read-only Neon connectivity check and review migration state. Do not run migrations as part of this audit.

### Safe to defer until after the deployment boundary is confirmed

- Persistent worker deployment and continuous paper operation.
- Live market-data, Claude/news, account, instrument, broker, and MT5 integrations.
- Browser visual QA at the final production origin.
- Multi-tenant authorization, which is outside the declared single-user product scope.
- Adding build/lint tooling, if the selected deployment platform does not require a build step.

## Verification results

- `npm run verify` — PASS: syntax checks and 85 tests passed, 0 failed, 0 skipped, 0 cancelled.
- Focused rate-limit/security/routing tests — PASS: concurrent enforcement, expiry reset, backend failure, migration, authentication, and nested-route coverage passed.
- `npm run deployment-check` — BLOCKED as expected in the local development shell; production `APP_ENV`, HTTPS `APP_ORIGIN`, and process-level `DATABASE_URL` were absent. No secrets were printed.
- `npm run build` — unavailable: missing script.
- `npm run lint` — unavailable: missing script.
- Vercel CLI check — unavailable: `vercel` is not installed on PATH.
- Git status — unavailable: current directory is not a Git repository.
- Neon live check — intentionally not performed.
- Remote deployment smoke test — not performed.

## Changes made

This audit added the local shared rate-limit implementation, additive migration `007_rate_limit_buckets.sql`, recursive Vercel function pattern, focused tests, and the companion report. The later AI/MT5 readiness pass added structured-output request metadata, a mocked server-only Mirro transport, connector configuration, and explicit unverified dashboard state. No remote migration, database data, secrets, Git metadata, deployment project, broker account, or billing state was changed.

## Recommended next local-only task

Review the new migration and run it only through an authorized Neon migration event, then verify the Vercel recursive route pattern in a preview. Do not deploy or alter remote state from this local task.

Trading remains disabled, MT5 execution remains disabled, and the background worker remains disabled. Milestone 15 was not started.
