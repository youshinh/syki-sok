# v2 P2: what the see-through bars cost, and the default (2026-10-04)

Decides `appearance.bars` (`solid` | `light` | `glass`) for the header and the status bar, which float over the text in v2, and settles the "startup +7%" question that P2a left open. Numbers were taken with `tools/perf/` (this folder) in **one session**, configurations interleaved, on the PC listed under "Conditions". Plan: `docs/design/v2-plan-P2.md` section 5 (rule in 5.4, result in 5.6).

## Decision

1. **The default stays `light`** (one line, `DEFAULT_BARS` in `frontend/js/appearance.js`; `index.html` ships `<body data-bars="light">` and `tests/chrome_bars_zen_test.mjs` keeps the two equal). `light` is the bars at 86% opacity with nothing blurred. Against `solid` it costs **nothing that could be measured**: the same GPU-process memory (29.3 vs 29.5 MB), CPU time in every process type within the noise (and lower, not higher, without a GPU), the same frames, the same typing latency, with and without a GPU.
2. **`glass` is an option, not the default**, because it costs something that can be measured (the rule: if `glass` costs anything measurable it must not be the default):
   - **+1.5 MB in the GPU process, every time** (30.7-31.2 MB in all 24 glass runs on the GPU; 29.2-29.6 MB in all 42 solid and light runs).
   - **Without a GPU (software compositing: Remote Desktop, a VM, a driver fallback) the GPU process uses twice the CPU while the 80,000-line note scrolls**: 992 ms (range 938-1109) against 484 (solid) and 406 (light) over a 4.3 s scroll; the ranges do not touch, in both rounds. The rule of the plan (5.4) allowed +30%.
   - On a hardware GPU the extra CPU time cannot be told from the noise (see the batches below), and no frame was dropped by any configuration.
3. **`will-change: opacity` is not added** to the bars: with it, GPU-process memory, GPU CPU time and frames are the same as without, with `light` and with `glass` (batch 2).
4. **`appearance.autoHide` stays `true` by default.** It costs nothing: with it on, the bars are at opacity 0 during a scroll or while typing, and a bar at opacity 0 is not drawn (`glass` with auto-hide, `D` below, equals `C` and `B` in every frame and CPU row; its +1.5 MB of GPU memory is the same as above, because the bars are on screen at rest).
5. **Startup**: this build's startup is **465 ms against 456 ms for the v1.14 look, +2.0%** in 16 alternated runs each; all of it was already there at P2a (465 ms), P2b adds 0 ms. The "+7%" of P2a came from comparing with a number measured at another time (baseline file: 483 ms); in the same session the difference is 9 ms, and the distributions overlap (445-466, 450-486, 452-474). It is the page's own share (152 -> 166 ms) and it goes with 4 more files to load (43 -> 47 resource entries: `tokens.css`, `chrome.css`, `appearance.js`, `chrome_overlay.js`).

## Conditions

- PC: GMKtec NucBox K8 Plus, AMD Ryzen 7 8845HS with Radeon 780M, 47.8 GB, Windows 11 Pro 10.0.26300, on mains power, WebView2 154. The idle frame interval is 18.2-18.4 ms (hardware) and 16.7 ms (software compositing).
- **Animations on.** This PC reports `prefers-reduced-motion: reduce`, which makes the app switch every transition off. All measurements used `--motion no-preference` (CDP `Emulation.setEmulatedMedia`; the harness checked `matchMedia` three times in every run: effective `false`).
- Exes: `v2-base.exe` (the v1.14 look, sha256 `90f88870e4`), `v2-p2a-head.exe` (a clean checkout of `14e412f`, built from a temporary worktree: `4c6b5927a0`), `v2-p2b.exe` (this work: `5c0eca0953`), `v2-p2b-wc.exe` (this work + `#header, #status-bar { will-change: opacity }`: `023e8dfebf`). The 80,000-line note is the harness' generated one (sha256 `e12f4596c782de4b`, 3.12 million characters).
- The harness checks its own conditions: the config patch reached the app (`data-bars`, `--bar-a`, the computed `backdrop-filter` are read back per run), `--bars-state shown` kept `#header` at opacity 1 for the whole scroll and `natural` ended with `body.chrome-faded` and opacity 0 (both checked at the start and the end of every scroll), and `--disable-gpu` is proven by the command lines of the GPU and renderer processes (`--use-angle=d3d11-warp-webgl`: Microsoft's software rasterizer; the frame interval of the idle page is 16.7 ms).
- Busy-PC runs are discarded and repeated (system CPU over 10% before, during or after a run): 1 discarded of 66 in the main matrix, none in the others. No run was kept as noisy.
- **Bars states.** `natural` (default behaviour): the bars fade at the first wheel event or key and stay away. `on` (`autoHide: false` in the config and `--bars-state shown`): both bars are on screen for the whole scroll and the whole typing step, which is the worst case for translucency (it is what a person reading with the mouse moving sees, and what `autoHide: false` always gives).
- Medians with the min-max after them in smaller type (`<sub>`). n = 6 per cell in the main matrix (2 rounds x 3 runs, rounds in opposite order), 6 in batch 2 (3 rounds x 2 runs), 16 in the startup test (4 rounds x 4 runs).

## Main matrix: a hardware GPU, 80,000-line note

Bars fading as designed (`B`, `C`, `D`) next to the v1.14 look (`A`) and P2a (`P`):

| Metric | A v1.14 look | P P2a (14e412f) | B solid | C light | D glass |
|---|---:|---:|---:|---:|---:|
| Startup: process start to ready (ms) | 451 <sub>444-457</sub> | 467 <sub>459-476</sub> | 469 <sub>456-471</sub> | 465 <sub>457-486</sub> | 464 <sub>459-468</sub> |
| Memory 10 s after ready: private working set, all processes (MB) | 109.5 <sub>109.1-112.1</sub> | 110.9 <sub>110.7-113.1</sub> | 111.2 <sub>110.0-113.2</sub> | 111.3 <sub>110.7-113.7</sub> | 112.3 <sub>111.6-112.9</sub> |
| ... of which the GPU process (MB) | 29.3 <sub>29.2-29.6</sub> | 29.5 <sub>29.4-29.6</sub> | 29.5 <sub>29.4-29.5</sub> | 29.3 <sub>29.2-29.4</sub> | 30.9 <sub>30.8-31.1</sub> |
| Idle CPU, all processes (% of one core) | 1.34 <sub>0.45-1.94</sub> | 1.05 <sub>0.45-2.69</sub> | 1.12 <sub>0.60-2.40</sub> | 1.12 <sub>0.30-1.65</sub> | 1.12 <sub>0.45-1.35</sub> |
| Open the 80,000-line note (ms) | 1,846 <sub>1,834-1,873</sub> | 1,849 <sub>1,839-1,855</sub> | 1,848 <sub>1,847-1,855</sub> | 1,852 <sub>1,846-1,859</sub> | 1,852 <sub>1,844-1,859</sub> |
| Scroll: late frames (of about 240) | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> |
| Scroll: frames over 50 ms | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> |
| Scroll: longest frame (ms) | 21.0 <sub>20.6-24.1</sub> | 21.8 <sub>20.1-24.4</sub> | 21.1 <sub>20.5-24.7</sub> | 21.0 <sub>20.4-23.6</sub> | 20.8 <sub>20.5-21.4</sub> |
| Scroll: frame p95 (ms) | 19.2 <sub>19.0-19.2</sub> | 19.2 <sub>18.8-19.5</sub> | 19.1 <sub>18.9-19.4</sub> | 19.3 <sub>19.0-19.4</sub> | 19.1 <sub>19.0-19.4</sub> |
| Scroll: main-thread busy (ms) | 1,379 <sub>1,315-1,431</sub> | 1,360 <sub>1,327-1,394</sub> | 1,349 <sub>1,330-1,369</sub> | 1,361 <sub>1,348-1,409</sub> | 1,367 <sub>1,306-1,389</sub> |
| Scroll: CPU time of the GPU process (ms) | 570 <sub>531-672</sub> | 562 <sub>391-781</sub> | 648 <sub>547-734</sub> | 602 <sub>359-719</sub> | 633 <sub>547-797</sub> |
| Scroll: CPU time of the renderer (ms) | 1,594 <sub>1,422-1,688</sub> | 1,617 <sub>1,516-1,688</sub> | 1,547 <sub>1,437-1,578</sub> | 1,617 <sub>1,547-1,719</sub> | 1,586 <sub>1,406-1,687</sub> |
| Scroll: CPU time, all processes (ms) | 3,914 <sub>3,812-4,031</sub> | 3,914 <sub>3,734-4,094</sub> | 3,812 <sub>3,750-4,125</sub> | 3,969 <sub>3,734-4,078</sub> | 3,883 <sub>3,719-4,250</sub> |
| Typing: key to next frame, p50 (ms) | 129 <sub>128-130</sub> | 128 <sub>128-130</sub> | 128 <sub>127-128</sub> | 128 <sub>127-128</sub> | 128 <sub>128-128</sub> |
| Typing: p95 (ms) | 146 <sub>142-162</sub> | 147 <sub>142-150</sub> | 142 <sub>139-149</sub> | 143 <sub>141-151</sub> | 148 <sub>140-152</sub> |
| Typing: max (ms) | 159 <sub>158-204</sub> | 160 <sub>156-162</sub> | 160 <sub>158-168</sub> | 161 <sub>160-166</sub> | 161 <sub>157-169</sub> |

Bars on screen the whole time (worst case; `autoHide: false`):

| Metric | S solid, bars on | F light, bars on | E glass, bars on |
|---|---:|---:|---:|
| Startup: process start to ready (ms) | 474 <sub>464-480</sub> | 469 <sub>460-479</sub> | 464 <sub>454-468</sub> |
| Memory 10 s after ready: private working set, all processes (MB) | 110.9 <sub>110.2-111.8</sub> | 110.6 <sub>110.4-113.2</sub> | 112.8 <sub>112.4-114.8</sub> |
| ... of which the GPU process (MB) | 29.5 <sub>29.4-29.6</sub> | 29.3 <sub>29.2-29.6</sub> | 30.8 <sub>30.8-31.2</sub> |
| Idle CPU, all processes (% of one core) | 0.90 <sub>0.75-1.79</sub> | 1.42 <sub>0.15-2.39</sub> | 1.12 <sub>0.75-2.69</sub> |
| Open the 80,000-line note (ms) | 1,849 <sub>1,840-1,867</sub> | 1,849 <sub>1,840-1,866</sub> | 1,854 <sub>1,846-1,867</sub> |
| Scroll: late frames (of about 240) | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> |
| Scroll: frames over 50 ms | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> |
| Scroll: longest frame (ms) | 21.6 <sub>20.7-24.9</sub> | 22.0 <sub>21.1-24.0</sub> | 21.9 <sub>21.1-26.5</sub> |
| Scroll: frame p95 (ms) | 19.3 <sub>19.0-19.5</sub> | 19.2 <sub>19.0-19.3</sub> | 19.2 <sub>19.0-19.5</sub> |
| Scroll: main-thread busy (ms) | 1,353 <sub>1,313-1,383</sub> | 1,368 <sub>1,320-1,410</sub> | 1,359 <sub>1,323-1,400</sub> |
| Scroll: CPU time of the GPU process (ms) | 484 <sub>406-656</sub> | 578 <sub>500-750</sub> | 742 <sub>578-812</sub> |
| Scroll: CPU time of the renderer (ms) | 1,648 <sub>1,500-1,719</sub> | 1,594 <sub>1,484-1,703</sub> | 1,594 <sub>1,438-1,641</sub> |
| Scroll: CPU time, all processes (ms) | 3,899 <sub>3,547-4,172</sub> | 3,859 <sub>3,812-4,125</sub> | 4,055 <sub>3,812-4,141</sub> |
| Typing: key to next frame, p50 (ms) | 128 <sub>127-128</sub> | 128 <sub>127-129</sub> | 128 <sub>127-130</sub> |
| Typing: p95 (ms) | 144 <sub>137-154</sub> | 146 <sub>143-152</sub> | 144 <sub>141-155</sub> |
| Typing: max (ms) | 160 <sub>157-164</sub> | 163 <sub>158-166</sub> | 161 <sub>158-165</sub> |

Reading it:
- Frames: **0 late frames and 0 frames over 50 ms in every configuration** (a late frame is 1.5 x the idle interval); p95 is 19.1-19.3 ms everywhere; the longest frame is 20-22 ms in the median (a single frame of 24-29 ms turns up in some runs of every configuration alike). On this machine frame times cannot tell the bars apart; the CPU and memory columns can.
- Typing (50 real key events in the middle of the note): p50 128 ms for every configuration; p95 and max sit in the run-to-run spread of the v1.14 look (p95 142-162, max 158-204).
- Open: 1.84-1.85 s for every configuration (baseline-v1.14.md: 1.86 s).
- Memory: all processes together within about 3 MB of each other (overlapping ranges); the GPU process is where `glass` shows (the "GPU process" row, and the lists below).
- GPU-process CPU time over the scroll, every run, ms: S-solid-shown 406 469 469 500 562 656; F-light-shown 500 531 562 594 641 750; E-glass-shown 578 641 703 781 812 812; B-solid 547 547 609 688 703 734; C-light 359 578 594 609 625 719; D-glass 547 578 609 656 703 797.
- GPU-process private working set at idle, every run, MB: S-solid-shown 29.4 29.4 29.5 29.5 29.5 29.6; F-light-shown 29.2 29.2 29.3 29.3 29.3 29.6; E-glass-shown 30.8 30.8 30.8 30.8 31.1 31.2; B-solid 29.4 29.4 29.5 29.5 29.5 29.5; C-light 29.2 29.2 29.2 29.3 29.4 29.4; D-glass 30.8 30.9 30.9 30.9 31.1 31.1.

## Batch 2: more runs, `will-change`

3 rounds x 2 runs (rounds alternate), steps memory, open, scroll. `v2-p2b-wc.exe` has `will-change: opacity` on both bars; "bars on" configurations scroll with the bars visible; the others let them fade.

| Metric | S solid, bars on | F light, bars on | E glass, bars on | E + will-change | C light | C + will-change | D glass | D + will-change |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Memory 10 s after ready: private working set, all processes (MB) | 111.6 <sub>110.9-113.3</sub> | 110.5 <sub>110.4-110.7</sub> | 114.1 <sub>111.6-115.5</sub> | 113.8 <sub>111.6-115.3</sub> | 110.7 <sub>109.4-113.2</sub> | 111.2 <sub>110.3-114.0</sub> | 112.7 <sub>112.0-116.2</sub> | 112.6 <sub>112.0-115.6</sub> |
| ... of which the GPU process (MB) | 29.5 <sub>29.4-29.6</sub> | 29.3 <sub>29.2-29.3</sub> | 30.8 <sub>30.8-31.2</sub> | 30.9 <sub>30.8-31.1</sub> | 29.3 <sub>29.2-29.5</sub> | 29.5 <sub>29.5-29.6</sub> | 30.9 <sub>30.7-31.1</sub> | 30.8 <sub>30.8-31.1</sub> |
| Scroll: longest frame (ms) | 21.0 <sub>20.4-23.7</sub> | 22.7 <sub>20.3-24.3</sub> | 21.3 <sub>20.5-23.7</sub> | 21.7 <sub>20.3-23.5</sub> | 21.5 <sub>20.3-23.6</sub> | 22.0 <sub>20.3-28.1</sub> | 22.6 <sub>20.3-29.0</sub> | 21.6 <sub>20.4-24.7</sub> |
| Scroll: main-thread busy (ms) | 1,326 <sub>1,307-1,359</sub> | 1,359 <sub>1,347-1,380</sub> | 1,336 <sub>1,314-1,378</sub> | 1,367 <sub>1,335-1,394</sub> | 1,334 <sub>1,294-1,356</sub> | 1,361 <sub>1,354-1,375</sub> | 1,314 <sub>1,296-1,348</sub> | 1,353 <sub>1,312-1,418</sub> |
| Scroll: CPU time of the GPU process (ms) | 664 <sub>594-797</sub> | 602 <sub>484-687</sub> | 672 <sub>656-813</sub> | 750 <sub>469-797</sub> | 664 <sub>484-687</sub> | 562 <sub>484-672</sub> | 648 <sub>438-781</sub> | 617 <sub>484-688</sub> |
| Scroll: CPU time, all processes (ms) | 3,906 <sub>3,781-3,984</sub> | 3,844 <sub>3,688-4,188</sub> | 3,914 <sub>3,797-4,313</sub> | 4,062 <sub>3,781-4,219</sub> | 3,953 <sub>3,734-4,031</sub> | 3,922 <sub>3,875-4,141</sub> | 3,797 <sub>3,719-3,969</sub> | 3,992 <sub>3,672-4,078</sub> |

- GPU-process CPU time over the scroll, bars on, batch 2, every run, ms: S-solid-shown 594 609 656 672 750 797; F-light-shown 484 516 563 641 656 687; E-glass-shown 656 672 672 672 687 813. Batch 1 had `glass` higher (742 against 484 for `solid`); batch 2 has them level (672 against 664). The difference between the two batches is bigger than the difference between the configurations, so **no CPU cost of `glass` on a hardware GPU is claimed**; the 1.5 MB is claimed because it did not move in any of 24 runs.
- GPU-process private working set at idle, batch 2, every run, MB: S-solid-shown 29.4 29.5 29.5 29.5 29.6 29.6; F-light-shown 29.2 29.3 29.3 29.3 29.3 29.3; E-glass-shown 30.8 30.8 30.8 30.9 30.9 31.2; C-light 29.2 29.2 29.2 29.3 29.4 29.5; D-glass 30.7 30.9 30.9 30.9 30.9 31.1.
- `will-change: opacity` changes nothing that was measured: the same MB, the same ms, the same frames. It is not added (it would also be one more thing for Safari 15 to get wrong: plan 4.9).

## Software compositing (`--disable-gpu`, the worst case: Remote Desktop, a VM)

Bars on screen the whole time, hardware acceleration off (WARP). One row group per cost.

| Metric | SG solid, bars on | FG light, bars on | G glass, bars on |
|---|---:|---:|---:|
| Startup: process start to ready (ms) | 447 <sub>443-461</sub> | 450 <sub>446-454</sub> | 445 <sub>437-447</sub> |
| Memory 10 s after ready: private working set, all processes (MB) | 91.7 <sub>89.2-93.5</sub> | 90.5 <sub>89.3-92.8</sub> | 98.0 <sub>97.3-100.7</sub> |
| ... of which the GPU process (MB) | 9.0 <sub>9.0-9.0</sub> | 9.0 <sub>9.0-9.0</sub> | 16.1 <sub>16.1-16.1</sub> |
| Idle CPU, all processes (% of one core) | 0.60 <sub>0.45-1.20</sub> | 0.45 <sub>0.15-0.75</sub> | 1.21 <sub>0.75-1.95</sub> |
| Open the 80,000-line note (ms) | 1,850 <sub>1,836-1,856</sub> | 1,846 <sub>1,841-1,850</sub> | 1,856 <sub>1,848-1,867</sub> |
| Scroll: late frames (of about 240) | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> |
| Scroll: frames over 50 ms | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> | 0 <sub>0-0</sub> |
| Scroll: longest frame (ms) | 16.8 <sub>16.8-16.8</sub> | 16.8 <sub>16.8-16.8</sub> | 16.8 <sub>16.8-16.8</sub> |
| Scroll: frame p95 (ms) | 16.7 <sub>16.7-16.8</sub> | 16.8 <sub>16.7-16.8</sub> | 16.7 <sub>16.7-16.8</sub> |
| Scroll: main-thread busy (ms) | 1,503 <sub>1,441-1,532</sub> | 1,481 <sub>1,446-1,501</sub> | 1,475 <sub>1,449-1,502</sub> |
| Scroll: CPU time of the GPU process (ms) | 484 <sub>422-531</sub> | 406 <sub>312-531</sub> | 992 <sub>938-1,109</sub> |
| Scroll: CPU time of the renderer (ms) | 1,992 <sub>1,891-2,141</sub> | 2,008 <sub>1,922-2,062</sub> | 1,859 <sub>1,734-1,953</sub> |
| Scroll: CPU time, all processes (ms) | 4,172 <sub>4,140-4,438</sub> | 4,156 <sub>3,922-4,234</sub> | 4,586 <sub>4,438-4,734</sub> |
| Typing: key to next frame, p50 (ms) | 125 <sub>124-127</sub> | 125 <sub>125-126</sub> | 125 <sub>125-127</sub> |
| Typing: p95 (ms) | 145 <sub>138-150</sub> | 144 <sub>140-152</sub> | 140 <sub>136-144</sub> |
| Typing: max (ms) | 159 <sub>156-160</sub> | 157 <sub>154-176</sub> | 159 <sub>156-161</sub> |

- GPU-process CPU time over the scroll, every run, ms: SG-solid-shown-nogpu 422 437 453 516 516 531; FG-light-shown-nogpu 312 344 375 437 500 531; G-glass-shown-nogpu 938 984 984 1000 1062 1109.
- GPU-process private working set at idle, every run, MB: SG-solid-shown-nogpu 9.0 9.0 9.0 9.0 9.0 9.0; FG-light-shown-nogpu 9.0 9.0 9.0 9.0 9.0 9.0; G-glass-shown-nogpu 16.1 16.1 16.1 16.1 16.1 16.1.
- Frames are not affected (16.7 ms for all three; no late frame): the cost is CPU time, spent in the GPU process, about 0.1 of a core while scrolling, which a laptop on battery would notice more than a person at the screen would.
- With bars that fade (the default), the blur is not drawn while the bars are away: plan 1, E7 measured the same on a synthetic page (a bar at opacity 0 costs nothing).

## Startup, same session, alternated (4 rounds x 4 runs per exe; steps startup and memory)

| | v1.14 look (`v2-base.exe`) | P2a (`14e412f`) | this build (P2b) |
|---|---:|---:|---:|
| Process start to ready (page loaded, `window.backend` there) | 456 <sub>445-466</sub> | 465 <sub>450-486</sub> | 465 <sub>452-474</sub> |
| ... process start to the page navigation (Go + WebView2 creation) | 304 <sub>295-313</sub> | 298 <sub>296-308</sub> | 300 <sub>295-304</sub> |
| ... the page itself (navigation to ready) | 152 <sub>149-161</sub> | 166 <sub>153-179</sub> | 166 <sub>153-175</sub> |
| DOMContentLoaded | 453 <sub>442-463</sub> | 461 <sub>446-481</sub> | 461 <sub>449-470</sub> |
| First contentful paint | 431 <sub>416-441</sub> | 432 <sub>420-460</sub> | 428 <sub>419-445</sub> |
| App initialised (tab bar drawn) | 468 <sub>458-478</sub> | 478 <sub>465-497</sub> | 478 <sub>461-491</sub> |
| Private working set 10 s after ready, all processes (MB) | 109.2 <sub>108.2-112.0</sub> | 110.2 <sub>108.8-113.0</sub> | 110.3 <sub>108.9-113.2</sub> |
| ... GPU process (MB) | 28.1 <sub>28.0-28.2</sub> | 28.4 <sub>28.3-29.0</sub> | 28.1 <sub>28.0-28.5</sub> |
| Files the page loads (resource entries) | 43 | 47 | 47 |

(Median, then min-max. The first contentful paint has fewer samples for two of the exes because the harness cannot always read it; it does not move.)

## What this does not show

- **A Mac.** `-webkit-backdrop-filter` in WKWebView, `opacity` switches over a blurred bar in Safari 15 and the cost of `glass` there are unmeasured (`tools/MACOS_CHECKLIST_JA.md` section 8 has the checks). `light` is the default on every platform until a Mac says otherwise.
- **The owner's real note and a real mouse.** The note is generated, the wheel is synthetic (pointer still, so the bars fade), the keys are CDP key events. A pointer that keeps moving while someone reads keeps the bars shown, which is the `on` columns.
- **Another GPU.** One integrated GPU (Radeon 780M). A discrete card will do less of this work; an old integrated one more.
- **Small differences.** Each cell has 6 runs; the CPU time of a process is read in 15.6 ms ticks, and two identical hand measurements of the GPU process were seen to differ by 100 ms. A claim of less than 100 ms or 1 MB in a CPU column is not made.

## How to repeat it

```
# the exes: E2E build.sh builds this worktree (v2-p2b.exe); v2-base.exe is the v1.14 look; v2-p2a-head.exe is a clean checkout of 14e412f built
# the same way from a temporary `git worktree add --detach` (another overlay folder, so the first build's overlay is not touched);
# v2-p2b-wc.exe is v2-p2b plus `#header, #status-bar { will-change: opacity }` at the end of chrome.css.
node tools/perf/run_matrix.mjs --matrix tools/perf/matrix-p2-translucency.json --out <dir> --rounds 2 --runs 3     # 11 configurations, about 70 minutes
node tools/perf/run_matrix.mjs --matrix tools/perf/matrix-p2-willchange.json   --out <dir> --rounds 3 --runs 2     # about 35 minutes
node tools/perf/run_matrix.mjs --matrix tools/perf/matrix-p2-startup.json      --out <dir> --rounds 4 --runs 4 --steps startup,memory   # about 25 minutes
```

The three matrix files are in this folder (`motion` is `no-preference` in all of them, `barsState` `shown` and `autoHide: false` for the bars-on ones, `browserArgs` `--disable-gpu` for the three software ones; the format is in `README.md`, "run_matrix.mjs"). Do not run anything else heavy on the PC while they run: the harness waits for a quiet PC and repeats a run that was not.
