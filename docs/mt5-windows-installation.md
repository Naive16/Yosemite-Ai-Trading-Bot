# Windows MT5 installation status — 28 October 2026

## Current status

**Desktop installation and native MT5 demo identity are verified; the approved read-only probe remains blocked by quote freshness.** Both disabled terminal trading controls now pass native verification. The installed terminal is build 6291. The assistant did not accept software/broker agreements or approve elevation on the operator's behalf.

The desktop UI inspection tools did not respond during installation, so the checkbox states were initially operator-confirmed only. The first native attempt found external Python trading was not disabled. The operator corrected it, and later native checks confirmed Algo Trading disabled and external Python trading disabled. No automation permissions were enabled or changed by the assistant.

## Fresh coordinated capture IDs — 28 October 2026

**This section supersedes the fixed A/B launch instructions below.** Earlier evidence is preserved. No new capture or native script was launched during this fix, and no capture success is claimed.

### Confirmed collision

The previous collector's `main()` and native script both hard-coded **20261028-final-B**. There was no per-capture ID generator or input. The collector raised `diagnostic_run_files_already_exist` if **either** of these existed:

```text
C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\Common\Files\YosemiteTimeTrace-20261028-final-B.jsonl
C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\Common\Files\YosemiteTimeTraceAck-20261028-final-B.txt
```

Both existed: the native trace was **1,256 bytes**, ACK **3 bytes**. The preserved native completion marker says `complete=false`, `reason=stopped_while_waiting_for_ack`, `acknowledgedFrames=0`, `executionAllowed=false`. The user-reported Python capture contains one frame and `pairedCaptureComplete=false`; it is not a successful capture. Existing-file refusal was the intended preservation guard, not a reason to delete evidence or bypass checks.

The native script used `FILE_COMMON`, which resolves to MT5's shared **Terminal\Common\Files** sandbox. It did **not** read the Python project's `.local-data` report directory. Python derived that same Common\Files location from APPDATA; the earlier hard-coded filenames were the coordination mechanism.

### Small local fix

- Python now generates a fresh ID for every `--capture`: a UTC identifier plus UUID. This names the diagnostic only and changes no market timestamp. Optional `--run-id <fresh-id>` is supported; explicit reuse is rejected, never silently renamed or resumed.
- Native version **1.02** has a required **`DiagnosticRunId`** string input instead of a hard-coded ID. Its Inputs dialog is shown at launch. The operator copies exactly the ID from the collector's READY line. Blank, invalid, path-like or overlong IDs fail before file access. Both implementations accept only 1–64 ASCII letters/digits/hyphen/underscore, starting with a letter/digit.
- Native trace/ACK names remain `YosemiteTimeTrace-<id>.jsonl` and `YosemiteTimeTraceAck-<id>.txt` under **FILE_COMMON**. Python validates the directory against the SDK's `commondata_path\Files` **before READY**; a mismatch fails closed. Native OUTPUT logging prints its actual built-in Common directory and selected filenames.
- Each collector exclusively creates `YosemiteTimeTraceClaim-<id>.json` in Common\Files and a new local output directory. Existing trace, ACK, claim or output directory rejects the ID before SDK loading/connection. A claim remains after failure, so a failed/aborted run is not reused. Concurrent collectors cannot reserve the same ID.
- New reports and raw snapshots use **`.local-data/mt5-paired-runs/<id>/report.json`** and **`native.jsonl`**, with exclusive file creation. Legacy `mt5-paired-trace.json`, `mt5-paired-native.jsonl` and prior captures are not overwritten.
- Native pre-existing trace/ACK checks remain. Native trace opening now uses non-truncating `FILE_READ|FILE_WRITE`, read sharing only, and a non-empty-file check before writing. This avoids destroying existing evidence in a duplicate-launch race. See [official file-opening flag semantics](https://www.mql5.com/en/docs/constants/io_constants/fileflags). No automatic cleanup or overwrite was added.
- Completion still requires the native `complete=true` marker, **three native acknowledged frames**, expected sequences 0/1/2, final identity/safety validation and confirmed SDK shutdown. One frame or an absent/incomplete native completion marker cannot pass. `mappingValidated=false` and `executionAllowed=false` remain unconditional.

The input is a diagnostic correlation value, **not a trading permission**. Only the script's Inputs field should be populated; no permission box should be enabled and no permission prompt approved. See [official script input behavior](https://www.mql5.com/en/docs/basis/variables/inputvariables).

### Exact next launch sequence

From the project root, run:

```powershell
& .\.venv\Scripts\python.exe .\bridge\diagnostics\paired_mt5_trace.py --capture
```

Do not supply the old A/B run ID. The collector generates a new ID automatically. After native connection/account/common-directory/disabled-control checks pass, its implemented READY output has this format:

```text
Yosemite collector READY run_id=<generated-id>; set native input DiagnosticRunId=<same-generated-id>; directory=C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\Common\Files; waiting for native script (100 seconds). Launch once; keep trading disabled.
```

The actual runtime ID is printed twice from the same validated variable, not a hard-coded placeholder or value assumed by the native program. Tests use a newly generated ID through readiness, native-frame validation and report creation. No live READY message or new capture was produced during this change.

1. Wait for **READY**, then copy only the generated ID value.
2. Select the existing EURUSD chart. Refresh Navigator > Scripts if needed and launch **YosemiteTimestampReadOnly once**.
3. On **Inputs**, set **DiagnosticRunId** to exactly that copied value. Leave all permissions unchanged; keep Algo Trading OFF and external Python trading disabled. If a permission approval is requested, stop rather than approve it.
4. Start the diagnostic while the collector is still waiting (100-second bound unchanged). In Experts, confirm `Yosemite START run_id=<same-id>` and the matching Common directory/filenames, then frame/ACK messages.
5. The collector's final JSON identifies the actual `runId` and unique `reportPath`. Review that run's report and native completion/frame count. Do not infer success from advancing timestamps, an ACK alone or a successful build.

If a run fails, retain its files and run the same command again for a **new** ID. Do not reuse/delete an old run, modify a source constant, or recompile just to start another capture. No fresh ID was reserved in the real Common directory during this code-only fix; real capture starts only when the user runs the command.

### Validation and preservation

**59 project tests passed, zero failures**: the existing 40 plus 19 paired-diagnostic tests. Coverage includes unique generated IDs, native/Python input coordination, READY output, invalid IDs, existing trace/ACK/claim/output preservation, exclusive report creation, cross-workspace duplicate reservations, concurrent reservation races, Common directory mismatch, and refusal of partial/missing native completion. All tests use synthetic SDK data and temporary files.

The updated native source was compiled in the verified active terminal's Scripts directory using **MetaEditor64.exe 6291**: **0 errors, 0 warnings**, 1,628 ms. The installed source hash matches the workspace source. Verified EX5 path:

```text
C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Scripts\YosemiteTimestampReadOnly.ex5
```

Output: **20,820 bytes**, SHA-256 **9CED347F087945461590BC7FC970A8E013575B1F74808C3BE16CD0919E86558D**. Compiler exit code was 1; the explicit successful compiler result and generated artifact establish compilation. Previous diagnostic source/EX5 backups were retained under ignored `.local-data`.

All **eight** existing capture/trace/ACK/report files inventoried before the change remained present and SHA-256 identical afterward. Evidence: `.local-data/mt5-run-evidence-before.json` and `.local-data/mt5-unique-run-validation.json`. The existing A/B traces and the incomplete B report were neither deleted nor rewritten. No source quote timestamp, freshness limit (15 seconds old / 5 seconds future), clock/service, trading permission, production resource, deployment, database or GitHub state changed. No collector/native launch or execution implementation was performed. Quote freshness remains blocked.

## Silent-launch diagnosis and instrumentation — 28 October 2026

**The terminal logs support a user launch, followed by repeated existing-output refusals.** No new launch was performed by the assistant. The script does not create a window or chart drawing, so a successful entry can appear to do nothing on the chart. Its original normal path wrote a trace without startup/progress/timeout messages.

### Source entry point and prerequisites

The entry is `void OnStart()` in `bridge/diagnostics/YosemiteTimestampReadOnly.mq5`. There are **no input parameters** and no requested permission changes. It uses fixed EURUSD/GBPUSD/USDJPY symbols, the approved native demo account/server, and a shared diagnostic run ID.

Startup requires: outside Strategy Tester, terminal connected, Algo Trading **off**, native account trade mode DEMO, approved account, and server **MetaQuotes-Demo**. It exits immediately if any gate fails, if its run's trace or ACK file already exists, or if the diagnostic output file cannot be opened. During capture it stops for changed safety state, a stop/replacement request, missing collector acknowledgement, or diagnostic file-write failure. It never selects instruments or submits/modifies/deletes orders.

### Existing terminal evidence

Filtered snapshots of the actual Experts and Journal files contain:

- **Journal 17:11:07.059 CAT:** `YosemiteTimestampReadOnly` loaded successfully.
- **Journal 17:11:08.854 CAT:** script removed. The short first interval is not proof of a full ten-second ACK timeout; interruption/replacement or another unlogged stop condition remains possible.
- The script-generated native trace for run **20261028-final-A** contains exactly **one native frame (sequence 0)** and `done.complete=false`. There is **no ACK file**. Native tick calls in that frame returned success/error code 0, and `safeAfter=true`.
- **Experts**, starting **17:11:08.870 CAT**, repeatedly records **"Yosemite diagnostic refused: run output already exists."** Further matching refusals extend through **17:14:07.722 CAT**. Corresponding Journal load/removal pairs confirm immediate exits on those attempts.
- The diagnostic-specific log entries inspected contain no identified permission rejection. That is not proof that every possible terminal permission/error is absent.

Thus a missing/non-discoverable binary is not the current explanation. The trace and terminal logs establish that an earlier user attempt entered the script. No successful collector acknowledgement exchange is evidenced, and the leftover trace caused later attempts to exit at the overwrite guard. The exact original first shutdown reason was not logged, so it is not invented as a confirmed timeout. Repeated double-clicks are not a recovery procedure.

Experts messages are displayed under **Toolbox > Experts** and saved under the active data directory's `MQL5\Logs\YYYYMMDD.log`. Platform load/removal events are under **Toolbox > Journal** and `Logs\YYYYMMDD.log`. These are host-local log times (CAT here), not UTC quote timestamps. The native trace/ACK live under:

```text
C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\Common\Files
```

The old A trace was retained **unchanged both in place and as** `.local-data/mt5-user-launch-native-final-A.jsonl`, SHA-256 **448BBED3928073939C5AF4D3AA7571C64EA62972EFBFAF9842EE284B6277F50F**, 1,196 bytes. A filtered, credential-free log audit is `.local-data/mt5-launch-log-evidence.json`. This is a partial native trace, **not** a successful paired Python/native capture and not freshness or order-execution proof.

### Minimal instrumentation and a fresh diagnostic run

Native version **1.01** now logs:

- `Yosemite START run_id=...` and relative Common\Files output names.
- Each startup check as `Yosemite CHECK <name>=PASS/FAIL`, including existing-file checks; account identifiers/passwords are not printed.
- Successful output open, frame writes, ACK waits and received ACKs.
- A fixed shutdown reason: existing output, failed startup gate, failed file open/write, changed safety state, stop request, ACK timeout, incomplete frame count or completion.

The completion marker also requires **all three acknowledged frames**, safe final state and no stop request. Interrupted loops cannot report completion merely because the last safety check passed. Neither quote timestamps nor freshness limits were changed.

Both native script and Python collector now use fresh diagnostic run ID **`20261028-final-B`**, with `YosemiteTimeTrace-20261028-final-B.jsonl` and `YosemiteTimeTraceAck-20261028-final-B.txt`. This avoids overwriting/deleting the old A evidence. It is not a timezone adjustment. No B trace/ACK existed after preparation; the instrumented version was **not launched**.

The collector originally had **no startup/readiness output**; it printed its final JSON summary only after completion/failure. It now prints a readiness line only after SDK initialization, account/process/connection validation and both disabled terminal controls pass. Native entry does not itself require Python, but all three frames require Python's sequence acknowledgements within the unchanged approximately ten-second native wait. Without a ready collector the diagnostic cannot complete its paired capture.

### Verified build and exact next user action

The active data directory remains the SDK-verified profile **D0E8209F77C8CF37AD8BF550E51FF075**, separate from `C:\Program Files\MetaTrader 5`. The previous installed source/binary matched the recorded successful build before editing. The instrumented source was copied only to that diagnostic's existing source path and compiled using the associated **MetaEditor64.exe 6291**. No unrelated source/binary was overwritten; prior diagnostic source/EX5 backups are in ignored `.local-data`.

Compiler result: **0 errors, 0 warnings**, 1,060 ms, X64 Regular. Compiler process exit was 1; success is supported by its explicit result and output file. Active source and workspace source share SHA-256 **C316E8080620AB945A5A6056461EFD4225F1B028054F180685440A768492B487**. Verified compiled output:

```text
C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Scripts\YosemiteTimestampReadOnly.ex5
```

New EX5: **19,508 bytes**, SHA-256 **39DC7D144F0668990BF41C3BA6B8FAA468FBA11062CE6263D888F147D7AF4A09**. Build/hash/file-preservation evidence is `.local-data/mt5-script-startup-validation.json`.

When the user chooses to perform the next paired capture, from the project root run the **actual implemented command**:

```powershell
& .\.venv\Scripts\python.exe .\bridge\diagnostics\paired_mt5_trace.py --capture
```

Wait for this **expected implemented** readiness line (not a newly observed live result):

```text
Yosemite collector READY run_id=20261028-final-B; waiting for native script (100 seconds). Launch once; keep trading disabled.
```

Only after READY, select the existing EURUSD chart, right-click Navigator **Scripts > Refresh**, and launch **YosemiteTimestampReadOnly once**. Open Toolbox **Experts** to observe:

```text
Yosemite START run_id=20261028-final-B build=6291
Yosemite CHECK outside_strategy_tester=PASS
Yosemite CHECK terminal_connected=PASS
Yosemite CHECK algo_trading_off=PASS
Yosemite CHECK native_demo_account=PASS
Yosemite CHECK approved_account=PASS
Yosemite CHECK approved_server=PASS
Yosemite CHECK trace_file_absent=PASS
Yosemite CHECK ack_file_absent=PASS
Yosemite TRACE_OPENED run_id=20261028-final-B
Yosemite FRAME sequence=0 written; waiting for collector ACK (maximum 10 seconds)
```

The expected exchange continues with ACK messages, frames 1/2, and `Yosemite STOP reason=completed acknowledged_frames=3 executionAllowed=false`. These are success indicators for the diagnostic exchange only. A complete capture still does not resolve or waive UTC freshness. If READY never appears, a check fails, or any permission dialog appears, do not launch/relaunch or enable anything; retain the numeric/error messages. If waiting for ACK, do not double-click again and interrupt it. A failed run leaves diagnostic files deliberately; do not delete or overwrite them to force a pass.

### Validation and stop point

`.venv\Scripts\python.exe -m unittest discover -s tests -p mt5*_test.py -v`: **50 tests passed, zero failures**, including 10 paired diagnostic tests. The first static capability test incorrectly treated the word `ACK (` inside a log string as a function call; its scanner was corrected to exclude string literals, and all tests then passed. The read-only capability allowlist and disabled-control gates remain enforced.

No new script or collector was launched by the assistant during this task. Existing user-launch logs were inspected instead of performing another controlled launch. No trading permission, account setting, clock/service, production resource, database, deployment or GitHub change occurred. Work stopped after diagnosis, instrumentation, compilation and tests. Quote freshness remains blocked.

## Diagnostic discoverability confirmed — 28 October 2026

The operator requested **discoverability only**, with no diagnostic launch. The existing source and compiled file were found; neither was missing. A fresh official SDK metadata attachment to the exact running terminal confirmed the active data directory independently of the installation directory and matching `origin.txt`:

```text
Installation: C:\Program Files\MetaTrader 5
Data: C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075
Scripts: C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Scripts
```

The workspace source remains `bridge/diagnostics/YosemiteTimestampReadOnly.mq5`. Initially the installed source and binary exactly matched their workspace copies by SHA-256. Source inspection and capability tests found no order/permission APIs, external imports, DLLs or network calls. The script writes only its bounded local diagnostic trace and reads its acknowledgement file; it does not modify broker state.

The unchanged source was recompiled **directly in the active Scripts directory** using `C:\Program Files\MetaTrader 5\MetaEditor64.exe`, version 5.0.0.6291. Result: **0 errors, 0 warnings**, 766 ms, X64 Regular. MetaEditor's process exit code was 1; the explicit compiler result and generated output establish compilation success, not an assumed exit-code convention. No unrelated file was overwritten.

Verified compiled output:

```text
C:\Users\Francis\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Scripts\YosemiteTimestampReadOnly.ex5
```

Output size: **16,226 bytes**. SHA-256: **97AAA492EF3E511D633AA88B26C874F3B4FCDC03F5955960AEE370398207C676**. Source SHA-256 remained **5FFB1BCC164FE0948C98F698099F38CA8D0E12259E0266583E7A06B3EBF345DE**, matching the workspace source. The compiler log is beside the active source, `YosemiteTimestampReadOnly.log`.

Navigator initially showed Scripts/Examples but not this diagnostic. After the in-place compilation and **right-click Scripts > Refresh**, the operator explicitly confirmed **"Visible; not launched"**. It appears directly under **Scripts**, outside **Examples**. Visibility is therefore confirmed by the operator, separately from filesystem/compiler verification; no success was inferred merely from the compiled file.

The metadata check reported `connected=true`, `trade_allowed=false`, `tradeapi_disabled=true`, build 6291, and confirmed SDK shutdown. No account credential was read or printed. This newer successful metadata attachment supersedes the prior authorization failure as an observation of attachment capability; it is not a new paired trace or account-classification check. The existing timestamp/freshness blocker remains unresolved.

Exact relevant validation: `.venv\Scripts\python.exe -m unittest discover -s tests -p mt5_paired_trace_test.py -v` — **8 tests passed, zero failures**. No source correction was needed. Evidence is saved in ignored `.local-data/mt5-script-directory-check.json` and `.local-data/mt5-script-discoverability.json`.

For a later paired capture, have the Python collector waiting first, select the existing **EURUSD** chart, open Navigator with **Ctrl+N** if hidden, right-click **Scripts > Refresh**, collapse **Examples** if necessary, and double-click **YosemiteTimestampReadOnly** directly under Scripts. Leave Algo Trading off and external Python trading disabled. If any permission dialog appears, do not enable permissions; report it. These are future instructions only: **the assistant did not launch the script or collector in this discoverability task**. No diagnostic native trace file was present at verification. No account/terminal settings, clocks/services, production resources, database or GitHub were changed. Work stopped after visibility confirmation.

## Final paired-trace preparation and runtime blocker — 28 October 2026

**A paired native MQL5/Python runtime trace has not yet been captured.** The native script and Python collector are implemented and tested, and native compilation succeeded, but runtime collection stopped before any paired frames. The earlier 20-PASS/1-FAIL results below remain historical observations, not a new paired result. The unresolved UTC mapping and quote-freshness release blocker remain unchanged.

### Official timestamp contract, checked 28 October 2026

Only current official documentation was used for the contract review. Short quoted fragments below are exact; the accompanying descriptions record scope and qualifications. No forum, inferred offset or matching minute boundary was accepted as authority.

| Official source | Exact relevant wording and documented scope |
| --- | --- |
| [MqlTick](https://www.mql5.com/en/docs/constants/structures/mqltick) | `time`: **"Time of the last prices update"**; `time_msc`: **"Time of a price last update in milliseconds"**. The struct page itself does not state a UTC timezone conversion rule. |
| [SymbolInfoTick](https://www.mql5.com/en/docs/marketinformation/symbolinfotick) | Fills MqlTick with **"current prices and time of the last price update"**. Returns true/false; failure is not a valid tick. The page itself specifies no separate UTC conversion. |
| [TimeLocal](https://www.mql5.com/en/docs/dateandtime/timelocal) | **"Returns the local time of a computer"** where the terminal runs. This is host-local time, not an independently obtained UTC reference. In the strategy tester it equals simulated TimeCurrent. |
| [TimeCurrent](https://www.mql5.com/en/docs/dateandtime/timecurrent) | **"The time value is formed on a trade server"**. It is the last known server/last quote time; outside OnTick it can come from any selected Market Watch symbol. It does not depend on PC time settings. This describes server time, not a broker-to-UTC conversion contract. |
| [TimeGMT](https://www.mql5.com/en/docs/dateandtime/timegmt) | **"Returns the GMT"**, calculated using the terminal computer's local time and DST handling. It is host-calculated, not network-authoritative time. In the strategy tester it equals simulated TimeTradeServer, so the diagnostic rejects the tester. |
| [TimeTradeServer](https://www.mql5.com/en/docs/dateandtime/timetradeserver) | Returns **"calculated current time of the trade server"**. Calculation is in the client terminal and depends on PC time settings. It is an estimate, not an independent UTC authority. |
| [Python symbol_info_tick](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfotick_py) | **"Get the last tick for the specified financial instrument."** Returns a tuple or None; the page points to SymbolInfoTick and last_error. It has no standalone explicit UTC-conversion statement. |
| [Python copy_ticks_from](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksfrom_py) | **"Data received from the MetaTrader 5 terminal has UTC time."** The input may be a datetime or seconds since 1970; datetime inputs should be UTC. Returned ticks are a named NumPy array, or None on error. This explicit UTC statement is the unresolved contract question for the observed raw epochs. |
| [Python copy_rates_from_pos](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrompos_py) | **"Thus, the zero bar means the current one."** Returns named NumPy bars or None; available history depends on MaxBars. Its own page does not independently specify a UTC conversion rule. [MqlRates](https://www.mql5.com/en/docs/constants/structures/mqlrates) calls `time` **"Period start time"**; it is not quote-update time. The separate [copy_rates_from](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrom_py) page explicitly describes UTC data. |

The [official local/server-time explanation](https://www.mql5.com/en/book/common/timing/timing_local_server) describes Market Watch's last known server clock and server-time chart history. Those formatted labels are separate from a documented UTC-epoch guarantee. [Journal time](https://www.metatrader5.com/en/terminal/help/start_advanced/journal) uses the PC timezone. Neither display can independently validate source quote freshness.

### Prepared paired trace and safety design

Native source: `bridge/diagnostics/YosemiteTimestampReadOnly.mq5`. Python source: `bridge/diagnostics/paired_mt5_trace.py`. A copy of the native source and compiled binary was placed in the approved terminal profile's `MQL5\Scripts` directory; the workspace binary is kept under ignored `.local-data`. No existing script was overwritten and no production/application configuration was changed.

The native program is a bounded **script**, not a persistent EA. It has no trading APIs, external includes/imports, DLLs, network calls or permission setters. It refuses a tester, disconnected terminal, enabled Algo Trading, non-demo account, wrong server or changed approved account. It writes three frames for EURUSD/GBPUSD/USDJPY, each containing raw TimeLocal/TimeGMT/TimeCurrent/TimeTradeServer, native SymbolInfoTick seconds/milliseconds/bid/ask, native counter brackets, status and numeric errors. It waits for Python acknowledgement between frames, then exits. Existing run files cause refusal rather than overwrite. No program or global trading permission is enabled.

The Python collector validates the exact running process and native account/connection/disabled controls, including `tradeapi_disabled=true`, before and after each data observation. Initialization supplies only path/timeout/portable settings, without credentials. It records host-aware UTC immediately before/after each call and independent HTTPS UTC before/after capture. The shared-file handshake identifies native frames; it does not claim that two separate API calls are atomic.

For each native row the collector records Python live ticks plus two `copy_ticks_range` queries, both with explicitly UTC-aware datetimes:

1. The actual host-UTC five-second window, without shifting its time basis.
2. A small window around the **unchanged native raw epoch interpreted as UTC**, labelled a raw-domain consistency query. This does not subtract an offset, assert that the native value is UTC, or validate freshness. An exact native tick match checks milliseconds and bid/ask, rather than assuming equal live values across sequential calls.

Raw integers and host ISO UTC fields stay separate. History results are whitelisted/bounded to 200 rows, with availability, truncation and numeric SDK error codes recorded. Missing or failed data is not converted to success. `mappingValidated=false`, `executionAllowed=false` and blocked readiness remain unconditional.

The [official OnTick documentation](https://www.mql5.com/en/docs/event_handlers/ontick) distinguishes event processing from permission to send trade requests. That distinction does not authorize enabling anything here. If MT5 requests any security/trading permission for launch, the diagnostic must stop rather than change it.

### What actually happened

- MetaEditor 6291 compiled the script with **0 errors, 0 warnings**, producing an EX5 file. Its process exit code was 1; success was established from the compiler result and generated artifact, not an assumed exit-code convention. This is compilation evidence only.
- Windows Computer Use could inspect Navigator but could not complete launch: errors included unavailable coordinate geometry, a minimized window, and detected user input. A manual launch handoff was requested; **no native trace file/frames were observed** as of this report.
- The first Python collector recorded `running_terminal_changed` before paired data. That is a process-guard verification failure, not proof that the process was actually restarted. A subsequent read-only process inventory still showed the expected executable running/responding.
- Later initialization attempts returned **`-6 / RES_E_AUTH_FAILED`** before account or tick collection. The installed official SDK and [official last_error reference](https://www.mql5.com/en/docs/python_metatrader5/mt5lasterror_py) define -6 as authorization failed. No password or broker error string was printed. A fresh independent HTTPS UTC reference was also unavailable during the latest attempt; historical successful references were not relabeled as current.
- Each failed collector confirmed SDK shutdown, retained blocked readiness and produced **zero paired frames**. Failure records are under `.local-data/mt5-paired-launch-attempt.json`, `mt5-paired-initialize-refused.json` and the latest `mt5-paired-trace.json`. Their evidence source explicitly states no paired frames. No native GMT/current-time values or historical tick results are claimed from these failed attempts.

The operator was asked to privately verify that MT5 is connected to the existing intended MetaQuotes-Demo demo account and to locate/run the compiled read-only script with all trading permissions still disabled. No password is requested in chat. Until that succeeds, current account/connection state cannot be reverified from the failed SDK initialization. The prior disabled-control observations remain historical; the assistant changed no controls.

### Proven, plausible and unresolved

| Question | Current conclusion |
| --- | --- |
| Is Yosemite applying a local-time relabel or guessed offset? | No, based on reviewed source, previous raw captures and regression tests. No timestamp correction was introduced. |
| Do prior ticks, symbol metadata, bars and display support a shared time-domain issue? | Yes, the preserved earlier observations support that hypothesis; they do not establish a conversion contract. |
| Do native MQL5 and Python expose identical raw epochs? | **Not yet established by a paired native trace.** Matching Python data paths are insufficient. |
| Does native TimeCurrent differ from TimeGMT by the observed amount? | **Not measured yet.** No inferred value is inserted into the trace. |
| Does historical tick retrieval match native/live data in the same raw domain? | **Not measured yet.** The UTC-aware queries and exact-match analysis are implemented/tested but have not produced real paired output. |
| Is an absolute UTC freshness check safe to retain? | **Retain it as a fail-closed release gate**, including 15 seconds old / 5 seconds future. Its rejection is safe; interpreting these source epochs as verified UTC for accepting an order is not established. Do not substitute receipt time or infer a mapping from observed advancement. |
| Can a fixed two-hour correction be deployed? | No. No documented independently validated conversion rule or vendor response supports one. |

### Reproduction, remaining blocker and support enquiry

The paired sources use run ID `20261028-final-A` and diagnostic-only shared files `YosemiteTimeTrace-20261028-final-A.jsonl` and `YosemiteTimeTraceAck-20261028-final-A.txt` under the terminal Common\Files sandbox. They refuse existing run files. For a fresh run, preserve prior diagnostic files and use a new matching run ID in both sources before compiling; never delete/overwrite unknown terminal files. These files are diagnostic synchronization only, not execution intents.

Once the account is privately connected with unchanged safety controls:

```powershell
& .venv\Scripts\python.exe bridge\diagnostics\paired_mt5_trace.py --capture
```

While that bounded collector waits, run **Navigator > Scripts > YosemiteTimestampReadOnly** on the existing chart. Do not enable Algo Trading, Python trading, DLLs or other permissions. The collector writes `.local-data/mt5-paired-trace.json` and, only if present, a copy of the actual native JSONL. Exit 2 always means this diagnostic does not clear release readiness. If native launch/authorization fails, preserve the error and stop; do not replace missing native data with expected values.

A concise **unsent** support enquiry with the existing raw sample, exact contract question and minimal reproduction logic is prepared in `.local-data/metaquotes-timestamp-support-enquiry.txt`. The precise question is whether these fields are UTC Unix epochs or server-wall-time values for this server/build/SDK, and, if not UTC, what authoritative timezone/DST/history mapping and supported API establish a safe conversion without deriving an offset from receipt time. If UTC is the contract, MetaQuotes must clarify whether this is a source/terminal/SDK defect and its supported fix. No support response has been received or implied.

### Exact local validation results

`python -m unittest discover -s tests -p 'mt5*_test.py' -v` in the project `.venv`: **48 tests passed** (40 prior tests plus 8 paired-trace tests). The prior standalone suite `.local-data/test_mt5_native_time_repro.py -v` also passed **11/11**, for **59 passing tests total**, zero failures. Paired tests cover native-code capability restrictions, strict safety/identity gates, UTC-aware history inputs, unchanged raw timestamps, future rejection, sequence/connection changes, numeric error redaction and shutdown failure. Compilation: **0 errors / 0 warnings**. Authentication-foundation hashes remained unchanged. The offline application preflight still reports every Yosemite execution switch disabled. These tests and the successful build do not establish actual paired runtime or broker execution.

Stop point: paired runtime is blocked pending local terminal authorization/launch; timestamp mapping remains unresolved. No order, permission enablement, clock/service change, production write, deployment, GitHub push, remote database modification or execution implementation was performed.

## Extended native time-basis investigation — 28 October 2026

**The discrepancy is consistent across three symbols and three native API paths. Server-wall-time encoding is supported by the observations, but the exact server/terminal/SDK UTC conversion contract remains unresolved. Freshness remains a release blocker.** The existing investigation and raw artifacts were read before adding this investigation. No project configuration or existing probe implementation was changed in this phase.

### Versions and official semantics

The executable remains `C:\Program Files\MetaTrader 5\terminal64.exe`, product/file version **5.0.0.6291**, with **Valid** MetaQuotes Ltd. Authenticode signature. Native `version()` returned **`(500, 6291, '28 Oct 2026')`**; its third item is a build release date, not the current server clock. The isolated project environment remains **Python 3.11.9 x64**, official **MetaTrader5 5.0.6231**. Package and terminal versions are separate observations; their differing numbers do not establish a compatibility bug.

| Source | Meaning and limitation |
| --- | --- |
| `symbol_info_tick().time`, `.time_msc` | Last price-update time in seconds/milliseconds; preserve both native integers. See [MqlTick](https://www.mql5.com/en/docs/constants/structures/mqltick). |
| `symbol_info().time` | Last quote time. The installed Python structure had no `time_msc` field in any observation; absence was recorded without synthesizing it. See [symbol properties](https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants) and [Python symbol information](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfo_py). |
| `copy_rates_from_pos(symbol, TIMEFRAME_M1, 0, 3)` | Requests the current bar and preceding bars. `time` is **bar-open time**, not last-tick/receipt time; it must not be assessed using the 15-second tick limit. See [position-based rates](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrompos_py) and [MqlRates](https://www.mql5.com/en/docs/constants/structures/mqlrates). |
| Market Watch title and chart axis | Last known **server time**, driven by received ticks; historical chart times use server time. They are not independent UTC clocks. See [official local/server-time explanation](https://www.mql5.com/en/book/common/timing/timing_local_server). |
| Journal timestamps | The user's **computer timezone**, not an independent server/UTC clock. See [platform logs](https://www.metatrader5.com/en/terminal/help/start_advanced/journal). |
| `terminal_info()` | Connection/settings/build and diagnostics such as ping/retransmission; no independently trusted current-server-UTC clock. See [terminal information](https://www.mql5.com/en/docs/python_metatrader5/mt5terminalinfo_py). |

The official Python [rates](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrom_py) and [ticks](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksfrom_py) references describe returned timestamps as UTC without a shift. Native/server-display documentation describes server time. No current authoritative **MetaQuotes-Demo** offset/DST policy resolving the observed Python values was established. Historical/community offset statements were not adopted as a conversion rule.

### Standalone reproduction and captures

A standalone, offline-by-default reproduction was created at ignored `.local-data/mt5-native-time-repro.py`. It imports only Python standard-library modules plus the installed official SDK in the explicitly requested read-only branch; it imports no project configuration or probe conversion code. It pins the already running executable/process and approved observed account, requires native DEMO plus both disabled terminal controls, and rechecks them before and after each observation. Initialization supplies only the terminal path, timeout and portable-mode setting, without credentials or a login call. No instrument is selected. The script always exits 2 and leaves release readiness blocked.

The approved run used three observations, with five-second pauses plus validation overhead, across already visible **EURUSD, GBPUSD and USDJPY**. Each SDK data call has before/after UTC Unix captures and a monotonic duration. Three API paths were collected: tick, symbol information and three M1 bars. These are **distinct paths sharing one terminal/feed**, not independent time authorities.

First observation examples (native numbers are unmodified):

| Symbol | Host UTC capture | Raw tick seconds | Raw tick milliseconds | Raw newest M1 open |
| --- | --- | --- | --- | --- |
| EURUSD | 12:56:40.439290 | `1793199397` | `1793199397658` | `1793199360` |
| GBPUSD | 12:56:40.450922 | `1793199398` | `1793199398964` | `1793199360` |
| USDJPY | 12:56:40.706396 | `1793199400` | `1793199400159` | `1793199360` |

All nine tick observations had consistent native seconds/milliseconds. All nine `symbol_info.time` values matched the corresponding tick seconds in these captures; sequential reads are not generally guaranteed to match exactly. All returned M1 opens were minute-aligned; the raw arrays were `[1793199240, 1793199300, 1793199360]`, corresponding to **14:54, 14:55 and 14:56 only when those raw values are interpreted as UTC**. The newest open matched the tick's native minute in all nine cases. Its bar time remained unchanged during the same minute, which is expected and not a stale-bar finding.

Across captures at **12:56:40–12:56:54 UTC**, native tick milliseconds divided by 1000 were **7197.219–7199.562 seconds ahead of host UTC**. The newest M1 opens were **7145.283–7159.560 seconds ahead**, with the smaller difference explained by bar-open semantics. EURUSD tick time advanced **16.130 seconds** over **14.278 seconds** of host elapsed time; GBPUSD advanced **14.695/14.266**, USDJPY **14.120/14.011**. Different first/last tick ages explain these differences; advancing values alone do not prove freshness or validate an offset.

TLS-verified, cache-busted Google HTTPS Date references before/after the native run returned **12:56:37 GMT** and **12:56:56 GMT** (Unix **1793192197** and **1793192216**), agreeing with host UTC within one-second header precision and approximately **0.44/0.41-second** request timing. No receipt timestamp was substituted for source quote time.

### Terminal display, connectivity and logs

Computer Use successfully captured MT5's Market Watch clock at **14:52:56–57**, bracketed by host UTC **12:52:54.965–12:52:58.447**. The EURUSD M5 chart's rightmost visible axis label was **28 Oct 14:50**. These are server-time display observations, not UTC assertions or a validated UTC offset. One UI observation succeeded; later recaptures were unavailable because of minimized-window/user-input state, and no trading-control input was sent.

Native diagnostics remained `connected=true`, `trade_allowed=false`, `tradeapi_disabled=true` before/after all observations. The captured raw diagnostics included `ping_last=249170`, `retransmission=0.2501434308663224`, `maxbars=100000`. Final process/account identity validation and SDK shutdown passed. These establish observed connectivity and safe controls, not quote freshness.

The approved profile's daily log was inspected through a read-only shared stream. Its stable snapshot was **17,790 bytes, 90 nonempty lines**, SHA-256 **`5962196bdbd2f88967441cfd69a86aac5a542eca24d3a80d92b2fa3d59a42630`**. Only fixed classifications/times and metadata were saved; arbitrary log messages, credentials, account identifiers and IP addresses were excluded.

The log showed connection losses at host-local **14:17:30.043**, **14:21:24.535**, **14:22:06.705**, then authorization at **14:23:04.095** and quote synchronization at **14:23:05.044**. Startup records identified builds 6230/6291 and Windows **GMT+2**; that is host-zone information, not a server-offset contract. No narrowly searched stale/invalid-tick, history, Python/IPC or clock-correction indicators were found. Log records end before the native observations, so absence of newer errors cannot prove current connectivity or freshness. A separate non-Network timeout was not misclassified as a broker connection failure.

Windows timezone/service state was reread at **13:00:31 UTC / 15:00:31 CAT**: South Africa Standard Time (UTC+02:00), Windows Time **Stopped / Manual**. No clock, timezone, service or security setting was changed. Fresh independent HTTPS observations and the earlier read-only NTP measurement do not establish ongoing service synchronization.

### Hypotheses and release decision

| Hypothesis | Evidence-based assessment |
| --- | --- |
| Yosemite's local-time formatting or UTC labeling caused the two hours | **Ruled out for these captures:** raw integers and the standalone script already contain the discrepancy; existing aware conversions/direct subtraction agree. |
| Host clock is two hours wrong | **Contradicted:** independent HTTPS UTC and earlier NTP measurements agree closely with host UTC. |
| Only EURUSD or one tick API is affected | **Not supported:** three symbols, symbol metadata and M1 bars use consistent native time labels. |
| One permanently frozen tick explains the observation | **Not sufficient:** tick values advance across all three symbols and the discrepancy persists through the later final probe. Advancement is not freshness proof. |
| An active connectivity failure alone explains the offset | **Not supported during captures:** native connectivity and data calls passed, earlier logged losses recovered. Other delays/staleness can still coexist. |
| A common server-wall-time domain is being represented in native epoch fields | **Supported, not established as a safe conversion contract:** UI/server labels, ticks, metadata and bar minutes align approximately two hours ahead of UTC. |
| Server source, terminal translation or shared SDK encoding is responsible | **Unresolved:** the API paths share the terminal/feed; a paired non-Python native trace or vendor clarification is needed to separate them. |
| A fixed two-hour correction is safe, including DST/restarts/history | **Unverified and prohibited:** no authoritative current offset/effective-date contract or source fix was obtained. |

The final existing probe rerun at **12:58:42.395596 UTC / 14:58:42 CAT** again passed **20/21 checks**, with only `quoteFresh=FAIL` and none skipped. Raw EURUSD time was **1793199520**, milliseconds **1793199520041**; host Unix time **1793192322.395596**, giving age **-7197.645404 seconds**. Native demo identity, both disabled terminal controls, final identity and SDK shutdown passed. The 15-second age and 5-second future bounds remain unchanged; release and order execution remain blocked.

Additional evidence needed before any source-time correction:

1. A current MetaQuotes statement for **MetaQuotes-Demo**, terminal build **6291** and Python SDK **5.0.6231** specifying whether raw tick/bar values represent UTC Unix epochs or server-wall-time values; if the latter, a reliable timezone/DST/effective-date mapping and supported way to obtain it.
2. Confirmation of any known server/terminal/SDK timestamp issue and its upstream fix. An empirical offset or a matching screen label is insufficient.
3. If ambiguity remains, a paired native MQL5 diagnostic trace of `SymbolInfoTick`, `CopyRates`, `TimeCurrent` and `TimeGMT`, captured beside Python raw values and an independent UTC reference. `TimeTradeServer` must be labeled as a client-calculated estimate. No new MQL code or EA was installed/run in this investigation.

### Artifacts and verification

All raw/derived diagnostic artifacts remain under ignored `.local-data/`: `mt5-native-time-repro.py`, `mt5-native-time-repro.json`, `mt5-multipath-summary.json`, `mt5-display-time-observation.json`, `mt5-terminal-log-audit.json`, `mt5-current-windows-time-state.json`, and `mt5-read-only-multipath-final.json`. Prior investigation artifacts were preserved. No passwords or tokens are present in the saved whitelisted outputs.

Reproduction commands from the project root (the connection command remains subject to explicit approval for that run):

```powershell
& .venv\Scripts\python.exe .local-data\mt5-native-time-repro.py --read-only
& .venv\Scripts\python.exe -m unittest discover -s tests -p 'mt5*probe_test.py' -v
& .venv\Scripts\python.exe .local-data\test_mt5_native_time_repro.py -v
```

All **40 project probe tests** and **11 standalone safety/diagnostic tests** passed. Eight authentication-foundation files matched their existing hashes. The offline application preflight still shows every execution switch disabled. The standalone/native capture is real SDK evidence; the unit tests remain synthetic and do not prove broker execution. No orders/order checks, permission enablement, project configuration changes, production writes, deployment or GitHub push occurred. **MetaQuotes-Demo remains the intended server; no separate broker's demo account is verified by this evidence.**

## First approved native read-only attempt — 28 October 2026 (historical)

The operator explicitly approved a current-account read-only connection and checking exact `EURUSD` availability, with no fallback instrument selection. The existing probe now supports `--inspect-running-read-only`, using the installed terminal and the project's Python environment without reading or supplying login credentials. It does not create a broker/execution allowlist or change any terminal or application setting.

The first native attempt at approximately **12:27 UTC** returned:

| Check | Result |
| --- | --- |
| Exact running terminal process, native SDK initialization, installation path | PASS |
| Native terminal broker connection (`connected=true`) | PASS |
| Algo Trading disabled (`trade_allowed=false`) | PASS |
| External Python trading disabled | **FAIL**: `tradeapi_disabled=false` |
| Account login/server/currency/balance/equity/free margin/permissions | NOT_RUN after safety failure |
| Native demo classification | NOT_RUN; unverified |
| Market Watch forex catalogue, exact EURUSD, candidates, quotes/tick values | NOT_RUN after safety failure |
| Final account/process identity recheck | NOT_RUN |
| SDK shutdown | PASS |

The connected native terminal reported **build 6291**. A fresh executable check verified product/file version **5.0.0.6291**, with a **Valid** MetaQuotes Ltd. Authenticode signature, at `C:\Program Files\MetaTrader 5\terminal64.exe`. The build 6230 file details below record the earlier installation verification, not the updated executable's current version/hash.

`readOnlyProbeSucceeded=false`, `nativeDemoAccountVerified=false`, `executionAllowed=false`, `actualBrokerOrderExecuted=false`; error code `read_only_probe_requires_external_python_trading_disabled`. No account financial data, password or token was collected or stored by this attempt. The native probe made no order, order-check, modification, close, instrument-selection or account-login call.

The operator subsequently confirmed checking **Disable automated trading via external Python API**, leaving **Allow algorithmic trading** unchecked, and clicking OK. The later attempts below independently verified the corrected state.

The fresh JavaScript regression suite passed **160/160** tests, including authentication and disabled execution controls. All **28/28** synthetic Python probe tests passed, including the original 14 tests. Synthetic tests remain separate from native broker evidence.

## Earlier approved native snapshot — 28 October 2026, 14:36 CAT

Two subsequent read-only attempts passed **20 of 21 checks**, with no checks skipped. The most recent capture was `2026-10-28T12:36:00.152505Z` (14:36:00 CAT). The complete whitelisted snapshot, including requested account identifiers and financial values, is kept in ignored `.local-data/mt5-read-only-latest.json`, outside tracked documentation. No password, token or account-holder name is included.

| Check | Latest result |
| --- | --- |
| Exact running terminal, SDK initialization, terminal path and broker connection | PASS |
| Algo Trading disabled; external Python trading disabled | PASS; native values `trade_allowed=false`, `tradeapi_disabled=true` |
| Account available, login/server identity and requested account fields | PASS |
| Native demo classification | PASS; native integer `account_info.trade_mode == ACCOUNT_TRADE_MODE_DEMO (0)` |
| Market Watch catalogue and explicit symbol input | PASS |
| Exact EURUSD available and visible | PASS |
| Valid positive bid/ask; observed spread | PASS; latest bid 1.11336, ask 1.11337, spread approximately 0.00001 (1 point) |
| Tick size and tick values | PASS; size 0.00001; value/profit/loss values each 1.0 in account currency |
| Quote freshness | **FAIL**; native epoch interpreted as UTC gives `2026-10-28T14:35:58.515Z`, approximately 7198.36 seconds ahead of capture UTC |
| Final account/process identity and safety-state recheck | PASS |
| SDK shutdown | PASS |

The connected account reports server **MetaQuotes-Demo**, currency **USD**, and both account-level trading permissions true. Those account permissions do not override the disabled terminal controls or authorize Yosemite execution. Native demo identity is verified independently of quote freshness. This is a MetaQuotes demo-server connection; a chosen third-party broker's demo account has not been established or verified. MetaQuotes states it is a software company and does not provide brokerage services in its [account-opening help](https://www.metatrader5.com/en/terminal/help/startworking/acc_open).

Visible native forex instruments were **AUDUSD, EURUSD, GBPUSD, NZDUSD, USDCAD, USDCHF, USDCNH, USDJPY, USDSEK**. The returned EUR-base/USD-profit forex candidate list contains exactly **EURUSD**, already visible; no suffix candidate or replacement instrument was selected. Discovery is not approval of an execution mapping.

The future-timestamp discrepancy persisted while prices/ticks advanced between captures. Windows UTC agreed with the independent clock tool to approximately one second; Windows local time was UTC+02:00. A read-only `w32tm /query /status` failed because the Windows Time service was not started, so synchronization status was not established. No clock, timezone, service or security setting was changed.

MetaQuotes' [Python tick documentation](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksfrom_py) describes terminal tick timestamps as UTC without a shift. The observation does not establish why this feed differs by approximately two hours. No guessed offset was subtracted and the freshness tolerance remains unchanged (maximum age 15 seconds; future tolerance 5 seconds). Verify the clock synchronization and terminal/server timestamp basis before treating any quote as fresh.

Latest flags: `nativeDemoAccountVerified=true`, `readOnlyProbeSucceeded=false`, `executionAllowed=false`, `actualBrokerOrderExecuted=false`, `releaseReadiness=blocked`. No orders, broker order preflight, instrument selection, account login call, remote writes, deployment or GitHub push occurred. The offline application inventory still confirms every Yosemite execution switch disabled; it does not ingest this native snapshot as a release capability.

## Earlier timestamp investigation — 28 October 2026, 14:45 CAT

The operator explicitly confirmed **MetaQuotes-Demo is the intended demo server**. The observed server matches it. This does not verify a separate broker's demo account and does not approve any account binding or order.

**No local-time-to-UTC conversion bug was found.** Both original probe branches used `datetime.fromtimestamp(time_msc / 1000, timezone.utc)`, an aware `datetime.now(timezone.utc)` clock, and aware UTC subtraction after the final identity recheck. No local `fromtimestamp` followed by UTC relabeling was present. PowerShell's `ConvertFrom-Json` can display an ISO instant in local `+02:00`; the underlying Unix instant and original JSON remain unchanged.

The probe now retains both raw fields, verifies `time_msc // 1000 == time`, preserves milliseconds through integer division/remainder, and reports direct Unix ages alongside the UTC datetime age. Missing, inconsistent, invalid or out-of-range native fields fail without falling back to another unit. No timezone offset is inferred or applied. The existing **15-second maximum age and 5-second future tolerance are unchanged**.

The final approved native rerun captured these values:

| Evidence | Value |
| --- | --- |
| Raw native `tick.time` | `1793198746` |
| Raw native `tick.time_msc` | `1793198746552` |
| Raw milliseconds divided by 1000 | `1793198746.552` |
| Raw units consistent | `1793198746552 // 1000 == 1793198746` |
| `datetime.now(timezone.utc)` at final capture, Unix seconds | `1793191548.987370` |
| Capture UTC | `2026-10-28T12:45:48.987370Z` |
| Native epoch interpreted as UTC | `2026-10-28T14:45:46.552Z` |
| Direct Unix age, seconds field | `-7197.012630` seconds |
| Direct Unix age, milliseconds field | `-7197.564630` seconds |
| Aware UTC datetime age | `-7197.564630` seconds |
| Offset applied | `0` seconds |
| Final freshness | **FAIL**, `quote_timestamp_in_future` |

The raw native numbers are already approximately two hours ahead of Unix UTC before any formatting. This rules out the probe's formatting as the cause. It does **not** establish whether the terminal/server/SDK encoded server wall time, supplied an incorrect epoch, or has another upstream issue. No current authoritative MetaQuotes-Demo offset/DST contract was established, so subtracting two hours would mask the unresolved source-time issue.

Independent time verification:

- TLS-verified, cache-busted HTTPS HEAD requests to Google's `https://www.google.com/generate_204` returned Date headers **12:45:46 GMT** and **12:45:49 GMT**, Unix seconds **1793191546** and **1793191549**. They bracket the native capture. Requests took approximately **0.45** and **0.44** seconds; HTTP Date precision is one second. Host and remote UTC agree within this precision/request timing. A Cloudflare reference request was unavailable and was explicitly excluded rather than fabricated.
- A read-only `w32tm /stripchart /computer:time.windows.com /samples:2 /period:1 /dataonly` succeeded at approximately 14:44:58–59 CAT, with reported offsets **-0.3089823** and **-0.3040586** seconds. The host is not two hours out relative to that independent NTP source. This is a measurement, not clock synchronization.
- Windows timezone is **South Africa Standard Time**, UTC+02:00, consistent with the operator's current Africa/Blantyre local offset. Windows Time is **Stopped**, start type **Manual**, configured type **NTP**, server **time.windows.com,0x9**. Service-based synchronization history could not be queried while stopped. No service, system clock, timezone or registry setting was changed.

Official sources require care: [Python tick documentation](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksfrom_py) describes UTC tick timestamps, whereas [Market Watch help](https://www.metatrader5.com/en/terminal/help/trading/market_watch) describes its displayed last-quote time in the trading server's timezone. [Symbol properties](https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants) defines native milliseconds since 1970. These descriptions do not establish a safe current offset for this Python feed. The next prerequisite is an authoritative server/SDK timestamp basis or upstream correction, followed by another approved native check. Do not alter the clock or widen freshness thresholds to force a pass.

All final native checks are listed here; none was skipped:

| Check | Result |
| --- | --- |
| runningTerminal | PASS |
| sdkInitialized | PASS |
| terminalPath | PASS |
| terminalConnected | PASS |
| algoTradingDisabled | PASS |
| externalPythonTradingDisabled | PASS |
| accountAvailable | PASS |
| accountIdentity | PASS |
| demoClassification | PASS |
| accountFields | PASS |
| marketWatchSymbols | PASS |
| symbolSpecified | PASS |
| symbolAvailable | PASS |
| symbolVisible | PASS |
| quoteValid | PASS |
| quoteFresh | **FAIL** |
| tickSize | PASS |
| tickValue | PASS |
| spreadObserved | PASS |
| terminalAndAccountStable | PASS |
| sdkShutdown | PASS |

The full whitelisted native snapshot is in ignored `.local-data/mt5-read-only-latest.json`; raw comparisons and independent HTTP references are in `.local-data/mt5-utc-investigation.json`. They contain no passwords/tokens. All **40 Python probe tests pass**: the original 28 plus 12 timestamp regressions covering UTC+2, UTC seconds, milliseconds/precision, inconsistent units, invalid timestamps, actual future timestamps and unchanged limits. Synthetic tests are not broker execution evidence.

The native demo identity remains verified while the overall probe fails closed. Account financial fields and symbol checks passed. All Yosemite execution switches remain disabled, no trading permission was enabled, and no order/preflight, production configuration, deployment, database change or GitHub push occurred.

The computer is Windows 11 Pro, version 10.0.26100/build 26100, x64. C: had approximately 787.9 GiB free of 930.52 GiB at initial inspection. Before installation, no MT5 entry was found in the checked Windows uninstall registries, running terminal processes, common Program Files/user Programs locations, or MetaQuotes Terminal data origins. These checks covered common installations rather than every possible custom folder on every drive. No duplicate installation was made by the assistant.

## Verified download and installed terminal

- Official source page: <https://www.metatrader5.com/en/download>.
- The Windows download link on that page: <https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe?utm_campaign=download&utm_source=www.metatrader5.com>.
- Saved installer: `C:\Users\Francis\Downloads\Yosemite-MT5-Setup\mt5setup.exe`.
- Size: 22,902,352 bytes.
- Windows Authenticode status: **Valid**.
- Actual signing subject: `CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY`.
- Installer file version: **5.0.0.6257**. This is not verification of the final terminal build.
- SHA-256: `C8C0A73F86C58974DF62FB48F8256A099D6698518CF2DEFC2B3F169773729E22`.
- Internet Zone marker was retained. No security protection or warning was disabled/bypassed.
- Verified installation directory: `C:\Program Files\MetaTrader 5`.
- Verified terminal executable: `C:\Program Files\MetaTrader 5\terminal64.exe`.
- Installed product: **MetaTrader 5 Client Terminal**.
- Initially verified terminal product/file version: **5.0.0.6230 (build 6230)**; see the later native-probe check above for the current version.
- Installed terminal size: **121,825,224 bytes**.
- Installed terminal Authenticode status: **Valid**, signer `CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY`.
- Installed terminal SHA-256: `800EFC58E49079D8969AA8AED24E89EB53F3EE95A4E551373759D45D12D69FD2`.
- Windows installed-app entry: **MetaTrader 5**, publisher **MetaQuotes Ltd.**, installation folder matching the verified path.
- Startup evidence: `terminal64` running from that path, `Responding=true`, and a nonzero main-window handle. This verifies process/window startup; no claim is made about a broker login or the uninspected toolbar state.
- The platform's `origin.txt` also identifies the same installation directory; account/password files were not read or printed.

The operator completed the interactive installer and any administrator/software-licence steps. The signed installer was not run a second time. The assistant did not create an account, supply personal details, accept broker financial terms, activate a VPS or subscribe to Signals.

Keep Algo Trading off and external Python automated trading disabled. The first native probe found that the external Python disable control still needed correction, as recorded above. The Python package and installer versions are separate from the verified terminal build; package import is not a terminal connection test.

## Python integration prepared locally

The existing interpreter is CPython **3.11.9, 64-bit** at `C:\Users\Francis\AppData\Local\Programs\Python\Python311\python.exe`. The existing global environment had no MetaTrader5 package. Global packages were not modified.

An isolated, Git-ignored environment was created at the project's `.venv`. Its interpreter is:

```text
C:\Users\Francis\OneDrive\Documents\Projects\Yosemite AI Trading Bot\.venv\Scripts\python.exe
```

The official PyPI namespace is maintained by `metaquotes`, links to MetaQuotes documentation, and publishes a Windows x86-64 CPython 3.11 wheel. Installation used isolated pip configuration, the official PyPI index, binary wheels only, and a pinned package version:

```text
.venv\Scripts\python.exe -m pip --isolated install --index-url https://pypi.org/simple --only-binary=:all: MetaTrader5==5.0.6231
```

Installed versions are recorded in `bridge/requirements-windows.txt`: MetaTrader5 **5.0.6231** and NumPy **2.4.6**. The SDK import/version check succeeded; `pip check` reported no broken requirements. All **14 mocked native-probe unit tests passed** in this environment. The actual offline probe exited 2 with `connectionAttempted=false`, `nativeDemoAccountVerified=false`, `executionAllowed=false` and `actualBrokerOrderExecuted=false`.

During package installation, no initialization, login, broker order/preflight, modification or close was called. The later approved native initialization is recorded above. Python package installation/import is not proof of a terminal connection or broker execution. Do not commit `.venv`, real credentials, terminal profiles or account snapshots.

## Free demo account — operator steps after installation

1. Use the existing computer and a dedicated demo-only terminal/profile; no VPS or paid service is required by this setup. Keep EAs, copy trading, Signals and Algo Trading off.
2. For a new demo account, choose File > Open an Account, select the intended broker's exact server and demo option, and complete any personal information and broker terms yourself. Confirm it is a broker-provided demo account before proceeding; do not select a real account or fund an account for this preparation.
3. For an existing demo account, use File > Login to Trade Account and enter the login, password and exact demo server privately in MT5. Never share the trading password in chat or commit it.
4. Once you have configured the demo account, identify the approved terminal path, exact login/server and broker symbol. Use secure host configuration for the password and allowlists described in `bridge/README.md`.
5. A future read-only probe requires the configured demo account and explicit approval for that connection. Do not run `--connect-read-only` just because the package imports or the terminal opens.

## What remains before any demo order

The desktop installation, Python package and connected MetaQuotes demo identity are verified. The operator confirmed MetaQuotes-Demo as the intended server. Both terminal trading controls are disabled. Resolve the upstream timestamp basis and approve the exact symbol/account binding before relying on these observations for trading. Supabase schema/RLS/operator access and the approved Cloudflare authentication release still require verification. The secure Windows-to-Cloudflare execution bridge, trusted risk/proposal pipeline, durable reservation/dispatch/reconciliation and approved execution schema are still missing. They must be implemented, tested and separately approved before presenting one exact demo order for approval.

All Yosemite execution settings remain disabled. Supabase, Cloudflare production and GitHub were not changed. No paid service or broker account was purchased/created, and no order was submitted, modified or closed. Follow `docs/runbooks/mt5-demo-release.md` for the full staged release gates.

## Official references

[MT5 download](https://www.metatrader5.com/en/download), [installation](https://www.metatrader5.com/en/terminal/help/start_advanced/installation), [Python package](https://pypi.org/project/metatrader5/), [MetaQuotes Python integration](https://www.mql5.com/en/docs/python_metatrader5), [demo accounts](https://www.metatrader5.com/en/terminal/help/startworking/acc_open), [account login](https://www.metatrader5.com/en/terminal/help/startworking/authorization).
