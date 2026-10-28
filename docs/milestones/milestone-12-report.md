> Historical milestone record. The active backend is now Supabase Auth and Data API. Use [the current release runbook](../runbooks/cloudflare-deployment.md); legacy Neon/custom-password instructions below are not current deployment guidance.

# Milestone 12 Report — MetaTrader 5 Demo Integration and Execution Reconciliation

## Status

Milestone 12 is complete as a local, provider-isolated integration and reconciliation foundation. Real-money trading remains disabled. No MT5 terminal, demo account, broker credentials, cloud worker, or order submission was used. No real-money or demo order was submitted. Milestone 13 was not started.

The local environment was checked on 2026-10-22. It is Windows with Python 3.11 available, but no discoverable MT5 terminal executable was found, the `MetaTrader5` Python package was not installed, and no demo account or broker credentials were available. Live MT5 verification is therefore BLOCKED/UNVERIFIED, not claimed.

## Architecture and files changed

Added a narrow adapter boundary under `api/_lib/mt5/`:

- `api/_lib/mt5/adapter.js` defines provider-neutral account classification, demo allowlisting, symbol/quote validation, connection status, read-only account/symbol/quote/position/order/history operations, safe shutdown, and an order-submission method that always throws `execution_disabled` in this milestone.
- `api/_lib/mt5/reconciliation.js` defines the execution state machine, stable idempotency key behavior, duplicate reservation handling, UNKNOWN outcomes, mandatory reconciliation transition, broker identifier mapping, and discrepancy handling.
- `db/migrations/005_execution_reconciliation.sql` adds additive durable execution-intent and transition tables with unique idempotency/proposal constraints, state checks, timestamps, and reconciliation indexes. It was not applied to any database.
- `api/_lib/config.js` adds server-only, disabled-by-default MT5 settings and rejects `MT5_EXECUTION_ENABLED=true`. Explicit demo mode requires account-login and server allowlists.
- `.env.example` documents placeholder-only MT5 configuration names.
- `tests/mt5.test.mjs` adds deterministic adapter, demo-classification, stale-quote, execution-block, idempotency, and reconciliation tests.
- `tests/database.test.mjs` verifies the additive migration structure and absence of destructive statements.
- `package.json` includes the new adapter/reconciliation modules in syntax verification.

Existing authentication, CSRF, session, database, strategy, risk, proposal, paper, backtest, worker, and security-hardening code was preserved.

## Provider contract and implementation status

The adapter accepts an injected transport rather than importing MT5 or Python directly. This keeps the core application independent of terminal-specific APIs and makes deterministic fakes possible. A future transport can wrap the official Python `MetaTrader5` package, but that transport was not added because the terminal and credentials are unavailable.

Supported contract areas:

- Account information and connection status.
- Provider-reported account trade mode, login, server, company, currency, and equity.
- Symbol metadata including visibility, contract size, volume bounds/step, point, tick size/value, and filling modes.
- Fresh bid/ask quote validation with spread and symbol matching.
- Read-only positions, orders, and historical data transport hooks.
- Safe shutdown.
- Order submission boundary that is permanently blocked by current configuration.

Malformed, unknown, stale, mismatched, incomplete, or non-allowlisted values are rejected. The adapter does not infer demo status from a username, server label, environment label, or UI state.

## Account classification and demo isolation

The normalized account classification uses the provider-reported MT5 trade mode values: demo, contest, or real. Unknown values are rejected. A demo connection requires:

1. `MT5_DEMO_MODE=true` in server configuration.
2. `MT5_EXECUTION_ENABLED` not set to true; true is rejected during configuration loading.
3. Exact allowlisting of the provider-reported account login.
4. Exact allowlisting of the provider-reported server.
5. Provider-reported classification equal to `demo`.

Live and contest accounts are blocked. The adapter never returns credentials, terminal passwords, or raw connection internals. No dashboard or request parameter can enable this boundary.

## Execution gates and default behavior

The current application configuration has `MT5_DEMO_MODE=false` and `MT5_EXECUTION_ENABLED=false` by default. The adapter’s `submitOrder()` method always raises `execution_disabled`; no API route calls it.

The reconciliation ledger models the required future gate set: authenticated actor, exact proposal/version/digest, fresh risk PASS, trusted inputs, positive demo classification, explicit mode, emergency-stop state, reservation uniqueness, and final risk validation. Any false or missing gate blocks reservation. The independent risk engine and explicit approval workflow remain authoritative; Claude cannot approve or execute.

The ledger is deliberately not wired to an executable worker in this milestone. Enabling a demo transport later would require a separately approved integration test and a durable repository implementation that persists the intent before any external call.

## Idempotency, unknown outcomes, and reconciliation

`execution_intents` provides a stable idempotency key unique to proposal ID/version/digest and a unique execution identifier. The state machine supports:

- approved
- execution reserved
- submission initiated
- broker acknowledged
- order accepted
- partially filled
- filled
- cancel requested
- cancelled
- rejected
- submission unknown
- reconciliation required

Duplicate reservations return the existing intent. A timeout or ambiguous submission becomes `submission_unknown` and cannot jump directly to an accepted/filled state. Reconciliation first records `reconciliation_required`, then applies a validated provider state. Missing broker records produce an auditable discrepancy and do not trigger replacement orders. The local deterministic ledger does not automatically close unrelated positions, cancel unrelated orders, or blindly retry unknown submissions.

The migration is additive only and uses UTC-capable PostgreSQL `timestamptz` defaults, parameterizable identifiers, unique constraints, and indexes. No migration was applied to Neon or any other database.

## Official MT5 checks and limitations

Official documentation checked on 2026-10-22:

- [MetaTrader 5 installation](https://www.metatrader5.com/en/terminal/help/start_advanced/installation) documents Windows 10/11 support.
- [MQL5 Python integration](https://www.mql5.com/en/docs/python_metatrader5) documents Python-to-terminal interprocess communication and functions such as initialization, account information, symbol information, positions, history, and order submission.
- [MQL5 account information](https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py) exposes provider account fields including `trade_mode`, login, server, currency, and equity.
- [MQL5 account properties](https://www.mql5.com/en/docs/constants/environment_state/accountinformation) documents demo/contest/real trade-mode classification.
- [MQL5 order submission](https://www.mql5.com/en/docs/trading/ordersend) states that a successful request response does not necessarily mean the order was executed and that later deal/order state must be checked.
- [MQL5 trade return codes](https://www.mql5.com/en/docs/constants/errorswarnings/enum_trade_return_codes) documents rejected, placed, completed, partial, and timeout outcomes.

The official sources establish the required concepts but do not prove this project’s broker, terminal installation, account isolation, restart supervision, network behavior, or Python package compatibility on this host. Linux/Wine and cloud-host reliability remain outside this local verification.

## Tests and exact results

Command run:

```text
npm run verify
```

Final observed result: syntax checks passed; `69` tests passed, `0` failed, `0` skipped, and `0` cancelled.

New deterministic tests cover:

- MT5 configuration disabled by default.
- Explicit execution configuration rejection.
- Required demo account/server allowlists.
- Unknown/live account classification rejection.
- Symbol metadata completeness.
- Quote freshness and symbol matching.
- Adapter connection isolation and blocked order submission.
- Duplicate execution reservation.
- Unknown submission outcome and mandatory reconciliation.
- Migration constraints and additive safety.

All MT5 tests use deterministic injected fakes. They are not evidence of a real terminal, broker, demo account, or network connection.

## Real external checks versus local checks

Verified locally:

- Windows host and Python 3.11 executable discovery.
- No discoverable MT5 terminal executable in the checked standard locations.
- Provider contract validation and execution blocking through deterministic fakes.
- Full existing regression suite.

Not verified:

- MT5 terminal installation or launch.
- `MetaTrader5` Python package installation/import.
- Demo-account login or broker-server identity.
- Symbol availability and broker-specific contract specifications.
- Account, position, order, deal, or history retrieval from a real provider.
- Demo order submission, acknowledgement, partial fill, cancellation, or reconciliation.
- Durable migration application against Neon.
- Persistent worker restart recovery or cloud deployment.

## Security, hosting, and compatibility risks

- Execution remains disabled and no order was submitted.
- MT5 passwords and broker credentials were not added to source, logs, browser code, or reports.
- Process-local rate limiting remains unresolved for multi-instance public deployment.
- Trusted proxy configuration and Git-history secret scanning remain production blockers from Milestone 10.5.
- A future worker must persist intent and lease/transition state before external calls and must reconcile unknown outcomes before retrying.
- MT5 terminal/Python integration requires a real supported terminal environment; this milestone does not claim that Linux/Wine, Vercel, Render, OCI, or this Windows host is reliable for unattended operation.
- The 005 migration is a schema foundation, not proof of transaction-level repository integration. That integration must be implemented and tested before any demo order path is considered.

## Explicit no-order confirmation

No real-money order was submitted. No demo order was submitted. No broker account was connected. No execution flag was enabled. The adapter rejects order submission under the current configuration.

## Remaining blockers before Milestone 13

1. Obtain explicit approval and a dedicated demo account with independently verified account/server identity.
2. Establish a controlled Windows/MT5 environment and validate terminal, Python package, broker login, symbol metadata, read-only account state, time synchronization, supervision, and shutdown.
3. Implement the database repository and transaction boundaries for migration 005.
4. Implement durable heartbeat/lease/job handling and restart reconciliation in the approved worker environment.
5. Add read-only provider integration tests using the real demo terminal before considering any submission test.
6. Keep order submission disabled until every gate, emergency-stop, idempotency, and reconciliation check is externally verified.

Milestone 12 stops here and awaits approval. No Milestone 13 work was started.
