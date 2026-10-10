# tools/perf: the v2 performance harness

Measures a test exe of syki::sok (`v2-*.exe`, built by the E2E `build.sh`) the same way every time, so a change of look (v2) can be
compared with the build it started from (`baseline-v1.14.md`): **startup**, **memory**, **idle CPU**, and an **80,000-line note**
(open, scroll, type). Windows only. Node 24 only (no npm packages), plus PowerShell.

```
node tools/perf/v2_perf.mjs --exe v2-base.exe --out base-a.json                       # 7 runs (default), prints a Markdown table and the JSON
node tools/perf/v2_perf.mjs --exe v2-new.exe  --compare tools/perf/baseline-v1.14.json  # measure, then print the deltas against the baseline
node tools/perf/v2_perf.mjs --diff tools/perf/baseline-v1.14.json new.json             # compare two result files (nothing is launched)
node tools/perf/v2_perf.mjs --merge a.json b.json --out pooled.json                    # pool two invocations (how the baseline was made)
node tools/perf/gen_note.mjs --out note.md                                              # the test note on its own (prints lines / chars / sha256)

# conditions (see "Conditions" below): the app config, the browser flags, animations on, the bars' state while scrolling
node tools/perf/v2_perf.mjs --exe v2-p2b.exe --config-patch '{"appearance":{"bars":"glass","autoHide":false}}' --bars-state shown --motion no-preference --browser-args "--disable-gpu"
# several configurations, interleaved in one session, one table
node tools/perf/run_matrix.mjs --matrix matrix.json --out <dir> --rounds 2 --runs 3
```

A full invocation of 7 runs takes about 7 minutes on a quiet PC (more when busy runs are repeated). Progress goes to stderr, the Markdown table and JSON to stdout (`--format md|json|both`).
Options: `--runs 7`, `--e2e <dir>` (default `$V2_E2E`, else the E2E folder of this session), `--work <dir>` (default `<e2e>/../v2perf`),
`--note <file>` (a different note), `--idle-sec 10`, `--cpu-idle-sec 10`, `--settle-sec 3`, `--quiet-pct 10`, `--quiet-wait-sec 45`, `--max-retries 8`, `--keys 50`, `--wheel-sec 4`,
`--steps startup,memory,open,scroll,typing`, `--label text`, `--lock-timeout-min 30`, `--trace-scroll <file>`, and the five conditions `--config-patch`, `--browser-args`, `--motion`, `--bars-state`, `--tabs`
(next section).

## Conditions: what an invocation can change on purpose

Defaults change nothing, so every result made without these options is still comparable with `baseline-v1.14.json`. Whatever was changed is recorded in the result (`conditions`),
printed in the Markdown header, and `--compare` / `--diff` say "not measured under the same conditions" when the two files differ in one of them.

| Option | What it does | Recorded |
|---|---|---|
| `--config-patch '<json>'` or `@file.json` | A JSON object **deep-merged** (objects key by key, anything else, arrays included, replaced) over the app config the harness writes into `config.json` for **every** start, the priming one too. Example: `--config-patch '{"appearance":{"bars":"glass","autoHide":false}}'`. Invalid JSON, a non-object, or a patch of `scraps.scrapDir` (the harness owns the notes folder) is refused before anything is launched. | `conditions.configPatch` (the compact JSON text), `conditions.appConfig` (the merged config that was written) |
| `--browser-args "<flags>"` | Extra Chromium flags for the WebView2 processes, e.g. `--disable-gpu`. **How a flag gets there:** the app overwrites `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` with its own list when it starts (`window_windows.go`), so the harness cannot append to that variable from outside. (1) `--disable-gpu` is applied through the private profile: the pref `hardware_acceleration_mode.enabled = false` in `<profile>/EBWebView/Local State` ("use graphics acceleration when available" off), written before every start, the priming one included; this works with every exe. (2) Any other flag is passed in `MDM_E2E_BROWSER_ARGS`, which an exe only honours if its E2E overlay appends it (suggested line for `make_overlay.py`, **not tried**: replace the `--disable-hang-monitor` edit's right-hand side by `'"--disable-hang-monitor "+"--remote-debugging-port=9335 "+os.Getenv("MDM_E2E_BROWSER_ARGS"),'`). **Every flag is proven**: the priming start reads the command lines of the profile's processes and the invocation stops before the first measured run if a flag is on none of them; each measured run proves it again. The priming start and every copy of its profile are made with the same flags in the same invocation, so a profile made with other GPU flags is never reused. | `conditions.browserArgs`, `conditions.browserArgsVia`, per run `browserArgs` (which process types carry it), `gpuProcessFlags`, `rendererGpuFlags` |
| `--motion system\|no-preference\|reduce` | `system` (default) does nothing. The others call `Emulation.setEmulatedMedia` with `prefers-reduced-motion` right after the CDP session is attached (while the page is still loading), set it again after a navigation of the main frame, and **fail the run** if `matchMedia('(prefers-reduced-motion: reduce)').matches` is not what was asked, checked right after setting it, before the scroll and at the end of the run. | `conditions.motion`, per run `motion` (`systemReduce` = what this PC reports, `checked`, `reapplied`, `navigations`) |
| `--tabs N` | Before anything is measured, opens small notes (`__sykiRPC.openTab`, no path, in the background, so nothing is selected or focused) until `#tabs-list` holds N tabs, and records the count it saw (`run.tabs`, `conditions.tabs`, printed in the header; `--compare` / `--diff` say "not measured under the same conditions" when it differs). The idle CPU of a strip of 3 tabs and of 40 are different conditions: `tools/perf/v2-p3-idle-cpu.md`. 0 (default) leaves the app as it starts. | `conditions.tabs`, per run `tabs` |
| `--bars-state natural\|shown\|faded` | **Scroll step only.** `natural` (default) leaves the bars to the app (they fade at the first wheel event). `shown`: before the scroll `ChromeOverlay.current.configure({autoHide:false}); show()`, so both bars stay on screen for the whole scroll (the worst case for translucency and blur). `faded`: `configure({autoHide:true})`, **one** pointer move to the spot where the wheel will turn (while the bars are still shown: the overlay brings the bars back at the first pointer move it sees if it never saw the pointer before, and the browser makes small moves of its own after a scroll; tried on the real `chrome_overlay.js`, without that move the bars are back after the scroll), then `away()`, 400 ms of waiting for the 0.2 s fade, and the frame recorder and the wheel start with the bars at opacity 0 (no further pointer move). The state is **checked** at the start and at the end of the scroll (`body.chrome-faded` and `#header` opacity); a mismatch fails the run instead of mislabelling it. Afterwards `autoHide` is put back to what it was, and if it was on the bars end faded, as after a natural scroll, so the typing step starts alike in every mode. An exe without `window.ChromeOverlay` (`v2-base.exe`, `v2-p1b.exe`) measures as `natural` and says so (`scroll.bars.unsupported = true`, printed in the header). | `conditions.barsState`, per run `scroll.bars` = `{ mode, unsupported?, was, now, pointerNotedAt?, start: {...}, end: {...} }` |

`scroll.bars.start` and `.end` hold, read from the page at the first wheel event and after the recorder stopped: `chromeFaded` (`body.classList.contains('chrome-faded')`), `headerOpacity` / `statusOpacity`
(`getComputedStyle(...).opacity`), `backdropFilter` (of `#header`), `barA` (`--bar-a` of `#header`, where `css/chrome.css` sets it: 1 solid, 0.86 light, 0.62 glass), `dataBars` (`body.dataset.bars`), and the overlay's own state (`overlay`, `controller`, `autoHide`, `away`). An old exe has `null` for `barA` / `dataBars`.

**`prefers-reduced-motion` is the reason `--motion` exists.** This PC reports `reduce` (the Windows "show animations" setting is off), and then the app sets `transition-duration: 0s !important`: every fade, and with it
the cost of blurring a translucent bar under a fade, is invisible to the harness. A v2 measurement that is about fades, blur or translucency must be made with `--motion no-preference`. Use the **same** `--motion` for every
configuration you compare (including the baseline: its animations are switched off by the same rule). Limits: the emulation starts when the harness attaches, which is while the page loads; CSS follows the change
at once, but JS that read the media query at load keeps the value of the PC. The page's startup timestamps come from the page itself, but the harness' two or three calls at attach time happen while it loads (a few ms are possible): compare like with like.

**`--disable-gpu` through the profile is not byte-identical to the switch.** Chromium ends in the same place (`GpuDataManager::DisableHardwareAcceleration`: software compositing, the GPU process stays), but the
command lines show it differently. Seen here (WebView2 154, 2026-10-04): with the pref the renderer gets `--disable-gpu-compositing` and the GPU process `--use-gl=angle --use-angle=d3d11-warp-webgl` (WARP, Microsoft's software
rasterizer), and the frame interval of the idle page is 16.7 ms instead of 18.3 ms. That is what `gpuProcessFlags` and `rendererGpuFlags` record. A build run with the literal switch might use SwiftShader instead of WARP: the
number is "software compositing", not a promise about one particular rasterizer.

## What it does to the machine

- The exe must be named `v2-*.exe` (so `E2E/stop.ps1` agrees to stop it). It is **started by this harness** (Node `spawn`, same environment
  as `E2E/launch.ps1`: `APPDATA`, `LOCALAPPDATA`, `MDM_E2E_WEBVIEW`, and a file name that does not exist so no running syki::sok is activated) and
  **stopped with `E2E/stop.ps1 -ProcId <that pid>`**, in a `finally`, also on Ctrl+C, on an error, and after a 5 minute watchdog.
  Its `msedgewebview2` children leave by themselves; they are waited for, never killed (they are not the pid that was started).
- The user's own `syki.exe`, real config, notes, Ollama are never touched. The test app's data lives in `<work>/env`, **not** in the shared
  `E2E/appdata` and `E2E/wv`: a 3 MB note would otherwise end up in the session that every other test of the isolated app restores.
  `launch.ps1` is not used for that reason, and because starting it through PowerShell adds about a second to "process start".
  If `launch.ps1` ever changes what it sets up, mirror that in `Harness.envVars` / `configJson`.
- `E2E/app.lock` (mkdir) is taken for every run (start to stop) and given back between runs; the harness waits if another agent holds it and
  gives up after `--lock-timeout-min`. It refuses to start when port 9335 already answers while it holds the lock (someone left an app running).
- One invocation per work folder at a time (`<work>/invocation.lock`).
- App config for the test: the defaults, except `autocomplete.enabled = false` (otherwise every keystroke asks Ollama), `imeGuardian*` off
  (it calls Windows IME functions), no update check, no git sync, semantic search / inbox / Discord off. Cursor aura, auto save and session
  restore stay ON, as for a user (they are part of what typing in a huge note costs). `--config-patch` is merged over this.
- Every run: a clean `<work>/env/appdata` with that config, a fresh copy of a **primed WebView2 profile** (one unmeasured start of the same exe
  creates it at the beginning of each invocation, so every measured run is a "second start" with a warm profile, never the slower first one),
  a fresh copy of the note, and the app started from scratch.

## What is measured, and how

| Area | Method |
|---|---|
| Startup | `Date.now()` just before `spawn`. In the page: `performance.timeOrigin` + the navigation entry (`domContentLoadedEventEnd`, `loadEventEnd`, first-contentful-paint). Both sides use the same wall clock. **Ready** = `document.readyState === 'complete'` and `window.backend` (the load event). Also: process start to navigation start (Go + WebView2 creation), the page's own share, and "app initialised" (tab bar drawn). The CDP connection is attached while the page loads; the harness polls every ~10 ms, but the numbers come from the page's own timestamps, not from the polling. |
| Memory, idle | 10 s after ready, one PowerShell read (`proc_mem.ps1`): working set, private working set and private bytes of the app and of every `msedgewebview2.exe` whose command line holds the test profile folder (browser, renderer, GPU, network, storage, crashpad). Plus the renderer's JS heap (`Runtime.getHeapUsage`) and DOM node count. Every process carries its Chromium **type** (from `--type=` on its command line: `app`, `browser`, `gpu-process`, `renderer`, `utility`, `crashpad-handler`); the private working set is reported per type (`mem_idle.gpu_pws_mb` is the GPU process on its own; `run.memByType` has all of them) and the GPU process' CPU time since the launch is `cpu.start_gpu_ms`. |
| CPU | The same processes' CPU time (user + kernel): total used from launch to 10 s after ready (the cost of starting, independent of wall clock), and the % of one logical processor used over the next 10 s while nothing happens (a page that animates or polls shows up here at once; Windows counts CPU time in 15.6 ms ticks, so 0.0 to 0.2% is zero). |
| Open the 80,000-line note | In the page: `backend.readFileByPath` (Go read + decode + transfer), `__sykiRPC.openTab` (what Ctrl+O does after the dialog), then two `requestAnimationFrame`s (layout + paint of the first frame). Main-thread busy time (`Performance.getMetrics` `TaskDuration`, `ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration` deltas) from the open until 3 s later (so the session save, cursor aura etc. are counted). Memory again 3 s after. Then a **full garbage collection is forced** (`HeapProfiler.collectGarbage`) and timed (`open.gc_ms`), with the JS heap after it: see "the GC pause" below. |
| Scroll | The note is scrolled to the middle, then `Input.dispatchMouseEvent mouseWheel` 100 px every 33 ms for 4 s (121 events, 12,100 px, absolute schedule). An in-page `requestAnimationFrame` loop records the callback timestamps from the first event until 0.3 s after the last (the smooth-scroll tail). p50 / p95 / max of the intervals, frames over 17 ms, **late frames** (over 1.5 x the idle frame interval of that run), frames over 50 ms, and the `Performance.getMetrics` deltas. **CPU time per process type** over the scroll: one process snapshot (`proc_mem.ps1`, about 0.4 to 0.7 s) *before* the frame recorder starts, 300 ms or more of settle, the wheel, and one snapshot *after* the recorder has stopped (so the PowerShell calls never fall inside the frame timings); the difference of every process' CPU time is summed per type: `scroll.cpu_ms_by_type` (`gpu-process`, `renderer`, `browser`, `utility`, `app`, and `crashpad-handler`), `scroll.cpu_ms_total`, and the same as % of one logical processor over the window between the two snapshots (`cpu_pct_by_type`, `cpu_pct_total`, `cpu_window_ms`, about 5.3 s: the scroll is 4.3 s of it). A process that appeared in between counts with all its CPU time, one that went away is lost (`cpu_processes`). Also `scroll.bars` (the state of the bars, see Conditions). |
| Typing | Caret in the middle of the note, 50 real key events (`Input.dispatchKeyEvent` keyDown with `text` + keyUp), 150 ms apart, each one waited for. Latency = from the `keydown` event's `timeStamp` to the first task after the next `requestAnimationFrame` (a `MessageChannel` message: the end of the frame's main-thread work). p50 / p95 / max / mean, the delay until the key handler ran (main thread busy), and main-thread busy time per key. **CPU time per process type** over the whole typing step in the same way (`typing.cpu_ms_by_type`, `typing.cpu_ms_total`, `typing.cpu_pct_by_type`, `typing.cpu_pct_total`; snapshots just before the first key and just after the last one, about 16 s apart). |

### The `views` step (opt-in, P4): the four displays of the 80,000-line note

`--steps open,views` (the default steps do not run it, so the baseline stays comparable). After the note is open it goes through the displays with `__sykiRPC.setUiState` and measures each scene like the scroll step does (an in-page `requestAnimationFrame` recorder, `Performance.getMetrics` deltas, CPU time of every process before and after). The DOM is checked after every switch (`body[data-view]` where the build has it, which element is shown), so a scene cannot be measured in the wrong display; a build from before P4 has no `data-view` and runs the same scenes.

| Metric prefix | Scene |
|---|---|
| `view_side.switch_ms`, `view_preview.switch_ms` | the time of the switch itself (setUiState until the second frame after it): the 80,000-line note rendered beside the editor, then alone. The known slow one: about 3.5 s and 2.1 s on this PC |
| `mem_side.*`, `mem_preview.*` | memory 3 s after each switch |
| `side_scroll.*` | the wheel (100 px every 33 ms, `--wheel-sec`) at the centre of the side preview |
| `side_editor_scroll.*` | the same over the editor beside the preview (the scroll sync moves the preview with it) |
| `side_drag.*` | the divider pressed and dragged to and fro (+-20% of the window's width once a second) for 2 s with real mouse events (`buttons: 1`), editor + side preview. With the 80,000-line note every move lays the text area out again (about 480 ms): 20 frames in 2 s is the baseline, not a fault of the step |
| `preview_scroll.*` | the wheel over the preview alone |
| `pair_drag.*` | the divider dragged for 2 s with two editors (the 80,000-line note and a small one) |

**What it found (P4a): a wheel listener is not free.** With a passive `wheel` listener on the workspace (the first version of "the wheel over the desk scrolls the sheet") the editor-beside-a-preview scene needed 2.28 s of main-thread time instead of 1.71 s, +34%, with no frame dropped. A trace of the scene (`--trace-scroll`, or the Chromium trace of `Performance` in DevTools) showed `LayoutView::HitTest` x121, 755 ms: one hit test of the whole tree (about 6 ms with the preview of the 80,000-line note) for every wheel event. Chromium sends every wheel event to the main thread, non-blocking, as soon as *any* wheel listener exists on the page, wherever it is attached, and the main thread has to find the target first. The page has none while it scrolls (the bars' own listener goes when the bars fade), and the desk's listener now exists only while the pointer is over the desk. Watch `side_editor_scroll.task_ms` and `side_scroll.task_ms` when a listener of any kind is added.

Each scene has the frame intervals (p50, p95, max, late frames, frames over 50 ms, frames produced), the main-thread busy time with its layout and style share and the layout count, and the CPU time in total and of the renderer and the GPU process. Use the same `--motion` for what you compare (`--motion no-preference` for animations on). A full run takes about 80 s per start. The scenes keep their own details in the JSON under `run.views`.

### The `panels` step (opt-in, P5): floating panels over the 80,000-line note

`--steps open,panels` (the default steps do not run it, so the baseline stays comparable). With the note open and the caret in its middle, the step opens five panels one after the other **with their real shortcuts** (a `keydown` with the modifiers the app listens for, through `Input.dispatchKeyEvent`) and closes each with Escape (and checks that it closed):

| Metric prefix | Scene |
|---|---|
| `panel_<name>.open_ms` (`ask` Ctrl+L, `cli` Ctrl+E, `jev` Ctrl+J with canned candidates, `palette` Ctrl+Shift+P, `search` Ctrl+Shift+F) | from the `keydown` event's `timeStamp` to the second `requestAnimationFrame` after the panel is on screen: the time to the first frame the panel is painted in |
| `panel_ask_scroll.*`, `panel_cli_scroll.*`, `panel_jev_scroll.*` | the wheel over the editor (100 px every 33 ms, `--wheel-sec`) **with that panel open**, recorded like the scroll step. The palette and the search are modal (a scrim lies over the whole window), so the page cannot be scrolled under them: only their open time is measured |

What it is for: the face of a panel (a box shadow, two pseudo-elements, a scrim over the window) must not make the scroll of a huge note slower, and must not make the panel open late. The shadow is static (`box-shadow` only; no `filter`, no `backdrop-filter`, no `will-change`), so the numbers should not move. Use the same `--motion` for what you compare (`--motion no-preference`: the 120 ms fade-in runs). For an A/B of two exes in one session: `run_matrix.mjs` with one config per exe (`{ "exe": ... }`), `--steps startup,memory,open,scroll,typing,panels`. The scenes keep their own details in the JSON under `run.panels`.

### Reading the numbers (what is stable, what is not)

- This machine's frame period is **18.2 to 18.4 ms** (not 16.7): `requestAnimationFrame` intervals sit on that value to the decimal, so **p50 and p95 of
  the frame interval cannot move until frames are actually dropped**. "Frames over 17 ms" is therefore *every* frame here; it is printed because it
  was asked for, but the useful scroll numbers are **late frames**, **frames over 50 ms**, **max** (an outlier; one skipped frame gives 36 ms) and above all
  the **main-thread busy time during the scroll** (`scroll.task_ms`: about 40% of the time is spent painting the textarea even though no frame is dropped; a
  paint-heavy change of look shows there before it shows as jank).
- Startup, memory, open and typing repeat within a few percent (see `baseline-v1.14.md`). Noisier: `scroll.task_ms` (about 20%), `typing.p95_ms` / `typing.max_ms` (a few stray
  frames), `typing.queue_p95_ms` (sub-millisecond values), idle CPU (fractions of a percent; compare it with the baseline's range, not with zero).
- **The GC pause.** With the 80,000-line note open, V8's memory reducer runs one major GC by itself some 10 to 30 s later (a "reduce memory" mark-compact finalised by a task; nearly all of its time is the Oilpan epilogue,
  with about 150,000 DOM nodes): the main thread stops for **about 430 ms**, once, at a moment nobody chooses. The first versions of this harness hit it
  inside the scroll test in about four runs of five (a single 420 to 470 ms frame near the end of the wheel burst, found with `--trace-scroll`), which made `scroll.max_ms` and the
  frames over 50 ms a coin toss. So the harness forces that GC itself, right after the memory reading and before the scroll and the typing, and reports its length (`open.gc_ms`, about 650 ms
  through CDP) and the JS heap left after it (`mem_open.js_heap_gc_mb`, the memory that is really retained). A build that keeps fewer DOM nodes or less script heap for a huge note moves those two.
- `--trace-scroll <file>` writes a Chromium trace of the scroll phase (one file per run, openable in the DevTools Performance panel) and prints the events over 80 ms: the first thing to
  use when a frame over 50 ms shows up. Each run also keeps, in the JSON, the frames over 50 ms (`scroll.slowFrames`), Long Animation Frame entries (`scroll.longAnimationFrames`) and the
  window's focus / blur / visibility events (`focusEvents`; the app trims its memory 5 s after a blur).
- **CPU time per process type** is read in 15.6 ms ticks from `Win32_Process`, and the window is a PowerShell round trip long on each side; hand measurements of the GPU process alone were +-100 ms apart from one identical run to the next, so
  `--compare` / `--diff` use a **100 ms minimum step** for every `cpu_ms` row (2 percentage points for the scroll's `cpu_pct` rows, 0.7 for the typing's: the same 100 ms spread over the window). Measure a configuration at least twice (`run_matrix.mjs --rounds 2` or more) before reading a difference of a few hundred ms.
- Working set includes pages shared with other processes (and counts the same DLL pages in every WebView2 process); the **private working set** is the
  number that is really "this app's". Both are printed.
- Not measured: the true cold start after a reboot (the file cache is warm), GPU memory, the real owner's note (this one is generated), a real IME.
- The PC is shared with other agents (builds, screenshot runs with their own Edge window, Defender scans, the search indexer). The first baseline attempt showed it:
  four of seven runs overlapped a busy spell (system CPU 25 to 44%, `msedge.exe` / `MsMpEng.exe` / `SearchIndexer.exe` at 100 to 270% of a core) and were 30 to 50% slower to open
  the note and 150 ms slower to start than the three quiet runs. So the harness looks at the system CPU three times per run (1 s each: before the start, while the app is idle,
  after the typing). Before the start it waits up to `--quiet-wait-sec` (45 s) for the CPU to drop below `--quiet-pct` (10%); a run that still saw more than 10% at any look is **discarded and
  repeated** (up to `--max-retries` times per invocation, 8 by default; the discarded runs stay in the JSON under `discarded`). Past the limit a busy run is kept and marked `noisy`.
- If the page is not visible (window minimised / hidden) or frames are throttled (idle interval > 60 ms) the run fails instead of producing numbers.

## Comparing a build with the baseline

`--compare <baseline.json>` prints, per metric, the baseline median (min-max over its runs) next to the new median (min-max), the change, and a verdict:
**WORSE** or **better** only when the new median lies **outside the baseline's min-max range** *and* differs by more than a minimum step for that metric
(for example 15 ms for startup, 5 MB for memory); otherwise "within baseline range". The baseline file pools two invocations of 7 runs, so its range
already contains the invocation-to-invocation drift. For a change that matters, run the new build twice and look at both. Metrics with a known noise
floor are listed above; do not chase a verdict on those alone.

Conditions to keep equal when comparing: same machine, mains power, nothing heavy running (the harness prints the system CPU before each run and the busiest
processes in the JSON: `runs[].loadBefore`, `conditions.hostLoadBefore`), the same note (check the sha256 in the table header), the same Edge WebView2 runtime
(`conditions` does not record it; a runtime update moves startup and memory by itself, so re-measure the baseline after one).

## run_matrix.mjs: several configurations, interleaved, one table

The PC drifts (thermal state, Defender, other agents), so two builds measured an hour apart are compared on top of that drift. `run_matrix.mjs` measures the configurations **in one session, in turns**: round 1 runs the
list as written, round 2 in reverse, round 3 as written... (`--no-reverse-alternate`: always as written), so a slow drift is spread over the configurations instead of piling up on the last ones. It is a thin runner: for every
(configuration, round) it starts `node tools/perf/v2_perf.mjs ...` as a child process, **one at a time** (one debug port, one `E2E/app.lock`; the harness takes and gives the lock itself, as always), and **stops at once and says so** if a child
fails (non-zero exit, no result file, or a run that failed: the last lines of its progress and the log file are printed).

```
node tools/perf/run_matrix.mjs --matrix matrix.json --out <dir> [--rounds 2] [--runs 3] [--steps startup,memory,open,scroll,typing] [--no-reverse-alternate]
                               [--only A-base,C-light] [--e2e <dir>] [--work <dir>] [--note <file>] [--lock-timeout-min 30]
node tools/perf/run_matrix.mjs --matrix matrix.json --out <dir> --dry-run        # print the commands, change nothing
node tools/perf/run_matrix.mjs --matrix matrix.json --out <dir> --report-only    # the tables from the files already in <dir> (also after a matrix that stopped half way)
```

`--rounds` defaults to 2 and `--runs` (per invocation, i.e. per configuration and round) to 3, so a configuration gets 6 runs. Everything is checked **before the first launch**: the matrix file, the exes, and each configuration's options
(invalid JSON in a `configPatch`, a typo in `motion`...). Each invocation primes its own WebView2 profile (about 10 s) with that configuration's flags, so the profile of one configuration is never reused by another.

**The matrix file** is an array of configurations, or `{ "defaults": {...}, "configs": [...] }` (a `defaults` key is merged into every configuration). A configuration:

| key | meaning |
|---|---|
| `name` (required) | letters, digits, `.` `_` `-`; the file names are `<name>.r<round>.json` (+ `.md`, `.log`), and the column of the table |
| `exe` (required) | `v2-*.exe` in the E2E folder, or a full path |
| `configPatch` | object (or JSON text): `--config-patch` (written to `<name>.patch.json` and passed as `@file`) |
| `browserArgs` | `--browser-args` |
| `barsState` | `--bars-state` (`natural` / `shown` / `faded`) |
| `motion` | `--motion` (`system` / `no-preference` / `reduce`) |
| `steps` | `--steps` (default: the `--steps` of the runner, else all five) |
| `runs` | `--runs` for this configuration only |
| `label` | `--label` (default `<name> r<round>`) |
| `extraArgs` | array of further `v2_perf.mjs` arguments, e.g. `["--keys", "30", "--idle-sec", "5"]` |

The seven configurations A to G of `docs/design/v2-plan-P2.md` section 5.3 (`appearance.bars` is `solid`, `light` or `glass`, `appearance.autoHide` a boolean). `no-preference` for all of them so the fades run (see `--motion`);
E to G keep the bars on screen during the scroll twice over (`autoHide: false` in the config, `barsState: shown`), G on software compositing:

```json
{
  "defaults": { "motion": "no-preference", "steps": "startup,memory,open,scroll,typing" },
  "configs": [
    { "name": "A-base",  "exe": "v2-base.exe",  "barsState": "natural" },
    { "name": "B-solid", "exe": "v2-p2b.exe", "configPatch": { "appearance": { "bars": "solid", "autoHide": true } },  "barsState": "natural" },
    { "name": "C-light", "exe": "v2-p2b.exe", "configPatch": { "appearance": { "bars": "light", "autoHide": true } },  "barsState": "natural" },
    { "name": "D-glass", "exe": "v2-p2b.exe", "configPatch": { "appearance": { "bars": "glass", "autoHide": true } },  "barsState": "natural" },
    { "name": "E-glass-shown", "exe": "v2-p2b.exe", "configPatch": { "appearance": { "bars": "glass", "autoHide": false } }, "barsState": "shown" },
    { "name": "F-light-shown", "exe": "v2-p2b.exe", "configPatch": { "appearance": { "bars": "light", "autoHide": false } }, "barsState": "shown" },
    { "name": "G-glass-shown-nogpu", "exe": "v2-p2b.exe", "configPatch": { "appearance": { "bars": "glass", "autoHide": false } }, "browserArgs": "--disable-gpu", "barsState": "shown" }
  ]
}
```

(`v2-base.exe` knows nothing of `appearance`, so A has no patch. An exe without `window.ChromeOverlay` measures `shown` / `faded` as `natural` and says so in the table.)

**The output**: stdout and `<dir>/matrix.md` (+ `matrix.json` with the pooled numbers) hold the order of every round, a table of the configurations (exe + sha256, patch, flags, bars state, motion, runs ok, runs that were discarded or kept
while the PC was busy, the GPU process' backend flags), then **one table, metrics down and configurations across**, each cell the **median over the runs of all the rounds, then `/` and the min-max in smaller text**
(`-` = that step was not run): startup ready and first contentful paint, private working set of all processes and of the GPU process, idle CPU, open time, the scroll's late frames / frames over 50 ms / max / p95 / main-thread busy time /
CPU time of the GPU process, of the renderer and of all processes, and typing p50 / p95 / max. A **second table** gives the median of each round (`round 1 / round 2 / ...`) for the main metrics: a number that
keeps going one way from round to round is drift of the PC, not of the build. Time (measured): an invocation of 2 runs of all steps took 2 minutes (about 25 s of priming and 47 s per run), so 3 runs are about 3 minutes and the seven configurations above with `--rounds 2` (14 invocations) about 40 minutes
on a quiet PC, more when another agent holds `E2E/app.lock` or the PC is busy (busy runs are repeated). Fewer `steps` do not make it much shorter: the idle waits (`--idle-sec`, `--cpu-idle-sec`, 10 s each) stay unless lowered in `extraArgs`.

## Files

- `v2_perf.mjs`: the harness (startup, memory, CPU, open, scroll, typing, `--compare`, `--merge`, `--diff`). `V2_PERF_NO_MAIN=1` makes it importable without running (used by `run_matrix.mjs` and by tests of the snippets).
- `run_matrix.mjs`: the interleaved multi-configuration runner above.
- `gen_note.mjs`: the generator of the 80,000-line note. Seeded (`mulberry32`, seed 20261004), integer arithmetic only, so the bytes never change for a given
  `GENERATOR_VERSION`; written to `<work>/perf-80k.md` for each invocation (never committed). Japanese and English paragraphs, three heading levels, bullet / numbered /
  task lists, code fences (js, go, py, sh, json, css), block quotes, tables, links (`example.*` hosts), rules and a few lines of 700 to 1,900 characters that wrap into dozens
  of screen lines. 80,000 lines, no trailing newline, about 3.1 million characters (the owner's real note: 80,385 lines, 3.07 million).
- `proc_mem.ps1`: memory + CPU time of the app and its WebView2 processes (by profile folder). `sys_load.ps1`: what else the PC is doing (system CPU, busiest processes, machine info).
- `idle_ab.mjs`: the idle app under a microscope. Style variants (a `<style>` the page gets over CDP) take turns inside ONE running test app, and either the CPU time of its processes (`--mode cpu`, what `v2_perf.mjs` reads) or a Chromium trace (`--mode trace`: milliseconds of work per second of the renderer and the GPU process, 100 times finer) is read for each. Started by hand against an app you launched (`--e2e <dir>`, port 9335, `E2E/app.lock`); it starts and stops nothing.
- `v2-p3-idle-cpu.md`: "does the strip of tabs cost idle CPU?" (P3a saw +0.3 to +0.5 points): the matrices, the in-process A/B and the trace that show it does not (the idle work is the same with the strip, with an alpha fill and without it), why the CPU counters could not tell, the decision, and the final same-session numbers. `matrix-p3-idle.json` (3 tabs, every step) and `matrix-p3-idle-40.json` (40 tabs, startup / memory / idle) are the `run_matrix.mjs` definitions of that comparison.
- `v2-p2-translucency.md`: what the see-through bars cost (solid / light / glass, with and without a GPU, `will-change`) and the startup A/B of P2; the decision for `appearance.bars`. `matrix-p2-translucency.json`, `matrix-p2-willchange.json`, `matrix-p2-startup.json`: the `run_matrix.mjs` definitions it was made with.
- `baseline-v1.14.md` / `baseline-v1.14.json`: the numbers of `v2-base.exe` (the v2 branch before any v2 change = release v1.14.0) and how they were taken.

## What it needs from the app (if v2 renames one of these the harness fails loudly)

`window.backend.readFileByPath(path)`, `window.__sykiRPC.openTab({title, path, content, encoding})`, `#editor` (the textarea), `#tabs-list` (children = tabs),
`window.backend` itself, the debug port 9335 and the profile folder `<MDM_E2E_WEBVIEW>\wv` (both from the E2E overlay build).
