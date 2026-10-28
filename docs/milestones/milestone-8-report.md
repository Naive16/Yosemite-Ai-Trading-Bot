> Historical milestone record. The active backend is now Supabase Auth and Data API. Use [the current release runbook](../runbooks/cloudflare-deployment.md); legacy Neon/custom-password instructions below are not current deployment guidance.

# Yosemite AI — Milestone 8 Report

## Status

Milestone 8 is complete for the approved independent-risk-engine scope. Milestone 9 has not started. Trading remains disabled and read-only.

## 1. Implemented

- Added versioned `independent-risk-engine` v1.0.0 with `PASS`, `REJECT`, and `BLOCKED` decisions.
- Added bounded, centrally configured safeguards: 0.25% maximum equity risk per trade, 1% daily loss halt, two maximum open positions, 1.5:1 minimum reward:risk, three-loss cooling, quote-age and price-drift limits, mandatory stop-loss, and explicit trading-day configuration.
- Added deterministic position sizing with contract size, pip size/value, costs, volume minimum/maximum/step, exposure limits, and explicit base/quote-to-account currency conversion. Volume is rounded down and never upward beyond the risk budget.
- Added validation for stop direction, take-profit direction, candidate expiry/state, reward:risk, quote freshness, daily state, loss cooling, open positions, simulated state, price drift, aggregate exposure, and missing/inconsistent evidence.
- Added additive migration `002_risk_engine.sql` for risk configuration versions, daily equity state, account snapshots, position snapshots, and risk evaluations. Added parameterized risk repository functions. Existing audit events record blocked endpoint evaluations.
- Added protected read-only `GET /api/private/risk` endpoint with authentication, session validation, rate limiting, safe errors, and no client-supplied financial inputs.
- Integrated the risk status into the existing dashboard. The current endpoint truthfully displays `BLOCKED` because no trusted account, exposure, quote, or instrument-specification source is configured.
- Preserved authentication, durable sessions, CSRF protection, market data, deterministic strategy, Claude/news integration, dashboard layouts, and execution-disabled safeguards.

## 2. Files changed

- `api/_lib/config.js`
- `api/_lib/risk/engine.js`
- `api/_lib/risk/position-sizing.js`
- `api/_lib/risk/repository.js`
- `api/_lib/risk/rate-limit.js`
- `api/private/risk.js`
- `db/migrations/002_risk_engine.sql`
- `src/app.js`
- `index.html`
- `.env.example`
- `package.json`
- `README.md`
- `docs/architecture.md`
- `tests/risk.test.mjs`
- `tests/risk-api.test.mjs`
- `tests/database.test.mjs`
- `docs/milestones/milestone-8-report.md`

No broker, MT5, paper-trade, approval, or execution code was added.

## 3. Risk defaults and persistence design

The defaults are configured through `RISK_MAX_EQUITY_FRACTION`, `RISK_DAILY_LOSS_HALT_FRACTION`, `RISK_MAX_OPEN_POSITIONS`, `RISK_MIN_REWARD_RISK`, `RISK_COOLING_AFTER_LOSSES`, `RISK_COOLING_SECONDS`, `RISK_MAX_QUOTE_AGE_SECONDS`, `RISK_MAX_PRICE_DRIFT_PIPS`, and `RISK_TIME_ZONE`. Hard bounds prevent silent loosening. The default trading-day convention is the calendar day in the configured IANA time zone; UTC is the default, so daylight-saving changes are represented by the selected zone’s calendar-date conversion rather than local server time.

The additive migration stores versioned risk configuration, daily starting equity/loss state, account snapshots, position/exposure snapshots, and risk evaluation decisions. The current endpoint records blocked evaluations in the existing audit table. No live migration was applied because Neon credentials were unavailable.

## 4. Verification

Executed:

```text
npm run verify
```

Result: syntax checks passed; **45 tests passed, 0 failed, 0 skipped, 0 cancelled**.

Coverage includes currency conversion, contract and pip specifications, costs, volume-step rounding, minimum volume rejection, stop/take-profit validation, reward:risk, daily loss, open-position limits, cooling, stale/drifted/inconsistent/simulated state, trading-day configuration, additive migration checks, protected API behavior, audit recording, and regression coverage for existing authentication, market data, strategy, Claude, CSRF, and dashboard behavior.

Tests use deterministic fixtures and do not verify live Neon, broker, account, conversion-rate, instrument-specification, Claude, news, or market-provider connectivity.

## 5. Outstanding limitations

- No trusted account, P&L, broker position, conversion-rate, or broker instrument-specification source is configured. Therefore the API cannot produce a live PASS and correctly returns BLOCKED.
- Live Neon migration and concurrent multi-instance risk-state updates were not verified.
- Risk rate limiting is process-local and does not protect multiple serverless instances. Production requires a shared atomic limiter or managed service with fail-closed behavior.
- The engine estimates stop loss; gaps, slippage, spread changes, and other costs can exceed estimates.
- Browser visual QA was not repeated in Milestone 8. The Milestone 5 desktop check remains the only browser visual check; mobile viewport QA remains outstanding.
- `PASS` is never approval, user consent, or execution authorization. Claude cannot override risk decisions.

## 6. Next boundary

Milestone 9 may address the approval workflow only after review and approval. Paper trading, broker/MT5 integration, automatic position management, and live execution remain out of scope.

Stop point: waiting for review and approval.
