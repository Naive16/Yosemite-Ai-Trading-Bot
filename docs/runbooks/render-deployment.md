# Yosemite AI — Manual Render Deployment Runbook

This document prepares a manual Render deployment for the standard Node.js server. It does not authorize deployment, Neon access, migration execution, provider calls, broker access, worker activation, or trading.

## Local release gate

From the project root, using Node.js 20 or newer:

```powershell
npm ci
npm run check
npm test
npm run verify
npm run deployment-check
```

Expected results:

- `npm ci` completes from the committed lockfile.
- `npm run check` exits successfully with no syntax errors.
- `npm test` reports all tests passing.
- `npm run verify` reports both syntax checks and tests passing.
- `npm run deployment-check` must print `Deployment preflight passed. No secrets were printed.` once production variables are present.

In the current local development shell, the deployment check is expected to fail when production `APP_ENV`, HTTPS `APP_ORIGIN`, and `DATABASE_URL` are not supplied. That is an environment blocker, not a code failure.

## Create the Render service

1. In Render, choose **New → Web Service**.
2. Select the GitHub repository and the correct project root.
3. Use the Node runtime.
4. Set the build command to `npm ci`.
5. Set the start command to `npm start`.
6. Set the health-check path to `/api/health`.
7. Keep automatic migrations disabled.
8. Record the final HTTPS Render origin before setting `APP_ORIGIN`.

The checked-in `render.yaml` contains the non-secret service defaults above. Do not place credentials in it.

## Production environment variables

Configure these in Render’s encrypted environment settings. Never paste values into source files, `render.yaml`, browser code, logs, or support messages.

Required:

```text
APP_ENV=production
APP_ORIGIN=https://<final-render-origin>
AUTH_USERNAME=<configured-single-user-name>
AUTH_PASSWORD_HASH=<locally-generated-scrypt-hash>
SESSION_SECRET=<random-secret-at-least-32-bytes>
DATABASE_URL=<pooled-neon-runtime-url>
DATABASE_URL_UNPOOLED=<direct-neon-migration-url>
TRADING_MODE=disabled
LIVE_TRADING_ENABLED=false
WORKER_ENABLED=false
MT5_EXECUTION_ENABLED=false
```

Recommended until separately validated:

```text
TRUSTED_PROXY_MODE=none
```

Optional AI, market-data, news, and MT5 read-only credentials should remain unset until individually approved and tested. The application must remain safe and visibly unavailable when those integrations are not configured.

Generate the password hash locally with `npm run hash-password`. Do not store the plaintext password in Render or the repository.

## Neon preparation and migrations

Neon actions require separate approval. Before touching the database:

1. Select the exact target Neon project and branch.
2. Confirm the branch is the intended Render production branch.
3. Review backup/restore and retention settings.
4. Review `db/migrations/001_initial_schema.sql` through `007_rate_limit_buckets.sql` in order.
5. Confirm the migrations are additive and that 007 creates the shared rate-limit table and expiry index.
6. Record the current `schema_migrations` state.
7. Obtain explicit approval for this migration event.

Use the pooled URL only for runtime application traffic. Use the direct, non-pooled URL for migrations. After approval:

```powershell
npm run migrate
```

Expected result: unapplied versions are applied and already-applied versions are skipped. Stop on any error. Never run migrations automatically during Render startup. Never use destructive rollback SQL without separate authorization.

## Run the deployment preflight

After Render environment variables are configured, run the preflight in a safe environment containing those variables:

```powershell
npm run deployment-check
```

Expected result:

```text
Deployment preflight passed. No secrets were printed.
```

Any `FAIL` line blocks deployment. Review warnings, especially proxy trust and migration 007 verification.

## Post-deployment smoke tests

Against the final HTTPS Render URL:

1. `GET /api/health` returns a safe process health response.
2. The frontend loads over HTTPS.
3. Login succeeds with the configured account.
4. The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure`.
5. `/api/auth/me` returns the authenticated session only after login.
6. `/api/private/status` and other private routes return `401` without a session.
7. Cross-origin state-changing requests are rejected.
8. Logout clears the cookie and revokes the server-side session.
9. A revoked session cannot access private routes.
10. Repeated failed login attempts receive the configured rate-limit response.
11. Rate-limit state is shared across instances after migration 007 is verified.
12. Security headers are present, including CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, and Referrer Policy.
13. Missing AI and market-data integrations show unavailable states rather than invented data.
14. Trading, workers, MT5 execution, and broker submission remain disabled.

Do not treat `/api/health` as proof of database readiness, provider connectivity, broker readiness, or trading readiness.

## Logs, rollback, and recovery

- Inspect Render logs for startup/configuration errors without copying secrets, cookies, authorization headers, or database URLs.
- If startup fails, correct the named configuration issue and redeploy the same reviewed code; do not weaken validation.
- Roll back to the previous known-good Render deployment if the application is unhealthy, after confirming schema compatibility.
- If a migration fails, stop and preserve the migration state. Do not retry blindly, delete rows, drop tables, or reverse migrations destructively.
- For a Neon incident, use the approved backup/restore or branch recovery process.
- For an unknown broker outcome, preserve the reconciliation-required state and do not resubmit.

## Costs and boundaries

Render, Neon, AI providers, market-data providers, MT5 connectors, and brokers may charge for usage, compute, storage, egress, or subscriptions. No plan or free-tier eligibility is assumed here.

The standard server does not start a background worker. Trading remains disabled by configuration and execution guards. No hosted deployment or remote migration has been performed by this task.
