// The operation-rhythm log, page side (frontend/js/telemetry.js): what a window of 30 seconds adds up to, that nothing exists while it is off,
// that the input listeners make nothing and read no text, and that what is sent is exactly the numbers the Go side accepts.
import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

console.log('=== telemetry (page side) ===');
// (read with the line ends made LF: a checkout on Windows may have CRLF, and the function bodies below are cut out by line)
const src = fs.readFileSync(new URL('../frontend/js/telemetry.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const goSrc = fs.readFileSync(new URL('../pkg/telemetry/telemetry.go', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---- a page: listeners and timers that can be driven by hand
function makePage() {
  const listeners = []; // { target, type, fn, capture }
  const timers = new Map();
  let timerId = 0;
  const sent = [];
  let clock = 1000;
  const document = {
    visibilityState: 'visible',
    focused: true,
    hasFocus() { return this.focused; },
    addEventListener: (type, fn) => listeners.push({ target: 'document', type, fn }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.target === 'document' && l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    }
  };
  const sandbox = {
    document,
    addEventListener: (type, fn, opts) => listeners.push({ target: 'window', type, fn, capture: !!(opts && opts.capture) }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.target === 'window' && l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    Date: { now: () => 1776412800000 },
    performance: { now: () => clock }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const T = sandbox.Telemetry;
  const editor = { id: 'editor' };
  const other = { id: 'settings-field' };
  T.init({ send: (json) => { sent.push(JSON.parse(json)); }, targets: [editor], now: () => clock });
  const fire = (type, ev) => listeners.filter((l) => l.type === type && l.target === 'window').forEach((l) => l.fn(ev));
  const key = (t, over) => Object.assign({ type: 'keydown', code: 'KeyA', keyCode: 65, timeStamp: t, repeat: false, ctrlKey: false, metaKey: false, isComposing: false, target: editor }, over || {});
  // one press: keydown at t, keyup at t + dwell
  const press = (t, dwell, over) => {
    fire('keydown', key(t, over));
    fire('keyup', Object.assign(key(t + dwell, over), { type: 'keyup' }));
  };
  const runTimer = () => { const all = [...timers.entries()]; timers.clear(); all.forEach(([, v]) => v.fn()); return all.length; };
  return { T, sandbox, listeners, timers, sent, editor, other, fire, key, press, runTimer, setClock: (v) => { clock = v; }, document };
}

const NAMES = ['v', 'ts', 'dur_ms', 'keys', 'mean_dwell_ms', 'iki_mean_ms', 'iki_cv', 'delete_ratio', 'nav_ratio', 'ime_ratio', 'ime_delete_ratio',
  'stall_pauses', 'mouse_dist_px', 'mouse_turns', 'scroll_events', 'scroll_flips', 'scroll_px', 'cmd_count', 'last_cmd', 'cmd_latency_ms', 'voice_starts', 'voice_ms',
  'win_state', 'zen', 'view', 'win_changed', 'blur_count', 'focus_ms'];

// ---- off: nothing exists
{
  const p = makePage();
  assert.strictEqual(p.listeners.length, 0, 'no listener while it is off (the default)');
  assert.strictEqual(p.timers.size, 0, 'no timer');
  assert.strictEqual(p.T.isEnabled(), false);
  p.T.command(2);
  p.T.voice(true);
  assert.strictEqual(p.timers.size, 0, 'commands and voice are not counted while off');
  p.fire('keydown', p.key(1));
  assert.strictEqual(p.timers.size, 0);
  p.T.setEnabled(true);
  assert.deepStrictEqual(p.listeners.map((l) => l.target + ':' + l.type).sort(), ['document:visibilitychange', 'window:blur', 'window:focus', 'window:keydown', 'window:keyup', 'window:mousemove', 'window:pagehide', 'window:wheel']);
  assert.ok(p.listeners.find((l) => l.type === 'keydown').capture, 'keydown is seen before the shortcuts consume it');
  p.T.setEnabled(true);
  assert.strictEqual(p.listeners.length, 8, 'turning it on twice adds nothing');
  p.press(10, 80);
  assert.strictEqual(p.timers.size, 1, 'the first input of a window arms one timer');
  p.T.setEnabled(false);
  assert.strictEqual(p.listeners.length, 0, 'off again: every listener is gone');
  assert.strictEqual(p.timers.size, 0, 'and the timer');
  assert.strictEqual(p.sent.length, 0, 'what was counted is dropped, not sent');
}

// ---- a window of typing: the numbers
{
  const p = makePage();
  p.T.setEnabled(true);
  // 6 presses, key down times 0, 100, 200, 400, 500, 600 (intervals 100, 100, 200, 100, 100), each held 80 ms
  [0, 100, 200, 400, 500, 600].forEach((t) => p.press(t + 5000, 80));
  p.setClock(5000 + 30000);
  assert.strictEqual(p.timers.size, 1, 'one timer for the whole window');
  assert.strictEqual([...p.timers.values()][0].ms, 30000, 'a window is 30 s');
  assert.strictEqual(p.runTimer(), 1);
  assert.strictEqual(p.sent.length, 1);
  const s = p.sent[0];
  assert.deepStrictEqual(Object.keys(s), NAMES, 'the fields, in the order of the log');
  assert.strictEqual(s.v, 1);
  assert.strictEqual(s.keys, 6);
  assert.strictEqual(s.mean_dwell_ms, 80);
  assert.strictEqual(s.iki_mean_ms, 120);
  const mean = 120; const sd = Math.sqrt(((20 ** 2) * 4 + 80 ** 2) / 5 - 0); // intervals 100,100,200,100,100: mean 120
  assert.ok(Math.abs(s.iki_cv - Math.round((Math.sqrt((4 * 400 + 6400) / 5) / mean) * 1000) / 1000) < 0.002, 'iki_cv is the spread over the mean: ' + s.iki_cv + ' ' + sd);
  assert.strictEqual(s.delete_ratio, 0);
  assert.strictEqual(s.stall_pauses, 0);
  assert.strictEqual(s.dur_ms, 30000);
  assert.ok(Object.values(s).every((v) => typeof v === 'number' && Number.isFinite(v)), 'every value is a number');
  assert.strictEqual(p.timers.size, 0, 'nothing is armed after the window');
  // the next window starts clean and, with nothing typed or moved, there is nothing to send and no timer at all
  assert.strictEqual(p.runTimer(), 0);
  p.press(40000, 80);
  p.runTimer();
  assert.strictEqual(p.sent.length, 2);
  assert.strictEqual(p.sent[1].keys, 1, 'the second window counts only its own');
}

// ---- what is not typing
{
  const p = makePage();
  p.T.setEnabled(true);
  p.fire('keydown', p.key(100, { repeat: true }));
  p.fire('keydown', p.key(110, { ctrlKey: true }));
  p.fire('keydown', p.key(120, { metaKey: true }));
  p.fire('keydown', p.key(130, { code: 'ShiftLeft', keyCode: 16 }));
  p.fire('keydown', p.key(140, { code: 'ControlRight', keyCode: 17 }));
  p.fire('keydown', p.key(150, { target: p.other }));
  assert.strictEqual(p.timers.size, 0, 'a repeat, a chord, a modifier and a key in another field are not counted (and arm nothing)');
  p.press(200, 50);
  p.runTimer();
  assert.strictEqual(p.sent[0].keys, 1);
}

// ---- pauses
{
  const p = makePage();
  p.T.setEnabled(true);
  p.press(1000, 50);
  p.press(1100, 50);     // 100: rhythm
  p.press(3500, 50);     // 2400: a stall
  p.press(3600, 50);     // 100
  p.press(40000, 50);    // 36400: away, neither
  p.press(40100, 50);    // 100
  p.runTimer();
  const s = p.sent[0];
  assert.strictEqual(s.keys, 6);
  assert.strictEqual(s.stall_pauses, 1, 'only the pause between 2 s and 30 s is a stall');
  assert.strictEqual(s.iki_mean_ms, 100, 'and neither it nor the absence is in the rhythm');
  assert.strictEqual(s.iki_cv, 0);
}

// ---- deleting, moving the caret, and the IME
{
  const p = makePage();
  p.T.setEnabled(true);
  let t = 1000;
  const k = (over) => { p.press(t, 60, over); t += 120; };
  k({ code: 'KeyA' }); k({ code: 'KeyB' }); k({ code: 'Backspace', keyCode: 8 }); k({ code: 'ArrowLeft', keyCode: 37 }); k({ code: 'Delete', keyCode: 46 });
  // the IME is composing: the presses come as keyCode 229
  k({ code: 'KeyK', keyCode: 229, isComposing: true }); k({ code: 'KeyA', keyCode: 229, isComposing: true });
  k({ code: 'Backspace', keyCode: 229, isComposing: true }); k({ code: 'ArrowDown', keyCode: 229, isComposing: true });
  p.runTimer();
  const s = p.sent[0];
  assert.strictEqual(s.keys, 9);
  assert.strictEqual(s.delete_ratio, Math.round((2 / 9) * 1000) / 1000, 'Backspace and Delete outside a composition');
  assert.strictEqual(s.nav_ratio, Math.round((1 / 9) * 1000) / 1000, 'an arrow outside a composition (one in it chooses a candidate)');
  assert.strictEqual(s.ime_ratio, Math.round((4 / 9) * 1000) / 1000, 'presses made while composing');
  assert.strictEqual(s.ime_delete_ratio, 0.25, 'a Backspace in a composition edits the reading: counted apart');
  assert.strictEqual(s.mean_dwell_ms, 60, 'the dwell is measured for composing keys too (a slot by code, whatever the IME made of keyCode)');
}

// ---- the pointer
{
  const p = makePage();
  p.T.setEnabled(true);
  const mv = (t, x, y) => p.fire('mousemove', { type: 'mousemove', timeStamp: t, clientX: x, clientY: y });
  mv(1000, 100, 100);   // first sample: a start
  mv(1005, 500, 500);   // within a frame: dropped
  mv(1020, 110, 100);   // +10
  mv(1040, 130, 100);   // +20
  mv(1060, 120, 100);   // 10 back: a turn
  mv(1080, 125, 100);   // 5 forward: a turn
  mv(3000, 900, 700);   // the pointer rested: a new movement, the jump is not distance
  mv(3020, 900, 710);   // +10
  p.runTimer();
  const s = p.sent[0];
  assert.strictEqual(s.mouse_dist_px, 10 + 20 + 10 + 5 + 10, 'a sum of steps, one sample per frame, no jump after a rest');
  assert.strictEqual(s.mouse_turns, 2);
  assert.strictEqual(s.keys, 0);
}

// ---- the wheel
{
  const p = makePage();
  p.T.setEnabled(true);
  [100, 100, -100, -100, 100].forEach((d, i) => p.fire('wheel', { type: 'wheel', timeStamp: 1000 + i, deltaY: d }));
  p.runTimer();
  const s = p.sent[0];
  assert.strictEqual(s.scroll_events, 5);
  assert.strictEqual(s.scroll_flips, 2);
  assert.strictEqual(s.scroll_px, 500);
}

// ---- commands and voice
{
  const p = makePage();
  p.T.setEnabled(true);
  p.press(1000, 50);
  p.press(1200, 50);
  p.fire('keydown', p.key(2700, { ctrlKey: true, code: 'KeyL', keyCode: 76 })); // the chord itself is not typing
  p.setClock(2700);
  p.T.command(2);
  p.T.command(1);
  p.setClock(3000);
  p.T.voice(true);
  p.T.voice(true); // a second start while on is nothing
  p.setClock(11000);
  p.T.voice(false);
  p.T.voice(false);
  p.runTimer();
  const s = p.sent[0];
  assert.strictEqual(s.keys, 2, 'the chord is not a key press');
  assert.strictEqual(s.cmd_count, 2);
  assert.strictEqual(s.last_cmd, 1);
  assert.strictEqual(s.cmd_latency_ms, 1500, 'time since the last typing key (down at 1200)');
  assert.strictEqual(s.voice_starts, 1);
  assert.strictEqual(s.voice_ms, 8000, 'how long the microphone was on: a number, nothing about what was said');
  p.T.command(500);
  p.runTimer();
  assert.strictEqual(p.sent[1].last_cmd, 99, 'an id that is not one of the five is "other"');
  // nothing typed for 10 minutes: the latency is unknown
  p.setClock(1200 + 700000);
  p.T.command(3);
  p.runTimer();
  assert.strictEqual(p.sent[2].cmd_latency_ms, 0);
}

// ---- the focus: how often another app was used, and for how long the window had it
{
  const p = makePage();
  p.T.setEnabled(true);
  p.press(1000, 50);                       // the window begins at 1000 (clock 1000), the focus is on
  p.setClock(1000);
  p.fire('blur', { type: 'blur', timeStamp: 11000 });   // 10 s later: another app
  p.fire('blur', { type: 'blur', timeStamp: 11500 });   // a second blur while it is away is nothing
  p.fire('focus', { type: 'focus', timeStamp: 21000 }); // 10 s away, back
  p.fire('focus', { type: 'focus', timeStamp: 21100 }); // a second focus is nothing
  p.fire('blur', { type: 'blur', timeStamp: 26000 });   // 5 s more with the focus, away again
  p.setClock(31000);
  p.runTimer();
  const s = p.sent[0];
  assert.strictEqual(s.blur_count, 2, 'how often the window lost the focus');
  assert.strictEqual(s.focus_ms, 10000 + 5000, 'how long it had it: 1000-11000 and 21000-26000');
  assert.strictEqual(s.dur_ms, 30000);
  // only the window got and lost the focus: that is something to write down (another app was in use) even with no key and no mouse
  const q = makePage();
  q.T.setEnabled(true);
  q.fire('blur', { type: 'blur', timeStamp: 5000 });
  q.runTimer();
  assert.strictEqual(q.sent.length, 1, 'a window with only a blur is written');
  assert.strictEqual(q.sent[0].blur_count, 1);
  assert.strictEqual(q.sent[0].keys, 0);
  // the focus came back and nothing else happened for the whole window: the time with the focus is still a number worth having
  const r = makePage();
  r.T.setEnabled(true);
  r.document.focused = false;
  r.T.setEnabled(false);
  r.T.setEnabled(true); // starts without the focus
  r.fire('focus', { type: 'focus', timeStamp: 100 });
  r.setClock(30100);
  r.runTimer();
  assert.strictEqual(r.sent.length, 1);
  assert.strictEqual(r.sent[0].focus_ms, 30000, 'focus_ms never exceeds the window');
  assert.ok(r.sent[0].focus_ms <= r.sent[0].dur_ms);
  // one that has the focus the whole time and is typed in
  const w = makePage();
  w.T.setEnabled(true);
  w.press(2000, 50);
  w.setClock(32000);
  w.runTimer();
  assert.strictEqual(w.sent[0].blur_count, 0);
  assert.strictEqual(w.sent[0].focus_ms, 30000, 'the whole window');
}

// ---- the window's state: Zen, maximized, snapped to a side; and whether it changed
{
  const p = makePage();
  let now = { state: 0, zen: 0, view: 0 };
  p.T.init({ send: (j) => p.sent.push(JSON.parse(j)), targets: [p.editor], now: () => 1000, windowSample: () => now });
  p.T.setEnabled(true);
  const windowOf = (over) => { now = Object.assign({ state: 0, zen: 0, view: 0 }, over); p.press(10, 50); p.runTimer(); return p.sent[p.sent.length - 1]; };
  let s = windowOf({});
  assert.deepStrictEqual([s.win_state, s.zen, s.view, s.win_changed], [0, 0, 0, 0], 'the first window has nothing to differ from');
  s = windowOf({});
  assert.strictEqual(s.win_changed, 0, 'the same again: not changed');
  s = windowOf({ state: 2 });
  assert.deepStrictEqual([s.win_state, s.win_changed], [2, 1], 'snapped to a side: a change');
  s = windowOf({ state: 2, zen: 1, view: 2 });
  assert.deepStrictEqual([s.win_state, s.zen, s.view, s.win_changed], [2, 1, 2, 1], 'Zen and a split view');
  s = windowOf({ state: 3 });
  assert.strictEqual(s.win_state, 3);
  // junk from the sampler becomes 0, and a sampler that throws does not stop the window being written
  s = windowOf({ state: 9, zen: 'yes', view: -4 });
  assert.deepStrictEqual([s.win_state, s.zen, s.view], [0, 1, 0], 'out of range: 0 (zen is a flag)');
  p.T.init({ send: (j) => p.sent.push(JSON.parse(j)), targets: [p.editor], now: () => 1000, windowSample: () => { throw new Error('x'); } });
  p.press(10, 50);
  p.runTimer();
  assert.strictEqual(p.sent[p.sent.length - 1].win_state, 0);
  // no sampler: zeros, never "changed"
  const q = makePage();
  q.T.setEnabled(true);
  q.press(10, 50);
  q.runTimer();
  assert.deepStrictEqual([q.sent[0].win_state, q.sent[0].zen, q.sent[0].view, q.sent[0].win_changed], [0, 0, 0, 0]);
}

// ---- the window ends when the page is hidden, not when it comes back
{
  const p = makePage();
  p.T.setEnabled(true);
  p.press(1000, 50);
  p.document.visibilityState = 'visible';
  p.listeners.filter((l) => l.type === 'visibilitychange').forEach((l) => l.fn());
  assert.strictEqual(p.sent.length, 0, 'becoming visible sends nothing');
  p.document.visibilityState = 'hidden';
  p.listeners.filter((l) => l.type === 'visibilitychange').forEach((l) => l.fn());
  assert.strictEqual(p.sent.length, 1, 'hidden: what was counted is written now');
  assert.strictEqual(p.timers.size, 0, 'and its timer is gone');
  p.press(5000, 50);
  p.listeners.filter((l) => l.type === 'pagehide').forEach((l) => l.fn());
  assert.strictEqual(p.sent.length, 2, 'closing the page does the same');
}

// ---- what is sent is what the Go side accepts
{
  const tags = [...goSrc.matchAll(/`json:"([a-z_0-9]+)"`/g)].map((m) => m[1]);
  assert.deepStrictEqual(tags, NAMES, 'the page sends exactly the fields pkg/telemetry.Snapshot knows, in its order');
}

// ---- send failures never reach the person
{
  const p = makePage();
  p.T.init({ send: () => Promise.reject(new Error('off')), targets: [p.editor], now: () => 1 });
  p.T.setEnabled(true);
  p.press(1000, 50);
  p.runTimer(); // an unhandled rejection would fail the run
  const q = makePage();
  q.T.init({ send: () => { throw new Error('boom'); }, targets: [q.editor], now: () => 1 });
  q.T.setEnabled(true);
  q.press(1000, 50);
  assert.doesNotThrow(() => q.runTimer());
}

// ---- the source: no text is read, the listeners make nothing
{
  const code = src.replace(/\/\/[^\n]*/g, ''); // without the comments
  assert.ok(!/\b(e|ev|event)\.key\b/.test(code), 'e.key (the character) is never read');
  assert.ok(!/\.(value|innerText|textContent|data|clipboardData|getSelection)\b/.test(code), 'no text of the page is read');
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB)\b/.test(code), 'it writes nowhere itself: only the one send() it is given');
  assert.ok(!/getUserMedia|AudioContext|MediaRecorder|createAnalyser/.test(code), 'it does not touch the microphone: it is only told when voice input starts and stops');
  const fnSrc = (name) => {
    const m = new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n').exec(code);
    assert.ok(m, name + ' exists');
    return m[0];
  };
  for (const name of ['onKeyDown', 'onKeyUp', 'onMouseMove', 'onWheel', 'onBlur', 'onFocus', 'touch', 'slotOf', 'isModifier', 'isNav', 'isTracked']) {
    const body = fnSrc(name);
    assert.ok(!/\bnew\s/.test(body), name + ': no new');
    assert.ok(!/\.(push|map|filter|slice|concat|splice|forEach|fill|join|split)\(/.test(body), name + ': no array or string work');
    assert.ok(!/(JSON|Object|Array|Date|Math\.random|Symbol)\./.test(body), name + ': no JSON / Object / Array / Date');
    assert.ok(!/`/.test(body), name + ': no template string');
    assert.ok(!/=>/.test(body) && !/\bfunction\b/.test(body.replace(/^\s*function [A-Za-z]+/, '')), name + ': no closure');
    assert.ok(!/[=(,:?]\s*[\[{]/.test(body.replace(/\)\s*\{\s*$/gm, ')')) || name === 'slotOf', name + ': no object or array literal');
    assert.ok(!/document\.|getElementById|querySelector|getBoundingClientRect|offsetWidth|getComputedStyle|requestAnimationFrame|\.style\b/.test(body), name + ': no DOM and no layout');
    assert.ok(!/performance\.now|nowFn\(/.test(body), name + ': the time is the event\'s own (e.timeStamp), no clock call');
  }
}

// ---- how big it is, and how fast
{
  const p = makePage();
  assert.ok(p.T.footprintBytes() <= 5 * 1024, 'the whole state is under 5 KB: ' + p.T.footprintBytes());
  p.T.setEnabled(true);
  const down = p.listeners.find((l) => l.type === 'keydown').fn;
  const up = p.listeners.find((l) => l.type === 'keyup').fn;
  const move = p.listeners.find((l) => l.type === 'mousemove').fn;
  const ev = p.key(0);
  const evUp = Object.assign({}, ev, { type: 'keyup' });
  const mv = { type: 'mousemove', timeStamp: 0, clientX: 0, clientY: 0 };
  const N = 400000;
  for (let i = 0; i < 20000; i++) { ev.timeStamp = i; down(ev); evUp.timeStamp = i + 50; up(evUp); } // warm up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    ev.timeStamp = 100000 + i * 20; down(ev);
    evUp.timeStamp = ev.timeStamp + 70; up(evUp);
    mv.timeStamp = 100000 + i * 20; mv.clientX = (i * 7) & 1023; mv.clientY = (i * 3) & 511; move(mv);
  }
  const ns = Number(process.hrtime.bigint() - t0);
  const perEventUs = ns / 1000 / (N * 3);
  assert.ok(perEventUs < 5, 'an input listener takes ' + perEventUs.toFixed(3) + ' us on average (the limit is 50 us in a browser; 5 us here)');
  console.log('  input listener: ' + perEventUs.toFixed(3) + ' us per event');
}

console.log('telemetry (page side) tests passed');
