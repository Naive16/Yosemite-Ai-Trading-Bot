# Milestone 10 Report — Backtesting and Paper Trading

## Status

Milestone 10 is locally implemented. This report does not claim live provider, Neon, account, broker, or paper-worker verification. Trading remains disabled and no broker or MT5 connection was added.

## Implemented

- Added a deterministic server-side backtest engine that replays validated chronological candles with no lookahead.
- Reused the existing deterministic strategy and independent risk engines in an explicitly simulated context.
- Added bounded input validation, reproducible run configuration, historical-simulation labelling, and performance metrics including return, drawdown, profit factor, expectancy, trade counts, and costs.
- Applied explicit simulation assumptions: next-candle-open fills, spread/commission/swap/slippage inputs, execution delay of one candle, gap-at-open handling, conservative stop-first handling for ambiguous intrabar hits, and end-of-test close of open positions.
- Added a pure paper simulator with simulated-only positions/orders/trades state and idempotent event IDs. It accepts only trusted approved proposals with a risk `PASS`; it never submits broker orders.
- Added protected `/api/private/backtest` and `/api/private/paper` boundaries with existing authentication, CSRF protection for mutations, rate limiting, bounded bodies, safe unavailable responses, and no browser-supplied event data.
- Added additive migration `004_paper_backtest.sql` for future backtest runs and simulated events, positions, and trades. It was not applied because no authorized database credentials were available.
- Added dashboard navigation/status surfaces for Historical Simulation and Paper Simulation. The UI explicitly states unavailable, simulated-only, and no-live-order conditions.
- Preserved the Milestone 1–9 authentication, session, CSRF, market-data, strategy, Claude/news, risk, proposal, and dashboard behavior.

## Files changed

- `api/_lib/backtest/engine.js`
- `api/_lib/backtest/metrics.js`
- `api/_lib/paper/simulator.js`
- `api/_lib/risk/engine.js`
- `api/private/backtest.js`
- `api/private/paper.js`
- `db/migrations/004_paper_backtest.sql`
- `index.html`
- `src/app.js`
- `tests/backtest.test.mjs`
- `tests/database.test.mjs`
- `tests/dashboard.test.mjs`
- `tests/simulation-api.test.mjs`
- `package.json`
- `README.md`
- `docs/architecture.md`

## Provider and services

No new provider was selected for Milestone 10. The backtest engine is provider-independent and accepts validated historical candles from a trusted server-side source. The current API safely reports unavailable because no validated historical provider and instrument-specification source are configured. No live market-data request, Neon connection, paid service, broker, or execution adapter was used.

The paper simulator is a library and protected API boundary only. No persistent worker, continuous event loop, trusted live quote feed, broker account, or cloud deployment was introduced.

## Configuration

Existing server-only configuration remains required for authenticated API access, including `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, and `DATABASE_URL`. Live market data remains optional through the existing `MARKET_DATA_PROVIDER` and provider credentials. No new secret is exposed to browser code. Migration execution continues to require the direct `DATABASE_URL_UNPOOLED` connection and explicit operator authorization.

## Verification

Final verification command:

```text
npm run verify
```

Final observed result: `57` tests passed, `0` failed, `0` skipped, and `0` cancelled; JavaScript syntax checks passed. The suite includes deterministic backtest replay, metrics, malformed/chronology rejection, paper idempotency, migration safety, protected simulation API authentication/CSRF, and existing Milestone 1–9 regression coverage.

Browser visual QA was not performed for Milestone 10. Live Neon, provider, instrument-specification, account, broker, and continuous paper-operation verification remain outstanding.

## Limits and next boundary

- Backtest results are historical simulations, not forecasts, live performance, or profitability claims.
- Costs and swaps are only as accurate as explicitly supplied assumptions; broker-specific specifications are not inferred.
- The current paper API intentionally reports not running because there is no persistent worker or trusted live source.
- Login, market-data, risk, AI, and simulation rate limiters remain process-local and do not protect multiple serverless instances; production requires a shared atomic limiter or managed service with fail-closed behavior.
- Migration 004 is additive and has not been run against Neon. No destructive migration was performed.

Milestone 11, including any persistent worker, trusted paper-data ingestion, MT5/demo connectivity, or other execution-adjacent integration, is outside this milestone and requires approval.
