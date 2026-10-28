# Yosemite manual deployment preservation audit — 28 October 2026

This is a new report. Existing project files, configuration, dependencies, compiled artifacts, backups and evidence were left unchanged. No deployment, push, merge, GitHub change, production database/secret change, broker order, MT5 launch or capture was performed.

## Decision

**Application-only deployment is safe to consider conditionally, with trading disabled; this is not unconditional production clearance.** The local application, authentication, database/RLS tests, routing checks and read-only diagnostic tests pass on the final runs. Before deployment, the owner must reconcile source provenance and verify the actual Cloudflare and Supabase targets. These remote checks were not performed in this local-only audit.

| Readiness area | Verified locally | Still required |
| --- | --- | --- |
| Application | Node 24.22.1 checks, 160 application tests, six browser tests and isolated Workerd smoke pass; disabled configuration enforced | Reviewed source/commit, actual Cloudflare settings, actual Supabase identity/schema/RLS/session/membership checks |
| Read-only MT5 | Matching v1.03 native source/compiled/installed artifact; 69 synthetic Python tests pass on sequential run | Approved native ACK runtime capture; no successful runtime capture is claimed |
| Demo execution | Disabled; diagnostic completion never grants execution | Resolve source-time UTC mapping/freshness, verify native runtime, implement/review the native execution bridge and obtain explicit order approval |
| Live trading | Disabled | Outside this release; no approval or readiness claimed |

## Workspace, source and file status

Workspace: `C:\Users\Francis\OneDrive\Documents\Projects\Yosemite AI Trading Bot`.

- Both `git rev-parse --show-toplevel` and `git rev-parse HEAD` failed: this folder and its parents are not a Git repository. No branch, commit SHA, tracked/untracked distinction, Git diff, upstream identity or correspondence with `Naive16/Yosemite-Ai-Trading-Bot` can be verified locally. No Git metadata was created. A matching package version is not commit provenance.
- `package.json` identifies `yosemite-ai-trading-bot` version **0.1.0**. `.node-version` pins **24.22.1**; `engines.node` requires **>=22**. Tests used the existing bundled Node 24.22.1, without changing the default shell runtime or PATH. The prior audit found default Node 20; the owner's deployment/build shell must select the supported runtime explicitly.
- Initial inventory: **6,000 existing files**; **161 not excluded** by ignore rules and **5,839 ignored**. Ignore classification used `rg --files --hidden --no-require-git`; it is not a substitute for Git status. Appendix A lists all 161 release-source candidates, Appendix B all 145 ignored files outside dependency/virtual-environment trees. Dependency/virtual-environment trees account for the other 5,694 ignored files.
- Compared with the previous audit's 158-file before-manifest, the sole differing file is the already-known `docs/runbooks/manual-deployment.md` update. No file from that manifest is missing. That manifest predates the runbook update and is not a Git baseline. Additional source candidates are listed in Appendix A; they cannot be labelled Git-untracked.
- `docs/runbooks/manual-deployment.md`, `docs/mt5-ack-handshake-fix.md`, the collector and native source are present. The latest local release evidence is `.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/final-verification.json`; its conditional deployment/trading blockers remain applicable. This new report adds current test results, including initial failures.
- `node_modules/` has 2,636 files and `.venv/` has 3,058. **47 installed package records** were compared with the existing lockfile and installed manifests, with no version/declaration mismatches and no missing root dependency. Platform-specific packages not installed here were not claimed as verified. No package installation/update was run.

Lockfile SHA-256: `8c7342491e2056446ee4a458816030c46be809e24ebb08501830106bbfbe30ea`.

Important ignored items, all retained:

| Item | Why preserve it | Release treatment |
| --- | --- | --- |
| `.env` | Existing local private configuration; only safeguard results were reported, never secret values | Do not upload or serve; not a deployed-secret inventory |
| `.local-data/` — 120 files | Historical MT5 captures/reports, compiler artifacts, backups, authentication baseline and audit evidence | Preserve locally; exclude from GitHub/Cloudflare payloads |
| Root `.local-data*.log`, bridge diagnostic log | Prior verification/compiler evidence | Preserve; do not treat old passing logs as a newly run test |
| `dist/` — 3 files | Prior generated build output | Retain but do not deploy stale output as this release |
| `src/vendor/supabase.js` | Existing generated browser dependency, required at runtime | Preserve now; regenerate from the lockfile in the owner's clean build before deployment |
| `bridge/**/__pycache__`, `tests/__pycache__` | Existing interpreter artifacts | Preserve; Python tests ran with `-B` to prevent rewriting bytecode |
| `.venv/`, `node_modules/` | Existing local dependencies | No reinstall/delete; not Cloudflare static assets |
| `.wrangler/` | Existing local Wrangler state/directory | Preserve; new runtime artifacts were routed outside the project |

## Safeguards and ACK repair verification

`wrangler.jsonc` explicitly retains:

```dotenv
TRADING_MODE=disabled
LIVE_TRADING_ENABLED=false
WORKER_ENABLED=false
MT5_EXECUTION_ENABLED=false
MT5_DEMO_MODE=false
MT5_CONNECTOR=none
```

`api/_lib/config.js` rejects attempts to enable trading/worker/MT5 execution or choose an active connector. The local `.env` explicitly disables its trading/live/worker switches; MT5 switches are absent there and default to disabled/none in code. No other local environment values were printed. Actual remote settings and current terminal permission toggles were not inspected through an SDK/UI connection in this audit; no permission or setting was changed.

The collector and native v1.03 agree on run-specific readiness/closed markers and sequence-specific ACK filenames `YosemiteTimeTraceAck-<id>-0.txt` through `-2.txt`. Exact ASCII payloads are `YMT5-1|<id>|<sequence>` followed by LF. Run IDs and ordered sequences must match; exclusive writes prevent replacement, and native full-length/payload comparison rejects partial or mismatched ACKs. Three valid frames/ACKs, native completion with the expected count/reason/disabled execution, final safety checks and SDK shutdown are required. Separate launch and capture budgets remain bounded. No capture was launched to test this.

The current native source matches its compiled-source snapshot and installed source. The installed `.ex5` matches the compiled artifact. Existing final compiler evidence records **0 errors and 0 warnings**; unchanged code was not recompiled.

- Native source SHA-256: `d5cb2c5d36eb18517c693f49f2c633d2856d1b6b3e64691d2241b791d1e0ac80`.
- Installed binary SHA-256: `3493f7b6ffb792526916be9ac9404830ea77aafaabdf41176d6ec9cb6fbddca6`.
- Installed binary: `C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Scripts\YosemiteTimestampReadOnly.ex5`.
- All **eight authentication baseline files** still match `.local-data/demo-auth-baseline.json`.

The approximately +7,200-second timestamp discrepancy remains unresolved. Quote timestamps, UTC offsets and freshness checks are unchanged: native limits remain **15 seconds old / 5 seconds future**, with no assumed correction. `MetaQuotes-Demo` verification does not establish a different broker's account or order execution.

## Tests actually run in this audit

Node executable: `C:\Users\Francis\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` (**v24.22.1**). Commands were invoked directly so no build/pretest hook could overwrite existing generated assets.

| Check | Actual result |
| --- | --- |
| Every `node --check` command from `npm run check` and `npm run check:demo`, executed with Node 24.22.1 | **64 file syntax checks passed**, zero failures |
| Node 24.22.1 `--test` | **160 tests passed**, zero failed/skipped; exit 0 |
| Node 24.22.1 `scripts/browser-auth-smoke.mjs` | **Six tests passed**, zero failed/skipped; exit 0; all Auth/API traffic intercepted |
| `.venv\Scripts\python.exe -B -m unittest discover -s tests -p 'mt5*_test.py' -v`, first concurrent attempt | **69 ran, one failed**: `test_generated_id_is_used_in_readiness_native_validation_and_report` expected completion but received false |
| Identical Python command, sequential retry | **69 tests passed**, zero failures; exit 0; no tests/timeouts/source changes |
| Isolated copy of `scripts/worker-runtime-smoke.mjs`, first concurrent attempt | **Failed**: local Worker did not become ready within the unchanged 45-second startup window |
| Same isolated runtime check, sequential retry using a distinct temporary output directory | **Passed**, exit 0, with unchanged startup limit |

The two first-run failures occurred while all suites were running concurrently. Sequential passes are consistent with load-sensitive timing, but do not independently prove the first failures' cause. They are retained as a test-timing caveat, not hidden or converted into passes. The paired fixture uses a short wall-clock budget. Neither production quote freshness nor diagnostic timeouts were relaxed. The current local results support application-only consideration; they do not prove a native ACK capture or remote deployment.

The runtime smoke used the release's compatibility date/flags, production-mode configuration, asset routing and a synthetic public key in an external temporary configuration, not production credentials. It checked health with trading disabled, public configuration, protected 401s, root/SDK/CSS/JS assets, CSP, source/environment-file exclusions, missing assets and JSON API 404 behavior. It ran **local Wrangler dev only**; no deploy or dry-run deploy command was used.

Neither `npm ci`, asset-building scripts, `npm run verify`, `npm run worker:build`, migrations nor MT5 capture commands were run. This avoids package/generated-file replacement and the deploy subcommand embedded in `worker:build`.

## Outstanding blockers and uncertainty, in priority order

1. **Source provenance:** reconcile these exact local files with the intended GitHub branch and record a reviewed commit SHA. No local commit or remote revision was verified; do not overwrite this project or blindly replace GitHub source.
2. **Actual Supabase cutover:** privately verify project `Yosemite_Ai_Bot`, reference `txdjozotaxpthpnfikqx`, its public key, schema/ledger, RLS/grants/functions, approved membership, logout revocation and recovery delivery. No production introspection or migration was run here. Local PGlite/mocks and a health HTTP 200 cannot clear this gate.
3. **Actual Cloudflare configuration/build provenance:** verify the existing Worker/account/domain, effective runtime variables/secrets, supported Node selection, built browser SDK, release revision and safe rollback candidate. Local parsing does not prove effective remote values or secret validity.
4. **Trading gates:** native ACK runtime remains pending; source-time UTC mapping/freshness remains blocked; no execution bridge or demo-order approval is established. These are separate from deploying an authorized, disabled application dashboard.
5. **Timing caveat:** retain the initial Python/runtime failures and the successful sequential reruns. If they recur under normal sequential load, investigate before relying on the affected diagnostic/runtime validation. This audit makes no code changes to resolve them.

No new code defect requiring a source change was established. Optional unconfigured market-data/AI providers may remain honestly unavailable; they are not mandatory for this disabled auth/dashboard release. Do not purchase services or add dependencies to clear unrelated optional features.

## Owner's manual deployment checklist

1. **Use the existing release root:** `C:\Users\Francis\OneDrive\Documents\Projects\Yosemite AI Trading Bot`, with `wrangler.jsonc`. Preserve it; reconcile source in a separate reviewed checkout or source view. Verify the intended `Naive16/Yosemite-Ai-Trading-Bot` revision and any automatic Cloudflare build trigger before an owner upload/push. This audit performed neither.
2. **Select supported Node and locked dependencies:** build the reviewed commit with Node 24.22.1 (at least 22). In the owner's separate clean build, install from `package-lock.json` without upgrading and run `npm run build:client`. Do not mutate this preserved workspace to create a release package. Verify the generated browser SDK exists before publishing.
3. **Deploy the application through its Worker project, not a static folder upload.** The Worker entry is `src/worker.js`, bundled with its imported `api/` and package dependencies. Static assets come only from `src/`, including `src/index.html`, `styles.css`, `app.js`, `auth-client.js`, the generated `vendor/supabase.js`, `_headers` and `.assetsignore`. Production uses root asset URLs, not `/src/app.js`. Do not publish the repository root HTML in place of `src/index.html`.
4. **Retain the other source in GitHub:** `api/`, `src/` source, `bridge/` Python/MQL5 source and requirements, `db/`, `scripts/`, `tests/`, `docs/`, `server.js`, both HTML entries, `package.json`, `package-lock.json`, `.node-version`, `.npmrc`, `.gitignore`, `.env.example` and `wrangler.jsonc`. These are not all public static assets. The bridge stays on Windows; database SQL stays a separately reviewed administrative operation. Historical evidence, secrets, virtual environments, dependencies, stale build output and compiled local MT5 artifacts are not source-upload/static-asset payloads.
5. **Verify Cloudflare configuration:** existing Worker `yosemite-ai-trading-bot`, correct account/origin, entry `src/worker.js`, compatibility date `2026-10-22`, `nodejs_compat`, `ASSETS` binding to `src`, `run_worker_first: ["/api/*"]`, `not_found_handling: "none"`, current `src/.assetsignore`/`src/_headers`. Confirm logs/traces and secret redaction. `keep_vars=true` does not attest to effective remote values. Do not introduce new cron/execution triggers.
6. **Privately verify the required setting names:** `APP_ENV`, `APP_ORIGIN`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` or the supported `SUPABASE_ANON_KEY` alias. Confirm all six disabled controls listed above. Optional names include `TRUSTED_PROXY_MODE`, `DATABASE_QUERY_TIMEOUT_MS` and build-only `NODE_VERSION`. Optional provider secrets are not required to deploy the disabled dashboard. Never use a service-role/privileged Supabase key, database password or broker password in runtime/browser code. Do not print or upload secret values. A deployed secret edit can itself publish a Cloudflare version and is not authorized by this audit.
7. **Verify the database before accepting release:** read `db/supabase-preflight.sql` and `docs/runbooks/supabase-migration.md`; verify the actual target/schema before applying any SQL. `001`–`007` define historical tables, and `008_supabase_auth_rls.sql` is the reviewed Auth/membership/RLS transition with ledger version `000008`. Do not blindly replay these files or invoke automatic migration. Missing/conflicting schema or membership requires a separate reviewed production change and stops release.
8. **Verify approved operators and security:** public signup/anonymous access disabled; approved Auth UID maps to the preserved domain owner in `yosemite_members`; exact Site URL/recovery redirects and email delivery verified. Check active-session revocation, per-user RLS, session/rate-limit/proposal RPCs and Supabase's actual Auth rate limits. Application `AUTH_RATE_LIMIT_*` names alone do not configure provider login throttling.
9. **Record recovery first:** intended GitHub SHA, current deployed Cloudflare version, effective configuration inventory without secrets, compatible rollback version and separately approved database backup/recovery plan. A pre-Supabase custom-auth release is not automatically a safe rollback candidate.
10. **Owner deployment only:** after clearing the required gates, manually publish the reviewed commit through the existing authorized Cloudflare deployment path. Do not replace the Worker/account/domain unintentionally. Record the deployed version/SHA. The assistant takes no deployment action.
11. **Stop on failure:** a missing required verification or failed smoke test prevents release acceptance. Keep trading disabled; do not weaken RLS, authentication, origins, rate limits or freshness checks to obtain a pass.

## Post-deployment smoke tests — owner performs later

- Confirm `/`, `/styles.css`, `/app.js`, `/auth-client.js` and `/vendor/supabase.js` load, with correct content types and no console/module failures. Verify CSP/security headers and no-store on the HTML entry/API responses.
- Require 404 for `/worker.js`, `/.env`, `/.dev.vars`, `/api/_lib/config.js` and missing assets. Unknown API returns JSON 404; unsupported API method returns 405, not the HTML shell.
- Check `/api/health` returns healthy liveness with both trading flags false and `/api/auth/config` exposes public configuration only. `database: "unknown"` on public health is not target/database verification.
- In a private signed-out browser, require 401 from `/api/auth/me` and all `/api/private/*` routes; cookies alone and malformed/expired JWTs cannot authorize. Approved operator login, refresh and renewal must work; unapproved Auth accounts must be denied with 403.
- After authorized login, verify `/api/private/status` remains disabled, `/api/private/operations` reports a healthy authenticated database permission check, and the intended user's owned records are accessible. Verify two approved test identities cannot cross-read/update through Worker or direct Data API. Use approved synthetic records; do not mutate real records merely for smoke testing.
- Verify invalid/missing Origin handling, controlled provider/application rate limits, generic invalid-login messages and truthful service errors. Simulate outages only in an isolated approved environment, not by disrupting production.
- Confirm sign-out clears protected UI and immediately invalidates replay of an otherwise unexpired token using memory-only trusted tooling. Verify invitation/recovery delivery and PKCE flow with a designated test identity; do not retain tokens, passwords or action links in logs/history/reports.
- Recheck all disabled execution settings and sanitized logs. No broker call, native capture or order belongs in the application deployment smoke test.

## Rollback

On failure, stop release acceptance, preserve sanitized evidence and keep trading disabled. The owner may use Cloudflare's existing Worker → Deployments → Rollback for the **recorded safe, Supabase-compatible version**, then rerun the smoke tests and check effective settings. No rollback was performed here. Worker rollback does not restore database schemas/data or undo other resource changes. Do not delete tables, reverse SQL blindly or restore an incompatible custom-auth version. If no safe rollback candidate exists, use the owner's restricted-access/recovery procedure and resolve compatibility separately.

The maintained detailed procedure remains `docs/runbooks/manual-deployment.md`; this audit does not replace or alter it.

## Preservation and audit evidence

Before running tests, all 6,000 existing project files were inventoried by size and modification time; the 306 files outside `node_modules/` and `.venv/` also received byte hashes, including configuration, logs, evidence and generated assets. After tests, all existing metadata and all 306 byte hashes matched, with no missing file. Installed dependency/virtual-environment files were checked for unchanged metadata, not claimed as fully byte-hashed. No existing report, source, lockfile, generated bundle, configuration or backup was overwritten. Python bytecode writing was disabled. Only this new documentation file was added inside the workspace.

Fresh test logs, manifests and temporary local-runtime configuration are outside the project at `C:\Users\Francis\AppData\Local\Temp\yosemite-release-readonly-4kg0h3ea`. They retain both first failures and retries. Full ignored inventory is `ignored-files.json`, full non-ignored inventory is `not-ignored-files.json`, and package/safeguard results are `local-verification.json`. Temporary files are not a durable backup; the important source/evidence inventories are reproduced below. No secret values are included in this report.

## Appendix A — all 161 non-ignored existing files

These are release-source candidates, not a verified list of Git-tracked files. Paths are relative to the preserved project root. Counts precede creation of this report.

```text
.assetsignore
.env.example
.gitignore
.node-version
.npmrc
README.md
api/_lib/ai/rate-limit.js
api/_lib/auth.js
api/_lib/backtest/engine.js
api/_lib/backtest/metrics.js
api/_lib/claude/client.js
api/_lib/claude/schema.js
api/_lib/config.js
api/_lib/database.js
api/_lib/deployment.js
api/_lib/http.js
api/_lib/market-data/cache.js
api/_lib/market-data/normalize.js
api/_lib/market-data/provider.js
api/_lib/market-data/rate-limit.js
api/_lib/market-data/symbols.js
api/_lib/market-data/validation.js
api/_lib/mt5/adapter.js
api/_lib/mt5/demo-preflight.js
api/_lib/mt5/mirro.js
api/_lib/mt5/reconciliation.js
api/_lib/news/normalize.js
api/_lib/news/provider.js
api/_lib/operations/alerts.js
api/_lib/operations/health.js
api/_lib/operations/logger.js
api/_lib/operations/recovery.js
api/_lib/operations/retry.js
api/_lib/paper/simulator.js
api/_lib/proposals/canonical.js
api/_lib/proposals/repository.js
api/_lib/rate-limit.js
api/_lib/repository.js
api/_lib/risk/engine.js
api/_lib/risk/position-sizing.js
api/_lib/risk/rate-limit.js
api/_lib/risk/repository.js
api/_lib/routes.js
api/_lib/runtime.js
api/_lib/strategy/engine.js
api/_lib/strategy/indicators.js
api/_lib/validation.js
api/_lib/worker/lifecycle.js
api/auth/config.js
api/auth/login.js
api/auth/logout.js
api/auth/me.js
api/health.js
api/private/analysis.js
api/private/backtest.js
api/private/market-data.js
api/private/operations.js
api/private/paper.js
api/private/proposals.js
api/private/risk.js
api/private/status.js
api/private/strategy.js
bridge/README.md
bridge/diagnostics/YosemiteTimestampReadOnly.mq5
bridge/diagnostics/paired_mt5_trace.py
bridge/mt5_demo_probe.py
bridge/requirements-windows.txt
db/migrations/001_initial_schema.sql
db/migrations/002_risk_engine.sql
db/migrations/003_trade_proposals.sql
db/migrations/004_paper_backtest.sql
db/migrations/005_execution_reconciliation.sql
db/migrations/006_operations.sql
db/migrations/007_rate_limit_buckets.sql
db/migrations/008_supabase_auth_rls.sql
db/supabase-preflight.sql
docs/architecture.md
docs/authentication-repair.md
docs/milestones/ai-mt5-demo-integration-report.md
docs/milestones/deployment-readiness-audit.md
docs/milestones/milestone-1-report.md
docs/milestones/milestone-10-report.md
docs/milestones/milestone-10.5-security-report.md
docs/milestones/milestone-11-report.md
docs/milestones/milestone-12-report.md
docs/milestones/milestone-13-report.md
docs/milestones/milestone-14-report.md
docs/milestones/milestone-2-report.md
docs/milestones/milestone-3-report.md
docs/milestones/milestone-4-report.md
docs/milestones/milestone-5-report.md
docs/milestones/milestone-6-report.md
docs/milestones/milestone-7-report.md
docs/milestones/milestone-8-report.md
docs/milestones/milestone-9-report.md
docs/milestones/mt5-bbc-preparation-report.md
docs/milestones/serverless-readiness-fixes-report.md
docs/mt5-ack-handshake-fix.md
docs/mt5-windows-installation.md
docs/runbooks/cloudflare-deployment.md
docs/runbooks/deployment.md
docs/runbooks/manual-deployment.md
docs/runbooks/mt5-demo-release.md
docs/runbooks/operations.md
docs/runbooks/render-deployment.md
docs/runbooks/supabase-migration.md
index.html
package-lock.json
package.json
render.yaml
scripts/browser-auth-smoke.mjs
scripts/build-auth.mjs
scripts/demo-preflight.mjs
scripts/deployment-check.mjs
scripts/migrate.mjs
scripts/start.mjs
scripts/worker-runtime-smoke.mjs
server.js
src/.assetsignore
src/_headers
src/app.js
src/auth-client.js
src/index.html
src/styles.css
src/worker.js
tests/analysis.test.mjs
tests/auth.test.mjs
tests/backtest.test.mjs
tests/claude.test.mjs
tests/dashboard.test.mjs
tests/database.test.mjs
tests/demo-preflight.test.mjs
tests/deployment.test.mjs
tests/frontend-auth.test.mjs
tests/health.test.mjs
tests/market-data.test.mjs
tests/mt5-mirro.test.mjs
tests/mt5-reconciliation.test.mjs
tests/mt5.test.mjs
tests/mt5_demo_probe_test.py
tests/mt5_paired_trace_test.py
tests/mt5_running_probe_test.py
tests/mt5_timestamp_probe_test.py
tests/news-bbc.test.mjs
tests/operations.test.mjs
tests/proposals.test.mjs
tests/rate-limit.test.mjs
tests/risk-api.test.mjs
tests/risk.test.mjs
tests/security-hardening.test.mjs
tests/server.test.mjs
tests/simulation-api.test.mjs
tests/strategy.test.mjs
tests/supabase-config.test.mjs
tests/supabase-rls.test.mjs
tests/support/fake-auth.mjs
tests/support/fake-database.mjs
tests/worker-fetch.test.mjs
tests/worker.test.mjs
vercel.json
wrangler.jsonc
```

## Appendix B — all 145 ignored files outside dependency environments

Preserve these files locally. They include existing secrets/configuration, evidence, backups and generated artifacts; ignore status is not permission to remove them. Paths identify files only, never their credential contents.

```text
.env
.local-data-demo-baseline.log
.local-data-demo-final-build.log
.local-data-demo-final-verify.log
.local-data-demo-final-worker.log
.local-data-demo-preflight.log
.local-data-demo-python-tests.log
.local-data-final-browser.log
.local-data-final-build.log
.local-data-final-verify.log
.local-data-mt5-install-probe-tests.log
.local-data-verify.log
.local-data/YosemiteTimestampReadOnly-before-startup-logging.ex5
.local-data/YosemiteTimestampReadOnly-before-startup-logging.mq5
.local-data/YosemiteTimestampReadOnly-before-unique-runs.ex5
.local-data/YosemiteTimestampReadOnly-before-unique-runs.mq5
.local-data/YosemiteTimestampReadOnly.ex5
.local-data/__pycache__/mt5-native-time-repro.cpython-311.pyc
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/build-final/YosemiteTimestampReadOnly.ex5
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/build-final/YosemiteTimestampReadOnly.log
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/build-final/YosemiteTimestampReadOnly.mq5
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/build/YosemiteTimestampReadOnly.ex5
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/build/YosemiteTimestampReadOnly.log
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/build/YosemiteTimestampReadOnly.mq5
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/evidence-before.json
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/experts-log-baseline.json
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/experts-log-before.bin
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/installed-before/YosemiteTimestampReadOnly.ex5
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/installed-before/YosemiteTimestampReadOnly.mq5
.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/verification.json
.local-data/debug-39827b44-6fdc-4e9c-a249-5c5205f239c9.json
.local-data/debug-79fcbffe-48f3-49d5-a247-77efb207d893.json
.local-data/debug-e23fb7bf-6fcf-4cb1-9cb9-da9738ffe37f.json
.local-data/demo-audit.mjs
.local-data/demo-auth-baseline.json
.local-data/demo-final-report.mjs
.local-data/download-official-mt5.ps1
.local-data/inspect-diagnostic-launch.py
.local-data/metaquotes-timestamp-support-enquiry.txt
.local-data/mt5-current-windows-time-state.json
.local-data/mt5-display-time-observation.json
.local-data/mt5-final-tests.log
.local-data/mt5-launch-log-evidence.json
.local-data/mt5-multipath-summary.json
.local-data/mt5-native-time-repro-output.log
.local-data/mt5-native-time-repro.json
.local-data/mt5-native-time-repro.py
.local-data/mt5-paired-capture-status.log
.local-data/mt5-paired-initialize-refused.json
.local-data/mt5-paired-launch-attempt.json
.local-data/mt5-paired-native.jsonl
.local-data/mt5-paired-runs/20261028T154624Z-43a25246979949e89c8a4fc1541554da/report.json
.local-data/mt5-paired-runs/20261028T155653Z-104cf23aea494395b4dc3857b0442bb6/report.json
.local-data/mt5-paired-trace.json
.local-data/mt5-read-only-latest.json
.local-data/mt5-read-only-multipath-final.json
.local-data/mt5-readonly-js-tests.log
.local-data/mt5-run-evidence-before.json
.local-data/mt5-script-directory-check.json
.local-data/mt5-script-directory-check.py
.local-data/mt5-script-discoverability.json
.local-data/mt5-script-startup-validation.json
.local-data/mt5-terminal-log-audit.json
.local-data/mt5-unique-run-validation.json
.local-data/mt5-user-launch-native-final-A.jsonl
.local-data/mt5-utc-investigation.json
.local-data/mt5-utc-investigation.py
.local-data/npm-status.mjs
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/final-verification.json
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/mt5-auth-verification.json
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/release-files-before.json
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/secret-pattern-review.json
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-runtime-smoke.mjs
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/cache/cf.json
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/cache/miniflare-CacheObject/metadata.sqlite
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/cache/miniflare-CacheObject/metadata.sqlite-shm
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/cache/miniflare-CacheObject/metadata.sqlite-wal
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite-shm
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite-wal
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/metadata.sqlite
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/metadata.sqlite-shm
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/metadata.sqlite-wal
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/observability/miniflare-wobs-trace-store/metadata.sqlite
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/observability/miniflare-wobs-trace-store/metadata.sqlite-shm
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/observability/miniflare-wobs-trace-store/metadata.sqlite-wal
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/r2/miniflare-R2BucketObject/metadata.sqlite
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/r2/miniflare-R2BucketObject/metadata.sqlite-shm
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/state/v3/r2/miniflare-R2BucketObject/metadata.sqlite-wal
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/tmp/bundle-ZZzvtz/middleware-insertion-facade.js
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/tmp/bundle-ZZzvtz/middleware-loader.entry.ts
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/tmp/dev-KJG8By/worker.js
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/.wrangler/tmp/dev-KJG8By/worker.js.map
.local-data/release-audit-d4e90a52e8524271815c2594f42ff593/worker-smoke/wrangler.json
.local-data/report-results.mjs
.local-data/run-node24.mjs
.local-data/summarize-mt5-multipath.py
.local-data/test_mt5_native_time_repro.py
.local-data/update-tooling.mjs
.local-data/verify-installed-mt5-package.py
.local-data/worker-smoke/.wrangler/cache/cf.json
.local-data/worker-smoke/.wrangler/state/v3/cache/miniflare-CacheObject/metadata.sqlite
.local-data/worker-smoke/.wrangler/state/v3/cache/miniflare-CacheObject/metadata.sqlite-shm
.local-data/worker-smoke/.wrangler/state/v3/cache/miniflare-CacheObject/metadata.sqlite-wal
.local-data/worker-smoke/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite
.local-data/worker-smoke/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite-shm
.local-data/worker-smoke/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite-wal
.local-data/worker-smoke/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/metadata.sqlite
.local-data/worker-smoke/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/metadata.sqlite-shm
.local-data/worker-smoke/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/metadata.sqlite-wal
.local-data/worker-smoke/.wrangler/state/v3/observability/miniflare-wobs-trace-store/a590acd76969f996ec6e4b599c3c09f58c283a76f2d61392b5d3046caf557602.sqlite
.local-data/worker-smoke/.wrangler/state/v3/observability/miniflare-wobs-trace-store/a590acd76969f996ec6e4b599c3c09f58c283a76f2d61392b5d3046caf557602.sqlite-shm
.local-data/worker-smoke/.wrangler/state/v3/observability/miniflare-wobs-trace-store/a590acd76969f996ec6e4b599c3c09f58c283a76f2d61392b5d3046caf557602.sqlite-wal
.local-data/worker-smoke/.wrangler/state/v3/observability/miniflare-wobs-trace-store/metadata.sqlite
.local-data/worker-smoke/.wrangler/state/v3/observability/miniflare-wobs-trace-store/metadata.sqlite-shm
.local-data/worker-smoke/.wrangler/state/v3/observability/miniflare-wobs-trace-store/metadata.sqlite-wal
.local-data/worker-smoke/.wrangler/state/v3/r2/miniflare-R2BucketObject/metadata.sqlite
.local-data/worker-smoke/.wrangler/state/v3/r2/miniflare-R2BucketObject/metadata.sqlite-shm
.local-data/worker-smoke/.wrangler/state/v3/r2/miniflare-R2BucketObject/metadata.sqlite-wal
.local-data/worker-smoke/.wrangler/tmp/bundle-Hdy5q0/middleware-insertion-facade.js
.local-data/worker-smoke/.wrangler/tmp/bundle-Hdy5q0/middleware-loader.entry.ts
.local-data/worker-smoke/.wrangler/tmp/bundle-LoSbwL/middleware-insertion-facade.js
.local-data/worker-smoke/.wrangler/tmp/bundle-LoSbwL/middleware-loader.entry.ts
.local-data/worker-smoke/.wrangler/tmp/bundle-sdh1vF/middleware-insertion-facade.js
.local-data/worker-smoke/.wrangler/tmp/bundle-sdh1vF/middleware-loader.entry.ts
.local-data/worker-smoke/.wrangler/tmp/dev-8cbxz6/worker.js
.local-data/worker-smoke/.wrangler/tmp/dev-8cbxz6/worker.js.map
.local-data/worker-smoke/.wrangler/tmp/dev-PSc6mI/worker.js
.local-data/worker-smoke/.wrangler/tmp/dev-PSc6mI/worker.js.map
.local-data/worker-smoke/.wrangler/tmp/dev-SgDuBz/worker.js
.local-data/worker-smoke/.wrangler/tmp/dev-SgDuBz/worker.js.map
.local-data/worker-smoke/wrangler.json
bridge/__pycache__/mt5_demo_probe.cpython-311.pyc
bridge/__pycache__/mt5_demo_probe.cpython-312.pyc
bridge/diagnostics/YosemiteTimestampReadOnly.log
bridge/diagnostics/__pycache__/paired_mt5_trace.cpython-311.pyc
dist/README.md
dist/worker.js
dist/worker.js.map
src/vendor/supabase.js
tests/__pycache__/mt5_demo_probe_test.cpython-311.pyc
tests/__pycache__/mt5_demo_probe_test.cpython-312.pyc
tests/__pycache__/mt5_paired_trace_test.cpython-311.pyc
tests/__pycache__/mt5_running_probe_test.cpython-311.pyc
tests/__pycache__/mt5_timestamp_probe_test.cpython-311.pyc
```
