# Authentication and backend repair report

## Outcome and approval boundary

The local application has been converted to Supabase Auth and Supabase Data API access. Production deployment and database changes remain pending external review and approval. No remote schema, existing production data, Worker configuration, repository branch or broker account has been changed. No trading was enabled.

The local folder was not a Git checkout at inspection time. Files were edited directly for the requested manual GitHub upload. The existing ignored `.env` has legacy configuration and no Supabase URL/public-key entries; its secret values were neither printed nor copied into source. The Supabase schema and Auth dashboard settings remain uninspected. A read-only Cloudflare inspection confirmed the existing Worker and `https://yosemite-ai-trading-bot.francismkanda01.workers.dev`, current binding names/types, correct Supabase URL and disabled execution flags; it made no remote changes and exposed no credential values.

## Original causes found in local source

1. The active code did not use Supabase at all. Sign-in verified a custom scrypt password from `AUTH_PASSWORD_HASH` and created custom database session cookies through the Neon adapter. Supabase users/configuration could not authenticate against that independent identity store.
2. Authentication was coupled to successful Neon database writes/queries and the legacy session/rate-limit schema. A database error or missing legacy credentials could block sign-in even when Supabase Auth was healthy. Broad configuration failures were reported as an authentication configuration issue, obscuring the actual backend cause.
3. Production configuration and release checks required `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET` and `DATABASE_URL`. There were no Supabase runtime keys, approved Auth-to-domain membership or RLS policies for the requested backend.
4. The README instructed users to copy `.env` and run `npm start`, but the Node startup did not load `.env`. That documented local setup could silently leave authentication/database configuration missing.
5. Cloudflare Static Assets pointed at `src/`, while `.assetsignore` lived at the repository root. The Worker source inside `src/` was eligible for public asset serving. The repair adds the exclusion in the correct directory and frontend security headers.
6. Public health previously swallowed configuration errors and still returned a healthy 200. It now returns a safe 503 configuration state when configuration is invalid and never claims to have verified database connectivity.
7. Real local Workers execution exposed two startup blockers that a dry-run bundle did not detect: Wrangler 4.86.0 bundled a runtime older than the configured compatibility date, and the Worker entry exported test constants that Workerd rejects as entrypoints. Wrangler is now pinned to 4.154.0, test exports live in `api/_lib/routes.js`, and the real local runtime passes at the unchanged compatibility date. Build tooling now requires Node 22+; final verification used the available Node 24.22.1 runtime without changing the system installation.

Read-only Worker inspection additionally found encrypted `SUPABASE_ANON_KEY` and `SUPABASE_OWNER_USER_ID`, plus database/session/Hyperdrive bindings. Inspection of the deployed bundle confirmed it differs from the original local files: it authenticates through Supabase's password and user REST endpoints, revokes that temporary Supabase session, then creates and restores a separate `yosemite_session` database cookie. That split still couples dashboard authentication to the database and custom session store, and does not restore/refresh the official Supabase session. The repair removes this split and preserves the existing owner restriction through reviewed membership mapping. No live credential sign-in or production database inspection was performed, so the exact failing production request, timeout or missing relation is not asserted.

## Changed files and final architecture

| Area | Files | Purpose |
| --- | --- | --- |
| Identity and API authorization | `api/_lib/auth.js`, `api/auth/*`, protected API handlers | Official Auth identity verification, bearer access, approved membership/active-session checks, safe 401/403/503 responses and official sign-out |
| Data access | `api/_lib/database.js`, `api/_lib/repository.js`, risk/proposal repositories and rate limiter | Request-scoped Data API access with public key + user JWT; ownership and narrow RPCs; no Neon or Hyperdrive fallback |
| Browser/session UI | `src/auth-client.js`, `src/app.js`, both HTML entry points | Official SDK sign-in/persistence/refresh/sign-out/recovery, loading/error/denied states and cleared protected UI |
| Worker/Node runtime | `src/worker.js`, `api/_lib/routes.js`, `server.js`, `scripts/start.mjs` | Valid Worker exports, consistent auth/config routing and frontend asset paths, bounded request streaming and local `.env` loading |
| Public configuration/safety | `api/_lib/config.js`, `api/_lib/deployment.js`, `api/health.js`, `wrangler.jsonc`, `.env.example` | Pin the intended Supabase project, reject privileged public-key configuration, fail closed and keep all execution disabled |
| Static security/build | `src/.assetsignore`, `src/_headers`, `scripts/build-auth.mjs`, `package.json`, lockfile, `.node-version`, `.gitignore` | Exclude Worker source, apply CSP, bundle the official SDK locally, pin compatible tooling and ignore generated/sensitive files |
| Reviewed database preparation | `db/supabase-preflight.sql`, `db/migrations/008_supabase_auth_rls.sql`, migration runner and migration runbook | Read-only live-schema inventory, membership/RLS/RPC changes for review; automatic migrations disabled |
| Verification | Authentication/API/database/config/health/browser/RLS tests | Positive/negative identity cases, actual local SQL permission enforcement, error safety and preserved unrelated functionality |
| Documentation | README, architecture, current release/operations runbooks and historical milestone notices | Exact current settings, local checks, external blockers, approval boundary and manual upload exclusions |

The browser receives only the project's public URL/key from `/api/auth/config` and uses the locally bundled official Supabase SDK. The server uses the official `@supabase/auth-js` Auth client and `@supabase/postgrest-js` REST client, avoiding an unnecessary server Realtime/WebSocket requirement on the existing Node 20 runtime. It verifies every API identity with Auth `getUser`, then verifies approved membership and active session through a restricted RPC. Browser-supplied user IDs and roles never authorize access. Data queries use the same verified user JWT so RLS remains effective if a browser calls the Data API directly. There is no privileged Supabase runtime secret, second password verifier or custom session cookie.

Official sign-out invalidates the Supabase session. The database active-session check rejects a previously issued access token after sign-out even while its JWT lifetime has not elapsed. Signed-in Auth accounts without approved membership receive 403. Missing/expired/invalid bearer sessions receive 401. Backend transport/schema/permission failures produce safe 503 responses.

Invalid project keys and disabled email providers are configuration failures, rather than invalid-password messages. Browser requests from an earlier authentication state cannot overwrite a completed logout or a newer user's view. Network failures keep protected views inaccessible and show service errors. Query-string redaction is enabled for Worker observability to avoid retaining recovery codes in request logs. The obsolete password-hashing CLI and its password-system tests were removed.

## Schema, RLS and data inventory

Historical migrations `001`-`007` define these tables; none are dropped or cleared:

- Identity/history: `schema_migrations`, `app_users`, `auth_sessions`, `audit_events`.
- Risk: `risk_configurations`, `risk_daily_state`, `risk_account_snapshots`, `risk_position_snapshots`, `risk_evaluations`.
- Proposals: `trade_proposals`, `trade_proposal_decisions`.
- Simulations: `backtest_runs`, `paper_events`, `paper_positions`, `paper_trades`.
- Execution/supervision: `execution_intents`, `execution_transitions`, `operational_alerts`, `worker_leases`, `recovery_tasks`.
- Shared limits: `rate_limit_buckets`.

Migration `008` adds `yosemite_members`, mapping each approved `auth.users.id` UUID to an existing `app_users.id`; membership defaults disabled. It adds restricted session/membership, rate-limit and proposal-decision functions. Named application tables enable RLS; restrictive policies enforce per-user ownership even if an older permissive policy exists. Legacy password/session/membership internals and supervision/limiter tables have no direct authenticated-client access. Shared risk configuration is readable only by an approved active member. Session verification consults `auth.sessions` inside a narrowly scoped security-definer function, never by exposing that table to the client.

Existing domain foreign keys are preserved. Legacy password hashes/sessions remain historical storage only and must not be imported as an authentication authority. Live data transfer requires an approved table/row mapping, dependency order, backup and post-import ownership check. Existing source data has not been migrated remotely.

Every active query is in the audited repository/limiter layer: audit insert; owner-scoped proposal list/find; controlled proposal decision RPC; owner-scoped risk-evaluation insert; approved risk-configuration read; session-context/ping RPC; and per-user shared rate-limit RPC. No generic SQL execution endpoint or administrative client exists. See [the migration runbook](runbooks/supabase-migration.md) for preflight and account mapping.

## Validation record

- Before editing: `npm run verify` passed **116 tests, 0 failures/skips**, including the original syntax checks. This only established the old custom-auth baseline.
- After config/safety/health changes: `node --test tests/health.test.mjs tests/supabase-config.test.mjs tests/deployment.test.mjs tests/worker.test.mjs tests/mt5.test.mjs` passed **22 tests, 0 failures/skips**.
- `npm run build:auth` passed and produced the locally bundled browser SDK.
- `npm run deployment-check` failed safely with exit 1 in the current unconfigured process environment: production APP_ENV, HTTPS APP_ORIGIN and Supabase public settings were absent. No secret values were printed. External schema/RLS, approved membership and Auth dashboard verification are still required.
- Final `npm run verify` passed **138 tests, 0 failures/skips**, including the complete JavaScript syntax checks, local SDK build, all unrelated application tests, and eight executed PostgreSQL migration/RLS tests.
- Final `npm run test:browser` passed **6 real headless Chrome tests, 0 failures/skips**, with the actual official SDK and all external requests mocked. These cover sign-in, restoration, logout and its retry/race states, rejected access, PKCE recovery, database outages and network failures.
- Final `npm run test:worker-runtime` passed using isolated local Workerd at compatibility date `2026-10-22`: public config, protected 401 responses, CSP, excluded Worker source, SDK assets and disabled trading. It uses synthetic configuration and makes no Supabase or broker requests.
- Final `npm run worker:build` passed with Wrangler 4.154.0 (574.15 KiB bundle, 110.00 KiB gzip); no production upload or deployment occurred. Final commands used Node 24.22.1.

Tests use mocks for Auth/network/broker behavior and a local PostgreSQL engine for migration/RLS checks. They do not prove the external project's live schema, keys, email delivery, imported records or deployed runtime are correct. No real or demo order was submitted.

## Required external settings, verification and release

The [current Supabase/Cloudflare runbook](runbooks/cloudflare-deployment.md) contains the exact public/secret variable table, Supabase invitation/signup/Site URL/recovery settings, local verification steps, production approval gate, deployment sequence and upload allowlist/exclusions.

The deployed public origin, Supabase URL and disabled execution settings were already confirmed and should be retained. Remaining production blockers are local access to the same-project public key, verification of the existing encrypted Cloudflare `SUPABASE_ANON_KEY`, read-only target schema/policy inspection, approved migration/data mapping (including the existing `SUPABASE_OWNER_USER_ID` owner restriction), invited approved operators, actual RLS/session-revocation tests on the intended project, recovery email verification and approved Cloudflare deployment. Local development/build commands now require Node 22+; no system runtime was replaced. None of these checks may be replaced with a bypass or fabricated readiness claim.

All required execution switches remain `TRADING_MODE=disabled`, `LIVE_TRADING_ENABLED=false`, `WORKER_ENABLED=false`, `MT5_EXECUTION_ENABLED=false`; demo mode and broker connectors are also blocked by runtime configuration. Isolated mocked simulations remain available for tests.
