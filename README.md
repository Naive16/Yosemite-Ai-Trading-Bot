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

Private dashboard access is provided by Cloudflare Access at the edge, not by an application login page. Add `CLOUDFLARE_ACCESS_JWKS_URL` and `CLOUDFLARE_ACCESS_AUDIENCE` to the same server-side variables (Wrangler `.dev.vars` locally / production environment variables in Cloudflare). The Supabase `SUPABASE_SERVICE_ROLE_KEY` is also server-side only: it enables the Worker's service-role Data API client for Cloudflare-authorized requests and must never be placed in browser code, `.env`, or `.env.example`. The browser receives only the project's public URL and publishable key.

The local `.env` that existed before this repair contains obsolete custom-auth/Neon names and has not been copied into source or rewritten. Replace those names with the configuration in `.env.example`. Old `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, `SESSION_TTL_SECONDS`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and Hyperdrive bindings are unused by runtime code.

An actual login additionally requires the reviewed Supabase schema/RLS and an approved operator membership. Local mocked tests do not prove the external project has those settings. Do not apply historical migrations blindly or enable public signup. Follow the [Supabase and Cloudflare runbook](docs/runbooks/cloudflare-deployment.md) and [repair report](docs/authentication-repair.md).

## Authentication and private dashboard access

Cloudflare Access is the edge authentication barrier for the dashboard and every `/api/private/*` endpoint. There is no application login page. When the browser reaches the dashboard through Cloudflare Access, Cloudflare issues a signed `Cf-Access-Jwt-Assertion` JWT that identifies the user. The Worker verifies that JWT against the Cloudflare Access JWKS (issuer, audience, signature and expiry), maps the asserted email to an `app_users` row whose `username` matches the email, and establishes a server-side session. Requests without a valid assertion receive 401; asserted identities without an approved `app_users` row receive 403.

Protected API calls from the browser send credentials (`credentials: "include"`) so the Cloudflare Access session cookie is attached. Data operations then run through a server-side Supabase service-role client with application-level `user_id` filtering; the service-role key is never sent to the browser. The existing Supabase bearer-token flow remains available for non-browser clients and is preserved unchanged: the Worker verifies the bearer JWT with Supabase Auth, then checks approved membership and active session through a restricted RPC.

The browser receives only the project's public URL and publishable key from `/api/auth/config`. Never put `SUPABASE_SERVICE_ROLE_KEY` or any privileged credential in browser code, `.env`, or `.env.example`.

There is no custom password verifier, cookie session store, Neon runtime adapter or Hyperdrive fallback. Existing historical SQL and milestone reports remain as evidence; they are not deployment instructions for the current backend.

## Manual setup required before first use

This sandbox cannot inspect or change production Supabase/Cloudflare, so the owner must complete these steps manually:

1. **Cloudflare Access** — Add the dashboard domain to a Cloudflare Access application and note its JWKS URL (e.g. `https://<team>.cloudflareaccess.com/.well-known/jwks`) and the intended audience. Set `CLOUDFLARE_ACCESS_JWKS_URL` and `CLOUDFLARE_ACCESS_AUDIENCE` as server-side variables.
2. **Supabase service-role key** — Set `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_*`) as a server-side variable only. It is used exclusively by the Worker for Cloudflare-authorized data operations and must never reach the browser.
3. **Authorized identity** — Insert one `app_users` row whose `username` equals the Cloudflare-asserted email of the authorized operator (e.g. `INSERT INTO app_users (id, username, password_hash) VALUES ('app-operator-001', 'operator@example.test', '<placeholder-satisfying-not-null-32-512-chars>');`). The `password_hash` is never used by the Cloudflare flow but is required by the schema's NOT NULL constraint. No migration is applied by this change; the row is ordinary application data.

Verify: with the above in place, a browser request through Cloudflare Access to `/api/private/status` returns `200` with the operator's username; a request without a valid Cloudflare assertion returns `401`, and an asserted identity with no matching `app_users` row returns `403`. Do not deploy, change production secrets, apply migrations, or enable live trading until these steps are reviewed and approved.

## Preparing actual MT5 demo execution

The [MT5 demo release plan](docs/runbooks/mt5-demo-release.md) records the current adapter/provider gaps, external terminal or hosted bridge requirement, exact configuration and separate approval gates through the first broker demo order. Order submission remains blocked. The in-memory execution model and mocked tests do not prove a broker connection or fill.

The selected route is a dedicated Windows/VPS MT5 terminal with an external bridge. `bridge/mt5_demo_probe.py` is an offline-by-default, read-only preparation tool; it is not the missing execution bridge. Its mocked tests run with `npm run test:mt5-probe` using Python's standard library. Do not use its connection option before approval of the exact demo terminal/account; it contains no order-submission path.

Run `npm run demo:preflight` for an offline configuration and implementation inventory. It prints no credentials, opens no broker/database connection, and intentionally exits with code `2` while the release remains blocked. Supplying credentials alone cannot activate execution or mark external verification complete.

## Validation and release

`npm run verify` builds the browser SDK, checks JavaScript syntax and runs the automated suite. Tests mock external integrations; no broker, order submission or production database write is part of verification. `npm run worker:build` packages the Worker locally with `--dry-run`; it does not deploy. `npm run deployment-check` validates the currently supplied environment without printing values and does not verify remote RLS or membership.

`npm run test:browser` runs the real bundled SDK in an installed Chrome/Edge/Chromium browser with all external requests mocked; set `BROWSER_EXECUTABLE` if needed. `npm run test:worker-runtime` starts an isolated local Workerd with synthetic configuration and verifies protected-route denial, static security and disabled execution. It never loads your environment files or connects to Supabase.

Before any production migration or release, review the exact changes and external checks in the runbook and obtain approval. No Git push, remote branch replacement, production deployment or Supabase migration is authorized by local preparation.

Upload the source and lockfile to `Naive16/Yosemite-Ai-Trading-Bot` only after review. Exclude `.env*` except `.env.example`, `.dev.vars*`, `.local-data/`, `.wrangler/`, `node_modules/`, `dist/`, generated `src/vendor/supabase.js`, logs, credentials and local test artifacts. Cloudflare's build must run `npm ci` and `npm run build:client` before deployment.
