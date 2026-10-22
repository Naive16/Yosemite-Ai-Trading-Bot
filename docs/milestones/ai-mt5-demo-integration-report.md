# AI, MT5 Demo Integration & Manual Deployment Readiness Report

Audit date: 2026-10-22

## 1. Claude integration status

The existing server-only Anthropic Messages API integration was inspected and hardened without changing its safety boundary. Requests now include Anthropic structured-output JSON-schema metadata, while the existing runtime validator remains authoritative for scope, timestamps, text bounds, source IDs, prices, expiry, and `NO TRADE` consistency. Claude remains analysis-only: it cannot approve, bypass deterministic strategy or risk checks, or submit an order.

The key is read only from `ANTHROPIC_API_KEY` on the server. Missing credentials, malformed output, provider failures, rate limits, timeouts, and invalid responses remain safe unavailable states. No live Claude request was made because no authorized API credential was available.

## 2. MT5 connector selection

MirroAPI was selected as the first adapter target because its official quickstart documents hosted MT5 account connections, account/environment metadata, quotes, positions, deal history, idempotent trade commands, and test keys restricted to demo accounts. The repository now contains a provider-independent server transport at `api/_lib/mt5/mirro.js`; it is not activated by default and was tested only with mocked responses.

MetaApi remains a documented alternative for future evaluation. Native MT5 terminal integration remains unsuitable for the current request-driven/serverless deployment boundary without an authorized persistent runtime.

MirroAPI pricing and availability were not accepted or activated. The provider documentation describes a no-subscription test/demo path with metered hosted-terminal usage and a per-account plan; current pricing must be rechecked by the user before use.

## 3. Demo account connection status

The existing MT5 adapter already enforced provider-reported account classification and exact server/account allowlists. Configuration now supports the optional server-only Mirro connector through `MT5_CONNECTOR`, `MIRRO_API_KEY`, `MIRRO_ACCOUNT_ID`, `MIRRO_API_BASE_URL`, and `MIRRO_TIMEOUT_MS`.

The dashboard now labels the MT5 account as not connected and unverified when no connector is configured. It does not display fabricated balances, positions, prices, or account identity. No broker account was connected, and no credential form or plaintext credential persistence was introduced.

## 4. Demo order execution status

Order submission remains hard-blocked. `MT5_EXECUTION_ENABLED=true` is rejected by configuration, `Mt5Adapter.submitOrder()` remains blocked, and the execution ledger still requires all gates, stable idempotency, and reconciliation after unknown outcomes. No demo order was submitted.

## 5. Live-account protection

Live account classification is rejected by the demo allowlist path. Live execution remains disabled independently of connector configuration and requires a separate future authorization and implementation. Switching connector settings cannot silently grant live execution.

## 6. Required environment variables

Server-side only; do not commit values:

```text
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-haiku-latest
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_TIMEOUT_MS=12000
ANTHROPIC_MAX_RETRIES=1
ANTHROPIC_MAX_OUTPUT_TOKENS=1200

MT5_CONNECTOR=none
MIRRO_API_KEY=
MIRRO_ACCOUNT_ID=
MIRRO_API_BASE_URL=https://api.mirroapi.cloud/v1
MIRRO_TIMEOUT_MS=10000
MT5_DEMO_MODE=false
MT5_EXECUTION_ENABLED=false
MT5_ALLOWED_ACCOUNT_LOGINS=
MT5_ALLOWED_SERVERS=
```

## 7. Migrations and manual setup

No new migration was required for the local adapter because no broker account or execution records are persisted by this pass. Existing migrations must be reviewed and applied only through the authorized Neon migration process. Migration 007 remains required for shared rate limiting before public deployment.

To configure a future demo read connection, the user must create an authorized provider account/key, connect a broker demo account through the provider, confirm the provider-reported account identity and server, set exact server-side allowlists, and run the application’s verification/preflight checks. This task did not perform those actions.

## 8. Tests and verification

- `npm run verify`: **85 tests passed, 0 failed, 0 skipped, 0 cancelled**.
- Added/updated tests cover Claude structured-output request metadata, response validation, provider failures, Mirro account classification, credential redaction, unconfigured connector failure, live classification, MT5 execution blocking, idempotency, and dashboard unverified-account labeling.
- `npm run deployment-check`: **failed as expected** in the local environment because production `APP_ENV`, HTTPS `APP_ORIGIN`, and `DATABASE_URL` are not configured. It also warned that migration 007 must be applied and verified. No secrets were printed.
- No live Anthropic, MirroAPI, MetaApi, MT5, Neon, Vercel, broker, or order-execution verification was performed.
- No build or lint scripts exist in `package.json`.

## 9. External services and costs

Anthropic usage may incur API charges. MirroAPI documentation describes hosted MT5 terminal pricing and metered usage; no subscription, account, API key, or paid service was created or activated. MetaApi was not connected.

## 10. Boundary confirmation

No deployment, remote migration, Neon connection, paid-service activation, broker connection, live order, demo order, autonomous trading, worker activation, Git operation, or secret addition occurred. Trading remains disabled. The next boundary is authorized external-provider configuration and verification, followed by a separately approved execution implementation review.
