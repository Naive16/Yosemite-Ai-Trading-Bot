> Historical milestone record. The active backend is now Supabase Auth and Data API. Use [the current release runbook](../runbooks/cloudflare-deployment.md); legacy Neon/custom-password instructions below are not current deployment guidance.

# Yosemite AI — Milestone 7 Report

## Status

Milestone 7 is complete for the approved Claude market-analysis scope. Milestone 8 has not started. Trading remains disabled and read-only.

## 1. Implemented

- Added a server-only Anthropic Messages API adapter with configurable model, bounded timeout, one-or-fewer retry policy, response-size/output-token limits, safe provider errors, and no browser credential exposure.
- Added strict Claude output validation for symbol, timeframe, timestamps, recommendation, bounded text arrays, numeric levels, expiry, source references, and analysis metadata. `NO TRADE` responses cannot contain proposed trade levels. Model confidence is discarded and is never treated as a calibrated probability.
- Added a protected `GET /api/private/analysis` endpoint. It authenticates through the existing database-backed session, applies AI and market-data request limits, validates query parameters, fetches market data server-side, evaluates the deterministic candidate, and assembles the evidence snapshot without accepting client-supplied prices, candles, indicators, news, or risk values.
- Added provider-independent news/calendar normalization and adapters. The disabled-by-default JSON feed adapter validates timestamps, source identity, currency relevance, duplicates, and freshness. Missing news is represented as unavailable context, not as proof that no event exists.
- Added prompt-injection boundaries: news is passed as untrusted evidence, cannot alter system rules, and Claude citations are accepted only when their IDs match supplied source records.
- Added a separate Claude interpretation panel to the existing chart/analysis workspace. It shows recommendation, summary, supporting/opposing evidence, news status, uncertainty, model metadata, expiry, and explicit analysis-only limitations.
- Preserved authentication, CSRF, Neon session persistence, market-data validation, deterministic strategy logic, responsive dashboard screens, and all execution-disabled safeguards.

## 2. Files changed

- `api/_lib/config.js`
- `api/_lib/ai/rate-limit.js`
- `api/_lib/claude/client.js`
- `api/_lib/claude/schema.js`
- `api/_lib/news/normalize.js`
- `api/_lib/news/provider.js`
- `api/private/analysis.js`
- `src/app.js`
- `index.html`
- `.env.example`
- `package.json`
- `README.md`
- `docs/architecture.md`
- `tests/analysis.test.mjs`
- `tests/claude.test.mjs`
- `tests/dashboard.test.mjs`
- `docs/milestones/milestone-7-report.md`

No database migration was needed. No second database or trading/execution component was introduced.

## 3. Provider configuration and costs

Claude is configured with `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_TIMEOUT_MS`, `ANTHROPIC_MAX_RETRIES`, `ANTHROPIC_MAX_OUTPUT_TOKENS`, `AI_RATE_LIMIT_WINDOW_SECONDS`, and `AI_RATE_LIMIT_MAX_REQUESTS`. The key is server-only. Anthropic API usage may incur charges; no paid service was provisioned or activated.

News/calendar configuration is `NEWS_PROVIDER`, `NEWS_API_KEY`, and `NEWS_FEED_URL`. `NEWS_PROVIDER=none` is the safe default. The JSON adapter is an integration contract, not a claim that a particular news provider is live. The existing Twelve Data configuration is not assumed to provide news or economic-calendar access.

## 4. Verification

Executed:

```text
npm run verify
```

Result: syntax checks passed; **39 tests passed, 0 failed, 0 skipped, 0 cancelled**.

The tests cover Claude schema validation, malformed output, bounded retries, prompt-injection text handling, news deduplication and validation, missing credentials, protected analysis authentication and validation, request limiting, dashboard integration, and regression coverage for authentication, CSRF, sessions, Neon adapters, market data, strategy, health, and dashboard structure.

Tests use deterministic mocks. They do not verify live Anthropic, live news, live Twelve Data, or live Neon connectivity.

## 5. Outstanding limitations

- Live Claude and news-provider connectivity was not tested because valid credentials and configured feeds are unavailable.
- The AI request limiter is process-local, like the existing login and market-data limiters; it does not protect multiple serverless instances. Production needs a shared atomic limiter or managed service with fail-closed behavior.
- The JSON news adapter does not silently scrape or select a paid source. A production deployment must choose a reputable source, confirm terms/costs, and test its contract.
- Browser visual QA was not repeated in Milestone 7. The previous Milestone 5 desktop check remains the only browser visual check; mobile viewport QA remains outstanding.
- Claude output is analysis only. It cannot approve a candidate, change risk settings, access broker credentials, or place/modify/close orders.

## 6. Next boundary

Milestone 8 must begin only after approval and should address the next item in the master plan. No approval workflow, independent risk engine, paper trading, MT5 integration, broker connection, or execution was started here.

Stop point: waiting for review and approval.
