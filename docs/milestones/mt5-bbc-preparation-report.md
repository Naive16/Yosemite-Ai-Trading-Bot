# Yosemite AI — MT5 Demo and BBC News Preparation

This is a local implementation and verification report. No external provider, broker, Cloudflare, Neon, or MT5 account was contacted.

## MT5 demo connectivity

The existing provider-isolated adapter was preserved. It requires the provider to return a positive account environment classification, a valid account identity, server, broker, currency, equity, and fresh symbol/quote data. Only demo accounts whose login and server exactly match the configured allowlists are accepted.

Required server-only settings are:

- MT5_CONNECTOR=mirro
- MIRRO_API_KEY — encrypted secret
- MIRRO_ACCOUNT_ID — server-side value
- MIRRO_API_BASE_URL — provider endpoint
- MIRRO_TIMEOUT_MS
- MT5_DEMO_MODE=true
- MT5_ALLOWED_ACCOUNT_LOGINS
- MT5_ALLOWED_SERVERS
- MT5_EXECUTION_ENABLED=false

MirroAPI operational compatibility was not verified. The adapter expects account, symbol, price, positions, orders, and history REST responses, including an independently reported demo environment. Cloudflare Workers cannot run a Windows MetaTrader 5 desktop terminal; direct terminal connectivity requires a separately hosted, authorized bridge/provider that exposes a secure server API. No credentials were added and no connection was attempted.

Order submission remains hard-blocked. Idempotency, unknown-outcome states, and reconciliation protections were unchanged.

## BBC news

Added a server-only BBC RSS adapter using the official business feed:

https://feeds.bbci.co.uk/news/business/rss.xml

The adapter validates RSS structure, title, HTTPS article URL, publication timestamp, source, bounded description, duplicates, and stale status. Malformed, unavailable, timed-out, or rate-limited responses fail closed. News remains untrusted context for advisory AI analysis and cannot alter deterministic strategy, risk, approval, or execution decisions.

BBC feed use may require compliance with BBC feed terms and licensing, especially for commercial use. Review the current BBC terms before production use: https://downloads.bbc.co.uk/usingthebbc/bbc_terms_of_use.pdf

## Environment and safety

NEWS_PROVIDER=bbc and the BBC feed URL are now the documented defaults in .env.example. No API key is required for the RSS adapter. Keep provider credentials and database URLs out of tracked files.

The following remain disabled:

- TRADING_MODE=disabled
- LIVE_TRADING_ENABLED=false
- WORKER_ENABLED=false
- MT5_EXECUTION_ENABLED=false

## Verification

Deterministic mocked tests cover BBC parsing, duplicate and stale handling, malformed links/feed responses, unavailable upstream responses, and default configuration. Existing MT5 demo classification, quote freshness, symbol validation, blocked submission, idempotency, reconciliation, authentication, and Worker tests remain part of the repository suite.

No live BBC or MirroAPI request was made. No MT5 account was connected and no demo or live order was submitted.
