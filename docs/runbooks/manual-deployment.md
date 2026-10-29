# Yosemite manual application release

Reviewed locally on 28 October 2026. The owner performs deployment manually. No deployment, push, merge, production mutation, migration or broker action was performed during this preparation.

The release is a Vanilla JavaScript SPA and request-driven Cloudflare Worker using **Supabase Auth and the Supabase Data API**. The local Windows MT5 components are read-only diagnostics, not an implemented order-execution bridge. Neon, Hyperdrive and custom password/session authentication are retired runtime paths. The optional Node server is a local alternative, not the Cloudflare release target.

## Readiness and stop conditions

| Area | Status and release gate |
| --- | --- |
| Application | Local security tests and runtime/asset checks pass. Manual production release remains conditional on source reconciliation, target configuration and actual Supabase schema/auth/RLS verification below. |
| Read-only MT5 | v1.03 ACK source, compiled artifact and installed binary match. Runtime ACK verification is pending; no new native capture was run. |
| Demo execution | Blocked: unresolved source-time/UTC mapping, quote freshness failure, pending ACK runtime verification and no approved native execution bridge/order procedure. |
| Live trading | Disabled and outside this release. |

**Stop at any failed or unverified required check.** Do not substitute a successful build, HTTP 200 health response, paper simulation, test fixture or completed ACK exchange for target identity, authentication, RLS, source quote freshness or actual broker execution evidence. Optional unconfigured analysis/data providers may remain explicitly unavailable for this disabled dashboard release; do not fabricate healthy states.

Keep these exact safety settings throughout preparation, deployment and smoke testing:

```dotenv
TRADING_MODE=disabled
LIVE_TRADING_ENABLED=false
WORKER_ENABLED=false
MT5_EXECUTION_ENABLED=false
MT5_DEMO_MODE=false
MT5_CONNECTOR=none
```

The committed configuration enforces these states and rejects enablement. Effective remote settings must still be verified by the owner. Keep native Algo Trading OFF and external Python trading disabled. Do not launch MT5 diagnostics, connect a broker, submit orders or approve permission prompts as part of application deployment. Native freshness limits remain 15 seconds old and 5 seconds future, with no assumed offset.

## 1. Establish the GitHub release source

1. Use `Naive16/Yosemite-Ai-Trading-Bot` as the source of truth. This local folder has **no `.git` directory**, so there is no trustworthy local branch/status/commit history. The GitHub connector reads were unavailable during this audit; recent remote commits, default branch and deployed revision were not verified.
2. In an authenticated, separate checkout or GitHub's reviewed source view, compare the local release against the actual intended branch. Resolve differences manually; do not replace remote work blindly. Record the final reviewed commit SHA, release timestamp, dependency lockfile and changes. Do not deploy from an unrecorded local folder.
3. Inspect the existing GitHub/Cloudflare build integration **before uploading or pushing**. A watched branch change can deploy automatically. The owner must control that trigger before source reconciliation; do not assume a source upload is deployment-free.
4. Include `api/`, `src/` source (especially `src/.assetsignore`, `src/_headers` and `src/index.html`), `bridge/` Python/MQL5 source and requirements, `db/`, `scripts/`, `tests/`, docs, both HTML entries, `server.js`, `package.json`, `package-lock.json`, `.node-version`, `.env.example`, `.gitignore` and `wrangler.jsonc`. Do not restore retired password-hash helpers from an older remote version.
5. Exclude `.env*` except `.env.example`, `.dev.vars*`, secrets/keys, `.venv/`, `node_modules/`, `.local-data/`, `.wrangler/`, `dist/`, generated `src/vendor/supabase.js`, logs, bytecode, database exports, diagnostic traces and compiled `.ex5` artifacts. Keep native binaries as verified local build artifacts with source/hash provenance. Do not upload private diagnostic evidence to GitHub or Cloudflare assets.

## 2. Local checks before the owner's release

Use Node **22 or newer**, with `.node-version` pinning the tested **24.22.1**, and the existing lockfile. The default `node` on this computer currently reports **20.18.1**, so it is not the supported release-build runtime. Select the supported runtime in the owner's build shell/Cloudflare build configuration; do not silently update dependencies or compatibility settings. The audit used the already-installed bundled Node 24.22.1 without changing PATH or environment settings.

For a fresh reviewed checkout, install locked dependencies and generate the required browser asset:

```powershell
npm ci
npm run build:client
```

Use these existing checks when source, dependencies or runtime have changed since the recorded results:

```powershell
npm run check
npm run check:demo
npm test
npm run test:browser
npm run test:worker-runtime
& .\.venv\Scripts\python.exe -m unittest discover -s tests -p 'mt5*_test.py' -v
```

The Windows Python command assumes the existing Python 3.11.9 x64 project environment. Tests use synthetic SDKs and do not require connecting MT5. Browser tests intercept all Auth/API traffic. The existing Worker smoke uses a local synthetic configuration and no remote bindings. Preserve previous diagnostic files; use a new output directory for any new audit artifacts. Do not rerun already-passing suites on identical source merely to generate a new timestamp.

Do **not** run `npm run worker:build` during this no-deployment preparation: it invokes a Wrangler deploy subcommand, even though configured as a dry run. No Wrangler deploy command was run in this audit. Do not run `npm run migrate`: it deliberately refuses automatic migrations. Do not run demo preflight/capture commands against the installed terminal as part of these checks.

`npm run deployment-check` checks configuration syntax/invariants only and does not read `.env` automatically, prove the database target, validate a key against the service, or inspect remote settings. Use only with the owner's intentionally prepared environment and never print it. An absent production configuration must fail, not be replaced with a test key.

## 3. Review Cloudflare configuration and asset routing

Verify these exact committed settings and the effective target before the owner deploys:

| Item | Expected configuration/check |
| --- | --- |
| Worker | Existing `yosemite-ai-trading-bot`; correct account, production target and recorded prior deployment version |
| Entry point | `src/worker.js`; preserve compatibility date `2026-10-22` and `nodejs_compat` for this tested release |
| Assets | Directory `src`, binding `ASSETS`, `run_worker_first: ["/api/*"]`, `not_found_handling: "none"` |
| Production HTML | `src/index.html` references root paths `/styles.css` and `/app.js`; do not serve the repository-root Node HTML as the Worker entry |
| Browser SDK | Generate `src/vendor/supabase.js` before deployment; no separate browser auth client is used |
| Exclusions | `src/.assetsignore` excludes `worker.js`, environment files, maps and logs; the repository-root `.assetsignore` alone is insufficient |
| Headers | `src/_headers` supplies CSP/security headers; API responses set their own security headers and `no-store` |
| Domains/origin | Recheck actual Routes/Domains against committed `APP_ORIGIN` and Supabase Site URL. The documented workers.dev host is historical evidence, not a live recheck. No new/custom domain is implied. |
| Variables | `keep_vars=true` does not prove the deployed variables are safe or current. Review dashboard-managed values privately and reconcile with the release configuration. |
| Observability | Logs and traces are enabled, query strings redacted; verify no request passwords, bearer tokens, recovery links or provider credentials are logged |

API requests must reach the Worker instead of an HTML fallback. Missing static files must return 404. The browser shell is public; private data requires authorization on every API request. No cron trigger or execution process is introduced by this request-driven dashboard.

This routing behavior follows [Cloudflare Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/), checked 28 October 2026. Do not change SPA fallback behavior or the compatibility date without reviewing and retesting the affected behavior.

## 4. Configuration and secret inventory — names only

Inspect names and purposes here; retrieve any required values privately from the verified target/provider. No secret value belongs in this runbook, source, command arguments or reports.

| Names | Purpose/classification |
| --- | --- |
| `APP_ENV`, `APP_ORIGIN` | Required public runtime mode and exact HTTPS application origin |
| `SUPABASE_URL` | Required public identity of the existing pinned Supabase project |
| `SUPABASE_PUBLISHABLE_KEY` or supported alias `SUPABASE_ANON_KEY` | Required project-matched public publishable/anon key; an existing encrypted binding can remain encrypted. Prefer one consistent name; conflicting aliases need review. |
| `TRADING_MODE`, `LIVE_TRADING_ENABLED`, `WORKER_ENABLED`, `MT5_EXECUTION_ENABLED`, `MT5_DEMO_MODE`, `MT5_CONNECTOR` | Required disabled-execution controls listed above |
| `TRUSTED_PROXY_MODE` | Optional; conservative default until trusted platform IP-header behavior is verified |
| `DATABASE_QUERY_TIMEOUT_MS`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`, `AUTH_RATE_LIMIT_MAX_ATTEMPTS` | Optional application limits; Auth service limits are independently configured and enforced by Supabase |
| `NODE_VERSION` | Build-only override, if used; align with `.node-version`, not a secret/runtime binding |
| `TWELVE_DATA_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `NEWS_API_KEY` | Optional encrypted provider credentials; unnecessary for the disabled auth/dashboard release. Do not add a paid provider during preparation. |
| `MARKET_DATA_PROVIDER`, `AI_PROVIDER`, `NEWS_PROVIDER` | Optional provider selection; document unavailable features honestly |

The complete optional setting names are in `.env.example`; runtime parsing and limits are in `api/_lib/config.js`. No Supabase service-role/secret key, Auth admin credential, database connection string or custom session secret is required by this runtime. Broker passwords, `MIRRO_API_KEY` and `MIRRO_ACCOUNT_ID` are not needed for this release and must not be added to browser assets or enabled connectors.

Legacy `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `HYPERDRIVE`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, `SESSION_TTL_SECONDS` and `SUPABASE_OWNER_USER_ID` are not authorization/runtime fallbacks. Retiring them or changing any deployed secret is a separate reviewed production action; first verify other components and preserve the owner mapping. No such changes were made here. Cloudflare documents that [secret put/delete can deploy immediately](https://developers.cloudflare.com/workers/configuration/secrets/); do not treat secret edits as harmless preparation.

## 5. Verify database identity, migrations and operators before release

1. Privately verify the existing Supabase project **`Yosemite_Ai_Bot`, reference `txdjozotaxpthpnfikqx`**, against the pinned runtime URL and public key. Do not create a substitute database, configure Neon, or infer identity from a friendly project name or a successful health response.
2. Run only the reviewed metadata reads in `db/supabase-preflight.sql` on that exact target. Inspect `schema_migrations` existence/definition before reading its ledger. Compare actual columns, types, constraints, functions, views, grants and RLS with `db/migrations/001`–`008`; ledger entries alone are insufficient.
3. `001_initial_schema.sql` through `007_rate_limit_buckets.sql` define the historical domain schema. `008_supabase_auth_rls.sql` is the reviewed Supabase Auth/membership/RLS transition and records version `000008`. Its transaction alters grants and authorization; it is not an automatic or blindly repeatable startup operation. Read [the Supabase migration runbook](supabase-migration.md) before proposing any SQL.
4. Actual target migration status is **unverified in this local audit**. If required tables, session functions, RPCs, RLS or data mappings are absent/conflicting, stop application release. Back up and review the exact missing SQL/data transition separately; do not apply migrations or create schema while following local preparation steps.
5. Verify approved operator invitation, email/password provider, email delivery/recovery, exact Site URL and recovery redirects. Keep public signup and anonymous sign-ins disabled. Verify an enabled `yosemite_members` mapping from the correct Auth UID to the preserved domain `app_users.id`; an Auth user alone must not grant access. Never remap ownership from browser input or migrate legacy password/session credentials.
6. Verify active-session rejection after logout and per-user isolation using approved test identities/records on an isolated or explicitly approved target. Check the three required RPCs: `yosemite_session_context`, `yosemite_rate_limit`, and `yosemite_transition_proposal`, plus their helper policies/functions. No general SQL or privileged client access may be exposed. Any mutation needed for this verification is a separate operator-controlled approval, not part of this preparation.
7. Check Supabase Auth's actual configured request/rate limits. The browser signs in through the official SDK directly, and the optional Worker login route forwards to Auth; application `AUTH_RATE_LIMIT_*` settings do not implement a separate pre-authentication login throttle. Protected application operations use the scoped atomic database limiter. Confirm provider 429 handling with controlled test traffic, not repeated guesses against the real operator's password.

The existing [Cloudflare/Supabase runbook](cloudflare-deployment.md) supplies the detailed provider configuration and recovery flow. Its historical remote observations must be rechecked by the owner; this audit did not inspect or modify production.

## 6. Owner's numbered manual deployment checklist

1. Reconcile the reviewed files with GitHub, record the intended release commit, and control any automatic deployment trigger.
2. Use supported Node and locked dependencies; confirm the applicable local test results and generate the browser SDK from that exact revision.
3. Verify the existing Cloudflare account/Worker/domain, effective variable names and private values, asset configuration, and every disabled execution setting.
4. Verify the actual Supabase identity, schema/migration status, approved membership, RLS, active-session behavior and recovery delivery. Stop for any missing verification or separately required production change.
5. Record the current Cloudflare deployment/version, configuration inventory, data backup/restore evidence and a **safe Supabase-compatible rollback version**. An older custom-auth/Neon deployment is not automatically a safe rollback candidate.
6. In the existing Cloudflare GitHub build configuration, verify the connected repository/branch/commit and locked dependency installation followed by `npm run build:client`. Confirm the deployment uses the committed Wrangler configuration and correct assets. Do not substitute a standalone static HTML upload or create a replacement Worker.
7. Only the owner, after clearing the gates, manually triggers the existing authorized Cloudflare deployment. This step publishes code; source synchronization and secret/database changes are not implied permissions for the assistant. Record the resulting version and associated GitHub SHA.
8. Run the post-deployment checklist below immediately. A failed required check stops release acceptance. Keep all execution controls disabled regardless of deployment status.

## 7. Post-deployment smoke-test checklist

Use the verified HTTPS origin. Keep credentials and tokens in the browser or trusted memory-only tooling; do not save them to shell history, screenshots, logs or reports.

- [ ] `/`, `/styles.css`, `/app.js` and `/vendor/supabase.js` load with appropriate content types and no console/module errors. Check CSP, frame protections, `nosniff` and no-store on the HTML entry.
- [ ] `/worker.js`, `/.env`, `/.dev.vars`, `/api/_lib/config.js` and a nonexistent asset return **404**, not source content or the SPA shell. Unknown API returns JSON 404; wrong API method returns 405.
- [ ] `GET /api/health` returns 200 with both trading flags false. Its `database: "unknown"` is intentional liveness, not database verification. `/api/auth/config` reports configured public settings only. Missing/invalid production configuration must fail with 503, not appear healthy.
- [ ] In a private signed-out browser, `/api/auth/me` and **all** `/api/private/*` routes deny access with 401 and no private data. Legacy cookies alone and malformed/expired bearer tokens must not authorize access.
- [ ] The dashboard loads directly with no sign-in form, on open and on refresh. In a private browser, `/api/auth/me` and all `/api/private/*` routes deny anonymous access with 401 and no private data. Never include a token in the acceptance report.
- [ ] Authenticated `/api/private/status` confirms disabled trading and `/api/private/operations` reports a healthy authenticated Supabase permission check. Other unconfigured components may remain explicitly unavailable. Verify the intended user's actual owned records, not only an empty dashboard.
- [ ] Using approved test identities, confirm the second owner cannot read or modify the first owner's rows through either the Worker or direct Data API. Verify anonymous access and revoked membership remain denied. Do not mutate real trading/domain records merely to smoke-test deployment.
- [ ] Cross-origin/missing-origin login and logout requests are rejected with 403. Authenticated protected writes must reject invalid origin/authorization without side effects; individual endpoints can return 400 for validation rejection. Do not use a valid proposal approval, paper mutation or order as a smoke test.
- [ ] Confirm Supabase 429 responses and application rate limits fail closed with controlled test traffic and appropriate retry behavior. Missing RPC/RLS permissions or provider/network failures must be service-unavailable states rather than invalid-password messages. Simulate outages only in an isolated approved environment, never by disrupting production.
- [ ] Sign out, verify protected UI clears and private APIs return 401. With trusted memory-only test tooling, verify a formerly valid JWT is rejected immediately after logout despite its unexpired `exp`.
- [ ] Verify approved invitation/recovery email delivery and the exact PKCE recovery redirect using a designated test identity, then fresh sign-in and sign-out. Do not record action links/passwords.
- [ ] Recheck effective disabled settings, no broker calls/orders and no token/credential leakage in sanitized logs. Record the deployed version/SHA and each result. MT5 ACK runtime, timestamps and demo/live execution remain separate blocked gates.

## 8. Failed checks and rollback

On a failed required check, stop release acceptance, preserve sanitized evidence and keep trading disabled. Do not weaken RLS, origins, rate limits, permissions or quote freshness to produce a passing result.

The owner can select the previously recorded **compatible and safe** version in Cloudflare → existing Worker → Deployments → Rollback, then repeat the smoke tests and verify effective settings. A rollback is a production action; none was performed here. [Cloudflare rollback guidance](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) confirms connected resources are not rolled back with code. Do not reverse migrations, delete tables/data or restore an incompatible authentication version as a shortcut. If no safe version matches the actual schema/auth configuration, stop and use the owner's access-restriction/recovery plan rather than restoring vulnerable behavior.

## Local verification record for this handoff

- Reused unchanged results from the immediately preceding ACK repair: **69 Python tests passed**, including 29 paired-trace and 40 probe/timestamp tests; **160 application tests passed**, including authentication, RLS/migrations, rate limits, execution-disablement and Worker route tests. They were not rerun because this preparation made no application, configuration or diagnostic source changes.
- Ran `scripts/browser-auth-smoke.mjs` directly with bundled **Node 24.22.1**: **6 tests passed, 0 failures/skips**. All external Auth/API calls were intercepted.
- Ran an isolated audit copy of `scripts/worker-runtime-smoke.mjs` with bundled Node 24.22.1: **passed, exit 0**. It used the committed asset/routing/compatibility settings, production-mode configuration and a synthetic public key, with no real Auth/database/broker requests. Added checks covered CSS/app assets and secret/source/missing-file exclusions. No Wrangler deploy command was used.
- Hash-verified v1.03 MQL5 source against the compiled source and installed script, and the 23,358-byte installed `.ex5` against the compiled artifact/hash. Existing compiler log: **0 errors, 0 warnings**. Compilation was not repeated on unchanged source. ACK wire contract and bounded waits still match Python. No runtime ACK success is claimed.
- All eight authentication baseline files match. Secret-pattern review of release source found no candidate private keys, privileged Supabase keys, provider secrets or database credential URLs; literal test fixtures were excluded. This is a local pattern/source review, not proof of remote secret hygiene.
- Audit evidence is in `.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/`, including a 158-file before manifest and MT5/auth verification. Existing historical diagnostic evidence is preserved. The only maintained repository file changed in this preparation is this runbook.

Remaining application blockers are target verification and source/build provenance, including supported Node selection. Read-only native ACK verification and the unresolved approximately two-hour MT5 timestamp discrepancy block trading readiness, not deployment of the verified disabled dashboard. No execution implementation is started by this handoff. Wait for the owner's manual deployment.
