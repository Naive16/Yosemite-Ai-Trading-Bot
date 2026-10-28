# Yosemite AI Trading Bot

The local source now uses Supabase Auth and the Supabase Data API as its only active authentication and persistence backend. The existing Cloudflare Worker is `yosemite-ai-trading-bot`; the intended Supabase project is `Yosemite_Ai_Bot` (`txdjozotaxpthpnfikqx`).

Trading, background execution, demo connections and MT5 order submission remain disabled. The dashboard retains its market-data, advisory analysis, risk, proposal, historical simulation and operations surfaces. Unconfigured integrations report unavailable states.

## Local setup

Use Node.js 22 or newer and the committed lockfile. `.node-version` pins the verified Node 24.22.1 runtime for builds. Wrangler was updated from 4.86.0 to pinned 4.154.0 because the previous local runtime could not start with the existing `2026-10-22` compatibility date. The production compatibility date is preserved.

```text
npm ci
npm run verify
npm run worker:build
```

Copy `.env.example` to ignored `.env` for the Node server. Add the project's **public** Supabase publishable key to `SUPABASE_PUBLISHABLE_KEY`; the legacy public anon key is also accepted. Never supply a Supabase secret/service-role key. `npm start` reads `.env` and serves `http://localhost:3000`; existing platform environment values take precedence.

For Wrangler, use ignored `.dev.vars` with `APP_ENV=development`, `APP_ORIGIN=http://localhost:8787`, the project URL and its public key, then run `npm run worker:dev`. Choose `.dev.vars` or `.env` for Wrangler, not both. The SDK is bundled locally by the scripts; no CDN is required.

The local `.env` that existed before this repair contains obsolete custom-auth/Neon names and has not been copied into source or rewritten. Replace those names with the configuration in `.env.example`. Old `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, `SESSION_TTL_SECONDS`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and Hyperdrive bindings are unused by runtime code.

An actual login additionally requires the reviewed Supabase schema/RLS and an approved operator membership. Local mocked tests do not prove the external project has those settings. Do not apply historical migrations blindly or enable public signup. Follow the [Supabase and Cloudflare runbook](docs/runbooks/cloudflare-deployment.md) and [repair report](docs/authentication-repair.md).

## Authentication

The browser's official Supabase client handles sign-in, persistence, refresh, password recovery and sign-out. Protected API calls carry an access token in the Authorization header. The Worker verifies identity with Supabase Auth and checks the server-side approved membership and active Supabase session; browser-supplied roles or user IDs never authorize access. Data access uses the public project key plus the verified user's JWT and database RLS. No privileged Supabase runtime secret is required.

There is no custom password verifier, cookie session store, Neon runtime adapter or Hyperdrive fallback. Existing historical SQL and milestone reports remain as evidence; they are not deployment instructions for the current backend.

## Preparing actual MT5 demo execution

The [MT5 demo release plan](docs/runbooks/mt5-demo-release.md) records the current adapter/provider gaps, external terminal or hosted bridge requirement, exact configuration and separate approval gates through the first broker demo order. Order submission remains blocked. The in-memory execution model and mocked tests do not prove a broker connection or fill.

The selected route is a dedicated Windows/VPS MT5 terminal with an external bridge. `bridge/mt5_demo_probe.py` is an offline-by-default, read-only preparation tool; it is not the missing execution bridge. Its mocked tests run with `npm run test:mt5-probe` using Python's standard library. Do not use its connection option before approval of the exact demo terminal/account; it contains no order-submission path.

Run `npm run demo:preflight` for an offline configuration and implementation inventory. It prints no credentials, opens no broker/database connection, and intentionally exits with code `2` while the release remains blocked. Supplying credentials alone cannot activate execution or mark external verification complete.

## Validation and release

`npm run verify` builds the browser SDK, checks JavaScript syntax and runs the automated suite. Tests mock external integrations; no broker, order submission or production database write is part of verification. `npm run worker:build` packages the Worker locally with `--dry-run`; it does not deploy. `npm run deployment-check` validates the currently supplied environment without printing values and does not verify remote RLS or membership.

`npm run test:browser` runs the real bundled SDK in an installed Chrome/Edge/Chromium browser with all external requests mocked; set `BROWSER_EXECUTABLE` if needed. `npm run test:worker-runtime` starts an isolated local Workerd with synthetic configuration and verifies protected-route denial, static security and disabled execution. It never loads your environment files or connects to Supabase.

Before any production migration or release, review the exact changes and external checks in the runbook and obtain approval. No Git push, remote branch replacement, production deployment or Supabase migration is authorized by local preparation.

Upload the source and lockfile to `Naive16/Yosemite-Ai-Trading-Bot` only after review. Exclude `.env*` except `.env.example`, `.dev.vars*`, `.local-data/`, `.wrangler/`, `node_modules/`, `dist/`, generated `src/vendor/supabase.js`, logs, credentials and local test artifacts. Cloudflare's build must run `npm ci` and `npm run build:client` before deployment.
