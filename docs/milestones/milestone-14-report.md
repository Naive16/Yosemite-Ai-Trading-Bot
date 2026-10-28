> Historical milestone record. The active backend is now Supabase Auth and Data API. Use [the current release runbook](../runbooks/cloudflare-deployment.md); legacy Neon/custom-password instructions below are not current deployment guidance.

# Milestone 14 report — Deployment preparation

## 1. Scope completed

Milestone 14 prepared the repository for a safe, request-driven deployment without deploying it. The existing authentication, CSRF checks, database-backed sessions, Neon persistence, dashboard, market-data boundary, risk controls, reconciliation foundation, and operations diagnostics were preserved.

Added:

- A secret-safe deployment preflight at `npm run deployment-check`.
- Production checks for HTTPS `APP_ORIGIN`, required authentication and database configuration, direct versus pooled Neon URLs, disabled trading, disabled MT5 execution, and disabled persistent worker mode.
- A deployment runbook covering Vercel/Neon environment configuration, migration review, health checks, proxy handling, and rate-limit limitations.
- Four focused deployment-preflight tests.

The existing `vercel.json` already provides security headers and Node.js 20 serverless function configuration for `api/*.js`; no unrelated rewrite or frontend redesign was introduced.

## 2. Files changed

- `api/_lib/deployment.js`
- `scripts/deployment-check.mjs`
- `tests/deployment.test.mjs`
- `package.json`
- `README.md`
- `docs/runbooks/deployment.md`
- `docs/milestones/milestone-14-report.md`

## 3. Provider and compatibility

Vercel is the prepared hosting target because the repository contains static assets plus request-driven `api/*.js` handlers and an existing compatible `vercel.json`. Neon PostgreSQL remains the persistence provider. No Vercel project, production domain, GitHub repository, or remote deployment was selected or configured in this milestone.

The in-process worker is not a Vercel deployment worker and remains disabled. MT5 integration and order execution remain disabled. Optional market-data, Claude, news, and broker credentials remain absent from the deployment preparation.

## 4. Environment variables

The required production names are documented in `docs/runbooks/deployment.md` and `.env.example`: `APP_ENV`, HTTPS `APP_ORIGIN`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `TRADING_MODE`, `LIVE_TRADING_ENABLED`, `WORKER_ENABLED`, and `MT5_EXECUTION_ENABLED`.

No secret values are included in this report. `.env` is listed in `.gitignore`; this workspace is not a Git repository, so repository-level ignore verification and source-control history could not be independently confirmed.

## 5. Verification performed

- `npm run verify` — passed: syntax checks and 74 tests passed, 0 failed, 0 skipped, 0 cancelled.
- `node --test tests/deployment.test.mjs` — passed: 4 tests passed, 0 failed.
- `npm run deployment-check` in the current local development environment — expected failure. It reported that production `APP_ENV`, HTTPS `APP_ORIGIN`, and process environment `DATABASE_URL` were not present, plus the process-local limiter warning. No secret values were printed.
- Neon migration state — previously authorized and applied migrations `000001` through `000006` were verified read-only on the configured Neon branch. No new remote migration was run for Milestone 14.
- Browser visual QA — not performed.
- Remote deployment smoke test — not performed.

## 6. Cost and external-service status

No new paid service was provisioned and no subscription was activated. Vercel and Neon usage, limits, billing, and production suitability remain account- and plan-dependent. No deployment credentials were available or used for this milestone.

## 7. Outstanding issues and boundary

- The project has no Git metadata or remote, so commit/push/source integration cannot be verified.
- A Vercel project, deployment origin, encrypted production environment, and authorized deploy action remain to be supplied.
- The process-local login, market-data, and AI rate limiters do not protect across multiple serverless instances. A shared atomic Neon limiter or reviewed managed service is the safe production path; it is not falsely claimed here.
- The persistent worker, live broker, MT5 execution, and live trading remain outside this deployment milestone and disabled.
- Production verification must include the actual deployment origin, login/logout, protected APIs, session revocation, security headers, and read-only Neon connectivity.

Milestone 15 and broader production readiness work were not started. This milestone stops here for review and approval.
