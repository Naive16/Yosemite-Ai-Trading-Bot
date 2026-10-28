"""Approved bounded native/Python diagnostic; default offline, never an executor."""
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from contextlib import redirect_stdout, redirect_stderr
import argparse
import importlib
import json
import os
import re
import struct
import sys
import time
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from bridge import mt5_demo_probe as probe

TERMINAL = r"C:\Program Files\MetaTrader 5\terminal64.exe"
SERVER = "MetaQuotes-Demo"
LOGIN = 5058025194
SYMBOLS = ("EURUSD", "GBPUSD", "USDJPY")
CAPTURE_TIMEOUT_SECONDS = 100
ALLOWED = {"initialize", "version", "terminal_info", "account_info", "symbol_info", "symbol_info_tick", "copy_ticks_range", "last_error", "shutdown"}


def validate_run_id(run_id):
    if not isinstance(run_id, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", run_id) is None:
        raise probe.ProbeError("invalid_diagnostic_run_id")
    return run_id


def new_run_id():
    # Identifier generation only; no source market timestamp is changed.
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid4().hex


def protocol_paths(ack):
    # Immutable, exclusive files: neither an old sequence nor another run can ACK.
    return {key: ack.with_name(ack.stem + "-" + key + ".txt")
            for key in ("ready", "closed", "0", "1", "2")}


def protocol_payload(run_id, kind):
    validate_run_id(run_id)
    if kind not in ("ready", "closed", "0", "1", "2"):
        raise probe.ProbeError("invalid_ack_sequence")
    return ("YMT5-1|" + run_id + "|" + kind + "\n").encode("ascii")


def publish_protocol(path, payload):
    # Readers require the entire canonical payload, including its final LF.
    # A partial write is never accepted; existing evidence is never replaced.
    try:
        with path.open("xb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        raise probe.ProbeError("diagnostic_protocol_file_already_exists") from None


def run_paths(common, output_root, run_id):
    validate_run_id(run_id)
    common, output_root = Path(common), Path(output_root)
    directory = output_root / run_id
    paths = {"trace": common / ("YosemiteTimeTrace-" + run_id + ".jsonl"), "ack": common / ("YosemiteTimeTraceAck-" + run_id + ".txt"), "claim": common / ("YosemiteTimeTraceClaim-" + run_id + ".json"), "directory": directory, "report": directory / "report.json", "native": directory / "native.jsonl"}
    paths.update({"protocol_" + key: path for key, path in protocol_paths(paths["ack"]).items()})
    return paths


def prepare_run(common, output_root, run_id):
    """Reserve a never-reused run; preserve failed reservations as evidence too."""
    paths = run_paths(common, output_root, run_id)
    reserved = ("trace", "ack", "claim", "directory") + tuple(key for key in paths if key.startswith("protocol_"))
    if any(paths[key].exists() for key in reserved):
        raise probe.ProbeError("diagnostic_run_files_already_exist")
    if not Path(common).is_dir():
        raise probe.ProbeError("native_common_files_directory_unavailable")
    try:
        # Exclusive creation also rejects simultaneous collectors using one ID.
        with paths["claim"].open("x", encoding="utf-8") as stream:
            json.dump({"runId": run_id, "purpose": "read_only_diagnostic_reservation", "executionAllowed": False}, stream)
        paths["directory"].parent.mkdir(parents=True, exist_ok=True)
        paths["directory"].mkdir()
        if paths["trace"].exists() or paths["ack"].exists():
            raise probe.ProbeError("diagnostic_run_files_already_exist")
    except FileExistsError:
        raise probe.ProbeError("diagnostic_run_files_already_exist") from None
    except OSError:
        raise probe.ProbeError("diagnostic_run_reservation_failed") from None
    return paths


def save_run(paths, report, native_bytes=None):
    # Never replace an earlier report or raw snapshot, even after a failed run.
    with paths["report"].open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
    if native_bytes is not None:
        with paths["native"].open("xb") as stream:
            stream.write(native_bytes)


def utc_reference():
    before = datetime.now(timezone.utc)
    try:
        request = Request("https://www.google.com/generate_204?mt5_pair=" + uuid4().hex, method="HEAD", headers={"Cache-Control": "no-cache, no-store"})
        with urlopen(request, timeout=8) as response:
            header = response.headers.get("Date")
            value = parsedate_to_datetime(header).astimezone(timezone.utc)
            result = {"usable": response.headers.get("Age") in (None, "0"), "source": "https://www.google.com/generate_204", "httpDate": header, "unixSeconds": value.timestamp(), "isoUtc": value.isoformat(), "precisionSeconds": 1, "tlsVerified": True}
    except Exception:
        result = {"usable": False, "errorCode": "independent_utc_unavailable"}
    return {**result, "hostBeforeUtc": before.isoformat(), "hostAfterUtc": datetime.now(timezone.utc).isoformat()}


def native_row(row):
    keys = ("TimeLocal", "TimeGMT", "TimeCurrent", "TimeTradeServer", "TimeGMTAfter", "counterBeforeUs", "counterAfterUs", "time", "time_msc", "errorCode")
    if not isinstance(row, dict) or row.get("symbol") not in SYMBOLS or any(type(row.get(key)) is not int for key in keys):
        raise probe.ProbeError("native_frame_schema_invalid")
    clean = {key: row[key] for key in keys}
    clean.update({"symbol": row["symbol"], "visible": row.get("visible") is True, "tickOk": row.get("tickOk") is True, "bid": probe._number(row.get("bid"), positive=True), "ask": probe._number(row.get("ask"), positive=True)})
    if not clean["visible"] or not clean["tickOk"] or clean["bid"] is None or clean["ask"] is None or clean["time_msc"] // 1000 != clean["time"]:
        raise probe.ProbeError("native_tick_invalid")
    clean["TimeGMTIsoUtc"] = datetime.fromtimestamp(clean["TimeGMT"], timezone.utc).isoformat()
    clean["serverMinusGmtSeconds"] = clean["TimeCurrent"] - clean["TimeGMT"]
    clean["TimeCurrentIsUtcValidated"] = False
    return clean


def collect(sdk, trace, ack, guard, timeout=CAPTURE_TIMEOUT_SECONDS, now=None, pause=time.sleep, notify=None, run_id=None, launch_timeout=300, monotonic=time.monotonic):
    clock = now or (lambda: datetime.now(timezone.utc))
    report = {"mode": "paired_native_python_trace", "evidenceSource": "injected-test", "frames": [], "errors": [], "collectorAcknowledgedFrames": 0, "releaseReadiness": "blocked", "executionAllowed": False, "actualBrokerOrderExecuted": False, "utcOffsetAppliedSeconds": 0, "mappingValidated": False}
    attempted = False
    ready = False
    controls = protocol_paths(ack)
    def call(name, *args, **kwargs):
        if name not in ALLOWED:
            raise probe.ProbeError("forbidden_diagnostic_capability")
        return probe._sdk_call(sdk, name, *args, **kwargs)
    def stamp():
        return probe._utc_time(clock)
    def safe():
        if guard(TERMINAL) is not True:
            raise probe.ProbeError("running_terminal_changed")
        terminal = call("terminal_info")
        account = call("account_info")
        if terminal is None or getattr(terminal, "path", None) != str(Path(TERMINAL).parent) or getattr(terminal, "connected", None) is not True or getattr(terminal, "trade_allowed", None) is not False or getattr(terminal, "tradeapi_disabled", None) is not True:
            raise probe.ProbeError("terminal_connection_or_disabled_controls_changed")
        if probe._integer(getattr(account, "login", None), 1) != LOGIN or getattr(account, "server", None) != SERVER or probe._integer(getattr(account, "trade_mode", None)) != 0 or probe._integer(getattr(sdk, "ACCOUNT_TRADE_MODE_DEMO", None)) != 0:
            raise probe.ProbeError("native_demo_identity_changed")
        native_common = getattr(terminal, "commondata_path", None)
        if not isinstance(native_common, str) or (Path(native_common) / "Files").resolve() != trace.parent.resolve():
            raise probe.ProbeError("native_common_files_directory_mismatch")
        return {"server": SERVER, "build": getattr(terminal, "build", None), "connected": True, "algoTradingAllowed": False, "externalPythonTradingDisabled": True, "commonFilesDirectory": str(trace.parent)}
    def timed(name, *args):
        before = stamp()
        started = time.perf_counter()
        try:
            value = call(name, *args)
            failure = None
        except probe.ProbeError as error:
            value, failure = None, error.code
        after = stamp()
        code = None
        if value is None:
            try:
                last = call("last_error")
                code = last[0] if isinstance(last, tuple) and type(last[0]) is int else None
            except probe.ProbeError:
                pass
        return value, {"beforeUtc": before.isoformat(), "afterUtc": after.isoformat(), "beforeUnix": before.timestamp(), "afterUnix": after.timestamp(), "durationSeconds": time.perf_counter() - started, "errorCode": failure, "sdkErrorNumber": code}
    def history(symbol, start, end, native):
        if start.tzinfo is None or start.utcoffset() != timedelta(0) or end.tzinfo is None or end.utcoffset() != timedelta(0):
            raise probe.ProbeError("utc_aware_history_inputs_required")
        rows, frame = timed("copy_ticks_range", symbol, start, end, sdk.COPY_TICKS_ALL)
        items = []
        if rows is not None:
            for row in rows[:200]:
                items.append({"time": int(row["time"]), "time_msc": int(row["time_msc"]), "bid": float(row["bid"]), "ask": float(row["ask"])})
        return {"queryStartUtc": start.isoformat(), "queryEndUtc": end.isoformat(), "inputTimezone": "UTC", "available": rows is not None, "count": len(rows) if rows is not None else None, "truncated": rows is not None and len(rows) > 200, "items": items, "exactNativeTickPresent": any(item["time_msc"] == native["time_msc"] and item["bid"] == native["bid"] and item["ask"] == native["ask"] for item in items), **frame}
    try:
        validate_run_id(run_id)
        report["runId"] = run_id
        if guard(TERMINAL) is not True:
            raise probe.ProbeError("running_terminal_required")
        attempted = True
        if call("initialize", TERMINAL, timeout=10000, portable=False) is not True:
            try:
                last = call("last_error")
                report["initializationErrorNumber"] = last[0] if isinstance(last, tuple) and type(last[0]) is int else None
            except probe.ProbeError:
                report["initializationErrorNumber"] = None
            raise probe.ProbeError("initialize_refused")
        report["initialTerminal"] = safe()
        report["sdkVersion"] = getattr(sdk, "__version__", None)
        report["terminalVersion"] = call("version")
        report["pythonVersion"] = sys.version.split()[0]
        if ack.exists() or any(path.exists() for path in controls.values()):
            raise probe.ProbeError("diagnostic_protocol_file_already_exists")
        publish_protocol(controls["ready"], protocol_payload(run_id, "ready"))
        ready = True
        if notify is not None:
            notify("Yosemite collector READY run_id=" + run_id + "; set native input DiagnosticRunId=" + run_id + "; directory=" + str(trace.parent) + "; protocol=YMT5-1; launch window=" + format(launch_timeout, "g") + " seconds; capture window=" + format(timeout, "g") + " seconds after first frame. Launch once; keep trading disabled.")
        deadline = monotonic() + launch_timeout
        position = 0
        sequence = 0
        done = False
        while monotonic() < deadline:
            if not trace.exists():
                pause(0.1)
                continue
            if trace.stat().st_size > 1024 * 1024:
                raise probe.ProbeError("native_trace_oversize")
            with trace.open("rb") as stream:
                stream.seek(position)
                line = stream.readline()
                next_position = stream.tell()
            if not line.endswith(b"\n"):
                pause(0.05)
                continue
            position = next_position
            received_before = stamp()
            raw = json.loads(line)
            if not isinstance(raw, dict):
                raise probe.ProbeError("native_frame_schema_invalid")
            if raw.get("runId") != run_id:
                raise probe.ProbeError("unexpected_native_run")
            if raw.get("type") == "done":
                done = (raw.get("complete") is True and type(raw.get("acknowledgedFrames")) is int
                        and raw["acknowledgedFrames"] == 3 and sequence == 3
                        and raw.get("reason") == "completed" and raw.get("executionAllowed") is False
                        and all(controls[str(index)].read_bytes() == protocol_payload(run_id, str(index)) for index in range(3)))
                break
            safe()
            if type(raw.get("sequence")) is not int or raw.get("sequence") != sequence or raw.get("type") != "native_frame" or raw.get("server") != SERVER or raw.get("connected") is not True or raw.get("algoTradingAllowed") is not False or raw.get("safeAfter") is not True:
                raise probe.ProbeError("native_frame_identity_or_safety_invalid")
            if not isinstance(raw.get("rows"), list) or [row.get("symbol") for row in raw["rows"]] != list(SYMBOLS):
                raise probe.ProbeError("native_frame_symbols_invalid")
            if sequence == 0:
                deadline = monotonic() + timeout
            frame = {"sequence": sequence, "nativeFrameReceivedBeforeUtc": received_before.isoformat(), "rows": []}
            for raw_row in raw["rows"]:
                safe()
                native = native_row(raw_row)
                symbol = native["symbol"]
                tick, live_frame = timed("symbol_info_tick", symbol)
                quoted_at, evidence = probe._tick_timestamp(tick)
                evidence.update({"bid": probe._number(getattr(tick, "bid", None), positive=True), "ask": probe._number(getattr(tick, "ask", None), positive=True), **live_frame})
                probe._stamp_quote_time(evidence, quoted_at, datetime.fromisoformat(live_frame["afterUtc"]))
                end = stamp()
                host_window = history(symbol, end - timedelta(seconds=5), end, native)
                raw_epoch = datetime.fromtimestamp(native["time"], timezone.utc)
                native_window = history(symbol, raw_epoch - timedelta(seconds=2), raw_epoch + timedelta(seconds=1), native)
                frame["rows"].append({"symbol": symbol, "native": native, "pythonLive": evidence, "liveRawMillisecondsEqual": evidence["rawTimeMsc"] == native["time_msc"], "hostUtcHistoryWindow": host_window, "nativeEpochHistoryWindow": native_window, "nativeEpochWindowPurpose": "raw-domain consistency only; not a timezone correction or freshness proof"})
            frame["terminalAfter"] = safe()
            frame["nativeFrameReceivedAfterUtc"] = stamp().isoformat()
            report["frames"].append(frame)
            if monotonic() >= deadline:
                raise probe.ProbeError("collector_capture_timeout_before_ack")
            publish_protocol(controls[str(sequence)], protocol_payload(run_id, str(sequence)))
            sequence += 1
            report["collectorAcknowledgedFrames"] = sequence
        report["nativeCompleted"] = done
        report["finalTerminal"] = safe()
        report["pairedCaptureComplete"] = done and sequence == 3
        if not report["pairedCaptureComplete"]:
            report["errors"].append("native_completion_or_frame_count_unverified")
            if sequence == 0:
                report["errors"].append("native_launch_or_first_frame_timeout")
    except probe.ProbeError as error:
        report["errors"].append(error.code)
        report["pairedCaptureComplete"] = False
    except Exception:
        report["errors"].append("paired_trace_failed")
        report["pairedCaptureComplete"] = False
    finally:
        if ready:
            try:
                publish_protocol(controls["closed"], protocol_payload(run_id, "closed"))
            except OSError:
                report["pairedCaptureComplete"] = False
                report["errors"].append("collector_close_marker_failed")
            except probe.ProbeError as error:
                report["pairedCaptureComplete"] = False
                report["errors"].append(error.code)
        if attempted:
            try:
                call("shutdown")
                report["sdkShutdownConfirmed"] = True
            except probe.ProbeError:
                report["sdkShutdownConfirmed"] = False
                report["pairedCaptureComplete"] = False
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="store_true")
    parser.add_argument("--run-id", help="Optional fresh ID; reusing any existing run is rejected. Default: UTC identifier plus UUID.")
    parser.add_argument("--launch-timeout", type=int, default=300, choices=range(1, 901), metavar="1..900", help="Bounded operator launch window; capture still has its own 100-second deadline.")
    args = parser.parse_args()
    if not args.capture:
        print(json.dumps({"mode": "offline", "executionAllowed": False, "releaseReadiness": "blocked"}))
        return 2
    if sys.platform != "win32" or struct.calcsize("P") * 8 != 64:
        raise SystemExit("windows_x64_required")
    probe._validate_terminal_path(TERMINAL)
    guard = probe._running_terminal_guard()
    if not guard(TERMINAL):
        raise SystemExit("running_terminal_required")
    common = Path(os.environ["APPDATA"]) / "MetaQuotes/Terminal/Common/Files"
    run_id = args.run_id if args.run_id is not None else new_run_id()
    try:
        paths = prepare_run(common, ROOT / ".local-data/mt5-paired-runs", run_id)
    except probe.ProbeError as error:
        raise SystemExit(error.code) from None
    with redirect_stdout(probe._DiscardOutput()), redirect_stderr(probe._DiscardOutput()):
        sdk = importlib.import_module("MetaTrader5")
    reference_before = utc_reference()
    report = collect(sdk, paths["trace"], paths["ack"], guard, notify=lambda message: print(message, flush=True), run_id=run_id, launch_timeout=args.launch_timeout)
    report.update({"evidenceSource": "native-sdk-and-mql5" if report["frames"] else "native-sdk-no-paired-frames", "nativeMqlFrameCount": len(report["frames"]), "runId": run_id, "independentUtcReferences": [reference_before, utc_reference()]})
    save_run(paths, report, paths["trace"].read_bytes() if paths["trace"].exists() else None)
    print(json.dumps({"runId": run_id, "reportPath": str(paths["report"]), "pairedCaptureComplete": report.get("pairedCaptureComplete"), "frames": len(report["frames"]), "errors": report["errors"], "executionAllowed": False, "sdkShutdownConfirmed": report.get("sdkShutdownConfirmed")}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
