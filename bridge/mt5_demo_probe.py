"""Offline by default; an approved, read-only native MT5 probe, never an executor.

The optional connection may launch the explicitly selected terminal. Use only a
dedicated demo installation/profile with Algo Trading disabled and no EAs,
Signals or copy trading. Both connection modes require explicit approval.
--inspect-running-read-only uses the running terminal's current account without
reading or supplying credentials, and does not authorize future execution.
"""

import argparse
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import importlib
import json
import math
import ntpath
import os
import re
import struct
import subprocess
import sys

REQUIRED_ENV = ("MT5_TERMINAL_PATH", "MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER", "MT5_SYMBOL", "MT5_ALLOWED_ACCOUNT_LOGINS", "MT5_ALLOWED_SERVERS")
MAX_ROWS = 200
MAX_QUOTE_AGE_SECONDS = 15
MAX_FUTURE_SECONDS = 5
RELEASE_BLOCKERS = ("execution_dispatch_not_implemented", "durable_execution_and_operator_binding_unverified", "trusted_daily_risk_state_unavailable", "commission_and_currency_conversion_not_reviewed", "approved_proposal_and_final_risk_unavailable", "broker_order_preflight_not_run")


class ProbeError(Exception):
    """Only fixed, nonsecret codes cross the CLI boundary."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class ProbeConfig:
    terminal_path: str
    login: int
    server: str
    symbol: str
    allowed_logins: tuple
    allowed_servers: tuple
    password: str = field(repr=False)


def _text(value, maximum=128):
    return isinstance(value, str) and 0 < len(value) <= maximum and not re.search(r"[\x00-\x1f\x7f]", value)


def _login(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[1-9][0-9]{0,18}", value)) and int(value) <= 2**63 - 1


def _validate_binding(config):
    path = config.terminal_path
    if not _text(path, 1024) or not re.match(r"^[A-Za-z]:[\\/]", path) or ntpath.splitext(path)[1].lower() != ".exe" or ".." in re.split(r"[\\/]", path):
        raise ProbeError("explicit_windows_terminal_exe_required")
    if str(config.login) not in config.allowed_logins or config.server not in config.allowed_servers:
        raise ProbeError("configured_account_not_allowlisted")


def load_probe_config(env, is_file=os.path.isfile):
    if any(not isinstance(env.get(name), str) or not env[name] for name in REQUIRED_ENV):
        raise ProbeError("required_native_configuration_missing")
    path, login, server, symbol = (env[name].strip() for name in REQUIRED_ENV[:2] + ("MT5_SERVER", "MT5_SYMBOL"))
    logins = tuple(part.strip() for part in env["MT5_ALLOWED_ACCOUNT_LOGINS"].split(","))
    servers = tuple(part.strip() for part in env["MT5_ALLOWED_SERVERS"].split(","))
    if not _login(login) or not _text(server) or not _text(symbol, 64) or not _text(env["MT5_PASSWORD"], 512) or not 1 <= len(logins) <= 32 or not 1 <= len(servers) <= 32 or not all(_login(item) for item in logins) or not all(_text(item) for item in servers):
        raise ProbeError("native_configuration_invalid")
    config = ProbeConfig(path, int(login), server, symbol, logins, servers, env["MT5_PASSWORD"])
    _validate_binding(config)
    try:
        present = is_file(path)
    except OSError:
        present = False
    if present is not True:
        raise ProbeError("configured_terminal_exe_unavailable")
    return config


class _DiscardOutput:
    def write(self, value):
        return len(value)

    def flush(self):
        pass


def _sdk_call(sdk, name, *args, **kwargs):
    try:
        with redirect_stdout(_DiscardOutput()), redirect_stderr(_DiscardOutput()):
            return getattr(sdk, name)(*args, **kwargs)
    except Exception:
        raise ProbeError("native_" + name + "_failed") from None


def _attribute(value, name):
    return getattr(value, name, None) if value is not None else None


def _number(value, minimum=None, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or (positive and value <= 0) or (minimum is not None and value < minimum):
        return None
    return value


def _integer(value, minimum=0):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= minimum else None


def _identifier(value):
    valid = _integer(value)
    return str(valid) if valid is not None else None


def _optional_text(value, maximum=64):
    return value if _text(value, maximum) else None


def _utc_time(clock):
    value = clock()
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise ProbeError("utc_clock_required")
    return value.astimezone(timezone.utc)


def _tick_timestamp(tick):
    """Interpret native epoch units directly; never infer a server/local offset.

    Keep both raw fields so formatting cannot hide a source-time discrepancy.
    Both native units must agree; milliseconds are never treated as seconds.
    """
    seconds = _integer(_attribute(tick, "time"), 1)
    millis = _integer(_attribute(tick, "time_msc"), 1)
    seconds = seconds if seconds is not None and seconds <= 2**63 - 1 else None
    millis = millis if millis is not None and millis <= 2**63 - 1 else None

    def convert(value, milliseconds=False):
        if value is None:
            return None
        try:
            whole, remainder = divmod(value, 1000) if milliseconds else (value, 0)
            return datetime.fromtimestamp(whole, timezone.utc) + timedelta(milliseconds=remainder)
        except (ValueError, OverflowError, OSError):
            return None

    from_seconds = convert(seconds)
    from_millis = convert(millis, milliseconds=True)
    consistent = seconds is not None and millis is not None and millis // 1000 == seconds
    evidence = {"rawTime": seconds, "rawTimeMsc": millis, "rawFieldsConsistent": consistent, "secondsAsUtc": from_seconds.isoformat() if from_seconds else None, "millisecondsAsUtc": from_millis.isoformat() if from_millis else None, "timestampInterpretation": "native_epoch_interpreted_as_utc", "utcOffsetAppliedSeconds": 0}
    return (from_millis if consistent and from_seconds is not None else None), evidence


def _stamp_quote_time(quote, quoted_at, captured_at):
    """Compare native Unix numbers as well as aware UTC datetimes."""
    captured_at = _utc_time(lambda: captured_at)
    captured_epoch = captured_at.timestamp()
    seconds, millis = quote.get("rawTime"), quote.get("rawTimeMsc")
    age = (captured_at - quoted_at).total_seconds() if quoted_at is not None else None
    quote.update({"capturedAtUtc": captured_at.isoformat(), "captureUnixSeconds": captured_epoch, "ageSecondsFromRawTime": captured_epoch - seconds if seconds is not None else None, "ageSecondsFromRawTimeMsc": captured_epoch - millis / 1000 if millis is not None else None, "ageSeconds": age, "maximumAgeSeconds": MAX_QUOTE_AGE_SECONDS, "maximumFutureSeconds": MAX_FUTURE_SECONDS})
    quote["freshnessFailureCode"] = "missing_or_inconsistent_native_timestamp" if age is None else "quote_timestamp_in_future" if age < -MAX_FUTURE_SECONDS else "quote_timestamp_stale" if age > MAX_QUOTE_AGE_SECONDS else None


def _identity(sdk, config):
    terminal = _sdk_call(sdk, "terminal_info")
    if terminal is None or _attribute(terminal, "connected") is not True:
        raise ProbeError("terminal_connection_unverified")
    terminal_path = _attribute(terminal, "path")
    if not _text(terminal_path, 1024) or ntpath.normcase(ntpath.normpath(terminal_path)) != ntpath.normcase(ntpath.dirname(config.terminal_path)):
        raise ProbeError("terminal_path_mismatch")
    if _attribute(terminal, "trade_allowed") is not False:
        raise ProbeError("read_only_probe_requires_algo_trading_disabled")
    if _attribute(terminal, "tradeapi_disabled") is not True:
        raise ProbeError("read_only_probe_requires_external_python_trading_disabled")
    account = _sdk_call(sdk, "account_info")
    if account is None or _integer(_attribute(account, "login"), 1) != config.login or _attribute(account, "server") != config.server:
        raise ProbeError("native_account_identity_mismatch")
    if _integer(_attribute(sdk, "ACCOUNT_TRADE_MODE_DEMO")) != 0 or _integer(_attribute(account, "trade_mode")) != 0:
        raise ProbeError("native_demo_account_required")
    return terminal, account


def _collection(sdk, name, missing, *args):
    try:
        rows = _sdk_call(sdk, name, *args)
    except ProbeError:
        rows = None
    if not isinstance(rows, (tuple, list)):
        missing.add(name + "_unavailable")
        return {"available": False, "count": None, "complete": False, "items": []}
    if len(rows) > MAX_ROWS:
        missing.add(name + "_snapshot_truncated")
    fields = ("ticket", "identifier", "position_id", "order")
    items = []
    for row in rows[:MAX_ROWS]:
        item = {key: _identifier(_attribute(row, key)) for key in fields}
        item.update({"symbol": _optional_text(_attribute(row, "symbol")), "type": _integer(_attribute(row, "type")), "volume": _number(_attribute(row, "volume"), minimum=0), "price": _number(_attribute(row, "price")), "openPrice": _number(_attribute(row, "price_open")), "stopLoss": _number(_attribute(row, "sl"), minimum=0), "takeProfit": _number(_attribute(row, "tp"), minimum=0), "profit": _number(_attribute(row, "profit")), "commission": _number(_attribute(row, "commission")), "swap": _number(_attribute(row, "swap")), "fee": _number(_attribute(row, "fee"))})
        if item["ticket"] is None:
            missing.add(name + "_row_identity_unavailable")
        items.append(item)
    return {"available": True, "count": len(rows), "complete": len(rows) <= MAX_ROWS and name + "_row_identity_unavailable" not in missing, "items": items}


def probe_native_demo(config, sdk, now=None, evidence_source="injected-test"):
    """Injected SDKs are unit-test evidence by default, never broker verification."""
    _validate_binding(config)
    clock = now or (lambda: datetime.now(timezone.utc))
    current = _utc_time(clock)
    report = {"mode": "native_read_only_probe", "evidenceSource": evidence_source, "readOnlyProbeSucceeded": False, "nativeDemoAccountVerified": False, "executionAllowed": False, "actualBrokerOrderExecuted": False, "releaseReadiness": "blocked", "missingRiskInputs": list(RELEASE_BLOCKERS)}
    try:
        if _sdk_call(sdk, "initialize", config.terminal_path, login=config.login, password=config.password, server=config.server, timeout=10000, portable=False) is not True:
            raise ProbeError("native_initialize_refused")
        terminal, account = _identity(sdk, config)
        missing = set()
        symbol = _sdk_call(sdk, "symbol_info", config.symbol)
        tick = _sdk_call(sdk, "symbol_info_tick", config.symbol)
        if symbol is None or _attribute(symbol, "name") != config.symbol:
            raise ProbeError("native_symbol_identity_unverified")
        contract_fields = {"point": "point", "contractSize": "trade_contract_size", "volumeMin": "volume_min", "volumeMax": "volume_max", "volumeStep": "volume_step", "tickSize": "trade_tick_size", "tickValue": "trade_tick_value", "tickValueProfit": "trade_tick_value_profit", "tickValueLoss": "trade_tick_value_loss"}
        contract = {key: _number(_attribute(symbol, native), positive=True) for key, native in contract_fields.items()}
        for key, native in {"digits": "digits", "tradeMode": "trade_mode", "fillingModeFlags": "filling_mode", "executionMode": "trade_exemode", "stopsLevelPoints": "trade_stops_level", "freezeLevelPoints": "trade_freeze_level"}.items():
            contract[key] = _integer(_attribute(symbol, native))
        for key, native in {"baseCurrency": "currency_base", "profitCurrency": "currency_profit", "marginCurrency": "currency_margin"}.items():
            contract[key] = _optional_text(_attribute(symbol, native), 12)
        contract["symbol"] = config.symbol
        contract["visible"] = _attribute(symbol, "visible") is True
        missing.update("symbol." + key for key, value in contract.items() if value is None)
        if not contract["visible"]:
            missing.add("symbol_not_visible_read_only_probe_did_not_select_it")
        if contract["volumeMin"] is not None and contract["volumeMax"] is not None and contract["volumeMin"] > contract["volumeMax"]:
            missing.add("symbol_volume_bounds_invalid")
        bid = _number(_attribute(tick, "bid"), positive=True)
        ask = _number(_attribute(tick, "ask"), positive=True)
        quoted_at, time_evidence = _tick_timestamp(tick)
        if bid is None or ask is None or ask < bid or quoted_at is None:
            missing.add("fresh_native_bid_ask_unavailable")
        quote = {"symbol": config.symbol, "bid": bid, "ask": ask, "timestamp": quoted_at.isoformat() if quoted_at else None, **time_evidence}
        positions = _collection(sdk, "positions_get", missing)
        orders = _collection(sdk, "orders_get", missing)
        start = current - timedelta(days=1)
        history = _collection(sdk, "history_deals_get", missing, start, current)
        history.update({"from": start.isoformat(), "to": current.isoformat(), "scope": "last_24_hours_only", "completeAccountHistory": False, "authoritativeDailyRisk": False})
        # Reject a terminal/account switch rather than publishing mixed-account data.
        _identity(sdk, config)
        captured_at = _utc_time(clock)
        _stamp_quote_time(quote, quoted_at, captured_at)
        if quote["freshnessFailureCode"] is not None:
            missing.add("fresh_native_bid_ask_unavailable")
        account_fields = {"equity": "equity", "balance": "balance", "freeMargin": "margin_free", "margin": "margin"}
        snapshot = {key: _number(_attribute(account, native)) for key, native in account_fields.items()}
        snapshot.update({"login": str(config.login), "server": config.server, "classification": "demo", "tradeMode": 0, "company": _optional_text(_attribute(account, "company"), 128), "currency": _optional_text(_attribute(account, "currency"), 3), "marginMode": _integer(_attribute(account, "margin_mode")), "leverage": _integer(_attribute(account, "leverage"), 1), "tradeAllowed": _attribute(account, "trade_allowed") if isinstance(_attribute(account, "trade_allowed"), bool) else None, "expertTradingAllowed": _attribute(account, "trade_expert") if isinstance(_attribute(account, "trade_expert"), bool) else None})
        missing.update("account." + key for key, value in snapshot.items() if value is None)
        report.update({"identityChecksPassed": True, "nativeDemoAccountVerified": evidence_source == "native-sdk", "readOnlyProbeSucceeded": not missing, "account": snapshot, "symbol": contract, "quote": quote, "positions": positions, "orders": orders, "history": history, "capturedAt": captured_at.isoformat(), "terminal": {"connected": True, "configuredPathMatched": True, "algoTradingAllowed": False, "externalApiTradingDisabled": _attribute(terminal, "tradeapi_disabled") if isinstance(_attribute(terminal, "tradeapi_disabled"), bool) else None, "build": _integer(_attribute(terminal, "build")), "dedicatedCleanProfileIndependentlyVerified": False}, "missingRiskInputs": sorted(set(RELEASE_BLOCKERS) | missing)})
    except ProbeError as error:
        report["errorCode"] = error.code
    except Exception:
        report["errorCode"] = "native_probe_failed"
    finally:
        try:
            _sdk_call(sdk, "shutdown")
            report["sdkShutdownConfirmed"] = True
        except ProbeError:
            report["sdkShutdownConfirmed"] = False
            report["readOnlyProbeSucceeded"] = False
            report["missingRiskInputs"].append("sdk_shutdown_unconfirmed")
    return report


RUNNING_CHECKS = ("runningTerminal", "sdkInitialized", "terminalPath", "terminalConnected", "algoTradingDisabled", "externalPythonTradingDisabled", "accountAvailable", "accountIdentity", "demoClassification", "accountFields", "marketWatchSymbols", "symbolSpecified", "symbolAvailable", "symbolVisible", "quoteValid", "quoteFresh", "tickSize", "tickValue", "spreadObserved", "terminalAndAccountStable", "sdkShutdown")


def _validate_terminal_path(path, is_file=os.path.isfile):
    if not _text(path, 1024) or not re.match(r"^[A-Za-z]:[\\/]", path) or ntpath.basename(path).lower() != "terminal64.exe" or ".." in re.split(r"[\\/]", path):
        raise ProbeError("explicit_windows_terminal_exe_required")
    if is_file(path) is not True:
        raise ProbeError("configured_terminal_exe_unavailable")


def _running_terminal_guard():
    """Pin one matching PID/start time. No command line or account files read.

    This reduces accidental startup, but MT5 has no documented attach-only API:
    a process exit between this guard and initialize remains a startup race.
    """
    pinned = None

    def check(path):
        nonlocal pinned
        script = "Get-Process terminal64 -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{Path=$_.Path;Pid=$_.Id;Started=$_.StartTime.ToUniversalTime().Ticks.ToString()} } | ConvertTo-Json -Compress"
        try:
            result = subprocess.run([os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            rows = json.loads(result.stdout) if result.stdout.strip() else []
            if isinstance(rows, dict):
                rows = [rows]
            matching = [row for row in rows if isinstance(row, dict) and isinstance(row.get("Path"), str) and ntpath.normcase(ntpath.normpath(row["Path"])) == ntpath.normcase(ntpath.normpath(path))]
            if result.returncode != 0 or len(matching) != 1 or _integer(matching[0].get("Pid"), 1) is None or not str(matching[0].get("Started", "")).isdigit():
                return False
            identity = (matching[0]["Pid"], matching[0]["Started"])
            if pinned is None:
                pinned = identity
            return identity == pinned
        except Exception:
            return False
    return check


def inspect_running_demo(terminal_path, symbol, sdk, now=None, evidence_source="injected-test", running_terminal_checker=None):
    """Discover current native identity without credentials or execution binding.

    Only read calls are used. Discovered identity is never an execution allowlist.
    Nothing is selected in Market Watch; no terminal permissions are changed.
    """
    checks = dict.fromkeys(RUNNING_CHECKS, "NOT_RUN")
    report = {"mode": "inspect_running_read_only", "evidenceSource": evidence_source, "checks": checks, "connectionAttempted": False, "readOnlyProbeSucceeded": False, "nativeDemoAccountVerified": False, "identityIsExecutionAuthorization": False, "executionAllowed": False, "actualBrokerOrderExecuted": False, "releaseReadiness": "blocked", "missingRiskInputs": list(RELEASE_BLOCKERS)}
    clock = now or (lambda: datetime.now(timezone.utc))
    guard = running_terminal_checker or _running_terminal_guard()
    attempted = False

    def require(name, condition, code):
        checks[name] = "PASS" if condition else "FAIL"
        if not condition:
            raise ProbeError(code)

    def terminal_identity():
        checks["terminalPath"] = "FAIL"
        terminal = _sdk_call(sdk, "terminal_info")
        path = _attribute(terminal, "path")
        report["terminal"] = {"connected": _attribute(terminal, "connected") if isinstance(_attribute(terminal, "connected"), bool) else None, "path": _optional_text(path, 1024), "build": _integer(_attribute(terminal, "build")), "algoTradingAllowed": _attribute(terminal, "trade_allowed") if isinstance(_attribute(terminal, "trade_allowed"), bool) else None, "externalApiTradingDisabled": _attribute(terminal, "tradeapi_disabled") if isinstance(_attribute(terminal, "tradeapi_disabled"), bool) else None}
        require("terminalPath", _text(path, 1024) and ntpath.normcase(ntpath.normpath(path)) == ntpath.normcase(ntpath.dirname(terminal_path)), "terminal_path_mismatch")
        # Observe both controls even if broker connectivity is absent.
        checks["algoTradingDisabled"] = "PASS" if _attribute(terminal, "trade_allowed") is False else "FAIL"
        checks["externalPythonTradingDisabled"] = "PASS" if _attribute(terminal, "tradeapi_disabled") is True else "FAIL"
        require("terminalConnected", _attribute(terminal, "connected") is True, "terminal_connection_unverified")
        require("algoTradingDisabled", _attribute(terminal, "trade_allowed") is False, "read_only_probe_requires_algo_trading_disabled")
        require("externalPythonTradingDisabled", _attribute(terminal, "tradeapi_disabled") is True, "read_only_probe_requires_external_python_trading_disabled")
        return terminal

    try:
        require("runningTerminal", guard(terminal_path) is True, "exact_running_terminal_unverified")
        attempted = True
        report["connectionAttempted"] = True
        checks["sdkInitialized"] = "FAIL"
        require("sdkInitialized", _sdk_call(sdk, "initialize", terminal_path, timeout=10000, portable=False) is True, "native_initialize_refused")
        terminal_identity()
        checks["accountAvailable"] = "FAIL"
        account = _sdk_call(sdk, "account_info")
        require("accountAvailable", account is not None, "native_account_unavailable")
        login = _integer(_attribute(account, "login"), 1)
        server = _optional_text(_attribute(account, "server"), 128)
        trade_mode = _integer(_attribute(account, "trade_mode"))
        snapshot = {"login": str(login) if login is not None else None, "server": server, "currency": _optional_text(_attribute(account, "currency"), 12), "balance": _number(_attribute(account, "balance")), "equity": _number(_attribute(account, "equity")), "freeMargin": _number(_attribute(account, "margin_free")), "tradeAllowed": _attribute(account, "trade_allowed") if isinstance(_attribute(account, "trade_allowed"), bool) else None, "expertTradingAllowed": _attribute(account, "trade_expert") if isinstance(_attribute(account, "trade_expert"), bool) else None, "tradeMode": trade_mode, "classification": {0: "demo", 1: "contest", 2: "real"}.get(trade_mode, "unverified")}
        report["account"] = snapshot
        require("accountIdentity", login is not None and server is not None, "native_account_identity_unverified")
        checks["accountFields"] = "PASS" if all(snapshot[key] is not None for key in ("currency", "balance", "equity", "freeMargin", "tradeAllowed", "expertTradingAllowed")) else "FAIL"
        require("demoClassification", _integer(_attribute(sdk, "ACCOUNT_TRADE_MODE_DEMO")) == 0 and trade_mode == 0, "native_demo_account_required")
        report["demoClassificationSource"] = "account_info.trade_mode == ACCOUNT_TRADE_MODE_DEMO (0)"
        # Read broker symbol metadata; do not select instruments or subscribe.
        checks["marketWatchSymbols"] = "FAIL"
        rows = _sdk_call(sdk, "symbols_get")
        forex_constants_verified = _integer(_attribute(sdk, "SYMBOL_CALC_MODE_FOREX")) == 0 and _integer(_attribute(sdk, "SYMBOL_CALC_MODE_FOREX_NO_LEVERAGE")) == 5
        checks["marketWatchSymbols"] = "PASS" if isinstance(rows, (tuple, list)) and forex_constants_verified else "FAIL"
        forex_modes = {0, 5} if forex_constants_verified else set()
        forex = []
        for row in rows if isinstance(rows, (tuple, list)) else ():
            name = _optional_text(_attribute(row, "name"))
            base = _optional_text(_attribute(row, "currency_base"), 12)
            profit = _optional_text(_attribute(row, "currency_profit"), 12)
            if name and _integer(_attribute(row, "trade_calc_mode")) in forex_modes:
                forex.append({"symbol": name, "baseCurrency": base, "profitCurrency": profit, "visible": _attribute(row, "visible") is True})
        report["marketWatchForexSymbols"] = sorted((item for item in forex if item["visible"]), key=lambda item: item["symbol"])
        report["eurUsdCandidates"] = sorted((item for item in forex if item["baseCurrency"] == "EUR" and item["profitCurrency"] == "USD"), key=lambda item: item["symbol"])
        report["symbolDiscoveryComplete"] = checks["marketWatchSymbols"] == "PASS" and forex_modes == {0, 5}
        checks["symbolSpecified"] = "PASS" if _text(symbol, 64) else "FAIL"
        if checks["symbolSpecified"] == "PASS":
            checks["symbolAvailable"] = "FAIL"
            info = _sdk_call(sdk, "symbol_info", symbol)
            checks["symbolAvailable"] = "PASS" if info is not None and _attribute(info, "name") == symbol else "FAIL"
            report["requestedSymbol"] = symbol
            if checks["symbolAvailable"] == "PASS":
                checks["symbolVisible"] = "PASS" if _attribute(info, "visible") is True else "FAIL"
                tick_size = _number(_attribute(info, "trade_tick_size"), positive=True)
                tick_values = {key: _number(_attribute(info, native), positive=True) for key, native in {"tickValue": "trade_tick_value", "tickValueProfit": "trade_tick_value_profit", "tickValueLoss": "trade_tick_value_loss"}.items()}
                report["symbol"] = {"symbol": symbol, "visible": _attribute(info, "visible") is True, "point": _number(_attribute(info, "point"), positive=True), "tickSize": tick_size, **tick_values}
                checks["tickSize"] = "PASS" if tick_size is not None else "FAIL"
                checks["tickValue"] = "PASS" if all(value is not None for value in tick_values.values()) else "FAIL"
                checks["quoteValid"] = "FAIL"
                tick = _sdk_call(sdk, "symbol_info_tick", symbol)
                bid = _number(_attribute(tick, "bid"), positive=True)
                ask = _number(_attribute(tick, "ask"), positive=True)
                quoted_at, time_evidence = _tick_timestamp(tick)
                valid = bid is not None and ask is not None and ask >= bid and quoted_at is not None
                checks["quoteValid"] = "PASS" if valid else "FAIL"
                spread = ask - bid if valid else None
                point = report["symbol"]["point"]
                spread_points = _number(spread / point, minimum=0) if spread is not None and point is not None else None
                report["quote"] = {"bid": bid, "ask": ask, "spread": spread, "spreadPoints": spread_points, "timestamp": quoted_at.isoformat() if quoted_at else None, **time_evidence}
                checks["spreadObserved"] = "PASS" if spread is not None and spread_points is not None else "FAIL"
        # Reject snapshots mixing identities, terminal processes, or safety states.
        checks["terminalAndAccountStable"] = "FAIL"
        terminal_identity()
        final = _sdk_call(sdk, "account_info")
        require("terminalAndAccountStable", guard(terminal_path) is True and _integer(_attribute(final, "login"), 1) == login and _attribute(final, "server") == server and _integer(_attribute(final, "trade_mode")) == 0, "terminal_or_account_changed")
        captured = _utc_time(clock)
        report["capturedAt"] = captured.isoformat()
        if "quote" in report:
            _stamp_quote_time(report["quote"], quoted_at, captured)
            checks["quoteFresh"] = "PASS" if checks["quoteValid"] == "PASS" and report["quote"]["freshnessFailureCode"] is None else "FAIL"
        report["nativeDemoAccountVerified"] = evidence_source == "native-sdk"
    except ProbeError as error:
        report["errorCode"] = error.code
    except Exception:
        report["errorCode"] = "native_running_probe_failed"
    finally:
        if attempted:
            try:
                _sdk_call(sdk, "shutdown")
                checks["sdkShutdown"] = "PASS"
                report["sdkShutdownConfirmed"] = True
            except ProbeError:
                checks["sdkShutdown"] = "FAIL"
                report["sdkShutdownConfirmed"] = False
        report["readOnlyProbeSucceeded"] = all(value == "PASS" for value in checks.values())
    return report


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ProbeError("unsupported_probe_arguments")


def main(argv=None, env=None, output=None, sdk_loader=None, is_file=os.path.isfile, now=None, platform_name=None, bits=None, running_terminal_checker=None):
    output = output or sys.stdout
    env = os.environ if env is None else env
    report = {"mode": "offline_config_check", "configurationValid": False, "connectionAttempted": False, "nativeDemoAccountVerified": False, "executionAllowed": False, "actualBrokerOrderExecuted": False, "releaseReadiness": "blocked"}
    try:
        parser = _Parser(description=__doc__)
        parser.add_argument("--connect-read-only", action="store_true", help="Requires prior explicit approval for the dedicated demo terminal connection; never sends orders.")
        parser.add_argument("--inspect-running-read-only", action="store_true", help="Approved read-only inspection of the current running terminal account; no credentials or account switching.")
        parser.add_argument("--terminal-path")
        parser.add_argument("--symbol")
        arguments = parser.parse_args(argv)
        if arguments.inspect_running_read_only:
            if arguments.connect_read_only:
                raise ProbeError("unsupported_probe_arguments")
            _validate_terminal_path(arguments.terminal_path, is_file)
            if (platform_name or sys.platform) != "win32" or (bits or struct.calcsize("P") * 8) != 64:
                raise ProbeError("windows_64bit_runtime_required")
            guard = running_terminal_checker or _running_terminal_guard()
            if guard(arguments.terminal_path) is not True:
                raise ProbeError("exact_running_terminal_unverified")
            try:
                with redirect_stdout(_DiscardOutput()), redirect_stderr(_DiscardOutput()):
                    sdk = sdk_loader() if sdk_loader is not None else importlib.import_module("MetaTrader5")
            except Exception:
                raise ProbeError("official_metatrader5_package_unavailable") from None
            report = inspect_running_demo(arguments.terminal_path, arguments.symbol, sdk, now=now, evidence_source="mock-sdk" if sdk_loader is not None else "native-sdk", running_terminal_checker=guard)
            print(json.dumps(report, allow_nan=False), file=output)
            return 0 if report.get("readOnlyProbeSucceeded") else 2
        if arguments.terminal_path is not None or arguments.symbol is not None:
            raise ProbeError("unsupported_probe_arguments")
        report["configurationPresent"] = {name: bool(env.get(name)) for name in REQUIRED_ENV}
        config = load_probe_config(env, is_file=is_file)
        report["configurationValid"] = True
        if not arguments.connect_read_only:
            report["errorCode"] = "explicit_read_only_connection_not_requested"
        elif (platform_name or sys.platform) != "win32" or (bits or struct.calcsize("P") * 8) != 64:
            report["errorCode"] = "windows_64bit_runtime_required"
        else:
            try:
                with redirect_stdout(_DiscardOutput()), redirect_stderr(_DiscardOutput()):
                    sdk = sdk_loader() if sdk_loader is not None else importlib.import_module("MetaTrader5")
            except Exception:
                raise ProbeError("official_metatrader5_package_unavailable") from None
            report.update(probe_native_demo(config, sdk, now=now, evidence_source="mock-sdk" if sdk_loader is not None else "native-sdk"))
            report["connectionAttempted"] = True
    except ProbeError as error:
        report["errorCode"] = error.code
    except Exception:
        report["errorCode"] = "native_probe_configuration_failed"
    print(json.dumps(report, allow_nan=False), file=output)
    return 0 if report.get("readOnlyProbeSucceeded") else 2


if __name__ == "__main__":
    raise SystemExit(main())
