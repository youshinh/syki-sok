# P5: the sticky-note panels cost nothing (measured 2026-10-05)

The face of the floating panels changed in P5 (docs/design/panel-template.md, "The face of a panel"): a transparent square root with a static `box-shadow`, a `::before` paper layer (three stacked backgrounds, a `clip-path` on that layer only), a `::after` flap, a 14px band of padding, and a lighter scrim behind the modal ones. The worry was an 80,000-line note: a shadow or a pseudo-element must not make it slower to scroll while a panel is open, and must not make a panel open late. The root has no `filter`, no `backdrop-filter`, no `will-change`, no `clip-path` (`tests/panel_template_test.mjs` keeps it so).

## Method

Same session, interleaved (`tools/perf/run_matrix.mjs`, 2 rounds, round 2 in reverse order, 3 runs each, 6 per build), `--motion no-preference` (the 120 ms fade-in runs; this PC reports `prefers-reduced-motion: reduce`, which would switch it off), hardware GPU, no config patch, no busy-PC run was discarded or kept. Steps `startup,memory,open,scroll,typing,panels` (the new `panels` step: `tools/perf/README.md`).

- A: `v2-p5-prev.exe`, built from the v2 branch at `fabb29c` (P4b), before any P5 change.
- B: `v2-p5.exe`, the P5 work tree.

Each cell: median (min-max) over the 6 runs.

| Metric | A: before P5 | B: P5 |
|---|---:|---:|
| Ask / rewrite bar (Ctrl+L): keydown to the second frame it is shown in (ms) | 97.2 (90.6-102) | 93.0 (83.5-99.6) |
| Command bar (Ctrl+E) (ms) | 107 (94.0-114) | 100 (96.4-110) |
| Quick Actions panel (Ctrl+J) (ms) | 58.9 (44.0-96.6) | 56.7 (50.4-65.0) |
| Command palette (Ctrl+Shift+P, scrim over the window) (ms) | 95.3 (87.9-104) | 90.5 (82.2-94.0) |
| Notes search (Ctrl+Shift+F, scrim) (ms) | 69.2 (47.8-95.0) | 67.1 (49.3-90.3) |
| Wheel over the editor, ask bar open: frame interval p50 (ms) | 19.0 (18.9-19.3) | 18.9 (18.8-19.1) |
| ... p95 (ms) | 37.4 (37.2-37.9) | 37.4 (37.3-37.5) |
| ... max (ms) | 46.6 (37.9-55.3) | 47.0 (38.1-55.2) |
| ... frames over 50 ms | 0.5 (0-1) | 0.5 (0-1) |
| ... main-thread busy time (ms) | 1094 (856-1216) | 1092 (984-1263) |
| ... CPU time, GPU process (ms) | 570 (484-688) | 617 (563-844) |
| Wheel over the editor, command bar open: frame interval p50 (ms) | 18.8 (18.7-19.1) | 18.8 (18.7-19.0) |
| ... p95 (ms) | 37.4 (37.2-37.5) | 37.4 (37.1-37.6) |
| ... max (ms) | 38.3 (38.1-366) | 38.1 (37.8-54.9) |
| ... main-thread busy time (ms) | 1205 (913-1393) | 1096 (1010-1140) |
| ... CPU time, GPU process (ms) | 672 (594-703) | 609 (516-703) |
| Wheel over the editor, Quick Actions open: frame interval p50 (ms) | 18.2 (18.2-18.3) | 18.3 (18.2-18.3) |
| ... p95 (ms) | 19.2 (19.1-19.3) | 19.2 (19.0-19.2) |
| ... max (ms) | 30.3 (20.3-37.3) | 36.1 (21.3-36.4) |
| ... main-thread busy time (ms) | 1990 (1694-2098) | 1955 (1917-2056) |
| ... CPU time, GPU process (ms) | 531 (438-656) | 492 (422-609) |
| Startup: process start to ready (ms) | 536 (525-562) | 538 (528-548) |
| Memory idle: working set, all processes (MB) | 380 (378-382) | 380 (378-385) |
| Memory idle: private working set (MB) | 113 (112-117) | 114 (112-117) |
| Idle CPU, all processes (% of one logical processor) | 1.12 (0.45-1.94) | 1.04 (0.60-1.34) |
| Open the 80,000-line note (ms) | 1868 (1857-1877) | 1881 (1871-1900) |
| Scroll, no panel: frame interval p95 (ms) | 19.2 (19.0-19.4) | 19.3 (19.0-19.4) |
| Scroll, no panel: main-thread busy time (ms) | 1671 (1497-1993) | 1751 (1568-1847) |
| Typing 50 keys: key to next frame p50 (ms) | 131 (129-133) | 130 (128-131) |

## Reading it

- No metric of the panels is worse than the other build's range by more than the noise of this harness (the README lists which ones are noisy). The one number that is higher, the GPU process' CPU time with the ask bar open (570 against 617 ms), goes the other way for the command bar (672 against 609 ms) and the Quick Actions panel (531 against 492 ms): it is the spread of the step, not the panel. The opening times are equal or a few ms shorter.
- The first two scenes (ask bar, command bar) have 60-70 "late" frames (p95 about 37 ms) in **both** builds, the Quick Actions scene none. That is the same before and after the change; its cause was not investigated here (the scene with a panel that holds the keyboard differs from the one where the editor holds it).
- Startup, memory, idle CPU, opening the note, scrolling and typing without a panel are unchanged: the face adds no script, no timer, no listener, and nothing is created until a panel is opened (the pseudo-elements exist only while a panel is displayed).
- The 14px band makes each panel 14px taller; the shadow is static (`box-shadow` only), so scrolling the text under a panel does not repaint it.
