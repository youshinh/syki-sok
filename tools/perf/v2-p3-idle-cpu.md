# v2 P3b S0: does the strip of tabs cost idle CPU? (2026-10-04)

P3a reported the idle CPU of all processes as **1.64 to 1.72% with the strip against 1.05% before it** (P2b) in two sessions, 1.42 against 0.97 in a third, "the GPU process mostly", and guessed that the fill of every tab (a `::before` with an `opacity` from `--d`) makes a surface per tab. P3b was asked to find out and to pick, among variants of the fill, the one with no measurable idle cost.

## Result

1. **There is no idle cost to find, and the guess is wrong.** With the strip present the idle app does the same work as without it. Measured as work (a Chromium trace, below), at 3 tabs, 40 tabs and 150 tabs, at every age of the process from 10 to 150 s, for the opacity fill, for an alpha fill and for no strip at all: **the renderer 2.5 to 2.9 ms of work per second, the GPU process 7.9 to 8.8 ms per second**, the differences between the variants (0.03 to 0.1 ms/s) smaller than the scatter between two rounds of the same variant (0.1 ms/s). 0.1 ms/s is 0.01 points of one core; the "+0.3 to +0.5 points" of P3a is thirty to fifty times that.
2. **The CPU-time counters that every earlier number came from cannot see a difference of this size.** They count in 15.6 ms ticks over a window of 30 s, and **one build alone ranges from 1.08 to 2.36%** between runs (v2-base, 3 tabs, six fresh launches: 1.08 1.08 2.36 1.23 1.23 1.23). In the same-session, interleaved comparison below no pair of builds differs significantly (exact permutation test of the medians, n = 6 against 6: p = 0.10 to 0.94). P3a's observation fits inside this scatter.
3. **Where the idle CPU is** (it is the same in v2-base, the look before v2): the caret blinks, and the page is composed and presented twice a second (1.9 frames/s in every build). One frame costs the GPU process about 4.5 ms of work (the swap chain's Present, the overlay commit, the draw) and the renderer about 1.3 ms: about 0.9% and 0.25% of a core, together the 1.1 to 1.3% that every build shows. The strip is not one of the frame's costs: no event of the frame changes by more than 0.05 ms/s when it is added or taken away.
4. **Decision: the fill stays an `opacity` on the pseudo-element, as P3a built it.** The alpha form (`rgb(var(--accent-rgb) / var(--tab-o))`, and the line under the tab faded with `--tab-hair-rgb` and a strength token) was built as an exe and measured (the CSS was two rules and two tokens); it does the same work, so it earns nothing and costs a `calc()` inside a colour (not run on Safari 15.6), two new tokens and a changed look of the line under the tabs. If a later change wants it, the differences are the two `.tab-item::before` rules and these tokens: `--tab-hair-rgb` (ink `255 255 255`, paper `var(--ink-rgb)`), `--tab-hair-a` (ink `0.07`, paper `0.09`), with `--tab-hair` made of the two.
5. What was kept from the investigation: `v2_perf.mjs --tabs N` (the length of the strip is a condition of the idle numbers), the idle rows of `run_matrix.mjs` (GPU process, renderer), and `idle_ab.mjs` (variants in one running app, by CPU time or by trace). Use the trace for idle questions: with counters, 0.2 points needs about 25 windows of 30 s per variant.

## Conditions

- PC: GMKtec NucBox K8 Plus, AMD Ryzen 7 8845HS with Radeon 780M, 47.8 GB, Windows 11 Pro 10.0.26300, on mains power, WebView2 154; frame interval 18.3 ms (hardware GPU). Nothing else heavy running (the harness discards a run when the system CPU was over 10% before, during or after it); the screenshot and smoke tools were not running during a measurement.
- **Animations on**: `--motion no-preference` (this PC reports `prefers-reduced-motion: reduce`, which switches every transition off), checked by the harness in every run.
- Builds: `v2-base.exe` (the v1.14 look, sha256 `90f88870e4`), `v2-p3a.exe` (HEAD 39fdd6b, `9f67fe24dc`), `v2-p3b-v1.exe` (HEAD with the alpha fill, a build for this question only), `v2-p3b.exe` (this work, `7d3aa103c2`).
- Idle window 30 s (`--cpu-idle-sec 30`), starting 10 s after the page is ready (`--idle-sec` 10) unless said. `--tabs N` opens notes (small, in the background) until the strip holds N.

## 1. Fresh launches, same session, turns (run_matrix: 2 rounds in opposite order x 3 runs = 6 per cell)

Idle CPU, % of one logical processor, median [min-max], `--tabs 3` and `--tabs 40` (build v2-p3b-v1.exe = the alpha fill). Raw files: `scratchpad/p3b/m1`, definition `matrix1.json`-like (`matrix-p3-idle*.json` here has the final builds).

| | base, 3 tabs | P3a, 3 tabs | alpha fill, 3 tabs | base, 40 | P3a, 40 | alpha fill, 40 |
|---|---:|---:|---:|---:|---:|---:|
| all processes | 1.23 [1.08-2.36] | 1.59 [1.18-2.21] | 1.52 [1.39-2.00] | 1.23 [1.13-1.59] | 1.54 [1.03-1.85] | 1.18 [0.82-1.69] |
| GPU process | 0.80 [0.62-1.08] | 0.90 [0.72-1.08] | 0.95 [0.62-1.11] | 0.80 [0.62-1.03] | 0.82 [0.62-1.23] | 0.74 [0.62-1.08] |
| renderer | 0.21 [0.05-1.08] | 0.41 [0.21-0.98] | 0.41 [0.31-0.77] | 0.23 [0.10-0.36] | 0.31 [0.21-0.92] | 0.13 [0.10-0.51] |

Median differences and p of an exact permutation test (n = 6 against 6): all processes, 3 tabs: P3a minus base +0.36 (p 0.20), alpha minus base +0.29 (0.15), alpha minus P3a -0.07 (0.84); 40 tabs: P3a minus base +0.31 (0.29), alpha minus base -0.05 (0.64), alpha minus P3a -0.36 (0.26). GPU process: differences between -0.08 and +0.15 (p 0.37 to 0.94). Renderer: between -0.18 and +0.21 (p 0.10 to 0.92). **None is significant**, and the sign changes with the tab count.

## 2. One running app, variants in turns (idle_ab.mjs --mode cpu; 3 tabs; windows of 30 s; the page kept the focus in every window)

Total idle CPU, % of one logical processor, median [every window]; the variants are `<style>` overrides added over CDP to the P3a build.

| variant | 3 rounds x 8 variants (first run) | 5 rounds x 5 variants |
|---|---|---|
| P3a as built (opacity fill) | 1.13 [1.24 1.13 1.13] | 1.23 [1.23 0.87 1.13 1.54 1.64] |
| alpha fill | 0.82 [0.87 0.82 0.72] | 1.13 [1.03 1.13 0.67 1.38 1.23] |
| per-distance colours (`[style*="--d: 1;"]` rules) | | 0.97 [0.72 0.97 1.38 1.28 0.97] |
| no fill at all | 0.92 [0.92 0.87 0.97] | 1.18 [1.02 0.97 1.18 1.23 1.33] |
| no strip (`display: none`) | 1.33 [0.77 1.33 1.33] | 0.82 [0.56 0.67 0.82 1.64 1.49] |
| no `contain` / no scroll box / no `isolation` / `visibility: hidden` | 1.08 / 1.69 / 1.02 / 1.23 | |

Paired by round (alpha minus P3a): -0.20 +0.26 -0.46 -0.16 -0.41 (mean -0.19, standard error 0.13, p about 0.2). The hidden strip, the cheapest thing there is, is above the opacity fill in 3 of the 8 rounds. The scatter of one variant's windows (0.56 to 1.64 for the hidden strip) is as large as every difference between variants: the counters are the wrong instrument.

## 3. The structure: layers and trace

- **Compositor layers** (`LayerTree`): 7 with the opacity fill, 7 with the alpha fill, 7 with the strip hidden, 6 with the fills removed: the fills are not surfaces of their own.
- **Work per second of an idle page** (`idle_ab.mjs --mode trace`: every task of the renderer's and the GPU process' main threads minus the waits for the vsync; 3 tabs; 15 s windows, 4 rounds per variant, turns):

| (mean of the rounds) | renderer ms/s [rounds] | GPU process ms/s [rounds] |
|---|---|---|
| P3a (opacity fill) | 2.48 [2.50 2.44 2.38 2.59] | 8.71 [8.69 8.81 8.67 8.69] |
| alpha fill | 2.60 [2.66 2.67 2.55 2.51] | 8.85 [8.91 9.09 8.61 8.78] |
| no strip | 2.45 [2.43 2.45 2.54 2.38] | 8.66 [8.64 8.46 9.00 8.53] |
| with 150 tabs: P3a / alpha / no strip | 2.63 / 3.02 / 2.52 | 8.60 / 8.56 / 8.70 |

  The compositor makes 1.9 frames per second in every case (the caret's blink). Every event of a frame (`ProxyMain::BeginMainFrame`, `DrawAndSwap`, `DCompPresenter::Present`, `SwapBuffers`, `PrepareTiles` ...) has the same time per second in all three.

- **By the age of the process** (fresh launches of v2-base, v2-p3a and the alpha build, 10 s traces at 10, 40, 90 and 150 s after the start; renderer / GPU ms/s):

| age | base | P3a | alpha fill |
|---|---|---|---|
| 10 s | 2.56 / 8.42 | 2.58 / 8.77 | 2.44 / 8.46 |
| 40 s | 2.54 / 8.83 | 2.58 / 8.76 | 2.51 / 8.68 |
| 90 s | 2.66 / 7.86 | 2.89 / 8.22 | 2.75 / 8.24 |
| 150 s | 2.62 / 8.56 | 2.64 / 8.65 | 2.54 / 8.62 |

  The idle work of the v1.14 look and of the strip builds is the same at every age; nothing in the first 40 s differs either.

## 4. The final builds, same session (this work against the build it started from and against the look before v2)

P3b is P3a plus the right strip, the four views, the drag and context-menu polish, the vertical-only `tab_overflow.js` and the docs: +8.4 KB of shipped JS/CSS/HTML (app.js +7.8 KB), 56 + 56 smoke flows and 129 JS test files passing. Cells: median <sub>min-max</sub> of 6 runs (2 rounds in opposite order x 3 runs); the last two columns are the difference of the medians and, in brackets, the p of a permutation test (exact for 6 against 6).

**`--tabs 3`, every step, an idle window of 30 s** (matrix-p3-idle.json; raw files `mF`)

| Metric | v2-base (v1.14 look) | P3a (HEAD 39fdd6b) | P3b (this work) | P3b minus P3a (p) | P3b minus v2-base (p) |
|---|---:|---:|---:|---:|---:|
| Startup: process start to ready (ms) | 483 <sub>471-500</sub> | 489 <sub>476-499</sub> | 497 <sub>490-505</sub> | +7 (0.12) | +14 (0.08) |
| ... of which the page itself (ms) | 155 <sub>147-162</sub> | 159 <sub>152-169</sub> | 164 <sub>161-172</sub> | +5 (0.11) | +9 (0.01) |
| Memory 10 s after ready: private working set, all processes (MB) | 110.0 <sub>108.8-111.9</sub> | 111.7 <sub>111.2-113.7</sub> | 112.3 <sub>111.4-115.8</sub> | +0.6 (0.40) | +2.3 (0.01) |
| ... of which the GPU process (MB) | 29.3 <sub>29.2-29.4</sub> | 29.8 <sub>29.8-30.2</sub> | 29.8 <sub>29.8-30.2</sub> | -0.0 (0.99) | +0.5 (0.02) |
| Idle CPU over 30 s, all processes (% of one core) | 1.03 <sub>0.82-1.79</sub> | 1.13 <sub>1.03-1.49</sub> | 1.36 <sub>0.92-1.59</sub> | +0.23 (0.24) | +0.33 (0.36) |
| ... GPU process | 0.62 <sub>0.56-1.18</sub> | 0.77 <sub>0.72-0.97</sub> | 0.74 <sub>0.51-0.92</sub> | -0.03 (0.88) | +0.13 (0.48) |
| ... renderer | 0.26 <sub>0.15-0.53</sub> | 0.21 <sub>0.10-0.72</sub> | 0.31 <sub>0.05-0.62</sub> | +0.10 (0.28) | +0.05 (0.64) |
| Open the 80,000-line note (ms) | 1853 <sub>1849-1878</sub> | 1860 <sub>1853-1872</sub> | 1855 <sub>1842-1865</sub> | -5 (0.45) | +2 (0.87) |
| Scroll: late frames (of about 240) | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | +0 (1.00) | +0 (1.00) |
| Scroll: longest frame (ms) | 22.8 <sub>20.4-26.9</sub> | 21.0 <sub>19.7-21.7</sub> | 20.6 <sub>20.4-24.4</sub> | -0.5 (0.95) | -2.3 (0.37) |
| Scroll: frame p95 (ms) | 19.3 <sub>18.9-19.5</sub> | 19.2 <sub>18.8-19.3</sub> | 19.0 <sub>18.9-19.3</sub> | -0.1 (0.52) | -0.2 (0.23) |
| Scroll: main-thread busy (ms) | 1384 <sub>1342-1422</sub> | 1354 <sub>1335-1389</sub> | 1331 <sub>1324-1370</sub> | -23 (0.20) | -53 (0.01) |
| Scroll: CPU time of the GPU process (ms) | 641 <sub>500-766</sub> | 578 <sub>391-609</sub> | 578 <sub>547-625</sub> | +0 (0.92) | -63 (0.12) |
| Scroll: CPU time, all processes (ms) | 4047 <sub>3906-4109</sub> | 3813 <sub>3563-3953</sub> | 3773 <sub>3703-3906</sub> | -39 (0.67) | -273 (0.01) |
| Typing: key to next frame, p50 (ms) | 129 <sub>128-129</sub> | 128 <sub>127-129</sub> | 128 <sub>128-129</sub> | -0 (0.49) | -1 (0.02) |
| Typing: p95 (ms) | 148 <sub>141-151</sub> | 148 <sub>141-155</sub> | 151 <sub>146-154</sub> | +3 (0.49) | +3 (0.27) |
| Typing: max (ms) | 159 <sub>155-176</sub> | 161 <sub>158-165</sub> | 162 <sub>159-198</sub> | +1 (0.43) | +3 (0.23) |

**`--tabs 40`, startup / memory / idle** (matrix-p3-idle-40.json; raw files `mG`)

| Metric | v2-base (v1.14 look) | P3a (HEAD 39fdd6b) | P3b (this work) | P3b minus P3a (p) | P3b minus v2-base (p) |
|---|---:|---:|---:|---:|---:|
| Startup: process start to ready (ms) | 493 <sub>482-495</sub> | 498 <sub>490-508</sub> | 499 <sub>489-516</sub> | +1 (1.00) | +5 (0.11) |
| ... of which the page itself (ms) | 157 <sub>153-163</sub> | 167 <sub>162-173</sub> | 173 <sub>163-174</sub> | +6 (0.27) | +16 (0.01) |
| Memory 10 s after ready: private working set, all processes (MB) | 111.9 <sub>111.1-112.3</sub> | 115.5 <sub>114.7-116.5</sub> | 115.8 <sub>114.8-118.0</sub> | +0.2 (0.71) | +3.9 (0.01) |
| ... of which the GPU process (MB) | 30.3 <sub>30.2-30.4</sub> | 32.0 <sub>31.9-32.4</sub> | 31.9 <sub>31.8-32.3</sub> | -0.0 (0.49) | +1.6 (0.01) |
| Idle CPU over 30 s, all processes (% of one core) | 1.33 <sub>1.13-1.33</sub> | 1.44 <sub>1.18-1.69</sub> | 1.49 <sub>1.08-1.80</sub> | +0.05 (0.81) | +0.15 (0.11) |
| ... GPU process | 0.85 <sub>0.62-1.08</sub> | 0.95 <sub>0.77-1.08</sub> | 1.00 <sub>0.72-1.13</sub> | +0.05 (0.68) | +0.15 (0.57) |
| ... renderer | 0.21 <sub>0.15-0.41</sub> | 0.33 <sub>0.10-0.67</sub> | 0.21 <sub>0.05-0.46</sub> | -0.13 (0.23) | +0.00 (1.00) |

**Startup alone, 4 rounds x 4 runs** (matrix-p3-startup-like run: `--steps startup`; 16 runs per build, alternated; the first matrix above had P3b 8 ms behind P3a, which 16 runs show to be scatter)

| Metric | v2-base (v1.14 look) | P3a (HEAD 39fdd6b) | P3b (this work) | P3b minus P3a (p) | P3b minus v2-base (p) |
|---|---:|---:|---:|---:|---:|
| Startup: process start to ready (ms) | 491 <sub>473-509</sub> | 495 <sub>482-512</sub> | 496 <sub>484-508</sub> | +2 (0.83) | +5 (0.29) |
| ... of which the page itself (ms) | 156 <sub>148-167</sub> | 163 <sub>154-171</sub> | 162 <sub>153-172</sub> | -1 (0.73) | +6 (0.01) |

**What the idle work is in the final build** (idle_ab-style trace of fresh launches, renderer ms/s / GPU process ms/s; 10 s windows at the age shown):

| age | v2-base | P3b |
|---|---|---|
| 10 s | 2.58 / 8.48 | 2.53 / 8.76 |
| 40 s | 2.53 / 8.29 | 2.52 / 8.57 |
| 90 s | 2.71 / 8.29 | 2.92 / 8.52 (another process 1.5 ms/s that window) |
| 150 s | 2.67 / 9.07 | 2.61 / 8.89 |

**The same question by process, over 120 s windows** (the last check: v2-base against P3b, fresh private profile, 3 tabs, the page focused, 3 rounds in turns, `proc_mem.ps1` CPU time per process role over a 120 s window that starts 25 s after the page was ready; % of one core):

| role | v2-base [3 rounds] | P3b [3 rounds] |
|---|---|---|
| GPU process | 0.86 [0.86 0.78 0.91] | 0.87 [0.87 0.87 0.92] |
| renderer | 0.35 [0.35 0.18 0.36] | 0.23 [0.13 0.26 0.23] |
| browser process | 0.07 [0.05 0.07 0.08] | 0.12 [0.17 0.05 0.12] |
| all processes | 1.28 [1.28 1.02 1.40] | 1.19 [1.19 1.19 1.28] |

With a window four times longer the strip build is not above the v1.14 look (all processes -0.09 on the medians; the GPU process +0.01, inside the scatter of the base alone, which has 0.78 to 0.91). Together with the trace, this is the answer to S0: the idle cost the P3a numbers suggested is the counters' scatter, not work.

Reading the final tables: what a person feels (the window opens in 0.5 s, the 80,000-line note opens in 1.85 s, scrolling has no late frame, a key is on screen after 128 ms) is the same in all three builds. What the strip costs is what P3a already had: a page that takes about 6 ms longer to come up (1%, 48 resources against 43), 2 to 4 MB more private memory (0.5 to 1.6 MB of it in the GPU process, which holds the strip's surface), and a total idle CPU that is higher than the v1.14 look's in 7 of the 8 comparisons (P3a, the alpha fill and P3b, at 3 and at 40 tabs, both matrices; the eighth, the alpha fill at 40 tabs, is -0.05), by 0.10 to 0.36 points, never significantly (the counters' scatter is as large) while the trace shows the same work. P3b adds nothing to P3a that these instruments can see (startup +2 ms, p 0.83; memory +0.2 to +0.6 MB, p 0.4 to 0.7; idle CPU +0.05 to +0.23, p 0.24 to 0.81).

## How to repeat

```
sh E2E/build.sh v2-x.exe
node tools/perf/run_matrix.mjs --matrix tools/perf/matrix-p3-idle.json --out <dir> --rounds 2 --runs 3        # 3 tabs, every step, a 30 s idle window
node tools/perf/run_matrix.mjs --matrix tools/perf/matrix-p3-idle-40.json --out <dir> --rounds 2 --runs 3    # 40 tabs, startup / memory / idle
# an app you started yourself (E2E/launch.ps1), the lock taken:
node tools/perf/idle_ab.mjs --e2e <E2E> --mode trace --secs 15 --rounds 4 --tabs 3 --variants "opacity=|alpha=.tab-item::before{opacity:1 !important;background:rgb(var(--accent-rgb) / var(--tab-o)) !important}|no strip=#tab-index-left{display:none}"
```
