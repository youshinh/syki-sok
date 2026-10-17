// syki::sok activity log (the page side), the second tier of the operation-rhythm log (js/telemetry.js). Off until the person turns on
// "Keep a log of notes and requests" (Settings > General). Then it writes down, for a local model to read later ("where did I leave off"):
//   - edit: which note was written in, for how long, and how many characters it grew or shrank by (30-second stretches). The note itself is
//     on disk already; a line names it and counts, it never holds the text that was typed;
//   - ask / answer: a request typed in the Ask or Rewrite bar (the words the person typed, not the note text that went with them), where the
//     model is (local / cloud), and what became of it (put in the note, failed, cancelled).
// What is never kept: the keys that were pressed, the text typed into a note, the clipboard, the screen, audio. The Go side (pkg/telemetry
// ActivityStore) refuses any line that is not exactly one of these shapes.
//
// The one listener (beforeinput) is cheap in the way the rhythm log's are: it adds to a few preallocated numbers and makes nothing. The
// length of the note is read twice per 30 seconds (when a stretch begins and when it ends), never per key.
(function (global) {
  'use strict';

  const WINDOW_MS = 30000;
  const MAX_PROMPT = 2000;
  const MAX_PENDING = 32;
  const VERSION = 1;

  const INS = 0, DEL = 1, PASTE = 2, UNDO = 3, T_START = 4, START_LEN = 5, SLOTS = 6;
  const acc = new Float64Array(SLOTS);

  let enabled = false;
  let armed = false;
  let timer = 0;
  let curId = '';
  let curLabel = '';
  let targets = [];
  let sendFn = null;
  let noteIdFn = () => '';
  let noteLabelFn = () => '';
  let noteLenFn = () => 0;
  let nowFn = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());
  const pending = new Map(); // request id -> when it was sent (answers are written only for requests that were written down)

  // ---------------------------------------------------------------------------------------------------------------------------------
  // the listener: numbers in, nothing made

  function isTracked(t) {
    for (let i = 0; i < targets.length; i++) if (targets[i] === t) return true;
    return false;
  }

  function onBeforeInput(e) {
    if (!isTracked(e.target)) return;
    const id = noteIdFn();
    if (armed && id !== curId) flushEdit();
    if (!armed) begin(id, e.timeStamp);
    const t = e.inputType || '';
    if (t === 'insertFromPaste' || t === 'insertFromPasteAsQuotation') acc[PASTE]++;
    else if (t.indexOf('insert') === 0) acc[INS]++;
    else if (t.indexOf('delete') === 0) acc[DEL]++;
    else if (t === 'historyUndo' || t === 'historyRedo') acc[UNDO]++;
  }

  // a stretch of writing begins (the length is read before the first change of it)
  function begin(id, now) {
    armed = true;
    curId = id;
    acc[T_START] = now;
    acc[START_LEN] = noteLenFn();
    curLabel = noteLabelFn();
    timer = setTimeout(onTimer, WINDOW_MS);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------

  function send(obj) {
    if (typeof sendFn !== 'function') return;
    try {
      const r = sendFn(JSON.stringify(obj));
      if (r && typeof r.catch === 'function') r.catch(() => {}); // best effort: a refusal is not shown
    } catch (err) { /* best effort */ }
  }

  // Ends the stretch of writing: one line, when anything was done in it. The app calls this before another note comes to the front.
  function flushEdit() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!armed) return;
    armed = false;
    const done = acc[INS] + acc[DEL] + acc[PASTE] + acc[UNDO] > 0;
    if (done) {
      const same = noteIdFn() === curId;
      send({
        v: VERSION,
        ts: Date.now(),
        kind: 'edit',
        note: curLabel,
        dur_ms: Math.round(Math.min(Math.max(nowFn() - acc[T_START], 0), 600000)),
        net_chars: same ? Math.round(noteLenFn() - acc[START_LEN]) : 0,
        ins: acc[INS],
        del: acc[DEL],
        paste: acc[PASTE],
        undo: acc[UNDO]
      });
    }
    acc.fill(0);
  }

  function onTimer() {
    timer = 0;
    flushEdit();
  }

  function onPageHide() { flushEdit(); }

  function onVisibility() {
    if (global.document && global.document.visibilityState === 'hidden') flushEdit();
  }

  // A request typed in an AI bar was sent. mode: 'ask' | 'rewrite' | 'command' | 'other'; dest: 'local' | 'cloud' | 'unknown'; prompt: the
  // words the person typed.
  function ask(reqId, mode, dest, prompt) {
    if (!enabled || !reqId) return;
    if (pending.size >= MAX_PENDING) {
      for (const oldest of pending.keys()) { pending.delete(oldest); break; } // the one waited for longest is let go
    }
    pending.set(String(reqId), nowFn());
    send({
      v: VERSION,
      ts: Date.now(),
      kind: 'ask',
      req: String(reqId),
      mode: mode === 'ask' || mode === 'rewrite' || mode === 'command' ? mode : 'other',
      dest: dest === 'local' || dest === 'cloud' ? dest : 'unknown',
      prompt: String(prompt || '').slice(0, MAX_PROMPT)
    });
  }

  // What became of it: outcome 'ok' (put in the note), 'error' or 'cancel'; chars: the length of the answer.
  function answer(reqId, outcome, chars) {
    if (!enabled) return;
    const id = String(reqId);
    if (!pending.has(id)) return;
    const t0 = pending.get(id);
    pending.delete(id);
    send({
      v: VERSION,
      ts: Date.now(),
      kind: 'answer',
      req: id,
      outcome: outcome === 'ok' || outcome === 'cancel' ? outcome : 'error',
      elapsed_ms: Math.round(Math.min(Math.max(nowFn() - t0, 0), 86400000)),
      chars: Math.max(0, Math.round(chars || 0))
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------

  function attach() {
    global.addEventListener('beforeinput', onBeforeInput, { capture: true, passive: true });
    global.addEventListener('pagehide', onPageHide);
    if (global.document) global.document.addEventListener('visibilitychange', onVisibility);
  }

  function detach() {
    global.removeEventListener('beforeinput', onBeforeInput, { capture: true });
    global.removeEventListener('pagehide', onPageHide);
    if (global.document) global.document.removeEventListener('visibilitychange', onVisibility);
    if (timer) { clearTimeout(timer); timer = 0; }
    acc.fill(0);
    armed = false;
    pending.clear();
  }

  // opts: send(json); targets: the note editors; noteId(): the note being written in (a string; it changes when another comes to the front);
  // noteLabel(): its path, or its title; noteLength(): its length in characters; now(): the clock (tests).
  function init(opts) {
    const o = opts || {};
    sendFn = typeof o.send === 'function' ? o.send : null;
    targets = Array.isArray(o.targets) ? o.targets.filter(Boolean) : [];
    if (typeof o.noteId === 'function') noteIdFn = o.noteId;
    if (typeof o.noteLabel === 'function') noteLabelFn = o.noteLabel;
    if (typeof o.noteLength === 'function') noteLenFn = o.noteLength;
    if (typeof o.now === 'function') nowFn = o.now;
  }

  function setEnabled(on) {
    const want = !!on;
    if (want === enabled) return;
    enabled = want;
    if (enabled) attach(); else detach();
  }

  global.Activity = {
    init: init,
    setEnabled: setEnabled,
    isEnabled: () => enabled,
    flushEdit: flushEdit,
    ask: ask,
    answer: answer,
    footprintBytes: () => acc.byteLength
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.Activity;
  }
})(typeof window !== 'undefined' ? window : globalThis);
