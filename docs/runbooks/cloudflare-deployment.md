# Supabase and Cloudflare release runbook

This is local release preparation for the existing Worker `yosemite-ai-trading-bot` and Supabase project `Yosemite_Ai_Bot`, reference `txdjozotaxpthpnfikqx`. Read-only Cloudflare inspection confirmed its workers.dev origin is `https://yosemite-ai-trading-bot.francismkanda01.workers.dev` and no custom domain is attached. No production migration, dashboard update, secret upload or deployment is performed by these instructions alone. Obtain approval before any potentially disruptive action.

## Required Supabase review and dashboard configuration

1. Open the existing project and verify reference `txdjozotaxpthpnfikqx`; do not create a new project. Confirm its URL is exactly `https://txdjozotaxpthpnfikqx.supabase.co` and obtain its **publishable** key from Project Settings > API Keys. A legacy public `anon` key for this project is accepted. Do not use `sb_secret_` or `service_role` keys in runtime configuration.
2. Inventory the live schema, RLS policies, grants, functions, existing Auth users and domain rows using the supplied read-only review SQL. Compare with historical migrations `001`-`007` and the new Supabase review migration. Take an approved backup/recovery point. Do not assume the project is empty or blindly replay all files. The application never auto-migrates.
3. Review the exact migration and data mapping with the owner. Approve the required changes before applying anything. Preserve existing domain user IDs and their records; map each approved operator's `auth.users.id` to its intended domain identity. Do not migrate legacy passwords or session tokens into Supabase Auth. Missing membership must remain denied.
4. In Authentication > Providers > Email, enable email/password authentication and keep email confirmation enabled. Disable **Allow new users to sign up** in Authentication settings. Invite only approved operators through Authentication > Users. A valid Auth account alone must never grant dashboard access; the reviewed approved-membership mapping is also required.
5. In Authentication > URL Configuration, set **Site URL** to `https://yosemite-ai-trading-bot.francismkanda01.workers.dev`. Add these exact **Redirect URLs**: `https://yosemite-ai-trading-bot.francismkanda01.workers.dev/?recovery=1`, `http://localhost:3000/?recovery=1`, and `http://localhost:8787/?recovery=1` while local verification is needed. Keep the production root URL as an allowed invitation destination if the invitation template uses it. Avoid wildcard domains. Recovery returns to the app root and is handled by the official SDK; verify the email template's action link preserves Supabase's recovery flow. Invited users who have not yet established a password can use recovery to set one before password sign-in testing.
6. Configure production SMTP/email delivery and verify an invitation and recovery email reach the intended operator. Keep passwords and action links out of logs and support reports.
7. Expose only the required public schema/Data API surface. Review the migration's function execution grants and per-user RLS; never grant clients access to `auth.sessions`, arbitrary SQL, legacy passwords or another user's records. Verify a second user cannot read/modify the first user's records even through a direct Data API request.
8. Verify active-session checks before release: an access token captured before sign-out must fail API access immediately after official sign-out, even if its JWT expiry is still in the future.

If target introspection, the public key, invite/membership, SQL review, email delivery or external RLS verification is unavailable, production readiness remains blocked. Record the exact missing item; do not mask it with an authentication error or bypass authorization.

## Cloudflare variables and secrets

Use the **existing** Worker Settings > Variables and Secrets. Read-only inspection confirmed `https://yosemite-ai-trading-bot.francismkanda01.workers.dev`; set that exact origin for `APP_ORIGIN` and Supabase Site URL. Recheck Routes/Domains immediately before release in case settings have changed.

Build tooling requires Node 22 or newer; `.node-version` records the tested Node 24.22.1. If an existing Cloudflare build override sets `NODE_VERSION`, align it with `24.22.1`; this is a public **build** variable, separate from Worker runtime bindings. The pinned Wrangler 4.154.0 supports the preserved `2026-10-22` compatibility date.

| Name | Classification | Required value/purpose |
| --- | --- | --- |
| `APP_ENV` | Public runtime variable | `production` |
| `APP_ORIGIN` | Public runtime variable | `https://yosemite-ai-trading-bot.francismkanda01.workers.dev` |
| `SUPABASE_URL` | Public runtime variable | `https://txdjozotaxpthpnfikqx.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` or existing `SUPABASE_ANON_KEY` | Public key; may remain an encrypted Cloudflare secret | Existing `SUPABASE_ANON_KEY` secret is present and can be reused through the supported alias after verifying it belongs to this project. No key value was read or printed. |
| `TRADING_MODE` | Public runtime variable | `disabled` |
| `LIVE_TRADING_ENABLED` | Public runtime variable | `false` |
| `WORKER_ENABLED` | Public runtime variable | `false` |
| `MT5_EXECUTION_ENABLED` | Public runtime variable | `false` |
| `MT5_DEMO_MODE` | Public runtime variable | `false` |
| `MT5_CONNECTOR` | Public runtime variable | `none` |
| `TRUSTED_PROXY_MODE` | Public runtime variable | Keep `none` unless the trusted platform header behavior has been separately verified |
| `DATABASE_QUERY_TIMEOUT_MS` | Optional public runtime variable | Default `5000` |
| `TWELVE_DATA_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `NEWS_API_KEY` | Optional encrypted secrets | Preserve only separately approved provider integrations; leave unset for auth verification |
| `MIRRO_API_KEY`, `MIRRO_ACCOUNT_ID` | Optional server-only credentials | Leave unset; the connector remains disabled |

Read-only binding inventory found `APP_ENV=production`, the correct Supabase URL and disabled execution settings, but also legacy `DATABASE_URL` and `HYPERDRIVE` bindings, encrypted `SESSION_SECRET`, `SUPABASE_OWNER_USER_ID` and `OPENROUTER_API_KEY`. The custom auth username/password-hash names required by the old local implementation were absent. Binding names/types were inspected without displaying secret values or the database URL.

Before retiring `SUPABASE_OWNER_USER_ID`, use its existing dashboard value privately to identify the intended owner Auth UUID and provision the approved `yosemite_members` mapping to the preserved domain user. Do not paste the value or any credential into chat. Preserve the existing encrypted anon key; moving it to a public variable is unnecessary.

**No privileged Supabase secret, service-role key, database password or custom session secret is required by the Worker.** Remove obsolete `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, `SESSION_TTL_SECONDS`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and unused Hyperdrive bindings only as a reviewed production configuration change after verifying no other deployed component uses them. Runtime ignores these old paths already.

`wrangler.jsonc` commits the known project URL and disabled-execution defaults. `keep_vars=true` preserves dashboard-managed variables. Verify the effective bindings before release; do not upload an environment file as an asset. Cloudflare secret changes can create/deploy versions, so changing a secret still requires the production approval boundary.

## Exact local verification

1. Use Node 22+ (tested with 24.22.1), then run `npm ci`, `npm run verify`, `npm run test:browser`, `npm run test:worker-runtime`, and `npm run worker:build`. Browser tests require installed Chrome/Edge/Chromium or `BROWSER_EXECUTABLE`. The runtime smoke uses a synthetic, isolated local Workerd configuration with no remote bindings or environment-file loading. The last command is a local Wrangler dry run; it does not deploy or prove live permissions.
2. For Node, copy `.env.example` to ignored `.env`; set the public key and keep `APP_ENV=development`, `APP_ORIGIN=http://localhost:3000`. Run `npm start` and open `http://localhost:3000/`. The startup helper reads `.env` with platform environment values taking precedence.
3. For Wrangler, use ignored `.dev.vars` instead: `APP_ENV=development`, `APP_ORIGIN=http://localhost:8787`, the same Supabase URL and its public key, and all disabled-execution settings. Run `npm run worker:dev` and open `http://localhost:8787/`. Wrangler prefers `.dev.vars` over `.env`; do not keep conflicting local files.
4. Confirm `/api/health` returns the minimal liveness payload with trading disabled. Confirm `/api/auth/config` reports ready only with valid public configuration; it must never return privileged secrets. With configuration missing, protected APIs must deny access.
5. In a signed-out/private browser, request every `/api/private/*` route; expect 401 and no private data. Submit an invalid password through the login UI; expect a generic credential error. Sign in with an invited, approved operator and confirm its dashboard loads.
6. Refresh the page, wait through token refresh and reopen a tab to verify official session persistence. A forced expired/invalid token must return 401. Confirm an invited Auth account without membership receives 403.
7. Test missing schema/RPC, permission failure and simulated network timeout separately; expect service-unavailable states without passwords, tokens, cookies, authorization headers or raw provider responses. Never relabel these as a wrong password.
8. Sign out and confirm the private UI clears. Replay a previously captured bearer token locally and verify access is denied after the server's active-session check. Do not save captured tokens in command history, screenshots or files.
9. Request recovery for an approved account, follow the email link, set a strong replacement password, then verify a fresh sign-in. Inspect the app's pending, failed and signed-out states. Never print recovery links.
10. Use the supplied transactional database verification to test RLS for two distinct identities, public/no-membership access and post-sign-out session checks. Run only against an approved isolated/reviewed target. Recheck all execution flags and confirm no broker request or order is made.

Local tests use mocks and a local embedded PostgreSQL engine where configured. Live Supabase login, email recovery, data import and deployed Cloudflare runtime verification remain separate checks until they are actually performed.

## Safe production release after approval

1. Record passing tests, target schema verification, verified memberships/RLS, exact final environment and current Cloudflare version. Review every changed source/configuration file and the approved SQL before touching production.
2. Check the existing deployment pipeline before uploading: if that branch triggers production builds, treat the upload as the deployment step and wait for deployment approval. Manually upload the reviewed source to `Naive16/Yosemite-Ai-Trading-Bot`. Include `api/`, `src/` source (including `.assetsignore` and `_headers`), `db/`, `scripts/`, `tests/`, current docs, both HTML entry files, `server.js`, `package.json`, `package-lock.json`, `.node-version`, `.env.example`, `.gitignore` and `wrangler.jsonc`. Remove the obsolete remote `scripts/hash-password.mjs` and `tests/hash-password.test.mjs` when replacing the repository. Existing optional Vercel/Render configs are legacy configurations, outside this Cloudflare release verification.
3. Exclude `.env*` except `.env.example`, `.dev.vars*`, credentials/keys, `.local-data/`, `.wrangler/`, `node_modules/`, `dist/`, generated `src/vendor/supabase.js`, coverage, logs and screenshots/test artifacts. This folder was not initially a Git checkout, so review the upload allowlist explicitly.
4. Configure Cloudflare's build command to run `npm ci` followed by `npm run build:client`. The generated browser SDK must exist before `npx wrangler deploy`. For a manual shell release, run `npm run verify` and `npm run worker:build` first and use the pinned local Wrangler. Target the existing Worker and its current production environment explicitly.
5. Obtain approval for reviewed schema/configuration changes and production deployment. Only then apply the approved non-destructive migration/mapping and configure the approved Worker variables. Deploy using the existing authorized pipeline or `npx wrangler deploy` from the reviewed folder. Never create a replacement Worker or change domains unintentionally.
6. Verify liveness, static source exclusions (`/worker.js` must be 404), CSP, configuration error states, correct/invalid sign-in, refresh, 401/403 boundaries, per-user isolation, recovery, sign-out replay denial, unavailable providers and disabled execution on the deployed origin.
7. If deployment fails, use an approved rollback to the recorded Worker version. A Worker rollback does not roll back database changes. Do not delete tables or reverse SQL/data changes as a rollback shortcut; follow the reviewed database recovery plan.

## Official references

[Supabase Auth sessions](https://supabase.com/docs/guides/auth/sessions), [Supabase sign-out](https://supabase.com/docs/reference/javascript/auth-signout), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Cloudflare static asset exclusions](https://developers.cloudflare.com/workers/static-assets/binding/#ignoring-assets), [Cloudflare build runtime versions](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), and [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
