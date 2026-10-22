# Milestone 6 report — Strategy and candidate detection

## Status

Completed for the approved Milestone 6 scope. Milestone 7 has not started.

## 1. What was implemented

- Added isolated deterministic indicator functions for simple moving average, Wilder-style RSI, and average true range with explicit warm-up periods.
- Added the configurable `baseline-trend-momentum-v1` strategy engine. It uses moving-average trend, RSI confirmation, ATR volatility, maximum spread, data-quality filters, a minimum reward:risk threshold, and ATR-based protective-level calculations.
- Added BUY, SELL, and NO TRADE outcomes. Conditions that are incomplete, stale, delayed, gapped, insufficient, malformed, low-volatility, wide-spread, or otherwise unclear return NO TRADE.
- Added strict candidate records containing candidate ID, timestamps, symbol, strategy/version, direction, timeframe, reference candle, quote snapshot, entry conditions, optional stop-loss/take-profit, reward:risk, indicators, reasons, counterconditions, data quality, spread status, expiry, invalidation criteria, informational status, not-approved state, and not-executed state.
- Excluded forming candles from indicator calculations and mark those evaluations `provisional`. The engine rejects non-chronological/duplicate candles and never accepts client-supplied prices or indicator values.
- Added protected `GET /api/private/strategy` integration. It fetches market data server-side through the existing provider adapter, validates allowlisted symbol/timeframe/strategy/limit inputs, applies the existing request limiter, and returns safe unavailable/error responses.
- Connected the existing chart/analysis screen to candidate analysis. The UI displays direction, signal state, strategy/version, reference price, optional levels, reward:risk, data quality, expiry, reasons, counterconditions, source/mode, and explicit unavailable/no-trade states.
- Kept candidates informational only. No approval action, broker call, paper trading, order submission, Claude integration, or persistence migration was added.

The current application is a Node/Vercel serverless application, so the engine is implemented as a server-side JavaScript module to preserve its deployable runtime and avoid introducing an unconnected Python worker. The algorithm is deterministic and isolated from the frontend and AI services. A future Python worker/backtesting implementation remains outside this milestone.

## 2. Files changed

- `api/_lib/config.js`
- `api/_lib/strategy/indicators.js`
- `api/_lib/strategy/engine.js`
- `api/private/strategy.js`
- `src/app.js`
- `index.html`
- `.env.example`
- `package.json`
- `README.md`
- `docs/architecture.md`
- `tests/strategy.test.mjs`
- `tests/dashboard.test.mjs`
- `docs/milestones/milestone-6-report.md`

Existing authentication, database, market-data, and security files were preserved except for narrowly scoped configuration/health/dashboard integration references.

## 3. Baseline strategy behavior

The default server-side configuration is:

- Fast SMA: 10 candles.
- Slow SMA: 30 candles.
- RSI: 14 candles.
- ATR: 14 candles.
- Minimum reward:risk: 1.5:1.
- Maximum spread: 3 pips.
- Minimum ATR: 2 pips.
- Stop distance: 1.5 ATR.
- Quote maximum age: 120 seconds.

These are initial engineering defaults, not optimized parameters and not evidence of profitability. A BUY requires fast SMA above slow SMA, RSI in the 50–70 confirmation band, acceptable ATR, acceptable spread, fresh non-delayed quote data, and valid calculated levels. SELL uses the inverse trend and 30–50 RSI band. Otherwise the engine returns NO TRADE.

The engine does not assume that a reference candle close was filled. It describes a future confirmation entry condition and labels the result informational. A forming latest candle is excluded and marked provisional; incomplete historical candles or large gaps invalidate the evaluation.

## 4. Environment variables

All values are server-side only and no secret values are included here.

- `STRATEGY_FAST_MA_PERIOD`
- `STRATEGY_SLOW_MA_PERIOD`
- `STRATEGY_RSI_PERIOD`
- `STRATEGY_ATR_PERIOD`
- `STRATEGY_MIN_REWARD_RISK`
- `STRATEGY_MAX_SPREAD_PIPS`
- `STRATEGY_MIN_ATR_PIPS`
- `STRATEGY_STOP_ATR_MULTIPLIER`
- `STRATEGY_QUOTE_MAX_AGE_SECONDS`

The configuration loader bounds each value and rejects a slow moving-average period that is not greater than the fast period. Existing authentication, Neon, and optional market-data variables remain unchanged.

## 5. Tests and verification

Executed from the repository root:

```text
npm run verify
```

Executed `npm run verify`; syntax checks passed and **32 tests passed, 0 failed, 0 skipped, 0 cancelled**. It covered indicator warm-up and correctness, BUY/SELL/NO TRADE outcomes, stale/delayed/missing/wide-spread/gapped/insufficient data, forming candles, future-data leakage, deterministic repeatability, invalid levels, protected API authentication, validation, safe unavailable data, and dashboard integration. Existing login, logout, CSRF, session, Neon adapter, market-data, health, and dashboard regression tests also passed.

No live provider or Neon verification was performed because credentials remain unavailable.

Browser visual QA was not repeated in this milestone. The existing Milestone 5 desktop unavailable-data visual check remains the only browser visual check; mobile screenshot QA remains outstanding because the available browser surface lacks a viewport override.

## 6. Services, costs, and limitations

- No paid services were provisioned or activated.
- Twelve Data remains optional and unverified live. Without provider credentials, the strategy endpoint safely returns unavailable rather than a fabricated NO TRADE or signal based on invented data.
- Candidate records are not persisted because durable candidate history was not required by this milestone and no second database was introduced.
- The existing process-local request limiter is not a multi-instance protection mechanism. Production still needs a shared atomic limiter or managed rate-limit service with fail-closed behavior.
- The baseline uses a fixed non-JPY pip size of `0.0001`, appropriate for the current registry symbols but requiring an explicit symbol metadata review if the registry expands.
- No backtesting, optimization, walk-forward validation, profitability claim, live-market validation, broker integration, or order execution was performed.

## 7. Outstanding issues and next boundary

- Live provider and Neon connectivity remain unverified.
- The current engine is runtime-native JavaScript; a separate Python worker/backtesting implementation remains future work and was not introduced here.
- Candidate history, approvals, independent risk decisions, trade proposals, and paper/live execution remain out of scope.
- Milestone 7 boundary: protected Claude integration only. Claude must not approve trades, change risk limits, or execute orders.

Stop point: waiting for user review and approval before any later milestone.
