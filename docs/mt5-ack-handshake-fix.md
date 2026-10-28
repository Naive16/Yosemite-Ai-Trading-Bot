# MT5 paired-capture ACK repair — 28 October 2026

Implemented and verified locally. No MT5 launch, native script launch, SDK connection or capture was performed during this repair. No orders, permissions, clock settings, production resources, deployment or GitHub operations were involved. Successful unit tests and compilation are not evidence of a successful terminal capture.

## Proven cause in the supplied run

Run: `20261028T155653Z-104cf23aea494395b4dc3857b0442bb6`.

The preserved report is `.local-data/mt5-paired-runs/<run>/report.json`. Its second independent-reference request starts **after `collect()` has returned and shut down its SDK connection**, at `2026-10-28T15:58:35.839044+00:00`. That request finishes at `15:58:36.230965+00:00`.

The Common Files trace's first native frame has `TimeGMT=1793203122`, or **15:58:42 UTC**. The Experts log independently records script startup and FRAME sequence 0 at local `17:58:42.077–078` (the host's configured UTC+2). The native frame therefore started at least six seconds after the collector had stopped. Its later `collector_ack_timeout` is consistent with having no active collector to acknowledge it.

The old Python `collect()` set `deadline = time.monotonic() + timeout` before waiting for the first frame, with default `timeout=100`. The native `OnStart()` checked file absence and account safety but did not check whether the collector was still waiting. The reservation claim proved an ID had been reserved, not that its collector was alive. This lifecycle mismatch explains this run's empty Python frames, absent ACK, and native sequence-0 timeout. Both sides previously agreed on the run-specific ACK filename and sequence-only text payload; evidence does not support attributing this run to an encoding or run-ID disagreement. The preserved trace is valid UTF-8 JSONL with two CRLF-terminated records, not an unterminated frame.

An additional bounded-wait mismatch existed: native ACK polling lasted 10 seconds, Python's capture budget was 100 seconds, and one guarded process check can itself wait up to 15 seconds. ACK publication also follows guarded SDK collection. Slow collection could therefore time out native ACK polling independently of operator launch delay.

## Local implementation

`bridge/diagnostics/paired_mt5_trace.py`:

- Publishes readiness only after native identity, connection and disabled-control checks; publishes a closed marker on every normal/error exit after readiness.
- Separates a default 300-second operator launch window from the existing 100-second capture budget, which starts at the first validated frame. Optional `--launch-timeout 1..900` changes only the diagnostic launch window. READY prints the actual run ID, directory, protocol and both budgets.
- Uses exclusive, immutable per-frame ACK files; records the actual successful ACK write count. A write failure cannot count as acknowledgement. No ACK is published after the capture deadline.
- Polls trace bytes using byte offsets, retries incomplete lines without advancing, and closes the reader before sleeping.
- Requires ordered sequences 0, 1 and 2; verifies all three exact ACK payloads again at completion. Requires a matching native `done` with `complete=true`, integer `acknowledgedFrames=3`, `reason="completed"`, and `executionAllowed=false`, followed by final terminal safety checks and SDK shutdown. Failure remains incomplete.
- Reserves all new control filenames as well as legacy names, rejecting pre-existing or duplicate run IDs without replacing evidence.

`bridge/diagnostics/YosemiteTimestampReadOnly.mq5`, version **1.03**:

- Checks matching readiness and absence of the closed marker before opening a trace. A late launch stops with `collector_not_ready_or_closed`.
- Polls the exact expected per-frame ACK filename and complete run/sequence payload. Partial writes, legacy sequence-only payloads, wrong IDs, wrong sequences and trailing bytes cannot match. Each sequence can increment the count once.
- Stops ACK polling if the collector closes or safety changes. Its maximum ACK wait is now 100 seconds, matching the Python capture budget; polling remains every 50 ms. Logs include the expected filename and protocol.
- Preserves all account, server, connection and Algo Trading checks. No trading, DLL, network or permission APIs were added.

`tests/mt5_paired_trace_test.py`: adds delayed-launch, incremental partial-line, successful ACK, stale-file reservation, duplicate frame/write, wrong-run/malformed/missing ACK, incomplete completion, write failure and expired capture tests. Tests use synthetic SDKs and temporary directories; native read-only API use and the shared wire contract are also checked statically.

`bridge/README.md`: links this repair and documents the matching diagnostic versions and filenames.

## Exact wire contract

All files are in `C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\Common\Files`.

| File | Required content |
| --- | --- |
| `YosemiteTimeTrace-<id>.jsonl` | Native frames 0–2, then native completion JSONL |
| `YosemiteTimeTraceClaim-<id>.json` | Existing reservation schema; never sufficient as readiness |
| `YosemiteTimeTraceAck-<id>-ready.txt` | ASCII `YMT5-1\|<id>\|ready` followed by one LF byte |
| `YosemiteTimeTraceAck-<id>-0.txt` | ASCII `YMT5-1\|<id>\|0` followed by one LF byte |
| `YosemiteTimeTraceAck-<id>-1.txt` | ASCII `YMT5-1\|<id>\|1` followed by one LF byte |
| `YosemiteTimeTraceAck-<id>-2.txt` | ASCII `YMT5-1\|<id>\|2` followed by one LF byte |
| `YosemiteTimeTraceAck-<id>-closed.txt` | ASCII `YMT5-1\|<id>\|closed` followed by one LF byte |

The legacy `YosemiteTimeTraceAck-<id>.txt` is no longer written; its existence still blocks reuse. No file above is overwritten or cleaned up automatically. Python flushes/fsyncs each exclusive control write. Native checks the complete byte length and contents using `FILE_BIN|FILE_ANSI`, so a partially written control file cannot be accepted. MetaQuotes documents explicit-length binary reads in [FileReadString](https://www.mql5.com/en/docs/files/filereadstring), checked 28 October 2026. ASCII run IDs avoid multibyte length ambiguity.

A crashed collector may leave readiness without a closed marker. Such a marker alone cannot complete a capture: stale ACKs block startup, and an absent collector cannot supply the three new ACKs. Native will time out safely. These files coordinate local diagnostics; they are not an authentication mechanism against malicious local file writers.

## Verification results

From the repository root:

```powershell
& .\.venv\Scripts\python.exe -m unittest discover -s tests -p 'mt5*_test.py' -v
node --test
```

- Python: **69 tests passed, 0 failures** (29 paired-trace tests and 40 existing probe/timestamp tests).
- Application: **160 tests passed, 0 failures, 0 skipped**, including authentication, disabled execution configuration and other bot functionality.
- MetaEditor: final v1.03 source compiled using the installed `C:\Program Files\MetaTrader 5\MetaEditor64.exe`; **0 errors, 0 warnings**, x64 output exists (23,358 bytes).
- Compiler output and exact matching source/binary: `.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/build-final/`.
- Matching source and binary were copied to the origin-verified terminal data directory's `MQL5\Scripts` folder. Installed binary SHA-256: `3493F7B6FFB792526916BE9AC9404830EA77AAFAABDF41176D6EC9CB6FBDDCA6`. Previous installed source and binary are preserved under the audit folder's `installed-before/`.
- Historical evidence: all **89 hashable pre-existing files** in the local evidence snapshot and Common Files matched their before hashes. The open Experts log was checked separately with shared read access; all previously captured bytes were preserved. No previous evidence was removed or changed.
- All **8 authentication baseline files** still match `.local-data/demo-auth-baseline.json`. No application/authentication, execution configuration, timestamp conversion or quote-validation code was modified.

Machine-readable verification and evidence baselines are in `.local-data/ack-fix-15d7106971c645a3867cc54c6092e401/`. The first intermediate build and its compiler log were preserved separately rather than overwritten by final compilation.

## Next capture sequence — documented only, not run

Do not reuse any previous run ID. Both updated Python and native v1.03 must be used together. When a future capture is separately authorized, run this from the repository root:

```powershell
& .\.venv\Scripts\python.exe .\bridge\diagnostics\paired_mt5_trace.py --capture --launch-timeout 300
```

Wait for `Yosemite collector READY run_id=<actual-id>; set native input DiagnosticRunId=<actual-id>; ... protocol=YMT5-1; launch window=300 seconds; capture window=100 seconds after first frame`. Refresh Navigator → Scripts if necessary. Before that launch window expires, launch the updated native diagnostic once on the existing EURUSD chart and copy that exact ID into Inputs → DiagnosticRunId. Leave every trading permission disabled; do not approve any permissions prompt. If READY has expired or the collector has exited, stop and use a fresh ID on a future approved attempt.

Successful startup should show `collector_ready=PASS`, `TRACE_OPENED`, FRAME 0 and its exact expected ACK filename. Completion requires three native ACK messages and a native STOP reason `completed` with `acknowledged_frames=3`, plus Python's verified completion and three frames. The collector still exits with status 2 because release readiness remains blocked; this is intentional, even for a complete diagnostic capture.

No end-to-end native capture has been performed with this repair. Slow/erroring SDK operations can still exhaust the bounded protocol deadline and must remain failures. The approximately +7,200-second source-time discrepancy remains unresolved; quote freshness still uses the original 15-second-old/5-second-future limits with zero offset. A complete ACK handshake cannot establish UTC mapping or authorize trading.
