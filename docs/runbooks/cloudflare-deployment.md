# Cloudflare Workers deployment runbook

This repository now includes a native Fetch API Worker in `src/worker.js` and local configuration in `wrangler.jsonc`. This guide describes manual deployment only; no hosted deployment, live Supabase connection, migration, or secret upload has been performed by local verification.

## Local validation

Install dependencies from the lockfile. Wrangler is pinned locally at `4.86.0`, which supports the project's current Node `20.18.1` runtime:

```text
npm ci
npm run check
npm test
npm run worker:test
npm run worker:build
```

Current Cloudflare Preview workflows require a newer Wrangler release and therefore Node 22 or newer. Node 22 was not available on the audited machine; upgrade Node without overwriting the existing installation before moving to Preview-specific tooling.

If Wrangler is available in the project environment, use the documented local command:

```text
npm run worker:dev
```

The local Worker should serve the frontend and `/api/health`. Do not point local tests at production Supabase or provider credentials. The Worker configuration does not contain secret values.

## Manual GitHub and Cloudflare setup

Upload the approved source files manually to the existing GitHub repository. In Cloudflare, create a Worker connected to that repository and select the project root. Configure the build/install command using the repository's package manager and the Worker entry point from `wrangler.jsonc`. Keep the deployment target and production branch explicit before saving.

The Worker uses Workers Static Assets. The root `.assetsignore` excludes API source, migrations, scripts, tests, documentation, package metadata, environment files, local data, and logs from public assets. Review both `.assetsignore` and `wrangler.jsonc` before deploying.

## Variables and secrets

Configure these in the Cloudflare Worker settings, not in GitHub files:

- Public/runtime variables: `APP_ENV=production`, final HTTPS `APP_ORIGIN`, `TRADING_MODE=disabled`, `LIVE_TRADING_ENABLED=false`, `WORKER_ENABLED=false`, and `MT5_EXECUTION_ENABLED=false`.
- Encrypted secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable/anon key only — never a service-role or secret key), `SUPABASE_OWNER_USER_ID` (single workspace owner UUID), `SESSION_SECRET`, and `DATABASE_URL` (Supabase Supavisor Transaction Mode `:6543` with `?sslmode=require`).
- Keep `DATABASE_URL` server-side. Use the Supabase Transaction Pooler URL (`:6543`) for Worker runtime traffic (the Worker opens short-lived per-request PostgreSQL clients so sockets are never shared across requests); keep `DIRECT_URL` (`:5432`) outside the Worker and use it only in a separately authorized migration workflow.
- Leave AI, market-data, news, and MT5 credentials unset until each integration is individually approved and verified. Unconfigured providers must remain unavailable.

The application rejects production startup when required authentication, database, origin, or safety configuration is missing or unsafe. Never put plaintext passwords, password hashes, database URLs, or provider keys in `wrangler.jsonc`, source code, frontend assets, or documentation.

## Supabase database review and approval boundary

Before any migration, confirm the exact Supabase project reference, database backup/PITR posture, and migration target. Review migrations `001` through `008` in order (`008_supabase_rls_hardening.sql` enables Row Level Security across all 21 `public` tables and locks down PostgREST access). Use Supabase Session Mode (`:5432`, IPv4-compatible) or Direct (`:5432`, IPv6) as `DIRECT_URL` for migration tooling and Transaction Mode (`:6543`) as `DATABASE_URL` for runtime traffic. No migration is run automatically by the Worker. See [`docs/supabase-migration-plan.md`](../supabase-migration-plan.md) for the non-destructive Neon data preservation workflow.

## Post-deployment checks

After the service is deliberately deployed, verify `/api/health`, HTTPS and secure session cookies, single-owner Supabase login, `403` rejection for non-owner users, database-backed `/api/auth/me`, same-origin CSRF enforcement, logout revocation, protected-route authorization, shared rate-limit behavior, and static asset restrictions. Confirm provider-unavailable states are explicit and that no route submits orders or starts a worker.

## Rollback and recovery

Use Cloudflare's version rollback only after confirming the target Worker version. A Worker rollback does not roll back Supabase PostgreSQL data or migrations. Keep the legacy Neon database untouched until post-cutover verification is complete, and never reverse a migration by deleting data without explicit authorization. Preserve logs and the failing request correlation information without recording secrets, cookies, tokens, or request bodies.

Cloudflare and Supabase limits and costs depend on the selected account plans and usage. Confirm current pricing and quotas in the respective dashboards before enabling production traffic.
