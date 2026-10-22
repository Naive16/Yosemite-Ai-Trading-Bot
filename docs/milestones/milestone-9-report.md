# Yosemite AI — Milestone 9 Report

## Status

Milestone 9 is complete for the approved explicit trade-approval workflow scope. Milestone 10 has not started. Trading remains disabled and read-only.

## 1. Implemented

- Added immutable server-side proposal construction with explicit versioning, canonical JSON representation, SHA-256 content digest, strategy evidence, optional Claude references, risk decision, market-data metadata, expiry, and audit metadata.
- Added eligibility enforcement: only fresh, unexpired proposals with valid trade parameters and risk `PASS` can be approved. `REJECT`, `BLOCKED`, expired, invalidated, superseded, changed, or already-consumed proposals cannot be approved.
- Added protected `GET, POST /api/private/proposals` workflow for authenticated listing/details and exact-version approve/reject actions.
- Required same-origin validation, the existing session, and the session-bound CSRF token for decisions. Client financial values are never accepted as proposal evidence.
- Added conditional PostgreSQL transitions requiring user ownership, exact proposal ID/version/digest, pending status, and unexpired state. Repeated identical decisions are handled idempotently where the persisted state is already the requested terminal state.
- Added additive migration `003_trade_proposals.sql` for immutable proposal payloads and decision records, including constraints, indexes, actor identity, reason, digest, and timestamps.
- Connected the approvals dashboard to the protected proposal API. Approval requires an explicit review checkbox and is disabled for non-`PASS` proposals. The UI explains the safe empty/blocked state.
- Preserved authentication, CSRF, durable sessions, market data, strategy, Claude, news, risk engine, responsive dashboard, and execution-disabled safeguards.

## 2. Files changed

- `api/_lib/proposals/canonical.js`
- `api/_lib/proposals/repository.js`
- `api/private/proposals.js`
- `db/migrations/003_trade_proposals.sql`
- `src/app.js`
- `index.html`
- `src/styles.css`
- `package.json`
- `README.md`
- `docs/architecture.md`
- `tests/proposals.test.mjs`
- `tests/database.test.mjs`
- `tests/dashboard.test.mjs`
- `docs/milestones/milestone-9-report.md`

No broker, MT5, paper-trade, execution queue, automatic approval, or bulk approval functionality was added.

## 3. Current eligibility state

The repository still lacks trusted market, account, conversion-rate, and broker instrument-specification integrations. Therefore no successful proposal is manufactured for the dashboard and no approval can currently be completed through a real eligible proposal. This is intentional: client-supplied values cannot bypass missing trusted inputs.

## 4. Persistence and concurrency

Migration `003_trade_proposals.sql` is additive and was not applied because live Neon credentials remain unavailable. Proposal payloads are stored as JSON with a digest and version. Decisions are stored separately with actor, reason, digest, and timestamp. The conditional transition prevents two concurrent requests from both moving a pending proposal to a terminal state. The endpoint re-reads state and verifies the digest before approving.

## 5. Verification

Executed:

```text
npm run verify
```

The first run caught one dashboard assertion mismatch; that test was corrected. The final verification run passed **50 tests, 0 failed, 0 skipped, 0 cancelled**, including syntax checks.

Coverage includes proposal digest stability, material-change detection, eligibility for `PASS`/`REJECT`/`BLOCKED`, expiry, conditional transition SQL, additive migration constraints, protected dashboard wiring, and regression coverage for authentication, CSRF, sessions, Neon adapters, market data, strategy, Claude, risk, and dashboard behavior.

Tests use deterministic fixtures. They do not verify live Neon transactions, live account state, broker state, market-provider connectivity, Claude/news connectivity, or execution.

## 6. Outstanding limitations

- Live Neon migration and concurrent transaction behavior were not verified.
- No trusted source currently creates an eligible `PASS` proposal, so live approval was not demonstrated.
- The proposal API’s process-local request protections do not replace a shared production rate limiter.
- Browser visual QA was not repeated in Milestone 9. The Milestone 5 desktop check remains the only browser visual check; mobile viewport QA remains outstanding.
- Approval records consent only for the exact proposal version and digest. They never trigger execution.

## 7. Next boundary

Milestone 10 may proceed only after approval and must remain within its specified boundary. Later execution components must consume the exact approved proposal ID/version/digest, revalidate expiry and risk state, and maintain the trading-disabled boundary until explicitly authorized.

Stop point: waiting for review and approval.
