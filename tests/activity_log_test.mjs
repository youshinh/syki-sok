// The activity log, page side (frontend/js/activity_log.js): which note was written in and by how much, and the requests of the AI bars with
// what became of them. Nothing exists while it is off; no typed text and no key is read; the lines are exactly the shapes the Go side takes.
import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

console.log('=== activity log (page side) ===');
// (read with the line ends made LF: a checkout on Windows may have CRLF, and the function bodies below are cut out by line)
const src = fs.readFileSync(new URL('../frontend/js/activity_log.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const goSrc = fs.readFileSync(new URL('../pkg/telemetry/activity.go', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function makePage() {
  const listeners = [];
  const timers = new Map();
  let timerId = 0;
  const sent = [];
  let clock = 1000;
  const state = { id: 'tab_1', label: 'C:\\notes\\plan.md', len: 100 };
  const document = {
    visibilityState: 'visible',
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
  const A = sandbox.Activity;
  const editor = { id: 'editor' };
  const barInput = { id: 'ask-bar-input' };
  A.init({
    send: (json) => { sent.push(JSON.parse(json)); },
    targets: [editor],
    noteId: () => state.id,
    noteLabel: () => state.label,
    noteLength: () => state.len,
    now: () => clock
  });
  const fire = (type, ev) => listeners.filter((l) => l.type === type && l.target === 'window').forEach((l) => l.fn(ev));
  const input = (t, inputType, target) => fire('beforeinput', { type: 'beforeinput', timeStamp: t, inputType, target: target === undefined ? editor : target });
  const runTimer = () => { const all = [...timers.entries()]; timers.clear(); all.forEach(([, v]) => v.fn()); return all.length; };
  return { A, listeners, timers, sent, state, editor, barInput, fire, input, runTimer, setClock: (v) => { clock = v; }, document };
}

// ---- off: nothing exists, nothing is written
{
  const p = makePage();
  assert.strictEqual(p.listeners.length, 0);
  assert.strictEqual(p.A.isEnabled(), false);
  p.A.ask('llm_1', 'ask', 'local', 'hello');
  p.A.answer('llm_1', 'ok', 5);
  p.input(10, 'insertText');
  assert.strictEqual(p.sent.length, 0, 'nothing is written while it is off');
  assert.strictEqual(p.timers.size, 0);
  p.A.setEnabled(true);
  assert.deepStrictEqual(p.listeners.map((l) => l.target + ':' + l.type).sort(), ['document:visibilitychange', 'window:beforeinput', 'window:pagehide']);
  assert.ok(p.listeners.find((l) => l.type === 'beforeinput').capture);
  p.A.setEnabled(true);
  assert.strictEqual(p.listeners.length, 3, 'on twice adds nothing');
  p.input(10, 'insertText');
  assert.strictEqual(p.timers.size, 1);
  p.A.setEnabled(false);
  assert.strictEqual(p.listeners.length, 0, 'off: every listener is gone');
  assert.strictEqual(p.timers.size, 0, 'and the timer');
  assert.strictEqual(p.sent.length, 0, 'what was counted is dropped');
}

// ---- a stretch of writing
{
  const p = makePage();
  p.A.setEnabled(true);
  p.setClock(5000);
  p.state.len = 100;
  p.input(5000, 'insertText');                  // the length is read when the stretch begins: 100
  p.state.len = 140;
  for (const t of ['insertText', 'insertCompositionText', 'insertLineBreak']) p.input(6000, t);
  p.input(7000, 'insertFromPaste');
  p.input(8000, 'deleteContentBackward');
  p.input(8100, 'deleteWordBackward');
  p.input(9000, 'historyUndo');
  p.input(9100, 'historyRedo');
  p.input(9200, 'formatBold');                  // none of the four
  p.state.len = 175;
  p.setClock(35000);
  assert.strictEqual([...p.timers.values()][0].ms, 30000);
  p.runTimer();
  assert.strictEqual(p.sent.length, 1);
  assert.deepStrictEqual(p.sent[0], {
    v: 1, ts: 1776412800000, kind: 'edit', note: 'C:\\notes\\plan.md', dur_ms: 30000, net_chars: 75, ins: 4, del: 2, paste: 1, undo: 2
  });
  // the next one starts clean; with nothing typed there is nothing and no timer
  assert.strictEqual(p.runTimer(), 0);
  p.state.len = 175;
  p.input(40000, 'deleteContentBackward');
  p.state.len = 170;
  p.setClock(41000);
  p.runTimer();
  assert.strictEqual(p.sent[1].net_chars, -5);
  assert.strictEqual(p.sent[1].ins, 0);
}

// ---- another note comes to the front
{
  const p = makePage();
  p.A.setEnabled(true);
  p.state.len = 10;
  p.input(1000, 'insertText');
  p.state.len = 25;
  p.A.flushEdit();                              // the app calls this before the other note comes to the front
  assert.strictEqual(p.sent.length, 1);
  assert.strictEqual(p.sent[0].net_chars, 15, 'the note that is leaving gets its own line, with its own length');
  assert.strictEqual(p.timers.size, 0);
  p.state.id = 'tab_2'; p.state.label = 'Untitled 2'; p.state.len = 0;
  p.input(2000, 'insertText');
  p.state.id = 'tab_3'; p.state.label = 'other.md'; p.state.len = 500; // the note changed without the app saying so: the stretch is closed, with no length
  p.input(3000, 'insertText');
  assert.strictEqual(p.sent.length, 2);
  assert.strictEqual(p.sent[1].note, 'Untitled 2');
  assert.strictEqual(p.sent[1].net_chars, 0, 'its length is not known any more: 0, not a made-up number');
  p.state.len = 510;
  p.runTimer();
  assert.strictEqual(p.sent[2].note, 'other.md');
  assert.strictEqual(p.sent[2].net_chars, 10);
}

// ---- what is not writing in a note
{
  const p = makePage();
  p.A.setEnabled(true);
  p.input(1000, 'insertText', p.barInput);
  p.input(1000, 'insertText', null);
  assert.strictEqual(p.timers.size, 0, 'another field (the AI bars, Settings, the search box) is not a note');
  assert.doesNotThrow(() => p.input(1000, undefined), 'an event without a type does not throw');
  p.runTimer();
  assert.strictEqual(p.sent.length, 0, 'and counts as nothing: no line');
}

// ---- hidden
{
  const p = makePage();
  p.A.setEnabled(true);
  p.input(1000, 'insertText');
  p.listeners.filter((l) => l.type === 'visibilitychange').forEach((l) => l.fn());
  assert.strictEqual(p.sent.length, 0, 'visible: nothing');
  p.document.visibilityState = 'hidden';
  p.listeners.filter((l) => l.type === 'visibilitychange').forEach((l) => l.fn());
  assert.strictEqual(p.sent.length, 1, 'hidden: the stretch is written');
  p.input(5000, 'insertText');
  p.listeners.filter((l) => l.type === 'pagehide').forEach((l) => l.fn());
  assert.strictEqual(p.sent.length, 2, 'closing too');
}

// ---- requests and answers
{
  const p = makePage();
  p.A.setEnabled(true);
  p.setClock(100);
  p.A.ask('llm_1', 'ask', 'local', 'summarise this');
  p.A.ask('rewrite_2', 'rewrite', 'cloud', 'x'.repeat(5000));
  p.A.ask('llm_3', 'weird', 'mars', 'p');
  p.setClock(1900);
  p.A.answer('llm_1', 'ok', 420);
  p.A.answer('llm_1', 'ok', 420);               // an answer is written once
  p.A.answer('never_asked', 'ok', 5);           // and only for a request that was written down
  p.A.answer('rewrite_2', 'cancel', 0);
  p.A.answer('llm_3', 'whatever', -4);
  assert.deepStrictEqual(p.sent.map((s) => s.kind), ['ask', 'ask', 'ask', 'answer', 'answer', 'answer']);
  assert.deepStrictEqual(p.sent[0], { v: 1, ts: 1776412800000, kind: 'ask', req: 'llm_1', mode: 'ask', dest: 'local', prompt: 'summarise this' });
  assert.strictEqual(p.sent[1].prompt.length, 2000, 'the request is cut at 2000 characters');
  assert.strictEqual(p.sent[1].dest, 'cloud');
  assert.deepStrictEqual([p.sent[2].mode, p.sent[2].dest], ['other', 'unknown'], 'anything unknown is "other" / "unknown"');
  assert.deepStrictEqual(p.sent[3], { v: 1, ts: 1776412800000, kind: 'answer', req: 'llm_1', outcome: 'ok', elapsed_ms: 1800, chars: 420 });
  assert.strictEqual(p.sent[4].outcome, 'cancel');
  assert.deepStrictEqual([p.sent[5].outcome, p.sent[5].chars], ['error', 0], 'an unknown outcome is an error; a negative length 0');
  // not too many are remembered
  const q = makePage();
  q.A.setEnabled(true);
  for (let i = 0; i < 100; i++) q.A.ask('r' + i, 'ask', 'local', 'p');
  q.sent.length = 0;
  q.A.answer('r0', 'ok', 1);
  assert.strictEqual(q.sent.length, 0, 'the oldest were forgotten (at most 32 are waited for)');
  q.A.answer('r99', 'ok', 1);
  assert.strictEqual(q.sent.length, 1);
}

// ---- the shapes are the ones the Go side takes
{
  const tags = (typeName) => {
    const m = new RegExp('type ' + typeName + ' struct \\{([\\s\\S]*?)\\n\\}').exec(goSrc);
    assert.ok(m, typeName);
    return [...m[1].matchAll(/`json:"([a-z_]+)"`/g)].map((x) => x[1]);
  };
  const p = makePage();
  p.A.setEnabled(true);
  p.state.len = 1;
  p.input(1000, 'insertText');
  p.state.len = 2;
  p.A.flushEdit();
  p.A.ask('r1', 'ask', 'local', 'p');
  p.A.answer('r1', 'ok', 1);
  const byKind = Object.fromEntries(p.sent.map((s) => [s.kind, Object.keys(s)]));
  assert.deepStrictEqual(byKind.edit, tags('EditEvent'));
  assert.deepStrictEqual(byKind.ask, tags('AskEvent'));
  assert.deepStrictEqual(byKind.answer, tags('AnswerEvent'));
}

// ---- send failures are not shown
{
  const p = makePage();
  p.A.init({ send: () => Promise.reject(new Error('off')), targets: [p.editor], noteId: () => 'a', noteLabel: () => 'a', noteLength: () => 0, now: () => 1 });
  p.A.setEnabled(true);
  p.input(1, 'insertText');
  p.runTimer();
  const q = makePage();
  q.A.init({ send: () => { throw new Error('boom'); }, targets: [q.editor], noteId: () => 'a', noteLabel: () => 'a', noteLength: () => 0, now: () => 1 });
  q.A.setEnabled(true);
  q.input(1, 'insertText');
  assert.doesNotThrow(() => q.runTimer());
}

// ---- the source: no typed text is read, the listener makes nothing, nothing else is touched
{
  const code = src.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\b(e|ev|event)\.(key|code|keyCode|data|clipboardData|dataTransfer)\b/.test(code), 'no key and no inserted text (e.data) is read');
  assert.ok(!/\.(value|innerText|textContent|getSelection)\b/.test(code), 'the note is not read: only its length, from the function it is given');
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|getUserMedia|AudioContext)\b/.test(code), 'it writes nowhere itself');
  assert.ok(!/addEventListener\('(keydown|keyup|keypress|input|paste|copy|cut|mousemove|mousedown|click)'/.test(code), 'one listener only: beforeinput');
  for (const name of ['onBeforeInput', 'isTracked']) {
    const m = new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n').exec(code);
    assert.ok(m, name);
    const body = m[0];
    assert.ok(!/\bnew\s/.test(body) && !/=>/.test(body) && !/`/.test(body), name + ': nothing is made');
    assert.ok(!/\.(push|map|filter|slice|concat|split|join)\(/.test(body) && !/(JSON|Object|Array|Date)\./.test(body), name + ': no array or string work');
    assert.ok(!/document\.|getElementById|querySelector|getBoundingClientRect|getComputedStyle/.test(body), name + ': no DOM');
    assert.ok(!/noteLenFn\(|noteLabelFn\(/.test(body.replace(/begin\(/g, '')), name + ': the note is not measured here (begin() does it, once per stretch)');
  }
  const p = makePage();
  assert.ok(p.A.footprintBytes() <= 256, 'a few numbers');
}

console.log('activity log (page side) tests passed');
