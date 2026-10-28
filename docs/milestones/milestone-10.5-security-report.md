> Historical milestone record. The active backend is now Supabase Auth and Data API. Use [the current release runbook](../runbooks/cloudflare-deployment.md); legacy Neon/custom-password instructions below are not current deployment guidance.

# Milestone 10.5 Security Audit and Hardening Report

## Executive summary

The repository was audited and targeted hardening was applied without enabling trading, adding external services, connecting MT5/brokers, or changing package managers. No critical or high-severity dependency vulnerabilities were found. The existing authentication, database-backed sessions, CSRF controls, proposal digest checks, independent risk engine, simulation boundaries, and execution-disabled defaults remain in place.

Verified fixes in this checkpoint:

- State-changing requests now fail closed when neither `Origin` nor `Referer` is present.
- Parsed JSON objects are size-bounded even when a hosting framework has already deserialized the body.
- Provider-derived market-table text is escaped before insertion into HTML.
- Account currency identifiers are required to be three uppercase letters before risk sizing proceeds.
- Vercel static deployment headers now include CSP, HSTS, clickjacking protection, referrer policy, permissions policy, and cross-origin isolation headers.
- Worker configuration remains disabled by default and cannot be enabled without a database URL; the lifecycle helper always reports `executionAllowed: false`.

This is not a formal penetration test, red-team exercise, compliance assessment, or security certification.

## Scope and files inspected

Inspected the Milestone 1–11 reports, `README.md`, `docs/architecture.md`, `package.json`, `package-lock.json`, `.env.example`, `vercel.json`, all API routes, authentication/session/CSRF code, database adapter/repositories/migrations, market-data/provider code, strategy, Claude/news, risk, proposal, backtest, paper, worker lifecycle code, dashboard source, and all existing tests.

Repository history was not available: the workspace is not a Git working tree, so Git history and tracked-file status could not be verified. No history rewrite or repository mutation was attempted.

Files changed:

- `api/_lib/validation.js`
- `api/_lib/risk/engine.js`
- `src/app.js`
- `vercel.json`
- `.env.example`
- `tests/risk.test.mjs`
- `tests/security-hardening.test.mjs`
- `docs/milestones/milestone-10.5-security-report.md`

## Findings by severity

### High or critical

No high or critical findings were verified in the local audit or dependency audit.

### Moderate findings remediated

1. State-changing origin validation permitted both headers to be absent. CSRF tokens protected existing authenticated mutations, but fail-closed origin validation is stronger and now requires an origin or referer that matches the configured application origin.
2. Parsed object request bodies bypassed the string byte-size check. This could allow oversized framework-deserialized bodies to reach route logic. Object bodies are now serialized and bounded before use.
3. Provider-derived values were interpolated into dashboard table HTML. Current market-data normalization constrains the values, but escaping at the browser sink removes unnecessary trust in upstream data.
4. Account currency validation accepted arbitrary strings due to an overly permissive boolean condition. Risk evaluation now blocks malformed currency identifiers.
5. Static deployments lacked repository-level security headers. `vercel.json` now defines a restrictive same-origin CSP, HSTS, `nosniff`, `DENY` framing, no-referrer, restrictive permissions, and cross-origin policies.

### Low or known remaining risks

- Authentication, market-data, AI, risk, and simulation rate limiters are process-local. They do not provide reliable multi-instance or restart-resistant throttling. Production requires a shared atomic limiter or managed equivalent with fail-closed behavior.
- `x-forwarded-for`/`x-real-ip` are used for rate-limit client identification. Correctness depends on the deployment proxy sanitizing those headers; direct exposure or an improperly configured proxy could allow identifier rotation and rate-limit bypass.
- The browser still uses some fixed-template `innerHTML` for local UI markup. Provider-derived table fields are escaped, and no direct arbitrary HTML field is accepted, but a future frontend change should prefer DOM construction or a centralized escaping helper.
- No formal DAST, SAST, penetration test, browser security-header scan, or production configuration review was performed.
- No live Neon, Vercel, Render, OCI, provider, Claude, MT5, broker, or cloud-worker verification was performed.

## Dependency and supply-chain audit

Audit date: 2026-10-22.

Commands and observed results:

```text
npm audit --json
0 info, 0 low, 0 moderate, 0 high, 0 critical vulnerabilities

npm audit signatures
audited 1 package; 1 package had a verified registry signature

npm ls --all
yosemite-ai-trading-bot@0.1.0
└── @neondatabase/serverless@1.2.0

npm ci --ignore-scripts
completed successfully; added 1 package and found 0 vulnerabilities
```

`package-lock.json` is lockfile version 3 and pins the resolved package tarball and integrity hash. `package.json` has one production dependency, no development dependencies, and no lifecycle scripts such as `preinstall`, `postinstall`, or `prepare`. No Python manifest or lockfile exists. The dependency is used server-side; it is not imported by browser code.

The package range uses `^1.2.0`, but deployment installation uses the lockfile through `npm ci`. No automatic upgrade, `npm audit fix`, or major-version change was performed. Registry signatures and vulnerability metadata do not prove package trust or absence of malicious behavior. New dependencies should require maintainer/source review, license review, lockfile changes, audit/signature checks, tests, and explicit approval for elevated capabilities.

Recommended safeguards: use `npm ci` in deployment, run `npm run verify`, `npm audit`, and signature checks in CI, review lockfile diffs, enable Dependabot and GitHub secret/dependency alerts only after confirming the repository’s actual GitHub settings, and require security review for packages that access credentials, filesystem, subprocesses, or network services. GitHub settings were not checked or enabled because no repository connection exists.

## Authentication, session, API, and database findings

- Passwords use bounded scrypt parameters and timing-safe digest comparison. Password hashes, session tokens, and CSRF values are not logged.
- Session cookies are opaque, HttpOnly, SameSite=Lax, and Secure in production. Only HMAC-derived session and CSRF hashes are persisted.
- Session validation checks database expiry and revocation, so logout and expiry work across simulated instances. Session fixation was not observed because successful login creates a new random 32-byte token.
- Logout and proposal mutations require same-origin validation and a session-bound CSRF token. The new missing-header behavior fails closed.
- Private routes authenticate on the server and scope proposal queries by `session.userId`; dashboard visibility is not the authorization boundary.
- Query parameters and JSON bodies are allowlisted and bounded on sensitive routes. Database queries use placeholders. Migrations are additive and no production database was touched.
- API responses use `no-store`, JSON content type, `nosniff`, `DENY` framing, no-referrer, and CSP headers. Static deployment headers now provide the corresponding browser-facing baseline.
- Error responses are generally generic. No database credentials or provider keys are returned to the browser.
- No SSRF-capable user-controlled URL path was found. Provider and Claude base URLs are server configuration constrained to HTTP(S) origins; no arbitrary request URL is accepted from the browser.

Login throttling is verified as process-local. This is acceptable only as a local/development mitigation and is not sufficient for public multi-instance deployment. A shared database counter/window or dedicated rate-limit service must be selected and tested before public exposure.

## Trading-specific security boundaries

The audit found the following controls intact and covered by existing tests:

- Claude output is schema-validated and read-only; it cannot approve or execute trades.
- The independent risk engine remains separate from strategy and approval. `PASS` is validation only and returns `executionAllowed: false` and `tradingEnabled: false`.
- Missing, simulated, stale, drifted, contradictory, or incomplete account/market/instrument data blocks or rejects risk evaluation.
- Baseline controls remain 0.25% equity risk per trade, 1% daily-loss halt, two open positions, 1.5:1 minimum reward:risk, and three-loss cooling.
- Proposal approval checks the exact proposal version and content digest, revalidates eligibility, uses conditional pending-state transitions, and records the decision.
- Proposal ownership is checked through `user_id`; duplicate approval of the same digest is idempotent, while changed state or digest returns a conflict.
- Paper records are explicitly simulated and the paper API reports `live: false`, `executionAllowed: false`, and `tradingEnabled: false`.
- The worker lifecycle helper reports stale/unknown status when heartbeat freshness expires and never grants execution permission. It is not durable and does not claim worker health in the dashboard.
- No broker, MT5, live/demo order, execution worker, or external account was connected.

Unknown external execution outcomes are not handled by a live execution path because no such path exists. Any future execution implementation must reconcile durable broker state before retrying.

## Secrets and repository hygiene

`.env.example` was inspected and contains placeholders only. It includes illustrative connection-string shapes but no real credential. Runtime secrets remain server-side. Browser source tests confirm that database URLs, session secrets, provider keys, and Claude keys are not embedded in `src/app.js`.

No actual secret was found in the files inspected. A Git history scan was not possible because the workspace has no `.git` directory. This does not prove that secrets were never committed elsewhere; if the project is later connected to Git, run a history-aware secret scan and rotate any exposed credentials rather than merely deleting current files.

## Changes and justification

All changes were narrow, additive, and directly tied to observed security properties. No dependency was added, no package manager was changed, no migration was run, no existing test was disabled, and no trading behavior was enabled. The new deployment headers are compatible with the existing local module script and same-origin API design.

## Verification

Final command:

```text
npm run verify
```

Observed result: syntax checks passed; `63` tests passed, `0` failed, `0` skipped, and `0` cancelled.

Additional observed checks:

- `npm audit --json`: clean, zero vulnerabilities.
- `npm audit signatures`: one installed package with a verified registry signature.
- `npm ls --all`: one direct runtime package, no invalid or extraneous packages reported.
- `npm ci --ignore-scripts`: completed successfully.

Local-only tests covered authentication, logout, CSRF, session expiry/revocation, database safety, provider validation, strategy/risk/proposal boundaries, simulation separation, worker lifecycle, missing-origin rejection, parsed-body limits, account-currency validation, and deployment/API security headers.

## Production blockers and required actions

Before public deployment:

1. Replace process-local rate limiting with a shared atomic limiter and verify proxy client-IP handling.
2. Perform a real deployment configuration review for `APP_ENV=production`, secrets, HTTPS, trusted proxy behavior, database roles, connection limits, and logging sinks.
3. Run a history-aware secret scan after connecting the repository to its actual Git remote.
4. Perform DAST/security-header/browser checks against a controlled staging deployment.
5. Keep Neon, provider, Claude/news, worker, MT5, broker, and account integrations unverified until separately tested with non-production credentials.
6. Preserve the explicit approval, independent risk, emergency-stop, audit, and execution-disabled gates in every future worker or broker integration.

Milestone 10.5 is complete. Milestone 12 and all execution/deployment work remain outside this checkpoint and require explicit approval.
