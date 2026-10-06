# Baseline: v2-base.exe (syki::sok v1.14.0 look and code)

What every later v2 build is compared with. Measured with `tools/perf/v2_perf.mjs` (see `README.md` there for how each number is taken);
the raw data is `baseline-v1.14.json` (14 runs, with the per-run detail, the loads sampled around every run and the machine).

## What was measured

| | |
|---|---|
| Build | `v2-base.exe`, 24,560,128 bytes, sha256 `90f88870e4e4afff4a1687203a7674806b346bfef4f0d7da941e0f39cb3fc7d8`: built from the `v2` branch before any v2 change (the same frontend and Go code as release v1.14.0), with the E2E overlay (debug port 9335, own mutex, own WebView2 folder) |
| Note | 80,000 lines, 3,121,083 characters, 4,648,773 bytes, sha256 `e12f4596c782de4b4612b46ae81575d7567f84fe8cd58f2837f6596f869923bd` (`gen_note.mjs`, generator version 1, seed 20261004) |
| When | 2026-10-04 (JST). Invocation A 12:45:51 to 12:52:15, invocation B 12:52:15 to 12:58:44. Two separate `node tools/perf/v2_perf.mjs --exe v2-base.exe --runs 7` runs, one straight after the other, 7 runs each, pooled with `--merge` |
| Machine | GMKtec NucBox K8 Plus (a mini desktop), AMD Ryzen 7 8845HS (8 cores, 16 threads), 47.8 GB RAM, Windows 11 Pro 10.0.26300, AMD Radeon 780M driving one 1920x1080 display (Windows says 60 Hz; the page's frames come every **18.4 ms**, constant in all 14 runs) |
| Power | no battery: always on mains power. Power plan "Balanced" (the Windows default) |
| WebView2 runtime | 154.0.4258.53 (a runtime update moves startup and memory by itself: re-measure the baseline after one) |
| Window | the app's default window, page viewport 1050 x 720, device pixel ratio 1, focused, visible (the editor's text area is 982 x 658 px; the note lays out to 1,981,930 px tall) |
| App settings | the defaults except: autocomplete (ghost text) off so no request goes to Ollama, IME guardian off, no update check, no git sync. Cursor aura, auto save and session restore on. Language ja |
| Profile | a copy of a primed WebView2 profile for every run (one unmeasured start per invocation creates it): every measured start is a "second start" with a warm profile and a warm OS file cache. **The true cold start after a reboot is not measured** |

### What else was running (the PC is shared)

- The owner's own `syki.exe` (since 10:03, about 95 MB) with its WebView2, left alone. About 17 `claude` processes (the agents), 11 `node`, Chrome with 20 processes, Ollama idle (one
  process, not used), Windows Defender real-time protection, the search indexer, Google Drive, `mspaint`. Other agents also use the isolated app (they hold `E2E/app.lock`, so never at the same time as a measured run) and
  run the docshots screenshot tool in its own Edge window.
- **System CPU around the 14 final runs** (1 s samples, all processes, % of the whole 16-thread CPU): before the start 1.2 to 4.3% (median 2.9), while the app was idle 0.5 to 4.0%, after the typing 4.1 to 6.9%. The usual
  names above 3% of a core were `powershell.exe` (the harness's own samplers), `claude.exe`, `WmiPrvSE.exe`, `System`, `SearchIndexer.exe`, `MsMpEng.exe`. **No run was discarded** (the harness drops and repeats a run
  that saw more than 10% at one of its three looks); in the very first attempt, made before that check existed, four of seven runs fell into a burst of other agents' screenshot or build work (25 to 44% system CPU, `msedge.exe` / `MsMpEng.exe` at 100 to 270% of a core)
  and took 2.8 to 3.0 s to open the note instead of 1.9 s and 40 to 300 ms longer to start, which is why that check exists. These tables are from quiet runs only.

## Summary

| | Baseline (median of 14) | Spread over the 14 runs |
|---|---:|---:|
| Startup: process start to ready | **483 ms** (331 ms to the page navigation = Go + WebView2 creation, 150 ms the page itself; first contentful paint at 445 ms) | 473 to 499 ms |
| Idle memory, working set (app + 6 WebView2 processes) | **390 MB** (Go app 32.5, WebView2 browser 126, renderer 84, GPU 74, utility 60, crashpad 13) | 388 to 393 MB |
| Idle memory, private working set | **111 MB** (committed 213 MB) | 110 to 114 MB |
| CPU time until 10 s after ready / idle CPU afterwards | 1.9 s / about 1.2% of one thread (GPU process 0.85%, renderer about 0.15%) | idle CPU is at the resolution of the OS counter (15.6 ms ticks): 0.6 to 2.2% |
| 80,000-line note, open (read + tab + first two frames) | **1,858 ms** (read 133, openTab 81, layout + paint 1,643 of which layout 1,351) | 1,849 to 1,877 ms |
| 80,000-line note, memory 3 s after the open | **1,077 MB** working set (renderer 716, of which private 657), 787 MB private, JS heap 27 MB (7.9 MB after a GC), 152,772 DOM nodes | 1,072 to 1,090 MB |
| 80,000-line note, one GC with it open | 658 ms (V8 does one by itself 10-30 s after the open and the page stops that long) | 647 to 681 ms |
| Scrolling (100 px every 33 ms for 4 s) | no frame over 50 ms; p50 18.2 ms, p95 19.3 ms (the frame period is 18.4 ms); main thread busy 1.8 s of the 4.3 s (painting; no layout) | busy time 1.63 to 1.94 s |
| Typing 50 keys in the middle | key to end of next frame: p50 **128 ms**, p95 154 ms, max 182 ms; the main thread is busy 161 ms per key (layout 21 ms, the rest mostly painting the 3 MB text area) | p50 125 to 131 ms |

Reading it: the app itself is small (32 MB); the page and its WebView2 processes add another 360 MB of working set at idle (only 111 MB of the 390 MB is private to the app; the rest are pages shared with the WebView2 runtime). An 80,000-line note adds **about 690 MB**, nearly all in the renderer (native text layout and
paint of one 2-million-pixel-tall text area), and every keystroke in it costs about 130 ms until the next frame is drawn. Those two are the numbers a v2 change must not make worse.

## The tables

Median, min and max over the 14 pooled runs; "Invocation medians" are the medians of invocation A and B, "Between invocations" is their difference as a percentage of the pooled median.

**Startup**

| Metric | Median | Min | Max | Spread (max-min)/median | Invocation medians | Between invocations |
|---|---:|---:|---:|---:|---:|---:|
| Process start to ready (readyState complete + window.backend) | 483 ms | 473 ms | 499 ms | 5% | 486 / 481 | 1.2% |
| ... of which: process start to the page navigation (Go + WebView2 creation) | 331 ms | 324 ms | 351 ms | 8% | 332 / 331 | 0.5% |
| ... of which: navigation to ready (the page itself) | 150 ms | 144 ms | 163 ms | 13% | 150 / 150 | 0.3% |
| First contentful paint (from process start) | 445 ms | 438 ms | 476 ms | 9% | 451 / 445 | 1.4% |
| DOMContentLoaded (from process start) | 481 ms | 470 ms | 496 ms | 5% | 484 / 478 | 1.3% |
| App initialised (tab bar drawn, from process start) | 502 ms | 484 ms | 512 ms | 6% | 501 / 503 | 0.4% |

**Memory, idle 10 s after ready**

| Metric | Median | Min | Max | Spread (max-min)/median | Invocation medians | Between invocations |
|---|---:|---:|---:|---:|---:|---:|
| Working set, app + its WebView2 processes | 390 MB | 388 MB | 393 MB | 1% | 390 / 390 | 0.1% |
| Private working set, same processes | 111 MB | 110 MB | 114 MB | 4% | 111 / 111 | 0.4% |
| Private bytes (committed), same processes | 213 MB | 211 MB | 216 MB | 3% | 214 / 213 | 0.8% |
| ... app (Go) working set | 32.5 MB | 32.2 MB | 32.8 MB | 2% | 32.5 / 32.5 | 0.0% |
| ... WebView2 browser process | 126 MB | 126 MB | 129 MB | 2% | 126 / 127 | 0.1% |
| ... renderer (the page) | 83.9 MB | 82.8 MB | 87 MB | 5% | 84.1 / 83 | 1.3% |
| ... renderer private working set | 32.4 MB | 31.3 MB | 35.5 MB | 13% | 32.6 / 31.5 | 3.4% |
| ... GPU process | 74 MB | 73.8 MB | 74.9 MB | 1% | 74 / 74 | 0.1% |
| ... utility (network, storage) | 60 MB | 59.8 MB | 61.6 MB | 3% | 60 / 59.9 | 0.1% |
| ... crashpad handler | 12.9 MB | 12.9 MB | 12.9 MB | 0% | 12.9 / 12.9 | 0.0% |
| Process count | 7 | 7 | 7 | 0% | 7 / 7 | 0.0% |
| JS heap in use (renderer) | 1.97 MB | 1.96 MB | 1.97 MB | 0% | 1.97 / 1.97 | 0.1% |
| DOM nodes | 4,672 | 4,672 | 4,672 | 0% | 4,672 / 4,672 | 0.0% |

**CPU time (app + its WebView2 processes)**

| Metric | Median | Min | Max | Spread (max-min)/median | Invocation medians | Between invocations |
|---|---:|---:|---:|---:|---:|---:|
| CPU time used from the launch until 10 s after ready (the cost of starting, all processes) | 1,938 ms | 1,562 ms | 2,156 ms | 31% | 1,875 / 1,938 | 3.3% |
| Idle CPU over 10 s, nothing happening (% of one logical processor; the OS counts CPU time in 15.6 ms ticks) | 1.19 % | 0.6 % | 2.23 % | 138% | 1.49 / 1.04 | 35.4% |
| ... renderer | 0.15 % | 0 % | 0.74 % | 501% | 0.15 / 0.15 | 0.1% |
| ... GPU process | 0.85 % | 0.45 % | 1.79 % | 157% | 0.89 / 0.75 | 18.2% |

**80,000-line note: open**

| Metric | Median | Min | Max | Spread (max-min)/median | Invocation medians | Between invocations |
|---|---:|---:|---:|---:|---:|---:|
| Read the file + open the tab + first two frames | 1,858 ms | 1,849 ms | 1,877 ms | 2% | 1,857 / 1,859 | 0.1% |
| ... backend.readFileByPath (Go read + decode + transfer) | 133 ms | 132 ms | 136 ms | 3% | 132 / 134 | 1.3% |
| ... openTab (synchronous JS: tab, textarea value, gutter, status bar) | 80.8 ms | 79.4 ms | 87 ms | 9% | 80.7 / 81.1 | 0.5% |
| ... until the second frame after it (layout + paint) | 1,643 ms | 1,634 ms | 1,661 ms | 2% | 1,643 / 1,644 | 0.0% |
| Main-thread busy time, from the open until 3 s later | 1,980 ms | 1,968 ms | 1,997 ms | 1% | 1,982 / 1,979 | 0.1% |
| ... of which script | 67.6 ms | 63.6 ms | 92.1 ms | 42% | 68.9 / 65.7 | 4.8% |
| ... of which layout | 1,351 ms | 1,344 ms | 1,370 ms | 2% | 1,353 / 1,349 | 0.3% |
| ... of which style recalculation | 88.7 ms | 87.1 ms | 94.7 ms | 9% | 88 / 88.8 | 0.9% |
| A full garbage collection with the note open (V8 does one by itself 20-30 s after the open; the page stops this long) | 658 ms | 647 ms | 681 ms | 5% | 658 / 666 | 1.2% |

**80,000-line note: memory 3 s after opening**

| Metric | Median | Min | Max | Spread (max-min)/median | Invocation medians | Between invocations |
|---|---:|---:|---:|---:|---:|---:|
| Working set, app + its WebView2 processes | 1,077 MB | 1,072 MB | 1,090 MB | 2% | 1,076 / 1,079 | 0.3% |
| Private working set, same processes | 787 MB | 782 MB | 798 MB | 2% | 787 / 787 | 0.0% |
| Private bytes (committed), same processes | 904 MB | 900 MB | 917 MB | 2% | 904 / 904 | 0.0% |
| ... app (Go) working set | 52.3 MB | 48.7 MB | 52.7 MB | 8% | 52.5 / 52.3 | 0.5% |
| ... WebView2 browser process | 152 MB | 152 MB | 155 MB | 2% | 152 / 152 | 0.1% |
| ... renderer (the page) | 716 MB | 714 MB | 726 MB | 2% | 716 / 715 | 0.2% |
| ... renderer private working set | 657 MB | 655 MB | 667 MB | 2% | 657 / 656 | 0.2% |
| ... GPU process | 77.2 MB | 77 MB | 78.2 MB | 2% | 77.2 / 77.1 | 0.0% |
| JS heap in use (renderer) | 27 MB | 27 MB | 27 MB | 0% | 27 / 27 | 0.0% |
| JS heap in use after that full GC (what is really retained) | 7.94 MB | 7.94 MB | 7.94 MB | 0% | 7.94 / 7.94 | 0.0% |
| DOM nodes | 152,772 | 152,772 | 152,773 | 0% | 152,772 / 152,772 | 0.0% |

**80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)**

| Metric | Median | Min | Max | Spread (max-min)/median | Invocation medians | Between invocations |
|---|---:|---:|---:|---:|---:|---:|
| Frame interval p50 (requestAnimationFrame) | 18.2 ms | 18.2 ms | 18.3 ms | 1% | 18.2 / 18.2 | 0.0% |
| Frame interval p95 | 19.3 ms | 19 ms | 19.4 ms | 2% | 19.3 / 19.2 | 0.5% |
| Frame interval max | 25.3 ms | 19.8 ms | 37.5 ms | 70% | 25.2 / 36.7 | 37.2% |
| Frames longer than 17 ms (as agreed; every frame when the display frame period is above 17 ms) | 234 | 232 | 235 | 1% | 234 / 234 | 0.0% |
| Late frames: longer than 1.5 x the idle frame interval (a skipped vsync) | 0 | 0 | 3 | 0% | 0 / 1 | 200.0% |
| Frames longer than 50 ms | 0 | 0 | 0 | 0% | 0 / 0 | 0.0% |
| Frames produced | 234 | 232 | 235 | 1% | 234 / 234 | 0.0% |
| Main-thread busy time (Performance.getMetrics delta) | 1,805 ms | 1,632 ms | 1,943 ms | 17% | 1,775 / 1,836 | 3.4% |
| ... of which script | 11.9 ms | 11.4 ms | 12.2 ms | 7% | 11.8 / 12.1 | 2.2% |
| ... of which layout | 0 ms | 0 ms | 0 ms | 0% | 0 / 0 | 0.0% |
| ... of which style recalculation | 0 ms | 0 ms | 0 ms | 0% | 0 / 0 | 0.0% |
| Layouts | 0 | 0 | 0 | 0% | 0 / 0 | 0.0% |

**80,000-line note: typing 50 keys in the middle**

| Metric | Median | Min | Max | Spread (max-min)/median | Invocation medians | Between invocations |
|---|---:|---:|---:|---:|---:|---:|
| Key press to the end of the next frame, p50 | 128 ms | 125 ms | 131 ms | 5% | 128 / 128 | 0.3% |
| ... p95 | 154 ms | 148 ms | 172 ms | 15% | 151 / 158 | 4.7% |
| ... max | 182 ms | 158 ms | 214 ms | 31% | 180 / 183 | 1.8% |
| ... mean | 133 ms | 130 ms | 135 ms | 4% | 132 / 133 | 1.5% |
| Key press to the key handler (main thread busy), p95 | 0.6 ms | 0.5 ms | 6.4 ms | 983% | 0.6 / 0.6 | 0.0% |
| Main-thread busy time per key | 161 ms | 159 ms | 163 ms | 2% | 162 / 161 | 0.6% |
| ... of which layout | 21.5 ms | 21.1 ms | 22.7 ms | 7% | 21.4 / 21.5 | 0.1% |

## Run-to-run spread (how much a difference has to be to mean something)

Two invocations in the same quiet conditions, 7 runs each, 14 runs pooled. The medians of the two invocations differ by **at most 1.4%** for every startup number, by **at most 1.3%** for the open and its memory (except two small ones: the renderer's private working set at idle, 3.4%, and the script time of the open, 4.8%), by 1.2% for the GC pause, 3.4% for the busy time while scrolling, and by 0.3% (p50), 4.7% (p95) and 1.8% (max) for typing: that is the reproducibility of the whole procedure (start, measure, stop, again). Within an invocation:

- **Tight (spread under 5% of the median, use freely):** startup ready 5% (473 to 499 ms), idle working set 1%, private working set 4%, committed memory 3%, memory after the open 2%, the open time 2%
  (1,849 to 1,877 ms), read 3%, layout 2%, main-thread time of the open 1%, GC pause 5%, typing p50 5% (125 to 131 ms), typing mean 4%, main-thread time per key 2%, frames produced 1%, frame p50 1%.
- **Usable, a little looser (5 to 20%):** process start to the page navigation 8% (324 to 351 ms), first contentful paint 9%, app initialised 6%, the page's own share of startup 13%, renderer private working set 13% (about 4 MB), typing p95 15% (148 to 172 ms),
  main-thread busy time during the scroll 17% (1.63 to 1.94 s), scroll frame max 70% (20 to 38 ms: one skipped frame is 37 ms; the median 25 ms is the number to look at).
- **Too noisy to carry a verdict on their own:** idle CPU (0.6 to 2.2%: the OS counts CPU time in 15.6 ms ticks, so the 10 s window resolves only 0.16%), CPU time until 10 s after ready (31%: 1.6 to 2.2 s, probably Defender and the indexer looking at the freshly copied profile), typing max (31%), the delay until the key handler ran (sub-millisecond, an occasional 6 ms), `script` times of the open (42%, 64 to 92 ms: a few ms of JIT/GC luck), late frames
  (0 to 3). They are in the tables for diagnosis; a verdict on them needs a second invocation that agrees.
- **Does not move at all (so it cannot detect anything but a big change):** the frame interval p50 and p95 (18.2 and 19.3 ms: vsync-locked at this display's 18.4 ms period), frames over 17 ms (every frame, as the period is above 17 ms),
  layout and style time during the scroll (0: scrolling only paints), JS heap and DOM node count (deterministic).

## Comparing a later build with it

```
node tools/perf/v2_perf.mjs --exe v2-new.exe --runs 7 --out new.json --compare tools/perf/baseline-v1.14.json
node tools/perf/v2_perf.mjs --diff tools/perf/baseline-v1.14.json new.json        # the same comparison from a saved result, nothing is launched
```

Prints, per metric, the baseline median (min-max of its 14 runs), the new median (min-max of its runs), the change in the metric's unit and in percent, and a verdict: **WORSE** / **better** when the new median lies outside the
baseline's min-max range and differs by more than the metric's minimum step (20 ms for startup, 5 MB for memory, 8 ms for typing...), otherwise "within baseline range".

Rules for a fair comparison: build the new exe as `v2-<name>.exe` with the E2E `build.sh` (same overlay, so the same debug port and profile layout); same machine on mains power, nothing heavy started on purpose
(the harness itself waits for a quiet CPU and repeats a run that saw more than 10%); the same note (the sha256 in the header must be `e12f4596c782de4b...`: if `gen_note.mjs` is ever changed, bump `GENERATOR_VERSION` and re-measure this baseline);
the same WebView2 runtime (154.0.4258.53; re-measure the baseline after an update). A verdict that matters (a **WORSE** on startup, memory or typing) should be confirmed by a second invocation of the new build before anyone acts on it.
A change in the layout of the page (v2 changes paddings and fonts) changes how many screen lines the note wraps into (`run.open.scrollHeight` in the JSON), and with it the open and typing times: say so when comparing, do not call that a regression of the code.

## Reproducing the baseline

```
node tools/perf/v2_perf.mjs --exe v2-base.exe --runs 7 --label "baseline A" --out a.json
node tools/perf/v2_perf.mjs --exe v2-base.exe --runs 7 --label "baseline B" --out b.json
node tools/perf/v2_perf.mjs --merge a.json b.json --out tools/perf/baseline-v1.14.json
```

`v2-base.exe` is `E2E\v2-base.exe` (never rebuilt: it is the reference). About 7 minutes per invocation when the PC is quiet.

## Things worth knowing that the first attempts showed

- **The GC pause (about 430 ms) found while taking this baseline.** With the note open, V8 runs a "reduce memory" major GC by itself some 10 to 30 s later and the main thread stops about 430 ms (heap 28 MB to 15 MB; nearly all of it
  in the Oilpan epilogue, with 152,772 DOM nodes). Chromium trace of the scroll (`--trace-scroll`): `V8.GCFinalizeMCReduceMemory`, `IncrementalMarkingJob::ScheduleTask`. The first version of the scroll test hit it in four runs of five, as a single
  420 to 470 ms frame near the end of the wheel burst. The harness now forces that GC before the scroll and times it (`open.gc_ms`, 658 ms through CDP). It is a real hitch for a person (open a huge note, scroll a few seconds later);
  whether to do something about it is a product question, not a harness one (where the 148,000 extra DOM nodes of an open 80,000-line note come from was not investigated).
- **Frame period 18.4 ms instead of 16.7 ms** at "60 Hz": a property of this machine/WebView2 combination, constant. The 17 ms threshold of the brief is below it, so "frames over 17 ms" counts every frame; use late frames, frames over 50 ms and the busy time.
- The app's memory on this baseline is measured with the window focused. The app trims its own memory 5 s after the window loses focus or is hidden (presumably the state behind the "5 to 15 MB resident" claim; the trimmed state is not measured here).
