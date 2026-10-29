"""Yosemite MT5 demo execution bridge.

This module is the MT5 bridge transport for demo-only order execution. It uses
the official MetaTrader5 Python SDK to connect to a dedicated, demo-only MT5
terminal, positively confirms the account is a demo account
(ACCOUNT_TRADE_MODE_DEMO), enforces allowlisted login and server, and submits
demo orders only.

DELIVERY STATUS: implemented but NOT production-verified. The default
application configuration keeps MT5_CONNECTOR="none", so this bridge is not
active and no broker order can be submitted from the application until an
operator explicitly configures the bridge and it is verified against a real
demo terminal. Live/real accounts are rejected by design; live execution
remains hard-blocked by MT5_EXECUTION_ENABLED=false.

Security properties enforced here:
  * The terminal path is pinned (exact absolute path, no auto-discovery).
  * The account identity (login, server, trade_mode) is verified natively;
    account names and environment flags are never accepted as evidence.
  * Only ACCOUNT_TRADE_MODE_DEMO accounts may submit orders. trade_mode REAL
    or CONTEST is rejected before any order request reaches the terminal.
  * Login and server must be present in the configured allowlists.
  * No real-money (live) execution path exists in this module.
  * Credentials are read only from the process environment; never from command
    arguments, browser code, Git, or reports.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

__all__ = [
    "MT5DemoBridgeTransport",
    "Mt5DemoBridgeAccountError",
    "Mt5DemoBridgeExecutionError",
    "Mt5DemoBridgeNotConfigured",
    "mt5_demo_bridge_available",
]


class Mt5DemoBridgeNotConfigured(RuntimeError):
    """The MT5 bridge is not configured (connector not set or SDK missing)."""


class Mt5DemoBridgeAccountError(RuntimeError):
    """The connected MT5 account is not a verified allowlisted demo account."""


class Mt5DemoBridgeExecutionError(RuntimeError):
    """An MT5 demo order submission failed."""


def mt5_demo_bridge_available() -> bool:
    """Return True only when the official MetaTrader5 package can be imported.

    The package import is lazy and occurs only in the explicit connection
    branch; this check does not initialize a terminal or contact a broker.
    """
    try:
        import MetaTrader5  # type: ignore
        return True
    except Exception:
        return False


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _epoch_ms() -> int:
    return int(time.time() * 1000)


def _pin_terminal_path(terminal_path):
    if not terminal_path or not isinstance(terminal_path, str):
        raise Mt5DemoBridgeNotConfigured("MT5_TERMINAL_PATH is required")
    return terminal_path.strip()


def _require_env(name):
    value = os.environ.get(name)
    if not value or not value.strip():
        raise Mt5DemoBridgeNotConfigured(f"{name} is required")
    return value.strip()


class MT5DemoBridgeTransport:
    """Demo-only MT5 execution transport backed by the MetaTrader5 SDK."""

    def __init__(
        self,
        *,
        terminal_path=None,
        login=None,
        server=None,
        password=None,
        symbol=None,
        allowed_logins=None,
        allowed_servers=None,
        connect_timeout_ms=15000,
        now=_epoch_ms,
    ):
        self.terminal_path = _pin_terminal_path(terminal_path)
        self.login = int(login) if login is not None else None
        self.server = server.strip() if server else None
        self.password = password  # secret; never logged or returned
        self.symbol = symbol.strip() if symbol else None
        self.allowed_logins = set(int(x) for x in (allowed_logins or []))
        self.allowed_servers = set(str(x).strip() for x in (allowed_servers or []))
        self.connect_timeout_ms = int(connect_timeout_ms)
        self.now = now
        self._mt5 = None
        self._account = None
        self._connected = False

    # ------------------------------------------------------------------ connect

    def connect(self):
        """Initialize MT5, confirm a verified demo account, and allowlist it.

        Returns a whitelisted account snapshot. Raises Mt5DemoBridgeAccountError
        if the account is not a verified demo account or is not allowlisted.
        Does not submit any order.
        """
        import MetaTrader5 as mt5  # lazy import; no terminal connection yet

        self._mt5 = mt5

        # Exact terminal path; no auto-discovery or last-session fallback.
        if not mt5.initialize(path=self.terminal_path):
            code, _ = mt5.last_error()
            raise Mt5DemoBridgeExecutionError(
                f"MT5 initialize failed (code {code}); verify the exact terminal path"
            )

        try:
            # Pin one Windows PID/start time before SDK reads and recheck after.
            # This reduces (but cannot eliminate) a terminal-exit race.
            start_info = self._capture_terminal_process()

            # Safety gate: report whether trading is allowed; do not silently
            # change terminal settings.
            terminal_info = mt5.terminal_info()
            if terminal_info is None:
                raise Mt5DemoBridgeExecutionError("MT5 terminal_info is unavailable")
            trade_allowed = bool(getattr(terminal_info, "trade_allowed", False))
            python_trading_allowed = bool(
                getattr(terminal_info, "python_trading_allowed", False)
            )

            account_info = mt5.account_info()
            if account_info is None:
                code, _ = mt5.last_error()
                raise Mt5DemoBridgeExecutionError(
                    f"MT5 account_info unavailable (code {code})"
                )

            account = self._normalize_account(account_info)

            # Confirm demo account identity natively; names/flags are not evidence.
            if account["trade_mode"] != "demo":
                raise Mt5DemoBridgeAccountError(
                    "Connected account is not a demo account "
                    f"(trade_mode={account['trade_mode']}); demo execution only"
                )

            # Allowlist checks.
            if self.login is not None and account["login"] != self.login:
                raise Mt5DemoBridgeAccountError(
                    f"Connected login {account['login']} does not match configured MT5_LOGIN"
                )
            if self.server is not None and account["server"] != self.server:
                raise Mt5DemoBridgeAccountError(
                    f"Connected server {account['server']} does not match configured MT5_SERVER"
                )
            if self.allowed_logins and account["login"] not in self.allowed_logins:
                raise Mt5DemoBridgeAccountError(
                    f"Account login {account['login']} is not allowlisted"
                )
            if self.allowed_servers and account["server"] not in self.allowed_servers:
                raise Mt5DemoBridgeAccountError(
                    f"Account server {account['server']} is not allowlisted"
                )

            # Reconfirm identity after collection to reject an account switch.
            account_info2 = mt5.account_info()
            account2 = self._normalize_account(account_info2)
            if account2["login"] != account["login"] or account2["server"] != account["server"]:
                raise Mt5DemoBridgeAccountError("MT5 account identity changed during collection")

            self._account = {
                **account,
                "terminal_pid": start_info.get("pid"),
                "terminal_start_time": start_info.get("start_time"),
                "trade_allowed": trade_allowed,
                "python_trading_allowed": python_trading_allowed,
                "verified_at_utc": _utc_now_iso(),
                "demo_confirmed": True,
            }
            self._connected = True
            return dict(self._account)
        except Mt5DemoBridgeAccountError:
            self.shutdown()
            raise
        except Exception as error:
            self.shutdown()
            if isinstance(error, Mt5DemoBridgeExecutionError):
                raise
            raise Mt5DemoBridgeExecutionError(f"MT5 demo bridge connection failed: {error}") from error

    # --------------------------------------------------------------- account info

    def account_info(self):
        if not self._connected or not self._account:
            raise Mt5DemoBridgeExecutionError("MT5 demo account is not connected")
        return dict(self._account)

    # ----------------------------------------------------------------- submit order

    def submit_order(self, request):
        """Submit a demo order to the connected demo account only.

        Rejects any request when the connected account is not a verified demo
        account. Returns a result with submittedToBroker=True on acceptance.
        Live (real) execution is not supported by this module.
        """
        if not self._connected or not self._account:
            raise Mt5DemoBridgeExecutionError("MT5 demo account is not connected")
        if self._account["demo_confirmed"] is not True or self._account["trade_mode"] != "demo":
            raise Mt5DemoBridgeAccountError("Demo-only order submission; account is not demo")

        mt5 = self._mt5

        symbol = str(request.get("symbol") or self.symbol or "").strip()
        if not symbol:
            raise Mt5DemoBridgeExecutionError("Order symbol is required")
        volume = float(request.get("volume") or 0)
        if not volume or volume <= 0:
            raise Mt5DemoBridgeExecutionError("Order volume is required")
        order_type = str(request.get("type") or "").strip().upper()
        if order_type not in ("BUY", "SELL"):
            raise Mt5DemoBridgeExecutionError("Order type must be BUY or SELL")
        stop_loss = request.get("stop_loss")
        take_profit = request.get("take_profit")
        comment = str(request.get("comment") or "yosemite-demo")[:255]

        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            raise Mt5DemoBridgeExecutionError(f"Symbol {symbol} is not available in Market Watch")
        if not bool(getattr(symbol_info, "visible", False)):
            raise Mt5DemoBridgeExecutionError(f"Symbol {symbol} is not visible")

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise Mt5DemoBridgeExecutionError(f"No quote available for {symbol}")
        price = float(tick.ask) if order_type == "BUY" else float(tick.bid)

        action = mt5.TRADE_ACTION_DEAL
        mt5_type = mt5.ORDER_TYPE_BUY if order_type == "BUY" else mt5.ORDER_TYPE_SELL

        request_mt5 = {
            "action": action,
            "symbol": symbol,
            "volume": volume,
            "type": mt5_type,
            "price": price,
            "sl": float(stop_loss) if stop_loss is not None else 0.0,
            "tp": float(take_profit) if take_profit is not None else 0.0,
            "deviation": 10,
            "magic": 123456,
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_RETURN,
        }

        result = mt5.order_send(request_mt5)
        if result is None:
            code, _ = mt5.last_error()
            raise Mt5DemoBridgeExecutionError(f"MT5 order_send returned None (code {code})")

        retcode = int(getattr(result, "retcode", -1) or -1)
        order_id = int(getattr(result, "order", 0) or 0)
        deal_id = int(getattr(result, "deal", 0) or 0)
        price_result = float(getattr(result, "price", price) or price)

        if retcode != mt5.TRADE_RETCODE_DONE:
            comment_text = str(getattr(result, "comment", "") or "")
            raise Mt5DemoBridgeExecutionError(
                f"MT5 order rejected (retcode {retcode}): {comment_text}"
            )

        return {
            "orderId": str(order_id),
            "dealId": str(deal_id) if deal_id else None,
            "symbol": symbol,
            "type": order_type,
            "volume": volume,
            "price": price_result,
            "stopLoss": float(stop_loss) if stop_loss is not None else None,
            "takeProfit": float(take_profit) if take_profit is not None else None,
            "accountLogin": self._account["login"],
            "server": self._account["server"],
            "currency": self._account["currency"],
            "status": "filled_demo",
            "simulated": False,
            "submittedToBroker": True,
            "demo": True,
            "live": False,
            "executionAllowed": False,
            "tradingEnabled": False,
            "createdAt": _utc_now_iso(),
            "note": "Demo order submitted to the connected MT5 demo terminal; real-money execution is not supported by this bridge.",
        }

    # ------------------------------------------------------------------- shutdown

    def shutdown(self):
        if self._mt5 is not None:
            try:
                self._mt5.shutdown()
            except Exception:
                pass
        self._mt5 = None
        self._account = None
        self._connected = False
        return {"status": "stopped", "executionAllowed": False}

    # ------------------------------------------------------------------ internals

    def _capture_terminal_process(self):
        """Best-effort capture of the MT5 terminal PID/start time.

        Windows-only via ctypes/kernel32; returns {} on any platform or error.
        This is a safety aid, not an authorization to trade.
        """
        if os.name != "nt":
            return {}
        try:
            import ctypes
            from ctypes import wintypes

            hwnd = ctypes.windll.user32.FindWindowW(None, "MetaTrader 5")
            if not hwnd:
                return {}
            pid = wintypes.DWORD()
            ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if not pid.value:
                return {}
            handle = ctypes.windll.kernel32.OpenProcess(0x0010 | 0x0400, False, pid.value)
            start_time = 0
            if handle:
                creation = wintypes.FILETIME()
                exit_time = wintypes.FILETIME()
                kernel = wintypes.FILETIME()
                user = wintypes.FILETIME()
                if ctypes.windll.kernel32.GetProcessTimes(
                    handle, ctypes.byref(creation), ctypes.byref(exit_time),
                    ctypes.byref(kernel), ctypes.byref(user),
                ):
                    start_time = (
                        creation.dwLowDateTime | (creation.dwHighDateTime << 32)
                    )
                ctypes.windll.kernel32.CloseHandle(handle)
            return {"pid": int(pid.value), "start_time": int(start_time)}
        except Exception:
            return {}

    @staticmethod
    def _normalize_account(account_info) -> dict:
        login = int(getattr(account_info, "login", 0) or 0)
        trade_mode = int(getattr(account_info, "trade_mode", -1) or -1)
        server = str(getattr(account_info, "server", "") or "").strip()
        company = str(getattr(account_info, "company", "") or "").strip()
        currency = str(getattr(account_info, "currency", "") or "").strip().upper()
        equity = float(getattr(account_info, "equity", 0.0) or 0.0)
        mode_map = {0: "demo", 1: "contest", 2: "real"}
        return {
            "login": login,
            "trade_mode": mode_map.get(trade_mode, f"unknown({trade_mode})"),
            "server": server,
            "company": company,
            "currency": currency,
            "equity": equity,
        }
