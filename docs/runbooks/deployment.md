# Deployment runbook

This project is prepared for a request-driven Vercel deployment of the dashboard and API, with Supabase providing both single-owner authentication and server-side PostgreSQL persistence. No deployment, Git push, or remote project configuration was performed.

## Platform boundary

- Vercel can host the static dashboard and `api/*.js` request handlers using the checked-in `vercel.json` Node.js 20 function configuration.
- The API uses same-origin `/api/...` requests. `APP_ORIGIN` must be the final HTTPS deployment origin; no browser API key or database credential is required.
- Supabase PostgreSQL is the database provider. Use the Supavisor Transaction Mode URL (`:6543`) as `DATABASE_URL` for application requests and the Supavisor Session Mode (`:5432`) or Direct (`:5432`) URL as `DIRECT_URL` only for reviewed migrations (`001`–`008`).
- The in-process worker is disabled and is not a persistent Vercel worker. `WORKER_ENABLED=false` is required for this deployment boundary.
- MT5 and order execution remain disabled. `TRADING_MODE=disabled`, `LIVE_TRADING_ENABLED=false`, and `MT5_EXECUTION_ENABLED=false` are required.

## Required production environment variables

Configure these in the deployment provider's encrypted server-side environment settings, never in browser code or Git:

```text
APP_ENV=production
APP_ORIGIN=https://<final-deployment-origin>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<supabase-anon-publishable-key-only>
SUPABASE_OWNER_USER_ID=<single-owner-supabase-user-uuid>
SESSION_SECRET=<random-secret-at-least-32-bytes>
DATABASE_URL=<Supabase-Supavisor-transaction-mode-6543-url>
DIRECT_URL=<Supabase-Supavisor-session-mode-5432-or-direct-5432-url>
TRADING_MODE=disabled
LIVE_TRADING_ENABLED=false
WORKER_ENABLED=false
MT5_EXECUTION_ENABLED=false
```

Optional provider credentials should remain unset unless separately reviewed and tested. The application starts safely with market data, Claude, news, and broker integrations unavailable.

For optional Claude analysis, configure `ANTHROPIC_API_KEY` and the bounded `ANTHROPIC_*` settings in the encrypted server-side environment. For the optional MirroAPI MT5 read connector, configure `MT5_CONNECTOR=mirro`, `MIRRO_API_KEY`, `MIRRO_ACCOUNT_ID`, and the exact `MT5_ALLOWED_ACCOUNT_LOGINS` and `MT5_ALLOWED_SERVERS` values. The application still rejects live classification and keeps order submission disabled. MirroAPI credentials must never be placed in browser code or committed to source.

## Preflight and migration sequence

1. Select or create the Vercel project and record its production origin.
2. Add the production environment variables through the provider's secret manager.
3. Run `npm run deployment-check` in an environment containing the production variables. It prints only safe validation messages and must pass before deployment.
4. Review the additive SQL migrations (`001`–`008`) and confirm the target Supabase project, backup/restore path, and approval. Do not run `npm run migrate` against a remote database without explicit authorization for that migration event.
5. Deploy from a verified Git commit through the selected source-control integration.
6. Verify `GET /api/health`, the login flow, logout/revocation, protected API responses, security headers, and database-backed sessions. Do not treat `/api/health` as proof that providers or execution are ready.

## Proxy and rate-limit notes

Keep `TRUSTED_PROXY_MODE=none` until the actual platform proxy behavior is confirmed. If the deployment requires trusted forwarded headers, set `TRUSTED_PROXY_MODE=platform` only after reviewing the platform's header guarantees.

The login, market-data, AI, risk, and simulation request limiters use migration `007_rate_limit_buckets.sql`, with atomic upserts, indexed expiry cleanup, and fail-closed database errors, while `008_supabase_rls_hardening.sql` enables Row Level Security across all 21 `public` tables. Apply and verify migrations `001`–`008` through the approved `DIRECT_URL` (`:5432`) migration process before public exposure. The market-data cache remains process-local and is only a freshness optimization, not durable state.
