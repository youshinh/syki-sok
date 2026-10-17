// syki::sok operation-rhythm log (the page side). When the person turns it on (Settings > General > "Keep an operation-rhythm log"), this
// counts HOW they work, in windows of 30 seconds: the rhythm of the key presses, how the pointer moves and the page scrolls, which command was
// called and how soon after the last key, how often voice input was started and for how long, and how the window was: Zen, maximized, snapped
// to a side of the screen, and how often and for how long it had the focus (that is how it shows that other apps are used alongside).
// One line of numbers per window goes to the
// Go side (pkg/telemetry), which keeps it in a folder on this PC.
//
// What it never keeps: what was typed, which key it was, where the pointer was, the audio of the voice input or anything about it. The
// listeners only add numbers into a few fixed slots, and Go refuses any line that is not numbers of the known names.
//
// Why it costs nothing:
//   - off (the default): not a listener, not a timer;
//   - on: the four input listeners (keydown, keyup, mousemove, wheel) do a few additions in preallocated typed arrays and return. They
//     make no object, no array, no closure and no string (frozen by tests/telemetry_test.mjs), and touch no DOM. mousemove is cut to one
//     sample per 16 ms. There is no interval: one timer is armed by the first input of a window and nothing runs when nothing is typed or
//     moved. The whole state is about 2.3 KB.
//   - the one place that makes objects (the summary of a window, every 30 s) runs from that timer, never from an input listener.
//
// Japanese input: while an IME composes, the keys come with keyCode 229 / isComposing. They count for the rhythm (that is how the
// person types), but a Backspace there edits the reading, not the text, so composing presses and their Backspaces are counted apart
// (ime_ratio, ime_delete_ratio) and delete_ratio is about the other presses only.
(function (global) {
  'use strict';

  const WINDOW_MS = 30000;   // length of a window
  const STALL_MS = 2000;     // a pause of at least this between two key presses is a stall ...
  const IDLE_MS = 30000;     // ... unless it is this long: that is the person being away, and counts as neither
  const DWELL_CAP_MS = 2000; // a key held longer than this (a stuck key, a held modifier) counts as this
  const MOUSE_STEP_MS = 16;  // at most one pointer sample per frame
  const MOUSE_GAP_MS = 500;  // a pointer that rested longer than this starts a new movement
  const TURN_MIN_PX = 3;     // a change of direction counts when the step is at least this long
  const VERSION = 1;

  // accumulator slots (one Float64Array, reset at the end of each window)
  const KEYS = 0, DWELL_SUM = 1, DWELL_N = 2, IKI_N = 3, IKI_SUM = 4, IKI_SUM2 = 5, DEL = 6, NAV = 7, IME = 8, IME_DEL = 9, STALL = 10,
    MDIST = 11, MTURNS = 12, WHEELS = 13, FLIPS = 14, SCROLL_PX = 15, CMDS = 16, LAST_CMD = 17, CMD_LAT = 18, VOICES = 19, VOICE_MS = 20,
    BLURS = 21, FOCUS_MS = 22, T_START = 23, SLOTS = 24;
  const acc = new Float64Array(SLOTS);
  const down = new Float64Array(256); // when a key went down, by a hash of its code (0: not down)

  // the rest of the state: plain numbers
  let enabled = false;
  let armed = false;
  let timer = 0;
  let lastDown = 0;      // when the last typing key went down
  let lastMX = 0, lastMY = 0, lastMT = -1e9, prevDX = 0, prevDY = 0;
  let lastWheelDir = 0;
  let voiceT0 = 0;
  let focused = true;    // the window has the focus
  let focusT0 = 0;       // since when (inside the window being counted)
  let lastWinPacked = -1; // win_state, zen and view of the window before, in one number
  let sampleWindow = null; // () => { state, zen, view }: what the window looks like (called when a window ends, never from a listener)
  let targets = [];      // the text surfaces whose key presses count (the editors and the bars' inputs)
  let sendFn = null;
  let nowFn = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());

  // ---------------------------------------------------------------------------------------------------------------------------------
  // the input listeners: numbers in, nothing out, nothing made

  function isTracked(t) {
    for (let i = 0; i < targets.length; i++) if (targets[i] === t) return true;
    return false;
  }

  // a slot for a key from its code ("KeyA", "Backspace" ...): the same for keydown and keyup, whatever an IME made of keyCode
  function slotOf(code, keyCode) {
    const n = code.length;
    if (n === 0) return keyCode & 255;
    return (code.charCodeAt(0) * 31 + code.charCodeAt(n > 3 ? 3 : n - 1) * 7 + code.charCodeAt(n - 1) * 3 + n) & 255;
  }

  function isModifier(c) {
    return c === 'ShiftLeft' || c === 'ShiftRight' || c === 'ControlLeft' || c === 'ControlRight' || c === 'AltLeft' || c === 'AltRight' ||
      c === 'MetaLeft' || c === 'MetaRight' || c === 'OSLeft' || c === 'OSRight';
  }

  function isNav(c) {
    return c === 'ArrowLeft' || c === 'ArrowRight' || c === 'ArrowUp' || c === 'ArrowDown' || c === 'Home' || c === 'End' ||
      c === 'PageUp' || c === 'PageDown';
  }

  function touch(now) {
    if (armed) return;
    armed = true;
    acc[T_START] = now;
    if (focused) focusT0 = now;
    timer = setTimeout(onTimer, WINDOW_MS);
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey) return; // a command chord is not typing (the command itself is counted by command())
    const c = e.code || '';
    if (isModifier(c) || !isTracked(e.target)) return;
    const now = e.timeStamp;
    down[slotOf(c, e.keyCode)] = now;
    acc[KEYS]++;
    const composing = e.isComposing || e.keyCode === 229;
    if (composing) acc[IME]++;
    if (c === 'Backspace' || c === 'Delete') {
      if (composing) acc[IME_DEL]++; else acc[DEL]++;
    } else if (!composing && isNav(c)) {
      acc[NAV]++;
    }
    if (lastDown > 0) {
      const gap = now - lastDown;
      if (gap >= IDLE_MS || gap < 0) {
        // away (or the clock went back): neither
      } else if (gap >= STALL_MS) {
        acc[STALL]++;
      } else {
        acc[IKI_N]++;
        acc[IKI_SUM] += gap;
        acc[IKI_SUM2] += gap * gap;
      }
    }
    lastDown = now;
    touch(now);
  }

  function onKeyUp(e) {
    const s = slotOf(e.code || '', e.keyCode);
    const t0 = down[s];
    if (t0 > 0) {
      down[s] = 0;
      const d = e.timeStamp - t0;
      if (d >= 0) {
        acc[DWELL_SUM] += d > DWELL_CAP_MS ? DWELL_CAP_MS : d;
        acc[DWELL_N]++;
      }
    }
  }

  function onMouseMove(e) {
    const now = e.timeStamp;
    if (now - lastMT < MOUSE_STEP_MS) return;
    const x = e.clientX;
    const y = e.clientY;
    if (now - lastMT <= MOUSE_GAP_MS) {
      const dx = x - lastMX;
      const dy = y - lastMY;
      const step = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
      acc[MDIST] += step;
      if (step >= TURN_MIN_PX && (dx * prevDX < 0 || dy * prevDY < 0)) acc[MTURNS]++;
      prevDX = dx;
      prevDY = dy;
    } else {
      prevDX = 0;
      prevDY = 0;
    }
    lastMX = x;
    lastMY = y;
    lastMT = now;
    touch(now);
  }

  function onWheel(e) {
    const dy = e.deltaY;
    acc[WHEELS]++;
    acc[SCROLL_PX] += dy < 0 ? -dy : dy;
    const dir = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
    if (dir !== 0) {
      if (lastWheelDir !== 0 && dir !== lastWheelDir) acc[FLIPS]++;
      lastWheelDir = dir;
    }
    touch(e.timeStamp);
  }

  // The window lost the focus (another app was used) or got it back: how often, and how long it had it.
  function onBlur(e) {
    const now = e.timeStamp;
    touch(now);
    if (!focused) return;
    focused = false;
    acc[BLURS]++;
    acc[FOCUS_MS] += now - focusT0;
  }

  function onFocus(e) {
    const now = e.timeStamp;
    if (focused) return;
    focused = true;
    touch(now);
    focusT0 = now;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // what is called from the app (not input listeners)

  // A command was called: id 1 Ctrl+J, 2 Ctrl+L, 3 Ctrl+E, 4 Ctrl+Enter, 5 voice input, 99 anything else.
  function command(id) {
    if (!enabled) return;
    const now = nowFn();
    acc[CMDS]++;
    acc[LAST_CMD] = id > 0 && id <= 99 ? id : 99;
    // time since the last typing key; unknown (0) when nothing was typed for 10 minutes or more
    acc[CMD_LAT] = lastDown > 0 && now - lastDown >= 0 && now - lastDown < 600000 ? now - lastDown : 0;
    touch(now);
  }

  // Voice input started (true) or stopped (false): the count and how long the microphone was on, nothing else.
  function voice(on) {
    if (!enabled) return;
    const now = nowFn();
    if (on) {
      if (voiceT0 > 0) return;
      voiceT0 = now;
      acc[VOICES]++;
    } else if (voiceT0 > 0) {
      acc[VOICE_MS] += now - voiceT0;
      voiceT0 = 0;
    }
    touch(now);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // the summary of a window (makes an object: runs from the timer, not from an input listener)

  function r3(v) { return Math.round(v * 1000) / 1000; }

  function summary(dur, win) {
    const keys = acc[KEYS];
    const ikiN = acc[IKI_N];
    const ikiMean = ikiN > 0 ? acc[IKI_SUM] / ikiN : 0;
    const ikiVar = ikiN > 1 ? Math.max(0, acc[IKI_SUM2] / ikiN - ikiMean * ikiMean) : 0;
    return {
      v: VERSION,
      ts: Date.now(),
      dur_ms: Math.round(Math.min(Math.max(dur, 0), 600000)),
      keys: keys,
      mean_dwell_ms: acc[DWELL_N] > 0 ? Math.round(acc[DWELL_SUM] / acc[DWELL_N]) : 0,
      iki_mean_ms: Math.round(ikiMean),
      iki_cv: ikiMean > 0 ? r3(Math.min(Math.sqrt(ikiVar) / ikiMean, 100)) : 0,
      delete_ratio: keys > 0 ? r3(acc[DEL] / keys) : 0,
      nav_ratio: keys > 0 ? r3(acc[NAV] / keys) : 0,
      ime_ratio: keys > 0 ? r3(acc[IME] / keys) : 0,
      ime_delete_ratio: acc[IME] > 0 ? r3(acc[IME_DEL] / acc[IME]) : 0,
      stall_pauses: acc[STALL],
      mouse_dist_px: Math.round(acc[MDIST]),
      mouse_turns: acc[MTURNS],
      scroll_events: acc[WHEELS],
      scroll_flips: acc[FLIPS],
      scroll_px: Math.round(acc[SCROLL_PX]),
      cmd_count: acc[CMDS],
      last_cmd: acc[LAST_CMD],
      cmd_latency_ms: Math.round(acc[CMD_LAT]),
      voice_starts: acc[VOICES],
      voice_ms: Math.round(Math.min(acc[VOICE_MS], 600000)),
      win_state: win.state,
      zen: win.zen,
      view: win.view,
      win_changed: win.changed,
      blur_count: acc[BLURS],
      focus_ms: Math.round(Math.min(acc[FOCUS_MS], dur, 600000))
    };
  }

  // The window as it is when a window of counting ends: small whole numbers (win_state 0 floating, 1 maximized, 2 snapped to a side,
  // 3 full screen; zen 0/1; view 0 editor, 1 preview, 2 split), and whether any of them differs from the window before.
  function windowNow() {
    let state = 0, zen = 0, view = 0;
    if (typeof sampleWindow === 'function') {
      try {
        const w = sampleWindow() || {};
        state = w.state >= 0 && w.state <= 3 ? w.state | 0 : 0;
        zen = w.zen ? 1 : 0;
        view = w.view >= 0 && w.view <= 2 ? w.view | 0 : 0;
      } catch (err) { /* best effort */ }
    }
    const packed = state * 100 + zen * 10 + view;
    const changed = lastWinPacked >= 0 && packed !== lastWinPacked ? 1 : 0;
    lastWinPacked = packed;
    return { state: state, zen: zen, view: view, changed: changed };
  }

  function active() {
    return acc[KEYS] > 0 || acc[MDIST] > 0 || acc[WHEELS] > 0 || acc[CMDS] > 0 || acc[VOICES] > 0 || acc[VOICE_MS] > 0 || acc[BLURS] > 0 ||
      acc[FOCUS_MS] >= 1000;
  }

  function resetWindow() {
    acc.fill(0);
    armed = false;
  }

  // Ends the window: sends its summary when anything happened in it, then starts clean. Returns the summary (or null).
  function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    const end = nowFn();
    if (armed && focused) acc[FOCUS_MS] += end - focusT0; // the time since the window began (or the focus came back), up to now
    if (!armed || !active()) { resetWindow(); focusT0 = end; return null; }
    const snap = summary(end - acc[T_START], windowNow());
    resetWindow();
    focusT0 = end;
    if (typeof sendFn === 'function') {
      try {
        const r = sendFn(JSON.stringify(snap));
        if (r && typeof r.catch === 'function') r.catch(() => {}); // the log is best effort: a refusal is not shown
      } catch (err) { /* best effort */ }
    }
    return snap;
  }

  function onTimer() {
    timer = 0;
    flush();
  }

  // the window is hidden or closed: what was counted so far is written now (a hidden page's timers are slowed down)
  function onPageHide() {
    flush();
  }

  function onVisibility() {
    if (global.document && global.document.visibilityState === 'hidden') flush();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------

  function attach() {
    global.addEventListener('keydown', onKeyDown, { capture: true, passive: true });
    global.addEventListener('keyup', onKeyUp, { capture: true, passive: true });
    global.addEventListener('mousemove', onMouseMove, { passive: true });
    global.addEventListener('wheel', onWheel, { passive: true });
    global.addEventListener('blur', onBlur, { passive: true });
    global.addEventListener('focus', onFocus, { passive: true });
    global.addEventListener('pagehide', onPageHide);
    if (global.document) global.document.addEventListener('visibilitychange', onVisibility);
    focused = !global.document || typeof global.document.hasFocus !== 'function' || !!global.document.hasFocus();
    focusT0 = nowFn();
  }

  function detach() {
    global.removeEventListener('keydown', onKeyDown, { capture: true });
    global.removeEventListener('keyup', onKeyUp, { capture: true });
    global.removeEventListener('mousemove', onMouseMove);
    global.removeEventListener('wheel', onWheel);
    global.removeEventListener('blur', onBlur);
    global.removeEventListener('focus', onFocus);
    global.removeEventListener('pagehide', onPageHide);
    if (global.document) global.document.removeEventListener('visibilitychange', onVisibility);
    if (timer) { clearTimeout(timer); timer = 0; }
    acc.fill(0);
    down.fill(0);
    armed = false;
    lastDown = 0;
    lastMT = -1e9;
    prevDX = 0;
    prevDY = 0;
    lastWheelDir = 0;
    voiceT0 = 0;
    lastWinPacked = -1;
  }

  // opts: send(json) hands a summary to the Go side; targets: the elements whose key presses count;
  // windowSample(): the window's state (see windowNow); now(): the clock (tests).
  function init(opts) {
    const o = opts || {};
    sendFn = typeof o.send === 'function' ? o.send : null;
    targets = Array.isArray(o.targets) ? o.targets.filter(Boolean) : [];
    if (typeof o.now === 'function') nowFn = o.now;
    sampleWindow = typeof o.windowSample === 'function' ? o.windowSample : null;
  }

  // Turning it off drops what was counted but not yet written, and removes every listener and the timer.
  function setEnabled(on) {
    const want = !!on;
    if (want === enabled) return;
    enabled = want;
    if (enabled) attach(); else detach();
  }

  global.Telemetry = {
    init: init,
    setEnabled: setEnabled,
    isEnabled: () => enabled,
    command: command,
    voice: voice,
    flush: flush,
    footprintBytes: () => acc.byteLength + down.byteLength,
    WINDOW_MS: WINDOW_MS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.Telemetry;
  }
})(typeof window !== 'undefined' ? window : globalThis);
