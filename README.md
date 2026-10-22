# Yosemite AI

Yosemite AI is an AI-assisted forex trading workspace designed around explicit user approval, independent risk validation, auditable trade lifecycles, and safe failure behavior.

## Current status

Milestone 14 — deployment preparation for a Vercel-compatible dashboard/API and Neon-backed persistence. No remote deployment, Git push, or browser production verification has been performed.

The current build contains the Milestone 1 dashboard and health-check scaffold, Milestone 2 authentication, Milestone 3 Neon persistence, the responsive Milestone 4 trading-terminal workspace, the Milestone 5 provider-independent market-data layer, the Milestone 6 deterministic baseline strategy engine, the Milestone 7 server-only Claude analysis adapter, the Milestone 8 independent risk engine, the Milestone 9 immutable proposal/explicit approval workflow, the Milestone 10 deterministic backtest engine plus paper-simulation boundary, and the Milestone 12 MT5 adapter/reconciliation foundation. Twelve Data, Claude, the optional news feed, trusted account/exposure feeds, instrument specifications, MT5 terminal access, and broker execution are unavailable by default. Live trading, demo execution, and continuous paper operation are disabled.

## Run locally

Install dependencies before local work. The application now includes a standard Node.js HTTP server that serves the frontend and delegates API routes to the existing handlers. Opening `index.html` directly shows the authentication shell but cannot authenticate without the API.

```text
npm install
```

Start the local HTTP server with Node.js 20 or newer:

```text
npm start
```

The server binds to `0.0.0.0` and uses `PORT` when supplied, otherwise `3000`. Open `http://localhost:3000/`. The Render deployment settings are documented in [docs/runbooks/render-deployment.md](docs/runbooks/render-deployment.md).

Do not add secrets to this repository. Copy `.env.example` to a local environment and provide an `AUTH_USERNAME`, an scrypt `AUTH_PASSWORD_HASH`, a randomly generated `SESSION_SECRET` of at least 32 bytes, and a server-only Neon `DATABASE_URL` before using the login flow.

Use the pooled Neon URL for application requests. Set `DATABASE_URL_UNPOOLED` to the direct, non-pooled URL for migrations. Neither value is sent to browser code.

Generate a password hash locally with:

```text
npm run hash-password
```

Run the additive migration script only after reviewing it and configuring a direct database URL:

```text
npm run migrate
```

The configured Neon production branch has additive migrations `000001` through `000006` applied and read-only schema verification completed. Future migration changes still require review and explicit authorization.

Before a production deployment, run the fail-closed preflight with the deployment environment variables loaded:

```text
npm run deployment-check
```

It reports configuration names and safe warnings only; it never prints secret values. The current local development environment is expected to fail this check until production-only variables and an HTTPS origin are supplied by the deployment platform.

Market data is optional. Leave `MARKET_DATA_PROVIDER=none` when no provider key is configured; the application starts safely and reports live data as unavailable. To use the server-side adapter for internal development, set `MARKET_DATA_PROVIDER=twelvedata` and `TWELVE_DATA_API_KEY` in the runtime secret store. The provider endpoint and timeout/retry/cache limits are configurable in `.env.example`. The key is never sent to browser code.

The Twelve Data adapter accepts the registry symbols `EUR/USD`, `GBP/USD`, `USD/ZAR`, and `EUR/ZAR`, and the supported UI timeframes `M5`, `M15`, and `H1`. It validates provider responses before rendering them, labels delayed or cached data, and never fills missing values. Live provider connectivity was not verified in this repository because no credential was available.

Candidate analysis is provided by the protected `GET /api/private/strategy` endpoint. The baseline `baseline-trend-momentum-v1` engine uses only validated historical candles and a validated quote, with moving-average trend, RSI momentum, ATR volatility, spread limits, data-quality checks, and a minimum reward:risk threshold. Its parameters are bounded by server-side environment configuration in `.env.example`. Identical inputs and evaluation timestamps produce identical candidate records. Candidates are informational only and never imply approval, execution, or profitability.

AI interpretation is provided by the protected `GET /api/private/analysis` endpoint. Set `AI_PROVIDER=anthropic` or `AI_PROVIDER=openrouter`; the latter uses `OPENROUTER_BASE_URL` and `OPENROUTER_MODEL` with the server-only `OPENROUTER_API_KEY`. The server assembles the market snapshot and deterministic candidate; browser clients cannot supply prices, candles, indicators, news, or risk values. Either provider's output is accepted only when it matches the bounded schema and references supplied news IDs. Missing credentials, refusal, empty/truncated/malformed output, missing news, stale evidence, and provider failures remain explicit unavailable or abstention states. AI is not a trading authority and cannot approve or execute anything. Provider usage may incur charges; no live provider request is claimed by local verification.

Independent risk validation is provided by the protected `GET /api/private/risk` endpoint and the server-side `independent-risk-engine` module. Its baseline limits are 0.25% equity risk per trade, 1% daily loss halt, two open positions, 1.5:1 minimum reward:risk, three-loss cooling, quote-age and price-drift limits, and required instrument specifications. Position sizing requires explicit contract, pip, volume, and currency-conversion data; missing or simulated account state returns `BLOCKED`. `PASS` is validation only, never approval or execution authorization. Risk state uses additive migration `002_risk_engine.sql`; live Neon/account validation remains outstanding.

Trade proposals and explicit decisions use the protected `/api/private/proposals` endpoint and additive migration `003_trade_proposals.sql`. Proposal payloads are immutable and SHA-256 digest-bound. Approval requires the exact proposal version and digest, a fresh eligible `PASS` risk result, unexpired trusted inputs, authenticated user action, same-origin validation, and the session CSRF token. Rejected, blocked, expired, invalidated, superseded, or changed proposals cannot be approved. Approval records consent only; it never triggers execution. The current environment has no trusted inputs, so no eligible proposal is manufactured.

Historical simulation is exposed through the protected `/api/private/backtest` surface and the server-side `api/_lib/backtest/engine.js` module. It replays validated chronological candles without lookahead, applies explicit next-candle-open fill and cost assumptions, uses the existing deterministic strategy and risk engines in simulation context, and reports labelled historical-simulation metrics. It fails closed when no validated historical provider and instrument specifications are configured; it does not claim live performance.

Paper simulation is exposed through the protected `/api/private/paper` surface and `api/_lib/paper/simulator.js`. It is a testable, simulated-only state boundary for approved proposals with a risk `PASS`; it has no broker adapter, no live orders, no persistent worker, and no claim of continuous operation. Migration `004_paper_backtest.sql` adds additive storage for future durable runs and simulated events, positions, and trades, but has not been applied without an authorized database.

Milestone 11 adds only a disabled-by-default worker configuration contract and an in-process lifecycle test helper. `WORKER_ENABLED=true` requires a server-side database URL, but the helper does not persist heartbeats, poll jobs, or execute trades. A real worker host remains an investigation outcome, not a deployment claim. MT5 remains unverified for unattended cloud operation.

The login, market-data, AI, risk, strategy, backtest, and paper request limiters use the additive `007_rate_limit_buckets.sql` shared Neon table with atomic upserts and fail-closed database errors. Migration 007 must be reviewed and applied to the target database before public deployment. The market-data cache remains process-local and is only a freshness optimization, not durable state.

Claude analysis is server-only and uses `ANTHROPIC_API_KEY`, bounded retries/timeouts, Anthropic structured-output metadata, and independent runtime validation. It is unavailable when the key is unset and never authorizes execution. The optional MT5 connector is provider-independent; the local MirroAPI transport is configured with `MT5_CONNECTOR=mirro`, `MIRRO_API_KEY`, and `MIRRO_ACCOUNT_ID`, but account verification and execution remain disabled until an authorized demo account and server allowlists are configured. MirroAPI usage may incur account-hosting charges; no account or key was created.

## Validation

```text
npm run verify
```

This runs JavaScript syntax checks and focused health, authentication, database, migration, market-data, strategy, Claude/news adapter, risk engine, proposal immutability/eligibility, backtest/paper simulation, deployment preflight, protected endpoints, and dashboard-structure tests. It does not perform authenticated live provider/account/instrument connectivity, live Claude/news connectivity, broker connectivity, continuous paper operation, remote deployment, or order execution. Browser visual QA was not performed for Milestone 14.

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the current component boundaries and deferred decisions.

## Safety boundary

Milestone 13 adds an authenticated `/api/private/operations` diagnostic and additive operations persistence foundations. The configured Neon branch has migrations `001` through `006` applied and verified. Public health remains minimal; structured logs are bounded and redacted; execution remains blocked. Production defaults to `TRUSTED_PROXY_MODE=none`, so forwarded client headers are not trusted unless explicitly enabled for the deployment platform.

The dashboard is intentionally read-only. It displays no fabricated market prices, balances, trades, performance, or strategy inputs, submits no orders, and does not claim production readiness or profitability. Candidate status is always informational and separate from approval. See [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md) for the deployment boundary and handoff procedure.
