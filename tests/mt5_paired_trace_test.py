"""Synthetic paired-trace tests: no installed SDK, terminal, network or orders."""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("paired_trace", ROOT / "bridge/diagnostics/paired_mt5_trace.py")
paired = importlib.util.module_from_spec(spec)
spec.loader.exec_module(paired)
NOW = datetime(2026, 10, 28, 13, 0, tzinfo=timezone.utc)
FUTURE = int(NOW.timestamp()) + 7200
SECRET = "synthetic-secret-not-output"
TEST_RUN_ID = "synthetic-fresh-run"


class Sdk:
    ACCOUNT_TRADE_MODE_DEMO = 0
    COPY_TICKS_ALL = -1
    __version__ = "synthetic"
    def __init__(self):
        self.calls = []
        self.terminal = SimpleNamespace(path=str(Path(paired.TERMINAL).parent), connected=True, trade_allowed=False, tradeapi_disabled=True, build=6291)
        self.account = SimpleNamespace(login=paired.LOGIN, server=paired.SERVER, trade_mode=0)
        self.history_none = False
        self.shutdown_error = False
        self.initialize_result = True
    def initialize(self, *args, **kwargs):
        self.calls.append(("initialize", args, kwargs))
        return self.initialize_result
    def terminal_info(self): return self.terminal
    def account_info(self): return self.account
    def version(self): return (500, 6291, "synthetic")
    def symbol_info_tick(self, symbol):
        self.calls.append(("symbol_info_tick", (symbol,), {}))
        return SimpleNamespace(time=FUTURE, time_msc=FUTURE * 1000 + 123, bid=1.1, ask=1.1001)
    def copy_ticks_range(self, symbol, start, end, flags):
        self.calls.append(("copy_ticks_range", (symbol, start, end, flags), {}))
        if self.history_none: return None
        seconds = FUTURE if start.timestamp() > NOW.timestamp() else int(NOW.timestamp()) - 1
        return [{"time": seconds, "time_msc": seconds * 1000 + 123, "bid": 1.1, "ask": 1.1001}]
    def last_error(self): return (-4, SECRET)
    def shutdown(self):
        self.calls.append(("shutdown", (), {}))
        if self.shutdown_error: raise RuntimeError(SECRET)
    def __getattr__(self, name):
        raise AssertionError("Unexpected capability: " + name)


def frames(run_id=TEST_RUN_ID):
    rows = [{"symbol": symbol, "visible": True, "tickOk": True, "errorCode": 0, "TimeLocal": FUTURE, "TimeGMT": int(NOW.timestamp()), "TimeCurrent": FUTURE, "TimeTradeServer": FUTURE, "TimeGMTAfter": int(NOW.timestamp()), "counterBeforeUs": 10, "counterAfterUs": 20, "time": FUTURE, "time_msc": FUTURE * 1000 + 123, "bid": 1.1, "ask": 1.1001} for symbol in paired.SYMBOLS]
    return [{"type": "native_frame", "runId": run_id, "sequence": sequence, "build": 6291, "server": paired.SERVER, "connected": True, "algoTradingAllowed": False, "safeAfter": True, "rows": rows} for sequence in range(3)] + [{"type": "done", "runId": run_id, "complete": True, "reason": "completed", "executionAllowed": False, "acknowledgedFrames": 3}]


class PairedTests(unittest.TestCase):
    def run_trace(self, sdk=None, data=None, guard=None, notify=None, commondata_path=None, run_id=TEST_RUN_ID):
        sdk = sdk or Sdk()
        with tempfile.TemporaryDirectory() as folder:
            # Match the native terminal's Common/Files convention exactly.
            common_files = Path(folder) / "Files"
            common_files.mkdir()
            trace, ack = common_files / "native.jsonl", common_files / "ack.txt"
            sdk.terminal.commondata_path = folder if commondata_path is None else commondata_path
            trace.write_text("".join(json.dumps(row) + "\n" for row in (frames(run_id) if data is None else data)), encoding="utf-8")
            report = paired.collect(sdk, trace, ack, guard or (lambda path: True), timeout=0.5, launch_timeout=0.5, now=lambda: NOW, pause=lambda delay: None, notify=notify, run_id=run_id)
        self.assertNotIn(SECRET, json.dumps(report))
        self.assertFalse(report["executionAllowed"])
        self.assertFalse(report["mappingValidated"])
        return report, sdk

    def test_native_and_python_raw_equality_never_authorizes_freshness(self):
        report, sdk = self.run_trace()
        self.assertTrue(report["pairedCaptureComplete"])
        self.assertTrue(report["sdkShutdownConfirmed"])
        self.assertEqual(len(report["frames"]), 3)
        self.assertEqual(sdk.calls[0], ("initialize", (paired.TERMINAL,), {"timeout": 10000, "portable": False}))
        for frame in report["frames"]:
            for row in frame["rows"]:
                self.assertTrue(row["liveRawMillisecondsEqual"])
                self.assertEqual(row["native"]["serverMinusGmtSeconds"], 7200)
                self.assertEqual(row["pythonLive"]["freshnessFailureCode"], "quote_timestamp_in_future")
                self.assertTrue(row["nativeEpochHistoryWindow"]["exactNativeTickPresent"])
                self.assertFalse(row["hostUtcHistoryWindow"]["exactNativeTickPresent"])

    def test_history_inputs_are_aware_utc_and_raw_output_is_unchanged(self):
        report, sdk = self.run_trace()
        for name, args, _ in sdk.calls:
            if name == "copy_ticks_range":
                self.assertEqual(args[1].utcoffset(), timedelta(0))
                self.assertEqual(args[2].utcoffset(), timedelta(0))
        row = report["frames"][0]["rows"][0]
        self.assertEqual(row["nativeEpochHistoryWindow"]["items"][0]["time_msc"], FUTURE * 1000 + 123)

    def test_disabled_controls_demo_identity_and_process_gates(self):
        for change in ("algo", "python", "connection", "real", "server", "login", "process"):
            sdk = Sdk()
            if change == "algo": sdk.terminal.trade_allowed = True
            if change == "python": sdk.terminal.tradeapi_disabled = False
            if change == "connection": sdk.terminal.connected = False
            if change == "real": sdk.account.trade_mode = 2
            if change == "server": sdk.account.server = "Other"
            if change == "login": sdk.account.login += 1
            report, sdk = self.run_trace(sdk, guard=lambda path: change != "process")
            self.assertFalse(report["pairedCaptureComplete"])
            self.assertNotIn("symbol_info_tick", [call[0] for call in sdk.calls])

    def test_native_connection_change_or_wrong_sequence_is_rejected(self):
        for key, value in (("connected", False), ("algoTradingAllowed", True), ("safeAfter", False), ("sequence", 2), ("runId", "other")):
            data = frames()
            data[0][key] = value
            report, _ = self.run_trace(data=data)
            self.assertFalse(report["pairedCaptureComplete"])

    def test_history_unavailable_records_numeric_error_without_secret(self):
        sdk = Sdk()
        sdk.history_none = True
        report, _ = self.run_trace(sdk)
        history = report["frames"][0]["rows"][0]["hostUtcHistoryWindow"]
        self.assertFalse(history["available"])
        self.assertEqual(history["sdkErrorNumber"], -4)
        self.assertEqual(history["items"], [])

    def test_shutdown_failure_invalidates_completion(self):
        sdk = Sdk()
        sdk.shutdown_error = True
        report, _ = self.run_trace(sdk)
        self.assertFalse(report["pairedCaptureComplete"])
        self.assertFalse(report["sdkShutdownConfirmed"])

    def test_initialize_refusal_records_only_numeric_error_and_stops_reads(self):
        sdk = Sdk()
        sdk.initialize_result = False
        report, sdk = self.run_trace(sdk)
        self.assertEqual(report["initializationErrorNumber"], -4)
        self.assertIn("initialize_refused", report["errors"])
        self.assertTrue(report["sdkShutdownConfirmed"])
        self.assertNotIn("symbol_info_tick", [call[0] for call in sdk.calls])

    def test_native_source_only_uses_reviewed_read_and_diagnostic_file_calls(self):
        source = (ROOT / "bridge/diagnostics/YosemiteTimestampReadOnly.mq5").read_text()
        code = re.sub(r'"(?:\\.|[^"\\])*"', '""', re.sub(r"//[^\n]*", "", source))
        calls = set(re.findall(r"\b([A-Za-z_][A-Za-z_0-9]*)\s*\(", code))
        allowed = {"ProtocolPayload", "AckFile", "ProtocolMatches", "CollectorReady", "ValidRunId", "StringLen", "StringGetCharacter", "TerminalInfoString", "FileSize", "Safe", "Number", "Boolean", "LogCheck", "LogStartupChecks", "LogStop", "OnStart", "MQLInfoInteger", "TerminalInfoInteger", "AccountInfoInteger", "AccountInfoString", "StringFormat", "if", "for", "Print", "FileIsExist", "ResetLastError", "FileOpen", "GetLastError", "IsStopped", "SymbolInfoInteger", "GetMicrosecondCount", "TimeLocal", "TimeGMT", "TimeCurrent", "TimeTradeServer", "SymbolInfoTick", "IntegerToString", "DoubleToString", "FileWriteString", "FileFlush", "FileReadString", "FileClose", "Sleep"}
        self.assertEqual(calls - allowed, set())
        self.assertNotIn("#import", source)
        self.assertNotIn("#include", source)
        self.assertIn("!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)", source)
        self.assertIn("sequence<3", source.replace(" ", ""))

    def test_ready_notice_requires_successful_native_safety_checks(self):
        messages = []
        report, _ = self.run_trace(notify=messages.append)
        self.assertTrue(report["pairedCaptureComplete"])
        self.assertEqual(len(messages), 1)
        self.assertIn("READY run_id=" + TEST_RUN_ID, messages[0])
        self.assertIn("DiagnosticRunId=" + TEST_RUN_ID, messages[0])
        self.assertIn("directory=", messages[0])
        sdk = Sdk()
        sdk.terminal.trade_allowed = True
        messages = []
        self.run_trace(sdk=sdk, notify=messages.append)
        self.assertEqual(messages, [])

    def test_native_diagnostics_share_run_id_and_expose_shutdown_reasons(self):
        source = (ROOT / "bridge/diagnostics/YosemiteTimestampReadOnly.mq5").read_text()
        self.assertIn('input string DiagnosticRunId="";', source)
        self.assertIn('#property script_show_inputs', source)
        self.assertIn('RUN_ID=DiagnosticRunId;', source)
        self.assertIn('TRACE="YosemiteTimeTrace-"+RUN_ID+".jsonl";', source)
        self.assertIn('ACK="YosemiteTimeTraceAck-"+RUN_ID;', source)
        self.assertIn('return ACK+"-"+IntegerToString(sequence)+".txt";', source)
        self.assertIn('return "YMT5-1|"+RUN_ID+"|"+kind+"\\n";', source)
        self.assertIn('FileSize(handle)==StringLen(expected)', source)
        self.assertIn('ProtocolMatches(AckFile(sequence),ProtocolPayload(IntegerToString(sequence)))', source)
        native_wait = int(re.search(r'ACK_WAIT_MILLISECONDS=(\d+)', source).group(1))
        self.assertEqual(native_wait, paired.CAPTURE_TIMEOUT_SECONDS * 1000)
        self.assertIn('acknowledged_frames==3', source.replace(" ", ""))
        for reason in ("existing_run_output", "trace_open_failed", "collector_ack_timeout", "stopped_while_waiting_for_ack", "safety_changed_while_waiting_for_ack", "incomplete_frame_count"):
            self.assertIn(reason, source)

    def test_completion_requires_native_confirmation_and_expected_frame_count(self):
        partial = frames()[:1] + [frames()[-1]]
        report, _ = self.run_trace(data=partial)
        self.assertFalse(report["pairedCaptureComplete"])
        for count, complete in ((0, True), (2, True), (3, False)):
            data = frames()
            data[-1].update(acknowledgedFrames=count, complete=complete)
            report, _ = self.run_trace(data=data)
            self.assertFalse(report["pairedCaptureComplete"])
        report, _ = self.run_trace(data=frames()[:-1])
        self.assertFalse(report["pairedCaptureComplete"])

    def test_wrong_native_common_directory_is_rejected_before_readiness(self):
        messages = []
        report, sdk = self.run_trace(commondata_path=str(ROOT), notify=messages.append)
        self.assertIn("native_common_files_directory_mismatch", report["errors"])
        self.assertFalse(report["pairedCaptureComplete"])
        self.assertEqual(messages, [])
        self.assertNotIn("symbol_info_tick", [call[0] for call in sdk.calls])

    def test_invalid_run_ids_are_rejected_before_file_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            for run_id in (None, "", ".", "..", "../escape", "a/b", "a\\b", "a:b", "a\n", "a\"b", "é", "_a", "-a", "x" * 65):
                with self.subTest(run_id=run_id), self.assertRaises(paired.probe.ProbeError):
                    paired.prepare_run(base, base / "output", run_id)
            self.assertEqual(list(base.iterdir()), [])

    def test_auto_ids_are_unique_and_valid(self):
        first, second = paired.new_run_id(), paired.new_run_id()
        self.assertNotEqual(first, second)
        self.assertEqual(paired.validate_run_id(first), first)
        self.assertEqual(paired.validate_run_id(second), second)

    def test_generated_id_is_used_in_readiness_native_validation_and_report(self):
        generated = paired.new_run_id()
        messages = []
        report, _ = self.run_trace(run_id=generated, notify=messages.append)
        self.assertTrue(report["pairedCaptureComplete"])
        self.assertEqual(report["runId"], generated)
        self.assertIn("run_id=" + generated, messages[0])
        self.assertIn("DiagnosticRunId=" + generated, messages[0])

    def test_existing_trace_ack_claim_or_output_directory_is_never_overwritten(self):
        for key in ("trace", "ack", "claim", "directory"):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as folder:
                common = Path(folder) / "Common/Files"
                common.mkdir(parents=True)
                output = Path(folder) / "reports"
                paths = paired.run_paths(common, output, TEST_RUN_ID)
                if key == "directory":
                    paths[key].mkdir(parents=True)
                    original = paths[key] / "report.json"
                else:
                    original = paths[key]
                original.write_bytes(b"existing evidence must survive")
                with self.assertRaises(paired.probe.ProbeError) as caught:
                    paired.prepare_run(common, output, TEST_RUN_ID)
                self.assertEqual(caught.exception.code, "diagnostic_run_files_already_exist")
                self.assertEqual(original.read_bytes(), b"existing evidence must survive")

    def test_fresh_runs_have_distinct_reports_and_preserve_legacy_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            common = base / "Common/Files"
            common.mkdir(parents=True)
            legacy = common / "YosemiteTimeTrace-20261028-final-B.jsonl"
            legacy.write_bytes(b"old incomplete trace")
            legacy_report = base / "mt5-paired-trace.json"
            legacy_report.write_bytes(b"old report")
            first = paired.prepare_run(common, base / "runs", paired.new_run_id())
            second = paired.prepare_run(common, base / "runs", paired.new_run_id())
            paired.save_run(first, {"run": 1}, b"native one")
            paired.save_run(second, {"run": 2}, b"native two")
            self.assertNotEqual(first["trace"], second["trace"])
            self.assertNotEqual(first["report"], second["report"])
            self.assertEqual(json.loads(first["report"].read_text()), {"run": 1})
            self.assertEqual(json.loads(second["report"].read_text()), {"run": 2})
            self.assertEqual(legacy.read_bytes(), b"old incomplete trace")
            self.assertEqual(legacy_report.read_bytes(), b"old report")
            with self.assertRaises(FileExistsError):
                paired.save_run(first, {"run": "overwrite"}, b"overwrite")
            self.assertEqual(first["native"].read_bytes(), b"native one")

    def test_duplicate_reservations_are_rejected_before_trace_exists(self):
        with tempfile.TemporaryDirectory() as folder:
            common = Path(folder) / "Files"
            common.mkdir()
            output = Path(folder) / "reports"
            first = paired.prepare_run(common, output, TEST_RUN_ID)
            claim = first["claim"].read_bytes()
            with self.assertRaises(paired.probe.ProbeError) as caught:
                paired.prepare_run(common, Path(folder) / "other-workspace", TEST_RUN_ID)
            self.assertEqual(caught.exception.code, "diagnostic_run_files_already_exist")
            self.assertEqual(first["claim"].read_bytes(), claim)
            self.assertFalse(first["trace"].exists())

    def test_concurrent_same_id_has_only_one_owner(self):
        with tempfile.TemporaryDirectory() as folder:
            common = Path(folder) / "Files"
            common.mkdir()
            def reserve(_):
                try:
                    paired.prepare_run(common, Path(folder) / "runs", TEST_RUN_ID)
                    return "reserved"
                except paired.probe.ProbeError as error:
                    return error.code
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(reserve, range(2)))
            self.assertEqual(results.count("reserved"), 1)
            self.assertEqual(results.count("diagnostic_run_files_already_exist"), 1)

    def test_protocol_payloads_and_paths_are_exact_and_exclusive(self):
        with tempfile.TemporaryDirectory() as folder:
            ack = Path(folder) / ("YosemiteTimeTraceAck-" + TEST_RUN_ID + ".txt")
            paths = paired.protocol_paths(ack)
            for sequence in range(3):
                path = paths[str(sequence)]
                self.assertEqual(path.name, "YosemiteTimeTraceAck-" + TEST_RUN_ID + "-" + str(sequence) + ".txt")
                payload = paired.protocol_payload(TEST_RUN_ID, str(sequence))
                self.assertEqual(payload, ("YMT5-1|" + TEST_RUN_ID + "|" + str(sequence) + "\n").encode("ascii"))
                paired.publish_protocol(path, payload)
                with self.assertRaises(paired.probe.ProbeError):
                    paired.publish_protocol(path, payload)
                self.assertEqual(path.read_bytes(), payload)

    def test_reservation_rejects_stale_protocol_files(self):
        for kind in ("ready", "closed", "0", "1", "2"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                common = Path(folder)
                paths = paired.run_paths(common, common / "reports", TEST_RUN_ID)
                stale = paths["protocol_" + kind]
                stale.write_bytes(b"stale evidence")
                with self.assertRaises(paired.probe.ProbeError):
                    paired.prepare_run(common, common / "reports", TEST_RUN_ID)
                self.assertEqual(stale.read_bytes(), b"stale evidence")

    def test_duplicate_native_frame_is_not_acknowledged_twice(self):
        data = frames()
        report, _ = self.run_trace(data=[data[0], data[0]] + data[1:])
        self.assertFalse(report["pairedCaptureComplete"])
        self.assertEqual(len(report["frames"]), 1)
        self.assertIn("native_frame_identity_or_safety_invalid", report["errors"])

    def test_invalid_completion_marker_never_completes(self):
        for changes in ({"reason": "collector_ack_timeout"}, {"executionAllowed": True}, {"acknowledgedFrames": True}, {"runId": "wrong-run"}):
            with self.subTest(changes=changes):
                data = frames()
                data[-1].update(changes)
                report, _ = self.run_trace(data=data)
                self.assertFalse(report["pairedCaptureComplete"])

    def test_tampered_missing_or_wrong_run_ack_never_completes(self):
        original = paired.publish_protocol
        for replacement in (b"0\n", b"YMT5-1|wrong-run|0\n", b"", b"YMT5-1|synthetic-fresh-run|0", b"YMT5-1|synthetic-fresh-run|0\nextra", None):
            with self.subTest(replacement=replacement):
                def publish(path, payload):
                    if path.name.endswith("-0.txt"):
                        if replacement is not None:
                            original(path, replacement)
                    else:
                        original(path, payload)
                with patch.object(paired, "publish_protocol", side_effect=publish):
                    report, _ = self.run_trace()
                self.assertFalse(report["pairedCaptureComplete"])

    def test_incremental_handshake_handles_partial_frame_and_late_operator(self):
        # A native-like file producer, no SDK/terminal/network. Launch at +108s:
        # the old 100s deadline exited before this valid sequence-0 frame.
        with tempfile.TemporaryDirectory() as folder:
            common = Path(folder) / "Files"
            common.mkdir()
            trace = common / "native.jsonl"
            ack = common / ("YosemiteTimeTraceAck-" + TEST_RUN_ID + ".txt")
            controls = paired.protocol_paths(ack)
            sdk = Sdk()
            sdk.terminal.commondata_path = folder
            clock = [0.0]
            native_sequence = [0]
            half = [False]
            native_ack_count = [0]
            def producer(delay):
                clock[0] += 1
                self.assertFalse(controls["closed"].exists())
                self.assertEqual(controls["ready"].read_bytes(), ("YMT5-1|" + TEST_RUN_ID + "|ready\n").encode())
                if clock[0] < 108:
                    return
                index = native_sequence[0]
                if index == 3:
                    return
                encoded = (json.dumps(frames()[index]) + "\r\n").encode()
                if not half[0]:
                    with trace.open("ab") as stream:
                        stream.write(encoded[:len(encoded)//2])
                    half[0] = True
                elif not controls[str(index)].exists():
                    with trace.open("ab") as stream:
                        stream.write(encoded[len(encoded)//2:])
                    # Advance the producer only after it sees exact native wire bytes.
                    half[0] = False
                    native_sequence[0] += 1
                # The preceding frame must have been ACKed before another is emitted.
                if index > 0:
                    self.assertEqual(controls[str(index-1)].read_bytes(), ("YMT5-1|" + TEST_RUN_ID + "|" + str(index-1) + "\n").encode())
                    native_ack_count[0] = index
                if native_sequence[0] == 3:
                    # Completion is emitted on the next EOF poll, after ACK 2.
                    native_sequence[0] = 3
            def polling(delay):
                if native_sequence[0] == 3 and controls["2"].exists():
                    self.assertEqual(controls["2"].read_bytes(), ("YMT5-1|" + TEST_RUN_ID + "|2\n").encode())
                    native_ack_count[0] = 3
                    with trace.open("ab") as stream:
                        stream.write((json.dumps(frames()[-1]) + "\r\n").encode())
                    clock[0] += 1
                else:
                    producer(delay)
            report = paired.collect(sdk, trace, ack, lambda path: True, now=lambda: NOW,
                                    pause=polling, monotonic=lambda: clock[0], run_id=TEST_RUN_ID)
            self.assertTrue(report["pairedCaptureComplete"], report["errors"])
            self.assertEqual(len(report["frames"]), 3)
            self.assertEqual(report["collectorAcknowledgedFrames"], 3)
            self.assertEqual(native_ack_count[0], 3)
            self.assertTrue(controls["closed"].exists())
            self.assertFalse(report["executionAllowed"])

    def test_expired_collector_is_closed_and_does_not_ack_late_frame(self):
        with tempfile.TemporaryDirectory() as folder:
            common = Path(folder) / "Files"
            common.mkdir()
            sdk = Sdk()
            sdk.terminal.commondata_path = folder
            trace, ack = common / "native.jsonl", common / "ack.txt"
            clock = [0]
            def pause(delay): clock[0] += 1
            report = paired.collect(sdk, trace, ack, lambda path: True, now=lambda: NOW,
                                    pause=pause, monotonic=lambda: clock[0], run_id=TEST_RUN_ID, launch_timeout=100)
            trace.write_text(json.dumps(frames()[0]) + "\n")
            controls = paired.protocol_paths(ack)
            self.assertFalse(report["pairedCaptureComplete"])
            self.assertIn("native_launch_or_first_frame_timeout", report["errors"])
            self.assertTrue(controls["closed"].exists())
            self.assertFalse(controls["0"].exists())

    def test_incomplete_native_line_times_out_without_any_ack(self):
        with tempfile.TemporaryDirectory() as folder:
            common = Path(folder) / "Files"
            common.mkdir()
            sdk = Sdk()
            sdk.terminal.commondata_path = folder
            trace, ack = common / "native.jsonl", common / "ack.txt"
            trace.write_bytes(json.dumps(frames()[0]).encode())  # No final LF.
            clock = [0]
            def pause(delay): clock[0] += 1
            report = paired.collect(sdk, trace, ack, lambda path: True, now=lambda: NOW,
                                    pause=pause, monotonic=lambda: clock[0], run_id=TEST_RUN_ID, launch_timeout=2)
            self.assertFalse(report["pairedCaptureComplete"])
            self.assertEqual(report["collectorAcknowledgedFrames"], 0)
            self.assertEqual(report["frames"], [])

    def test_ack_write_failure_does_not_count_frame_as_acknowledged(self):
        original = paired.publish_protocol
        def publish(path, payload):
            if path.name.endswith("-0.txt"):
                raise OSError("synthetic ACK write failure")
            return original(path, payload)
        with patch.object(paired, "publish_protocol", side_effect=publish):
            report, _ = self.run_trace()
        self.assertFalse(report["pairedCaptureComplete"])
        self.assertEqual(report["collectorAcknowledgedFrames"], 0)

    def test_slow_sdk_processing_cannot_publish_ack_after_capture_deadline(self):
        with tempfile.TemporaryDirectory() as folder:
            common = Path(folder) / "Files"
            common.mkdir()
            sdk = Sdk()
            sdk.terminal.commondata_path = folder
            trace, ack = common / "native.jsonl", common / "ack.txt"
            trace.write_text(json.dumps(frames()[0]) + "\n")
            clock = [0]
            original = sdk.copy_ticks_range
            def slow_history(*args):
                clock[0] += 30
                return original(*args)
            sdk.copy_ticks_range = slow_history
            report = paired.collect(sdk, trace, ack, lambda path: True, now=lambda: NOW,
                                    monotonic=lambda: clock[0], run_id=TEST_RUN_ID)
            self.assertFalse(report["pairedCaptureComplete"])
            self.assertEqual(report["collectorAcknowledgedFrames"], 0)
            self.assertIn("collector_capture_timeout_before_ack", report["errors"])
            self.assertFalse(paired.protocol_paths(ack)["0"].exists())


if __name__ == "__main__":
    unittest.main()
