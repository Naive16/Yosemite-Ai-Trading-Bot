# Yosemite AI architecture

## Scope

This document describes the Milestone 1 foundation through the unified Supabase Auth + Supabase PostgreSQL backend migration. It does not claim live Supabase DDL execution, market-provider, Claude/news, account/broker verification, strategy profitability, broker execution, continuous paper operation, MT5 compatibility on this host, or deployment.

## Components

```text
Browser
  ├── index.html + src/app.js + src/styles.css
  │     ├── login screen and authenticated responsive dashboard shell
  │     ├── overview, markets, chart/analysis, approvals, positions, history
  │     ├── risk settings, system health, and audit history screens
  │     └── explicit unavailable-data and read-only execution states
  │     └── no credentials or execution logic in the browser
  ├── POST /api/auth/login
  ├── GET  /api/auth/me
  ├── POST /api/auth/logout
  ├── GET  /api/private/status
  ├── GET  /api/private/market-data
  │     └── authenticated, read-only quote/candle adapter with validation, freshness, cache, and safe provider errors
  ├── GET  /api/private/strategy
  │     └── authenticated, read-only deterministic candidate analysis over server-fetched validated market data
  ├── GET  /api/private/analysis
  │     └── authenticated, read-only Claude interpretation of a server-assembled evidence snapshot
  ├── GET  /api/private/risk
  │     └── authenticated, read-only independent risk evaluation; BLOCKED until trusted account/exposure inputs exist
  ├── GET, POST /api/private/proposals
  │     └── authenticated proposal listing/details and CSRF-protected exact-version approve/reject actions
  ├── GET, POST /api/private/backtest
  │     └── authenticated, bounded historical-simulation boundary; unavailable without validated provider and instrument specifications
  ├── GET, POST /api/private/paper
  │     └── authenticated, CSRF-protected simulated-only boundary; no browser-supplied events or live execution
  │     └── server-side Supabase Auth owner verification, session, CSRF, validation, and safe response layer
  │           └── Supabase PostgreSQL via pg (Supavisor Transaction Mode :6543 + RLS hardening)
  └── GET /api/health
        └── Vercel-compatible foundation health response including optional market-data configuration state

Market-data layer
  ├── central forex symbol registry: EUR/USD, GBP/USD, USD/ZAR, EUR/ZAR
  ├── supported UI timeframes: M5, M15, H1, mapped to provider intervals
  ├── provider-neutral adapter contract
  └── optional server-only Twelve Data adapter; no credentials in browser code

Strategy layer
  ├── deterministic indicators: SMA, RSI, ATR with explicit warm-up periods
  ├── baseline-trend-momentum-v1 setup rules and bounded configuration
  ├── BUY, SELL, and NO TRADE informational candidate records
  └── no approval, broker, paper-trading, or order-execution capability

AI analysis layer
  ├── server-only Anthropic Messages API adapter with bounded timeout, retry, output, and rate limits
  ├── strict schema validation; source references must match supplied news IDs
  ├── provider-independent news/calendar contract with disabled-by-default JSON feed adapter
  ├── explicit unavailable/stale/missing-news states; news is treated as untrusted data
  └── no approval, risk override, broker, or execution capability

Risk layer
  ├── versioned bounded baseline limits and explicit UTC/configured-time-zone trading-day keys
  ├── deterministic stop, reward:risk, freshness, drift, exposure, loss-halt, cooling, and state checks
  ├── position sizing with explicit contract/pip/volume specifications and currency conversion
  ├── additive PostgreSQL risk state/evaluation tables plus existing audit-event recording
  └── PASS is validation only; it is never approval or execution authorization

Proposal layer
  ├── canonical immutable payloads with SHA-256 content digests and explicit versions
  ├── eligibility requires a fresh risk PASS, valid parameters, unexpired trusted evidence, and no safety block
  ├── conditional PostgreSQL transitions prevent concurrent or stale approvals
  ├── approval/rejection actors, reasons, versions, and digests are persisted for auditability
  └── approval records consent only and cannot trigger execution

Simulation layer
  ├── deterministic chronological backtest engine with no-lookahead replay
  ├── explicit next-candle-open fills, cost assumptions, gap handling, and conservative stop-first ambiguity handling
  ├── existing strategy and risk engines reused in explicit simulation context
  ├── pure paper simulator with idempotent event handling and simulated-only state
  └── additive migration `004_paper_backtest.sql`; no persistent worker or broker adapter

Worker groundwork
  ├── server-only worker configuration is disabled by default
  ├── explicit enablement requires a database URL and bounded timing values
  ├── lifecycle helper models start, heartbeat freshness, duplicate job IDs, and graceful stop
  └── no durable heartbeat, polling loop, broker adapter, or execution permission is provided

MT5 integration foundation
  ├── provider-isolated adapter contract with validated account, symbol, quote, and read-only state responses
  ├── explicit provider-reported demo classification plus account/server allowlists
  ├── order submission permanently blocked by current configuration
  ├── additive execution-intent/reconciliation migration `005_execution_reconciliation.sql`
  └── deterministic state machine for idempotency, unknown outcomes, and reconciliation-required states

Future components (not connected in Milestones 1-12)
  ├── persistent worker and external paper-data feed
  ├── real MT5 terminal transport and controlled demo read-only verification
  └── any broker order submission or execution worker
```

## Data-flow decisions

- The browser contains no credentials and has no order-execution capability.
- Runtime API traffic uses the server-only Supabase Supavisor Transaction Mode `DATABASE_URL` (`:6543`); DDL migrations use `DIRECT_URL` (or `DATABASE_URL_UNPOOLED`) pointing to Supabase Session Mode (`:5432`) or Direct (`:5432`).
- Database queries use parameter placeholders (`$1..$n`) through the `pg` PostgreSQL wire-protocol driver. Migration SQL (`001`–`008`) is trusted, versioned, additive, enables Row Level Security across all 21 `public` tables, and is never assembled from request input.
- Owner authentication uses server-side Supabase Email + Password (`POST /auth/v1/token?grant_type=password` + `GET /auth/v1/user`) with constant-time `SUPABASE_OWNER_USER_ID` enforcement on login and every protected route. Passwords and keys are never stored in browser code or plaintext logs.
- Sessions use opaque random tokens in an HttpOnly, SameSite=Lax cookie. Only HMAC-derived session and CSRF hashes are stored in PostgreSQL. State-changing auth requests require same-origin checks and the session-bound CSRF token.
- Session validation and revocation query PostgreSQL, so a session remains valid or revoked across simulated serverless instances.
- Login failures are generic and rate-limited by a hashed client identifier plus username in the current process only.
- The current rate limiter is not shared across instances. Production requires an atomic shared counter/window store or a dedicated rate-limit service and must fail closed when that limiter is unavailable.
- API responses set no-store and baseline browser security headers.
- The health endpoint is read-only and reports that broker, database, and AI services are not configured by default.
- Provider credentials are read only by server-side configuration. The market-data route validates symbols, timeframes, limits, response size, timestamps, OHLC bounds, duplicates, freshness, and provider errors before returning data.
- Quotes include optional bid/ask and spread values, provider source, timestamp, and freshness. Candles are normalized to UTC, sorted chronologically, deduplicated by timestamp using the last validated observation, and never backfilled when missing.
- Provider requests use bounded timeouts, bounded retries for rate limits/transient failures, safe error responses, and a process-local cache. The cache does not provide cross-instance consistency.
- Dashboard values are provider responses or explicit unavailable states, not fabricated market data. No simulated prices, balances, trades, performance, or signals are displayed.
- Strategy evaluation accepts only server-fetched validated candles and quotes; client-supplied prices and indicator values are ignored because the strategy endpoint has no such inputs.
- Indicator calculations are deterministic and expose warm-up periods. The engine rejects non-chronological/duplicate candle timestamps, malformed OHLC, incomplete historical candles, large gaps, stale/delayed quotes, unavailable spread, insufficient history, and invalid protective levels. A forming latest candle is excluded from calculations and marked `provisional`.
- Candidate records include strategy version, direction, reference timestamp, evidence, counterconditions, data quality, expiry, invalidation criteria, `informational` status, `not_approved` state, and `not_executed` state. No candidate is treated as user approval or an order.
- Strategy parameters are server-side bounded configuration. The endpoint uses the existing authenticated session and process-local request limiter, returns safe unavailable/error responses, and does not persist candidates because no durable history is required in this milestone.
- Claude receives only a server-assembled snapshot containing validated market evidence, the deterministic candidate, and explicitly unavailable news/calendar state when no verified feed is configured. Prompt text treats news as untrusted data and cannot grant it authority over system safety rules.
- Claude output must be strict JSON with matching symbol/timeframe, bounded text and numbers, verified source IDs, expiry, and analysis metadata. Model confidence is discarded and never represented as a calibrated probability. A malformed, contradictory, stale, or unavailable response becomes a safe unavailable/NO TRADE state.
- Anthropic/OpenRouter credentials remain server-only. Provider responses share the existing bounded advisory schema and fail closed on refusal, empty, truncated, malformed, or invalid output. Provider usage may incur charges; no paid service was activated and live provider connectivity remains unverified.
- Risk evaluation does not accept account balances, P&L, positions, conversion rates, or instrument specifications from the browser. The current endpoint returns BLOCKED and records an audit event because no trusted account/broker source is configured. Simulated fixtures are test-only and cannot produce a live PASS.
- Position sizing requires explicit base/quote conversion rates, contract size, pip value, pip size, volume bounds/step, and cost assumptions. Missing broker-specific specifications block sizing rather than inferring them from a symbol name.
- Risk state is designed for additive persistence in `002_risk_engine.sql`, including configuration versions, daily equity state, account/position snapshots, and risk evaluations. Concurrent multi-instance live broker account-state validation remains deferred while broker execution stays disabled.
- Proposal state is designed for additive persistence in `003_trade_proposals.sql`. Proposal payloads are stored with a canonical digest and version; decisions use conditional updates requiring pending status, matching digest/version, and unexpired state. No approval can be created from client-supplied financial values.
- Backtests consume only server-side validated historical candles. The engine replays candles chronologically, excludes future candles from each decision, fills at the next candle open by default, applies configured spread/commission/swap/slippage assumptions, handles gaps at the open, and resolves same-candle stop/target ambiguity conservatively as stop-first. It closes any remaining simulated position at the final historical close and labels results as historical simulation.
- Backtest inputs are bounded and reproducible. Unsupported instrument specifications, missing historical data, invalid OHLC, non-chronological candles, duplicate timestamps, and excessive gaps fail safely rather than being inferred or repaired into fabricated data.
- Paper simulation accepts only a server-side trusted approved proposal with a risk `PASS`; browser clients cannot inject quotes, events, positions, or fills. Event IDs are idempotency keys in the pure simulator. The current API reports that paper operation is unavailable because no persistent worker or trusted live source is configured.
- Worker status must be backed by durable, recent heartbeat rows before the dashboard can call a worker healthy. The current lifecycle helper is intentionally in-process and test-only; an expired process or a serverless instance restart must be treated as stale/unknown, never as healthy.
- MT5 account classification must come from provider-reported trade mode and exact server-side account/server allowlists. Server names, usernames, environment labels, and dashboard state cannot prove demo status. Unknown or live classifications block the adapter.
- The MT5 adapter is transport-independent and order submission is hard-blocked. A successful provider request must never be treated as execution; broker order/deal/position state must be reconciled, especially after timeouts or ambiguous responses.
- Execution intents use additive migration `005_execution_reconciliation.sql` with idempotency uniqueness and explicit unknown/reconciliation-required states. The current pure ledger is testable groundwork, not a durable repository or live execution path.
- The deployment investigation recommends retaining the current request-driven frontend/API and Supabase PostgreSQL database, with any future worker isolated as a separate process using the same server-side secrets and mandatory approval/risk gates. The worker must claim jobs transactionally, use idempotency keys, reconcile unknown outcomes after restart, back off on provider/database failure, and shut down without claiming uncommitted work completed.
- The current environment has no trusted candidate/account/instrument source for proposal creation, so the UI remains empty and approval cannot be manufactured. Future execution components must consume the exact approved proposal ID/version/digest and revalidate risk and expiry before any execution attempt.
- Login, market-data, AI, risk, strategy, backtest, and paper request limiters use the shared atomic `rate_limit_buckets` table from migration `007_rate_limit_buckets.sql`, with fail-closed behavior for sensitive routes. The migration must be applied and verified on the target database before public deployment.
- The initial safety state is paused, with live trading explicitly disabled.
- Future trade proposals must flow through server-side validation and immutable approval records before a worker can submit a demo order.

## Repository layout

Milestone 13 adds provider-independent operational health, bounded/redacted structured logging, deduplicated alert contracts, retry/recovery decisions, and additive tables for alerts, worker leases, and recovery tasks. The authenticated operations diagnostic reports unknown/unavailable states explicitly; no alert delivery provider or persistent worker is configured.

- `index.html`: responsive dashboard and authentication shell.
- `src/`: browser application code and styles.
- `api/`: Vercel-compatible serverless functions.
- `api/_lib/`: configuration, database, repository, HTTP security, authentication, validation, market-data provider adapters, normalization, cache, rate-limit, indicator, strategy, Claude, news, AI, backtest, and paper-simulation helpers.
- `db/migrations/`: additive versioned SQL migrations; use `DIRECT_URL` (`:5432`) for execution. `002_risk_engine.sql` adds risk state, `003_trade_proposals.sql` adds immutable proposal and decision records, `004_paper_backtest.sql` adds simulation-run/event/position/trade storage, `007_rate_limit_buckets.sql` adds shared atomic rate limiting, and `008_supabase_rls_hardening.sql` enables Row Level Security and locks down PostgREST access across all 21 `public` tables.
- `scripts/migrate.mjs`: PostgreSQL migration runner that rejects transaction-pooled (`:6543`) and legacy Neon URLs.
- `scripts/migrate-neon-to-supabase.mjs`: read-only-source (`BEGIN READ ONLY`), dry-run-by-default, idempotent data migration runner for preserving durable Neon records in Supabase.
- `tests/`: focused local tests using deterministic mocks plus disposable real PostgreSQL (`PGlite`), provider fixtures, and strategy fixtures; no live Supabase or market-data credentials are required.
- `docs/`: architecture and milestone documentation.
- `.env.example`: placeholder configuration names only.

## Deferred decisions

- Frontend framework selection: the repository was empty, so the foundation uses browser-native JavaScript to avoid unnecessary dependencies. React can be introduced later if the dashboard's state complexity justifies it.
- Persistent worker hosting, trusted paper-data ingestion, and MT5 compatibility: deferred to Milestone 11, where free-tier eligibility and architecture will be verified before provisioning.
- Broker positions and execution tables remain deferred. The current schema stores the configured single-user account, durable auth sessions, audit events, Milestone 8 risk-state contracts, and Milestone 9 proposal/decision records; no live account feed or execution worker populates them yet.
