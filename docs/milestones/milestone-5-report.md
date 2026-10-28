> Historical milestone record. The active backend is now Supabase Auth and Data API. Use [the current release runbook](../runbooks/cloudflare-deployment.md); legacy Neon/custom-password instructions below are not current deployment guidance.

# Milestone 5 report — Market data and charting

## Status

Completed for the approved Milestone 5 scope. Milestone 6 has not started.

## 1. Implemented

- Added a provider-independent market-data layer with a central registry for `EUR/USD`, `GBP/USD`, `USD/ZAR`, and `EUR/ZAR`.
- Added supported timeframe mappings for `M5`, `M15`, and `H1`; the adapter sends provider-native intervals only after server-side validation.
- Added an optional server-only Twelve Data adapter for forex quotes and historical time series.
- Added quote normalization with price, optional bid/ask, computed spread, source, timestamp, data-mode label, and freshness status.
- Added candle normalization with UTC timestamps, positive finite OHLC values, OHLC bounds, future-timestamp rejection, chronological sorting, duplicate replacement by last validated observation, response-size limits, and gap warnings without backfilling.
- Added bounded provider timeouts, bounded retries for transient failures/rate limits, `Retry-After` handling, malformed-response handling, and safe provider error mapping.
- Added process-local success caching as a short freshness optimization and a protected process-local request limiter for the market-data endpoint.
- Added `GET /api/private/market-data` with existing database-backed session authorization, safe errors, query validation, and no credential exposure.
- Connected the watchlist and chart/analysis screens to the endpoint. The UI now supports symbol selection, quote details, source/mode/freshness labels, timeframe controls, validated SVG candlestick rendering, loading/empty/error states, and explicit unavailable data.
- Updated health reporting to include optional market-data configuration state.
- Preserved the existing authentication, durable sessions, CSRF, Neon persistence, dashboard screens, responsive styling, read-only execution boundary, and trading-disabled posture.

## 2. Files changed

- `api/_lib/config.js`
- `api/_lib/market-data/symbols.js`
- `api/_lib/market-data/validation.js`
- `api/_lib/market-data/normalize.js`
- `api/_lib/market-data/provider.js`
- `api/_lib/market-data/cache.js`
- `api/_lib/market-data/rate-limit.js`
- `api/private/market-data.js`
- `api/health.js`
- `src/app.js`
- `src/styles.css`
- `index.html`
- `.env.example`
- `package.json`
- `README.md`
- `docs/architecture.md`
- `tests/market-data.test.mjs`
- `docs/milestones/milestone-5-report.md`

## 3. Provider selection and verification

Twelve Data was selected as an optional adapter because its documented forex quote and time-series endpoints match this milestone's read-only requirements and expose the intervals needed by the registry. Its current individual Basic plan is listed as free, with forex market data and an 800/day API limit; the plan's usage/display terms must be reviewed before any public deployment. See the [Twelve Data API documentation](https://twelvedata.com/docs) and [current individual pricing](https://twelvedata.com/pricing).

No Twelve Data credentials were present in the repository environment. The live provider was not called, and no live quotes or candles are claimed. With `MARKET_DATA_PROVIDER=none` or a missing key, startup remains safe and the private endpoint returns an explicit unavailable state.

## 4. Environment variables

All values are server-side only; no secret value is included in this report.

- `MARKET_DATA_PROVIDER=none` or `twelvedata`.
- `TWELVE_DATA_API_KEY` when the Twelve Data adapter is enabled.
- `MARKET_DATA_BASE_URL` (default `https://api.twelvedata.com`).
- `MARKET_DATA_TIMEOUT_MS`, `MARKET_DATA_MAX_RETRIES`, `MARKET_DATA_CACHE_SECONDS`, `MARKET_DATA_MAX_CANDLES`, and `MARKET_DATA_QUOTE_STALE_SECONDS`.
- `MARKET_DATA_RATE_LIMIT_WINDOW_SECONDS` and `MARKET_DATA_RATE_LIMIT_MAX_REQUESTS`.
- Existing auth and Neon variables remain required for the authenticated application; see `.env.example`.

## 5. Tests and verification

Executed from the repository root:

```text
npm run verify
```

Observed result: passed. Syntax checks passed and **25 tests passed, 0 failed, 0 skipped, 0 cancelled**.

The added market-data tests cover provider quote/candle parsing, malformed data, OHLC validation, ordering and duplicate handling, symbol/timeframe/limit validation, stale data, rate limits, bounded timeout behavior, missing credentials, safe unavailable startup, private-route authentication, method rejection, and safe error bodies. Existing authentication, logout, CSRF, session, database, health, and dashboard regression tests also passed.

Browser visual QA was performed against a local authenticated preview with server responses intentionally mocked as unavailable: desktop overview, market watchlist, and chart/analysis states were visually inspected. Mobile screenshot QA was not performed because the available browser automation surface did not expose a viewport override. Responsive breakpoints, reduced motion, focus states, semantic labels, and unavailable-data structure remain covered by automated tests.

Live Neon connectivity, live Twelve Data connectivity, broker connectivity, AI output, deployment, and order execution were not performed.

## 6. Services, costs, and limitations

- No paid service was provisioned or activated.
- Twelve Data is optional; the implementation does not require a subscription. Its free-plan quota and usage/display terms are external constraints and are not treated as production guarantees.
- The provider adapter supports the registry and documented intervals, but actual symbol availability can still be provider/account dependent and is surfaced as an unavailable response.
- The login and market-data request limiters are process-local. They do not protect multiple serverless instances. Production should use a shared atomic Neon-backed limiter or a dedicated managed rate-limit service and fail closed when unavailable.
- The market-data cache is process-local and non-durable. It reduces repeat requests within one instance only.

## 7. Outstanding issues and next boundary

- Live provider verification remains outstanding until valid credentials are supplied in a controlled runtime environment.
- Mobile browser screenshot QA remains outstanding because the available browser surface could not set a mobile viewport.
- Bid/ask and spread remain unavailable when the selected provider omits them; the UI preserves `—` rather than deriving a false spread from a single price.
- No provider data is persisted, no background worker is introduced, and no market data can trigger trading.
- Milestone 6 boundary: strategy/AI candidate detection only. Claude integration, trade proposals, risk decisions, approvals, paper execution, MT5 execution, and live orders remain out of scope.

Stop point: waiting for user review and approval before any later milestone.
