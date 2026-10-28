# Native MT5 read-only preparation

The selected deployment path uses a dedicated Windows/VPS MT5 terminal outside Cloudflare. `mt5_demo_probe.py` is a **read-only probe**, not an execution bridge, HTTP server, job poller, trading daemon or order dispatcher. It does not connect to Supabase or Cloudflare, persist execution records, or call `order_check`, `order_send`, close/cancel or `symbol_select`.

All unit tests use a synthetic SDK. Current Windows installation and isolated Python-package preparation are recorded in [the installation status](../docs/mt5-windows-installation.md); package import is not a terminal connection. Keep live trading disabled and retain the application's disabled execution flags.

## Paired trace: fresh ID for every capture

The local ACK repair requires **native diagnostic v1.03 and the matching updated collector**. It adds run-specific readiness/closed markers, immutable sequence-specific ACK files and separate launch/capture deadlines. The installed native source/binary have been updated without launching a capture. See [the ACK repair evidence, exact protocol, tests and future launch sequence](../docs/mt5-ack-handshake-fix.md). Quote freshness and execution remain blocked.

The paired collector now generates a unique run ID automatically. **Do not reuse `20261028-final-A` or `20261028-final-B`.** From the project root:

```powershell
& .\.venv\Scripts\python.exe .\bridge\diagnostics\paired_mt5_trace.py --capture
```

Wait for READY. Copy the actual generated ID into the native script's **Inputs > DiagnosticRunId** field when launching it once on the existing EURUSD chart. The native script no longer has a fixed run ID. Both use MT5's Common\Files directory; Python checks the SDK-reported common directory before READY. Inputs are diagnostic data, not permission approval: leave Algo Trading/Python trading disabled and do not approve a permissions prompt.

Each run gets distinct trace/ACK/claim names and `.local-data/mt5-paired-runs/<id>/report.json` plus `native.jsonl`. Existing files, prior output directories and duplicate/concurrent reservations fail closed. No prior trace/report is automatically deleted or overwritten. Optional `--run-id` accepts only a genuinely fresh, safe ID; failed runs also consume their ID. Native completion, three acknowledged frames and final safety checks remain necessary; completion never authorizes trading or resolves quote freshness. See [the current exact sequence and tests](../docs/mt5-windows-installation.md#fresh-coordinated-capture-ids--28-october-2026).

## Prerequisites for a separately approved connection

Use an appropriate **64-bit Windows** Python environment with a compatible official `MetaTrader5` package and installed MT5 terminal. The probe itself uses only Python's standard library and supports Python 3.10+. The current project's isolated Python 3.11.9 x64 environment, SDK 5.0.6231 and terminal build 6291 have been verified locally; other hosts and brokers require separate verification. The SDK import is lazy and occurs only in the explicit connection branch.

`MetaTrader5.initialize()` **can launch the terminal**. The approved probe must use a dedicated demo-only terminal installation/data profile with no Expert Advisors, copy trading or Signals running. Do not reuse a live-trading terminal or profile. Both connection modes require native Algo Trading to be disabled and native external Python trading to be disabled; an enabled/unknown state fails without changing it. Account trading permissions are reported and need not be true for read-only inspection. SDK shutdown disconnects the Python API, and does not claim to close the terminal itself.

## Approved current-account inspection without credentials

When the operator has approved inspecting the account already open in MT5, use this separate mode from PowerShell in the project root:

```powershell
& .venv\Scripts\python.exe bridge\mt5_demo_probe.py --inspect-running-read-only --terminal-path 'C:\Program Files\MetaTrader 5\terminal64.exe' --symbol EURUSD
```

`EURUSD` here is an exact existence check, not an approved instrument mapping. The probe never falls back to a suffix or calls `symbol_select`. It lists visible forex instruments from the native symbol catalogue and EUR/USD candidates using broker-reported base/profit currencies and verified native forex calculation-mode constants. Hidden candidates include an explicit `visible=false`. If an exact symbol is absent or hidden, the associated checks fail and no replacement is selected. Without `--symbol`, account inspection can proceed but symbol checks remain incomplete and the probe exits 2.

This mode does not read `MT5_PASSWORD`, call `login`, provide credentials/server/login to `initialize`, or create an account allowlist. It uses the current/last account maintained by the terminal. An exact-path process check pins one Windows PID/start time before SDK import and initialization and rechecks it after reads. MetaQuotes provides no documented attach-only initialize option: the process check reduces accidental startup but cannot eliminate a terminal-exit race between the check and initialization. Use only the approved dedicated terminal/profile.

The native terminal path, connection and both disabled controls must pass before account and symbol collection. Demo classification requires native integer `account_info.trade_mode == ACCOUNT_TRADE_MODE_DEMO (0)`; account names and environment flags are never evidence. The account identity, demo mode, process and safety controls are rechecked after collection. Account permissions are observations, not permission to trade. Discovered login/server values are never persisted as execution authorization. The report contains explicit `PASS`, `FAIL` and `NOT_RUN` checks and whitelisted data; no account-holder name, password or token is included. A failed safety gate stops subsequent checks, so absent data must not be described as verified.

After the operator corrected the first attempt's external Python setting, approved native attempts on 28 October 2026 verified a **MetaQuotes-Demo** native demo account, both disabled terminal controls, exact visible **EURUSD** and the final identity recheck. **Quote freshness failed:** the tick epoch interpreted as UTC was approximately two hours ahead of capture UTC. No guessed timezone adjustment or relaxed threshold was applied. The overall read-only probe and execution release remain blocked. See [the installation and probe status](../docs/mt5-windows-installation.md) for all checks and the timestamp discrepancy. No order or broker order preflight was attempted.

The operator subsequently confirmed **MetaQuotes-Demo** as the intended server. Raw native seconds and milliseconds both remain approximately two hours ahead of host Unix UTC independently checked against Google's HTTPS Date and `time.windows.com` NTP. The conversion audit found no local-time relabeling bug. Both probe branches now expose `rawTime`, `rawTimeMsc`, converted UTC interpretations, raw-unit consistency, capture Unix seconds, direct raw ages and a fixed freshness failure code. Missing or inconsistent native units fail closed. Integer division/remainder preserves millisecond precision; no server offset is inferred. The age limits remain 15 seconds old and 5 seconds in the future. Current evidence verifies this MetaQuotes demo account only; no separate broker's demo account is thereby verified.

A later standalone investigation reproduced the discrepancy across **EURUSD, GBPUSD and USDJPY**, using `symbol_info_tick`, `symbol_info` and current M1 `copy_rates_from_pos` data. Market Watch displayed matching server-hour labels while host UTC was two hours earlier. These paths share a terminal/feed; bar-open times, screen labels, advancing data and local receipt times never replace source quote freshness. A current vendor timestamp/DST contract or source fix is still required. The full hypotheses, filtered log audit, raw observations and **40 + 11 passing tests** are recorded in [the extended investigation](../docs/mt5-windows-installation.md#extended-native-time-basis-investigation--28-october-2026). No existing probe or application configuration was changed in this follow-up.

Prepare these native-host environment settings only in an approved secure environment. They are not Cloudflare runtime bindings or browser inputs:

| Variable | Classification | Purpose |
| --- | --- | --- |
| `MT5_TERMINAL_PATH` | Host-only configuration | Exact absolute local Windows `.exe` path of the approved dedicated terminal; no auto-discovery or last-session fallback |
| `MT5_LOGIN` | Host-only account identifier | Exact intended demo login |
| `MT5_SERVER` | Host-only account identifier | Exact broker server, including case |
| `MT5_SYMBOL` | Host-only instrument identifier | Exact broker symbol, including suffix/case; it must already be visible in Market Watch |
| `MT5_ALLOWED_ACCOUNT_LOGINS` | Host-managed allowlist | Comma-separated approved login(s); must contain `MT5_LOGIN` before any SDK loading/connection |
| `MT5_ALLOWED_SERVERS` | Host-managed allowlist | Comma-separated approved server(s); must contain `MT5_SERVER` exactly |
| `MT5_PASSWORD` | Secret, native host only | Broker credential kept in an approved secret store/process environment; never command arguments, browser code, Git or reports |

The probe reads only the current process environment; it does **not** load `.env` files, install packages, find an alternative terminal, supply missing financial values, choose a broker, or enable trading permissions.

## Offline and mocked checks now

From the project root:

```text
python bridge/mt5_demo_probe.py
python -m unittest discover -s tests -p "mt5*probe_test.py"
```

The first command performs an offline configuration/file-presence check only. It does not import the MT5 SDK, initialize a terminal or contact a broker. It exits **2** while no approved connection is requested, including when configuration is syntactically complete. Its output reports presence/blocker codes without secret values. The unit tests inject a mock SDK and clock; no installed MetaTrader5 package or account is required.

## Held read-only connection command

The following command is documented for a **future, explicitly approved** account/terminal connection. It was **not run** during this preparation:

```text
python bridge/mt5_demo_probe.py --connect-read-only
```

Before initializing it validates the exact executable, account/server allowlists and Windows architecture. It checks the native terminal's path/connection/disabled Algo Trading state, then native `account_info().login`, `.server` and `.trade_mode == ACCOUNT_TRADE_MODE_DEMO`. A name containing "demo" is insufficient. The same identity and connection checks are repeated after collection to reject an account switch. Quote freshness is checked again against the final UTC capture time.

The result contains only whitelisted account/symbol/quote/book/history fields. Broker tickets serialize as strings, not JavaScript-unsafe integers. Missing or nonfinite fields remain null with explicit blockers; unavailable books are distinct from empty books. Position/order/history snapshots return at most 200 whitelisted rows, with truncation reported. History covers only the explicitly reported last-24-hour query window and is never represented as complete account history or authoritative daily risk. No commission schedule, daily equity anchor, currency conversion, pip/filling-policy mapping or final risk approval is inferred.

Exit **0** means the **read-only probe** checks succeeded; exit **2** means configuration or read-only checks remain blocked. Neither authorizes execution. `executionAllowed` and `actualBrokerOrderExecuted` are always false; `releaseReadiness` remains blocked. Injected SDK tests label their evidence as mocked and do not set `nativeDemoAccountVerified`. A fresh result from a genuinely approved native connection is still a partial observation, not a signed machine capability or evidence of an order placed by this application. A separate secure bridge, Supabase capabilities, durable intent dispatch and reconciliation remain to be implemented and approved.

Follow [the release plan](../docs/runbooks/mt5-demo-release.md) before any connection, schema change, deployment or order action.

Official references: [initialize](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py), [account information](https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py), [terminal information](https://www.mql5.com/en/docs/python_metatrader5/mt5terminalinfo_py), [symbol information](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfo_py), [native quote](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfotick_py).
