// Tests for chrome_overlay.js: the geometry of the overlay bars (insets) and the auto-hide state machine, run against a fake document.
const assert = require('assert');
const CO = require('./chrome_overlay.js');

console.log('=== chrome_overlay.js ===');

// ---- a tiny fake document: classes, attributes, containment, listeners with their options ----
function makeDom() {
  let tick = 1000;
  const listeners = {};
  const observers = [];
  const timers = [];

  function el(name) {
    const attrs = new Map();
    const classes = new Set();
    const node = {
      name: name,
      children: [],
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
      setAttribute: (k, v) => attrs.set(k, v),
      hasAttribute: (k) => attrs.has(k),
      removeAttribute: (k) => attrs.delete(k),
      contains: (n) => n === node || node.children.some((c) => c === n || (c.contains && c.contains(n))),
      focused: 0,
      focus() { node.focused++; doc.activeElement = node; },
      disabled: false,
      offsetParent: {},
      pinned: new Set(), // selectors that "match" inside this node
      querySelector: (sel) => (node.pinned.has(sel) ? { sel: sel } : (node.byId && node.byId[sel]) || null),
      querySelectorAll: () => node.focusables || []
    };
    return node;
  }

  const header = el('header');
  const footer = el('status-bar');
  const editor = el('editor');
  const editor2 = el('editor-secondary');
  const preview = el('preview-pane');
  const preview2 = el('secondary-preview-pane');
  const gutter = el('line-numbers');
  const findInput = el('find-input');
  const tab = el('tab'); header.children.push(tab);
  const helpBtn = el('btn-help'); header.children.push(helpBtn);
  const chip = el('stat-gitsync'); footer.children.push(chip);
  header.focusables = [helpBtn];
  footer.focusables = [chip];
  header.byId = { '.tab-item.active, [role="tab"][aria-selected="true"]': tab };
  const message = el('stat-message'); footer.children.push(message);
  footer.byId = { '#stat-message': message };

  const doc = {
    body: el('body'),
    documentElement: el('html'),
    activeElement: editor,
    addEventListener(type, fn, opts) { (listeners[type] = listeners[type] || []).push({ fn: fn, opts: opts }); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((l) => l.fn !== fn); },
    getElementById(id) { return ({ header: header, 'status-bar': footer })[id] || null; },
    count() { return Object.keys(listeners).reduce((n, k) => n + listeners[k].length, 0); },
    types() { return Object.keys(listeners).filter((k) => listeners[k].length).sort(); },
    fire(type, props) {
      tick += 10;
      const e = Object.assign({ type: type, isTrusted: true, timeStamp: tick }, props);
      (listeners[type] || []).slice().forEach((l) => l.fn(e));
      return e;
    },
    advance(ms) { tick += ms; }
  };
  class FakeObserver {
    constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(t, cfg) { this.targets.push([t, cfg]); }
    disconnect() { this.disconnected = true; }
  }
  return { doc, header, footer, editor, editor2, preview, preview2, gutter, findInput, message, observers, timers, FakeObserver, helpBtn, chip, tab };
}

function setup(extra) {
  const d = makeDom();
  const noteFocus = [];
  const c = CO.create(Object.assign({
    doc: d.doc, win: { MutationObserver: d.FakeObserver },
    body: d.doc.body, header: d.header, footer: d.footer,
    isEditor: (n) => n === d.editor || n === d.editor2,
    scrollers: () => [d.editor, d.editor2, d.preview, d.preview2],
    focusNote: () => { noteFocus.push(1); d.editor.focus(); },
    setTimeout: (fn) => { d.timers.push(fn); return d.timers.length; }
  }, extra || {}));
  const faded = () => d.doc.body.classList.contains('chrome-faded');
  const runTimers = () => { while (d.timers.length) d.timers.shift()(); };
  return Object.assign({ c, faded, runTimers, noteFocus }, d);
}

// 1. Nothing listens until it is switched on, and nothing when it is switched off
{
  const s = setup();
  assert.strictEqual(s.c.listenerCount(), 0, 'created but not configured: no listener');
  assert.strictEqual(s.doc.count(), 0);
  s.c.configure({ autoHide: false });
  assert.strictEqual(s.doc.count(), 0, 'autoHide false: still no listener');
  s.doc.fire('input', { target: s.editor });
  assert.ok(!s.faded(), 'and typing hides nothing');
  s.c.configure({ autoHide: true });
  assert.deepStrictEqual(s.doc.types(), ['compositionstart', 'input', 'keydown', 'pointerdown', 'pointermove', 'scroll', 'wheel'], 'switched on: the writing / scrolling listeners, and the spot of the pointer');
  assert.strictEqual(s.c.listenerCount(), 7);
  assert.strictEqual(s.doc.count(), 7, 'the counter is the real number of listeners');
  s.c.configure({ autoHide: false });
  assert.strictEqual(s.doc.count(), 0, 'switched off again: all removed');
  assert.strictEqual(s.c.listenerCount(), 0);
  console.log('PASS: no listener unless auto-hide is on; switching it off removes them all.');
}

// 2. Typing hides the bars; the listeners swap; the mouse brings them back only after real travel from where it was
{
  const s = setup();
  s.c.configure({ autoHide: true });
  s.doc.fire('pointermove', { clientX: 100, clientY: 100 }); // seen while the bars are shown
  s.doc.fire('input', { target: s.editor });
  assert.ok(s.faded(), 'a trusted input in the editor hides the bars');
  assert.ok(s.c.isAway());
  assert.deepStrictEqual(s.doc.types(), ['focusout', 'pointerdown', 'pointermove'], 'while away only the pointer and the focus are listened to (typing costs nothing)');
  s.doc.fire('pointermove', { clientX: 100, clientY: 100 }); // the browser's own "same spot" move after a layout change
  assert.ok(s.faded(), 'a move that goes nowhere does nothing');
  s.doc.fire('pointermove', { clientX: 102, clientY: 101 });
  assert.ok(s.faded(), 'a tremble of 3px stays hidden');
  s.doc.fire('pointermove', { clientX: 103, clientY: 106 });
  assert.ok(!s.faded(), '9px away from where it was: the bars are back');
  assert.deepStrictEqual(s.doc.types(), ['compositionstart', 'input', 'keydown', 'pointerdown', 'pointermove', 'scroll', 'wheel'], 'and typing is listened to again');
  s.doc.fire('input', { target: s.editor });
  assert.ok(s.faded(), 'the next keystroke hides them again');
  s.doc.fire('pointermove', { clientX: 105, clientY: 106 });
  assert.ok(s.faded(), 'the anchor is where the pointer was when they came back (103, 106), not where it was before: 2px is nothing');
  s.doc.fire('pointermove', { clientX: 125, clientY: 106 });
  assert.ok(!s.faded());
  // a pointer that jumps in from far away after the bars are away: the spot noted is the old one
  s.doc.fire('pointermove', { clientX: 10, clientY: 10 });
  s.doc.fire('input', { target: s.editor });
  s.doc.fire('pointermove', { clientX: 500, clientY: 300 });
  assert.ok(!s.faded(), 'a real move from far away is enough at once (the mouseMoved a test sends before a click too)');
  // a pointer never seen: the first move is a real one
  const u = setup();
  u.c.configure({ autoHide: true });
  u.doc.fire('input', { target: u.editor });
  u.doc.fire('pointermove', { clientX: 40, clientY: 40 });
  assert.ok(!u.faded(), 'no spot noted yet (the first move since the page opened): the bars come back');
  // a touch (no moves before it) brings them back for the touch itself; the mouse button alone does not
  s.doc.fire('input', { target: s.editor });
  s.doc.fire('pointerdown', { target: s.editor, pointerType: 'mouse' });
  assert.ok(s.faded(), 'a mouse press that was not preceded by a move leaves them away (the pointer is on the text)');
  s.doc.fire('pointerdown', { target: s.editor, pointerType: 'touch' });
  assert.ok(!s.faded(), 'a touch brings them back');
  console.log('PASS: typing hides, the mouse (after the 6px dead zone from where it was) brings back, and the listeners swap.');
}

// 3. What does not hide the bars
{
  const s = setup();
  s.c.configure({ autoHide: true });
  s.doc.fire('input', { target: s.editor, isTrusted: false });
  assert.ok(!s.faded(), 'an input event made by script (an RPC write, a programmatic edit) does not');
  s.doc.fire('input', { target: s.findInput });
  assert.ok(!s.faded(), 'typing in the find box, the ask bar or a dialog is not typing in the note');
  s.doc.fire('keydown', { target: s.editor, key: 'Process' });
  assert.ok(!s.faded(), 'a Japanese IME key press alone (key "Process") is not typing yet');
  s.doc.fire('compositionstart', { target: s.editor });
  assert.ok(s.faded(), 'but the composition starting is');
  const t = setup();
  t.c.configure({ autoHide: true });
  t.doc.fire('compositionstart', { target: t.editor2, isTrusted: false });
  assert.ok(!t.faded(), 'a composition made by script does not');
  t.doc.fire('input', { target: t.editor2 });
  assert.ok(t.faded(), 'the second pane counts as the note');
  console.log('PASS: only a trusted input / composition in a note editor hides the bars.');
}

// 4. Scrolling hides them only when the person scrolled
{
  const s = setup();
  s.c.configure({ autoHide: true });
  s.doc.fire('scroll', { target: s.editor });
  assert.ok(!s.faded(), 'a scroll by script (switching tabs, a jump to a search hit) with no wheel / key / press before it');
  s.doc.fire('pointerdown', { target: s.tab });
  s.doc.fire('scroll', { target: s.editor });
  assert.ok(!s.faded(), 'a press on a tab in the header, then the tab scrolling the note by script');
  s.doc.fire('keydown', { target: s.editor, key: 'n', ctrlKey: true });
  s.doc.fire('scroll', { target: s.editor });
  assert.ok(!s.faded(), 'a shortcut (Ctrl+N) is not a scrolling key');
  s.doc.fire('wheel', { target: s.helpBtn });
  s.doc.fire('scroll', { target: s.editor });
  assert.ok(!s.faded(), 'a wheel over the header does not scroll the note');
  s.doc.fire('wheel', { target: s.editor });
  s.doc.fire('scroll', { target: s.gutter });
  assert.ok(!s.faded(), 'the line numbers following the note are not a scroll of the note');
  s.doc.fire('scroll', { target: s.editor });
  assert.ok(s.faded(), 'a wheel on the note, then the note scrolling');
  s.doc.fire('pointermove', { clientX: 50, clientY: 50 });
  assert.ok(!s.faded());

  s.doc.fire('wheel', { target: s.editor });
  s.doc.advance(CO.INTENT_MS + 50);
  s.doc.fire('scroll', { target: s.editor });
  assert.ok(!s.faded(), 'a scroll more than 300ms after the wheel is not caused by it');

  s.doc.fire('keydown', { target: s.editor, key: 'PageDown' });
  s.doc.fire('scroll', { target: s.editor });
  assert.ok(s.faded(), 'PageDown, then the note scrolling');
  s.c.show();
  s.doc.fire('pointerdown', { target: s.preview.contains ? s.preview : s.preview });
  s.doc.fire('scroll', { target: s.preview });
  assert.ok(s.faded(), 'a press on the preview (or its scrollbar), then the preview scrolling');
  s.c.show();
  assert.ok(!s.faded(), 'show() brings them back');
  s.c.scrolled();
  assert.ok(s.faded(), 'scrolled(): an HTML page scrolled inside its iframe');
  console.log('PASS: a scroll hides the bars only after the person\'s wheel, navigation key or press on the text.');
}

// 5. What keeps the status bar (and a header menu) in view while the bars are away
{
  const s = setup();
  s.c.configure({ autoHide: true });
  s.doc.fire('input', { target: s.editor });
  assert.ok(!s.footer.hasAttribute('data-pin') && !s.header.hasAttribute('data-pin'), 'nothing to say: both away');
  assert.strictEqual(s.observers.length, 1, 'the watcher exists while away');
  const targets = s.observers[0].targets.map((t) => t[0].name);
  assert.deepStrictEqual(targets.sort(), ['header', 'stat-message', 'status-bar'], 'it watches the two bars and the message');
  s.footer.pinned.add('#stat-tasks:not(.hidden)');
  s.observers[0].cb([]);
  assert.ok(s.footer.hasAttribute('data-pin'), 'a running task pins the status bar');
  assert.ok(!s.header.hasAttribute('data-pin'));
  s.footer.pinned.delete('#stat-tasks:not(.hidden)');
  s.observers[0].cb([]);
  assert.ok(!s.footer.hasAttribute('data-pin'), 'and when it is done the bar goes');
  s.header.pinned.add('[aria-expanded="true"]');
  s.observers[0].cb([]);
  assert.ok(s.header.hasAttribute('data-pin'), 'an open menu pins the header');
  s.doc.fire('pointermove', { clientX: 60, clientY: 0 });
  assert.ok(!s.faded());
  assert.ok(s.observers[0].disconnected, 'back to shown: the watcher is gone');
  assert.ok(!s.header.hasAttribute('data-pin') && !s.footer.hasAttribute('data-pin'), 'and so are the pins');

  // pins that are already true when the bars go away
  const t = setup();
  t.footer.pinned.add('#stat-ai[aria-expanded="true"]');
  t.c.configure({ autoHide: true });
  t.doc.fire('input', { target: t.editor });
  assert.ok(t.footer.hasAttribute('data-pin'), 'the AI popover is open: the status bar is pinned from the start');

  // the list
  assert.deepStrictEqual(CO.FOOTER_PINS, [
    '#stat-message:not(:empty):not([data-quiet])',
    '#stat-llm-indicator:not(.hidden)',
    '#stat-tasks:not(.hidden)',
    '#stat-recording:not(.hidden)',
    '#stat-ai[aria-expanded="true"]'
  ], 'the five things the status bar says; a quiet message (the automatic save) is not one');
  console.log('PASS: the status bar and the header stay while they have something to say; the watcher exists only while away.');
}

// 6. Focus
{
  const s = setup();
  s.c.configure({ autoHide: true });
  s.doc.fire('input', { target: s.editor });
  s.doc.activeElement = s.findInput;
  s.doc.fire('focusout', { target: s.editor });
  assert.ok(s.faded(), 'the check waits for the focus change to settle');
  s.runTimers();
  assert.ok(!s.faded(), 'focus went to something that is not a note editor: the bars are back');

  s.doc.fire('input', { target: s.editor });
  s.doc.activeElement = s.editor2;
  s.doc.fire('focusout', { target: s.editor });
  s.runTimers();
  assert.ok(s.faded(), 'moving to the other pane does not bring them back');

  s.doc.activeElement = s.editor2;
  s.doc.fire('focusout', { target: s.editor2 }); // the window lost focus: the editor is still the active element
  s.runTimers();
  assert.ok(s.faded(), 'the window losing focus (the editor stays the active element) does not');
  s.doc.fire('focusout', { target: s.findInput });
  s.runTimers();
  assert.ok(s.faded(), 'only the note editors count');
  console.log('PASS: focus leaving the note brings the bars back, a move between panes or a window blur does not.');
}

// 7. F6 goes round the note, the header and the status bar; Esc comes back
{
  const s = setup();
  s.c.configure({ autoHide: true });
  s.doc.fire('input', { target: s.editor });
  s.doc.activeElement = s.editor;
  assert.strictEqual(s.c.focusBar(1), 'header');
  assert.ok(!s.faded(), 'the bars come back for it');
  assert.strictEqual(s.helpBtn.focused, 1, 'the first control of the header takes the focus');
  assert.ok(s.c.focusInBar());
  assert.strictEqual(s.c.focusBar(1), 'footer');
  assert.strictEqual(s.chip.focused, 1);
  assert.strictEqual(s.c.focusBar(1), 'note');
  assert.strictEqual(s.noteFocus.length, 1);
  assert.ok(!s.c.focusInBar());
  assert.strictEqual(s.c.focusBar(-1), 'footer', 'Shift+F6 goes the other way round');
  assert.strictEqual(s.c.focusBar(-1), 'header');
  assert.strictEqual(s.c.focusBar(-1), 'note');
  s.c.focusBar(1);
  assert.strictEqual(s.c.leaveBar(), true, 'Esc in a bar');
  assert.strictEqual(s.noteFocus.length, 3, 'puts the focus back in the note');
  assert.strictEqual(s.c.leaveBar(), false, 'and Esc in the note is not for the bars');
  // a bar with nothing focusable is skipped, and so is a control that does not take the focus
  const t = setup();
  t.header.focusables = []; t.header.byId = {};
  t.doc.activeElement = t.editor;
  assert.strictEqual(t.c.focusBar(1), 'footer', 'an empty header is skipped');
  const u = setup();
  u.helpBtn.focus = function () { u.helpBtn.focused++; }; // a control that refuses the focus (not focusable)
  u.doc.activeElement = u.editor;
  assert.strictEqual(u.c.focusBar(1), 'footer', 'a header whose controls cannot take the focus is skipped too');
  console.log('PASS: F6 / Shift+F6 go round the note, the header and the status bar; Esc comes back.');
}

// 7b. F6 stops at the strips of the index tabs, between the header and the status bar (docs/design/v2-plan-P3.md)
{
  // a strip is a node with a roving tab stop (the selected tab, found by [tabindex="0"]) and a foot button; a hidden one cannot take the focus
  const stripNode = (dom, name, side, opts) => {
    const strip = (function () {
      const node = { name: name, children: [], focused: 0, disabled: false, offsetParent: {}, pinned: new Set(), byId: {}, attrs: { 'data-side': side } };
      node.classList = { add() {}, remove() {}, contains: () => false };
      node.setAttribute = (k, v) => { node.attrs[k] = v; };
      node.getAttribute = (k) => (k in node.attrs ? node.attrs[k] : null);
      node.hasAttribute = (k) => k in node.attrs;
      node.contains = (n) => n === node || node.children.some((c) => c === n);
      node.focus = () => {};
      node.querySelector = () => null;
      return node;
    })();
    const row = { name: name + '-tab', focused: 0, disabled: false, offsetParent: {}, focus() { if (opts && opts.refuses) return; row.focused++; dom.doc.activeElement = row; } };
    strip.children.push(row);
    strip.querySelectorAll = () => [row];
    return { strip, row };
  };
  const s = setup();
  const left = stripNode(s, 'left', 'left');
  const right = stripNode(s, 'right', 'right');
  let present = [left.strip];
  const c = CO.create({
    doc: s.doc, win: { MutationObserver: s.FakeObserver }, body: s.doc.body, header: s.header, footer: s.footer,
    isEditor: (n) => n === s.editor, scrollers: () => [s.editor],
    focusNote: () => { s.noteFocus.push(1); s.editor.focus(); },
    strips: () => present,
    setTimeout: (fn) => { s.timers.push(fn); return s.timers.length; }
  });
  s.doc.activeElement = s.editor;
  assert.strictEqual(c.focusBar(1), 'header');
  assert.strictEqual(c.focusBar(1), 'strip-left', 'F6 from the header stops at the strip of the left page');
  assert.strictEqual(left.row.focused, 1, 'on its roving tab stop (the selected tab)');
  assert.ok(c.focusInBar(), 'and the focus is in a bar for Esc');
  assert.strictEqual(c.focusBar(1), 'footer', 'then the status bar');
  assert.strictEqual(c.focusBar(1), 'note');
  assert.strictEqual(c.focusBar(-1), 'footer', 'Shift+F6 goes back the same way');
  assert.strictEqual(c.focusBar(-1), 'strip-left');
  assert.strictEqual(c.focusBar(-1), 'header');
  assert.strictEqual(c.focusBar(-1), 'note');
  c.focusBar(1); c.focusBar(1); // the strip
  assert.strictEqual(c.leaveBar(), true, 'Esc in a strip takes the focus back to the note');
  assert.strictEqual(s.noteFocus.length, 3, 'the round came back to the note twice, and Esc is the third');
  // two pages: the left strip, then the right one
  present = [left.strip, right.strip];
  s.doc.activeElement = s.editor;
  assert.deepStrictEqual([1, 1, 1, 1, 1].map(() => c.focusBar(1)), ['header', 'strip-left', 'strip-right', 'footer', 'note']);
  assert.deepStrictEqual([1, 1, 1, 1, 1].map(() => c.focusBar(-1)), ['footer', 'strip-right', 'strip-left', 'header', 'note']);
  // the divider between two pages is a stop of its own after the strips (the editors keep Tab, so F6 is how the keyboard gets to it): a node that
  // is itself the tab stop, with nothing inside it, named by its data-stop
  const dividerNode = (shown) => {
    const node = { focused: 0, disabled: false, offsetParent: shown ? {} : null, attrs: { tabindex: '0', 'data-stop': 'divider' } };
    node.getAttribute = (k) => (k in node.attrs ? node.attrs[k] : null);
    node.contains = (n) => n === node;
    node.querySelectorAll = () => [];
    node.focus = () => { node.focused++; s.doc.activeElement = node; };
    return node;
  };
  const divider = dividerNode(true);
  present = [left.strip, right.strip, divider];
  s.doc.activeElement = s.editor;
  assert.deepStrictEqual([1, 1, 1, 1, 1, 1].map(() => c.focusBar(1)), ['header', 'strip-left', 'strip-right', 'divider', 'footer', 'note'], 'F6 reaches the divider after the strips');
  assert.strictEqual(divider.focused, 1, 'and puts the focus on the divider itself');
  assert.deepStrictEqual([1, 1, 1, 1, 1, 1].map(() => c.focusBar(-1)), ['footer', 'divider', 'strip-right', 'strip-left', 'header', 'note'], 'Shift+F6 the other way');
  c.focusBar(1); c.focusBar(1); c.focusBar(1); c.focusBar(1); // header, left, right, divider
  assert.strictEqual(s.doc.activeElement, divider);
  assert.ok(c.focusInBar(), 'the focus on the divider counts as being in a bar (the bars stay up)');
  assert.strictEqual(c.leaveBar(), true, 'Esc on the divider takes the focus back to the note');
  present = [left.strip, divider];
  s.doc.activeElement = s.editor;
  assert.deepStrictEqual([1, 1, 1, 1].map(() => c.focusBar(1)), ['header', 'strip-left', 'divider', 'footer'], 'the divider does not need the right strip to be there');
  present = [left.strip, dividerNode(false)];
  s.doc.activeElement = s.editor;
  assert.deepStrictEqual([1, 1, 1, 1].map(() => c.focusBar(1)), ['header', 'strip-left', 'footer', 'note'], 'a divider that is not on screen (one page) is passed over');
  const unnamed = dividerNode(true);
  unnamed.attrs = { tabindex: '0' };
  present = [unnamed];
  s.doc.activeElement = s.editor;
  assert.strictEqual(c.focusBar(1), 'header');
  assert.strictEqual(c.focusBar(1), 'strip', 'a stop with no name is just a strip');
  // a strip that is not there (the preview alone: no element, or a hidden one that cannot take the focus) is passed over
  present = [];
  assert.deepStrictEqual([1, 1, 1].map(() => c.focusBar(1)), ['header', 'footer', 'note'], 'no strip: the old round');
  const hidden = stripNode(s, 'hidden', 'left', { refuses: true });
  present = [hidden.strip];
  assert.deepStrictEqual([1, 1, 1].map(() => c.focusBar(1)), ['header', 'footer', 'note'], 'a strip that refuses the focus (Zen mode, no strip in this view) is skipped');
  present = [null, undefined];
  assert.strictEqual(c.focusBar(1), 'header', 'and so are missing elements');
  // without the option at all it is the old round
  s.doc.activeElement = s.editor;
  assert.deepStrictEqual([1, 1, 1].map(() => s.c.focusBar(1)), ['header', 'footer', 'note']);
  console.log('PASS: F6 / Shift+F6 stop at the strips of the index tabs (left page, then right page) between the header and the status bar; a strip that cannot take the focus is skipped; Esc leaves a strip.');
}

// 8. Switching off while the bars are away brings them back
{
  const s = setup();
  s.c.configure({ autoHide: true });
  s.doc.fire('input', { target: s.editor });
  s.c.configure({ autoHide: false });
  assert.ok(!s.faded());
  assert.strictEqual(s.doc.count(), 0);
  assert.strictEqual(s.c.listenerCount(), 0);
  assert.ok(s.observers[0].disconnected);
  s.c.away();
  assert.ok(!s.faded(), 'with auto-hide off, away() does nothing');
  console.log('PASS: switching auto-hide off while away shows the bars and removes everything.');
}

// 9. Pure helpers
{
  assert.strictEqual(CO.movedFar(null, 5, 5), false);
  assert.strictEqual(CO.movedFar({ x: 10, y: 10 }, 13, 12), false);
  assert.strictEqual(CO.movedFar({ x: 10, y: 10 }, 13, 13), true, '|dx| + |dy| = 6 counts');
  assert.strictEqual(CO.movedFar({ x: 10, y: 10 }, 10, 10, 0), true);
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) assert.strictEqual(CO.isNavigationKey({ key: key }), true, key);
  assert.strictEqual(CO.isNavigationKey({ key: 'End', ctrlKey: true }), true, 'Ctrl+End');
  assert.strictEqual(CO.isNavigationKey({ key: 'ArrowDown', ctrlKey: true }), false, 'Ctrl+Down is not scrolling by itself');
  assert.strictEqual(CO.isNavigationKey({ key: 'ArrowUp', altKey: true }), false, 'Alt+Up moves a line');
  assert.strictEqual(CO.isNavigationKey({ key: 'a' }), false);
  assert.strictEqual(CO.isNavigationKey({ key: 'PageDown', metaKey: true }), false);
  console.log('PASS: the dead zone and the navigation keys.');
}

// 10. insets: how much of the box the bars cover
{
  const box = (top, bottom) => ({ top: top, bottom: bottom });
  assert.deepStrictEqual(CO.coverage(box(0, 720), box(0, 38), box(696, 720)), { top: 38, bottom: 24 }, 'the first pane: under both bars');
  assert.deepStrictEqual(CO.coverage(box(70, 720), box(0, 38), box(696, 720)), { top: 0, bottom: 24 }, 'the second pane starts below its own strip: only the status bar');
  assert.deepStrictEqual(CO.coverage(box(0, 720), box(0, 0), box(720, 720)), { top: 0, bottom: 0 }, 'Zen mode: the bars have no height');
  assert.deepStrictEqual(CO.coverage(box(38, 696), box(0, 38), box(696, 720)), { top: 0, bottom: 0 }, 'a box between the bars (the bars not floating)');
  assert.deepStrictEqual(CO.coverage(null, box(0, 38), box(696, 720)), { top: 0, bottom: 0 });
  assert.deepStrictEqual(CO.coverage(box(0, 10), box(0, 38), box(696, 720)), { top: 10, bottom: 0 }, 'never more than the box itself');
  const rect = (r) => ({ getBoundingClientRect: () => r });
  const doc = { getElementById: (id) => (id === 'header' ? rect(box(0, 38)) : id === 'status-bar' ? rect(box(696, 720)) : null) };
  assert.deepStrictEqual(CO.insets(rect(box(0, 720)), doc), { top: 38, bottom: 24 });
  assert.deepStrictEqual(CO.insets(rect(box(0, 720)), { getElementById: () => null }), { top: 0, bottom: 0 }, 'a page without the bars');
  assert.deepStrictEqual(CO.insets(null, doc), { top: 0, bottom: 0 }, 'no element');
  assert.deepStrictEqual(CO.insets({ getBoundingClientRect() { throw new Error('boom'); } }, doc), { top: 0, bottom: 0 }, 'never throws');
  console.log('PASS: insets are read from where the bars are.');
}


// ---- Zen mode (P2b): the same away state, for good, with a narrow way back ----------------------------------------------------------------

// A harness with timers that know their delay and can be cancelled, a window 720 tall, and bars that have a place (header 0-38, status 696-720).
function setupZen(extra) {
  const d = makeDom();
  const noteFocus = [];
  const timers = [];
  d.header.getBoundingClientRect = () => ({ top: 0, bottom: 38, left: 0, right: 1050 });
  d.footer.getBoundingClientRect = () => ({ top: 696, bottom: 720, left: 0, right: 1050 });
  const c = CO.create(Object.assign({
    doc: d.doc, win: { MutationObserver: d.FakeObserver, innerHeight: 720 },
    body: d.doc.body, header: d.header, footer: d.footer,
    isEditor: (n) => n === d.editor || n === d.editor2,
    scrollers: () => [d.editor, d.editor2, d.preview, d.preview2],
    focusNote: () => { noteFocus.push(1); d.editor.focus(); },
    setTimeout: (fn, ms) => { const t = { fn: fn, ms: ms, live: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.live = false; }
  }, extra || {}));
  const faded = () => d.doc.body.classList.contains('chrome-faded');
  const live = (ms) => timers.filter((t) => t.live && (ms === undefined || t.ms === ms));
  const fire = (ms) => { const t = live(ms)[0]; assert.ok(t, 'a timer of ' + ms + ' ms is waiting'); t.live = false; t.fn(); };
  const move = (y, x) => d.doc.fire('pointermove', { clientX: x === undefined ? 500 : x, clientY: y });
  const pinned = (bar) => bar.hasAttribute('data-pin');
  return Object.assign({ c, faded, live, fire, move, pinned, noteFocus, timers }, d);
}

// Z1. The pure helper and the constants the owner decided
{
  assert.strictEqual(CO.HOT_ZONE, 6, 'a 6px band');
  assert.strictEqual(CO.HOT_DWELL_MS, 150, 'the pointer has to stay 150 ms');
  assert.strictEqual(CO.HOT_LEAVE_MS, 700, 'and the bar goes 700 ms after the pointer left it');
  assert.strictEqual(CO.hotZoneOf(0, 720), 'top');
  assert.strictEqual(CO.hotZoneOf(5, 720), 'top');
  assert.strictEqual(CO.hotZoneOf(6, 720), null, 'the band is 6px: rows 0 to 5');
  assert.strictEqual(CO.hotZoneOf(300, 720), null);
  assert.strictEqual(CO.hotZoneOf(713, 720), null);
  assert.strictEqual(CO.hotZoneOf(714, 720), 'bottom');
  assert.strictEqual(CO.hotZoneOf(719, 720), 'bottom');
  assert.strictEqual(CO.hotZoneOf(-1, 720), null, 'above the window');
  assert.strictEqual(CO.hotZoneOf(100, 0), null, 'a window of no height has no bottom');
  assert.strictEqual(CO.hotZoneOf(undefined, 720), null);
  assert.deepStrictEqual(CO.ZEN_FOOTER_PINS, [
    '#stat-message[data-important]:not(:empty)',
    '#stat-recording:not(.hidden)',
    '#stat-ai[aria-expanded="true"]'
  ], 'in Zen mode only a failure, a recording and the open AI popover keep the status bar');
  console.log('PASS: the hot zone is the 6px band at the top and the bottom; 150 ms, 700 ms; the Zen pins.');
}

// Z2. Entering Zen mode: away for good, only the Zen listeners, with or without auto-hide
for (const autoHide of [true, false]) {
  const s = setupZen();
  s.c.configure({ autoHide: autoHide });
  s.c.setZen(true);
  assert.ok(s.c.isZen());
  assert.ok(s.faded(), 'Zen mode: the bars are away (autoHide ' + autoHide + ')');
  assert.deepStrictEqual(s.doc.types(), ['pointermove', 'pointerout'], 'only the pointer is listened to: nothing about typing or scrolling');
  assert.strictEqual(s.c.listenerCount(), 2);
  assert.strictEqual(s.live().length, 0, 'no timer exists until the pointer is at an edge');
  s.doc.fire('input', { target: s.editor });
  s.move(300); s.move(320, 700); s.move(100, 10);
  assert.ok(s.faded() && !s.pinned(s.header) && !s.pinned(s.footer), 'moving the mouse about does not bring the bars back');
  s.c.show();
  assert.ok(s.faded(), 'show() (what the screenshot tool calls) does not leave Zen mode');
  s.c.scrolled(); s.c.away();
  assert.ok(s.faded());
  s.c.configure({ autoHide: !autoHide });
  assert.ok(s.faded() && s.c.isZen(), 'switching auto-hide in Zen mode changes nothing on screen');
  assert.deepStrictEqual(s.doc.types(), ['pointermove', 'pointerout'], 'and adds no listener');
  s.c.setZen(false);
  assert.ok(!s.c.isZen());
  assert.ok(!s.faded(), 'leaving Zen mode brings the bars back');
  assert.strictEqual(s.doc.count(), !autoHide ? 7 : 0, 'and the listeners follow the (switched) auto-hide setting: ' + s.doc.types().join());
  s.c.setZen(false);
  assert.ok(!s.faded(), 'leaving twice is nothing');
}
console.log('PASS: Zen mode keeps the bars away whatever the mouse does, with or without auto-hide; leaving it restores the setting.');

// Z3. The top edge: 150 ms in the band calls the header only; it stays while the pointer is on it, goes 700 ms after it left
{
  const s = setupZen();
  s.c.setZen(true);
  s.move(2);
  assert.strictEqual(s.live(150).length, 1, 'the pointer reached the band: a dwell timer starts');
  assert.ok(!s.pinned(s.header), 'not yet');
  s.move(3, 520);
  assert.strictEqual(s.live(150).length, 1, 'moving inside the band does not start it again');
  s.fire(150);
  assert.ok(s.pinned(s.header) && !s.pinned(s.footer), 'the header is called back, the status bar is not');
  assert.ok(s.faded(), 'the class stays: the bar shows by its pin, as a bar with something to say does');
  s.move(20);
  assert.strictEqual(s.live(700).length, 0, 'on the header (below the band, above its bottom edge): it stays');
  s.move(37);
  assert.strictEqual(s.live(700).length, 0);
  s.move(40);
  assert.strictEqual(s.live(700).length, 1, 'off the header: it will go in 700 ms');
  s.move(2);
  assert.strictEqual(s.live(700).length, 0, 'back in the band before that: the goodbye is cancelled');
  s.move(300);
  assert.strictEqual(s.live(700).length, 1);
  s.move(310, 200);
  assert.strictEqual(s.live(700).length, 1, 'one goodbye timer, not one per move');
  s.fire(700);
  assert.ok(!s.pinned(s.header), '700 ms later the header goes');
  assert.strictEqual(s.live().length, 0, 'and no timer is left');
  assert.deepStrictEqual(s.doc.types(), ['pointermove', 'pointerout'], 'still only the Zen listeners');
  console.log('PASS: Zen: 150 ms at the top edge calls the header; it stays while the pointer is on it and goes 700 ms after.');
}

// Z4. A pass through the band is nothing; the bottom edge calls the status bar, not the header
{
  const s = setupZen();
  s.c.setZen(true);
  s.move(1);
  s.move(200);
  assert.strictEqual(s.live(150).length, 0, 'the pointer left the band before 150 ms: the dwell timer is cancelled');
  s.timers.forEach((t) => { if (t.live) { t.live = false; t.fn(); } });
  assert.ok(!s.pinned(s.header) && !s.pinned(s.footer), 'nothing was called');
  s.move(717);
  s.fire(150);
  assert.ok(s.pinned(s.footer) && !s.pinned(s.header), 'the bottom edge calls the status bar only');
  s.move(710);
  assert.strictEqual(s.live(700).length, 0, 'on the status bar: it stays');
  s.move(690);
  assert.strictEqual(s.live(700).length, 1);
  s.fire(700);
  assert.ok(!s.pinned(s.footer));
  // both edges in turn
  s.move(0); s.fire(150);
  s.move(719);
  s.fire(150);
  assert.ok(s.pinned(s.header) && s.pinned(s.footer), 'each edge calls its own bar');
  console.log('PASS: Zen: a pass through the band calls nothing; the bottom edge calls the status bar.');
}

// Z5. The pointer leaving the window; only a pointer the browser really made counts
{
  const s = setupZen();
  s.c.setZen(true);
  s.move(2);
  s.doc.fire('pointerout', { relatedTarget: null });
  assert.strictEqual(s.live(150).length, 0, 'out of the window before 150 ms: nothing is called');
  s.move(2); s.fire(150);
  assert.ok(s.pinned(s.header));
  s.doc.fire('pointerout', { relatedTarget: { nodeName: 'DIV' } });
  assert.strictEqual(s.live(700).length, 0, 'moving from one element to another is not leaving');
  s.doc.fire('pointerout', { relatedTarget: null });
  assert.strictEqual(s.live(700).length, 1, 'leaving the window starts the goodbye');
  s.fire(700);
  assert.ok(!s.pinned(s.header));
  s.doc.fire('pointermove', { clientX: 5, clientY: 1, isTrusted: false });
  assert.strictEqual(s.live().length, 0, "a pointer move made by script is not the person's");
  console.log("PASS: Zen: leaving the window starts the goodbye; a script's pointer is ignored.");
}

// Z6. What calls the status bar in Zen mode: a failure, a recording, its popover; not a message, a task, the AI indicator
{
  const s = setupZen();
  s.c.setZen(true);
  assert.strictEqual(s.observers.length, 1, 'the watcher exists in Zen mode');
  const targets = s.observers[0].targets.map((t) => t[0].name).sort();
  assert.deepStrictEqual(targets, ['header', 'stat-message', 'status-bar'], 'it watches the two bars and the message');
  const attrs = s.observers[0].targets.find((t) => t[0].name === 'status-bar')[1].attributeFilter;
  assert.ok(attrs.includes('data-important'), 'and the failure mark');
  const sync = () => s.observers[0].cb([]);
  for (const sel of ['#stat-message:not(:empty):not([data-quiet])', '#stat-llm-indicator:not(.hidden)', '#stat-tasks:not(.hidden)']) {
    s.footer.pinned.add(sel); sync();
    assert.ok(!s.pinned(s.footer), 'in Zen mode this does not call the status bar: ' + sel);
    s.footer.pinned.delete(sel);
  }
  for (const sel of ['#stat-message[data-important]:not(:empty)', '#stat-recording:not(.hidden)', '#stat-ai[aria-expanded="true"]']) {
    s.footer.pinned.add(sel); sync();
    assert.ok(s.pinned(s.footer), 'in Zen mode this calls the status bar: ' + sel);
    s.footer.pinned.delete(sel); sync();
    assert.ok(!s.pinned(s.footer), 'and it goes with it: ' + sel);
  }
  s.header.pinned.add('[aria-expanded="true"]'); sync();
  assert.ok(s.pinned(s.header), 'an open menu of the header keeps the header');
  s.header.pinned.delete('[aria-expanded="true"]'); sync();
  assert.ok(!s.pinned(s.header));
  // a failure that is already there when Zen mode starts
  const t = setupZen();
  t.footer.pinned.add('#stat-message[data-important]:not(:empty)');
  t.c.setZen(true);
  assert.ok(t.pinned(t.footer), 'a failure on the status line when Zen mode starts is not hidden');
  // outside Zen mode the ordinary pins are back
  t.footer.pinned.delete('#stat-message[data-important]:not(:empty)');
  t.footer.pinned.add('#stat-tasks:not(.hidden)');
  t.c.configure({ autoHide: true });
  t.c.setZen(false);
  t.doc.fire('input', { target: t.editor });
  assert.ok(t.pinned(t.footer), 'out of Zen mode a running task keeps the status bar again');
  console.log('PASS: Zen: a failure, a recording and the open popover call the status bar; a message, a task and the AI indicator do not.');
}

// Z7. Entering Zen from the "away" state of auto-hide swaps the listeners, and leaving brings the shown state back
{
  const s = setupZen();
  s.c.configure({ autoHide: true });
  s.doc.fire('input', { target: s.editor });
  assert.deepStrictEqual(s.doc.types(), ['focusout', 'pointerdown', 'pointermove']);
  s.c.setZen(true);
  assert.deepStrictEqual(s.doc.types(), ['pointermove', 'pointerout'], 'the mouse-brings-it-back listeners are gone');
  s.move(300); s.move(380, 800);
  assert.ok(s.faded(), 'the mouse does not bring the bars back');
  s.doc.fire('pointerdown', { target: s.editor, pointerType: 'touch' });
  assert.ok(s.faded(), 'nor a touch');
  s.c.setZen(false);
  assert.ok(!s.faded());
  assert.deepStrictEqual(s.doc.types(), ['compositionstart', 'input', 'keydown', 'pointerdown', 'pointermove', 'scroll', 'wheel'], 'auto-hide listens again');
  s.doc.fire('input', { target: s.editor });
  assert.ok(s.faded(), 'and the next keystroke hides the bars as before');
  console.log('PASS: Zen from the away state and back to the shown state.');
}

// Z8. Leaving Zen mode cancels the timers and clears what Zen called back
{
  const s = setupZen();
  s.c.setZen(true);
  s.move(2); s.fire(150);
  s.move(300);
  assert.strictEqual(s.live(700).length, 1, 'the goodbye is waiting');
  s.c.setZen(false);
  assert.strictEqual(s.live().length, 0, 'no timer survives Zen mode');
  assert.ok(!s.pinned(s.header) && !s.pinned(s.footer), 'no pin survives it');
  assert.ok(s.observers[0].disconnected, 'and the watcher is gone');
  assert.strictEqual(s.doc.count(), 0, 'no listener (auto-hide was never on)');
  s.c.setZen(true);
  assert.ok(!s.pinned(s.header), 'a bar that was called back in the last Zen session is not still called back in the next');
  s.move(2);
  assert.strictEqual(s.live(150).length, 1, 'a dwell timer is waiting');
  s.c.setZen(false);
  assert.strictEqual(s.live().length, 0, 'a dwell timer is cancelled with it too');
  s.c.setZen(true);
  s.move(2); s.fire(150);
  assert.ok(s.pinned(s.header));
  s.c.setZen(false);
  s.c.setZen(true);
  assert.ok(!s.pinned(s.header) && !s.pinned(s.footer), 'the bar called back before is not called back by the next Zen mode');
  s.move(2);
  s.fire(150);
  assert.ok(s.pinned(s.header), 'and the edge still works the second time');
  console.log('PASS: leaving Zen mode leaves no timer, no pin, no watcher.');
}

// Z9. F6 and Esc in Zen mode: focus in a bar shows it (CSS :focus-within), nothing takes the class off
{
  const s = setupZen();
  s.c.setZen(true);
  s.doc.activeElement = s.editor;
  assert.strictEqual(s.c.focusBar(1), 'header');
  assert.strictEqual(s.helpBtn.focused, 1);
  assert.ok(s.faded(), 'the class stays: it is :focus-within that shows the header');
  assert.ok(s.c.focusInBar());
  assert.strictEqual(s.c.focusBar(1), 'footer');
  assert.strictEqual(s.c.focusBar(1), 'note');
  s.c.focusBar(1);
  assert.strictEqual(s.c.leaveBar(), true, 'Esc in a bar goes back to the note');
  assert.ok(s.c.isZen() && s.faded(), 'and does not leave Zen mode');
  console.log('PASS: F6 goes round in Zen mode; the bar shows by focus, the class stays.');
}

// Z10. Without a body (a page without the bars) Zen is nothing
{
  const c = CO.create({ doc: { addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, body: null }, body: null });
  c.setZen(true);
  assert.strictEqual(c.isZen(), false);
  console.log('PASS: no body, no Zen.');
}

console.log('\nAll chrome_overlay tests PASSED!');
