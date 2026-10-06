// Unit tests for view_layout.js: which of the four displays the app is in, and the divider's arithmetic. tests/view_layout_mutation_test.mjs
// breaks the module in a number of ways and checks that this file notices.
const assert = require('assert');
const VL = require('./view_layout.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('PASS: ' + name);
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || '') + ' ' + a + ' vs ' + b);

// ---- the four displays --------------------------------------------------------------------------------
check('viewOf: the table of the four displays (isPreviewMode, isSplitMode, secondaryViewMode)', () => {
  const rows = [
    [{ isPreviewMode: false, isSplitMode: false, secondaryViewMode: 'editor' }, 'page'],
    [{ isPreviewMode: false, isSplitMode: false, secondaryViewMode: 'preview' }, 'page'],
    [{ isPreviewMode: false, isSplitMode: true, secondaryViewMode: 'editor' }, 'pair'],
    [{ isPreviewMode: false, isSplitMode: true, secondaryViewMode: 'preview' }, 'side'],
    [{ isPreviewMode: true, isSplitMode: false, secondaryViewMode: 'editor' }, 'preview'],
    [{ isPreviewMode: true, isSplitMode: false, secondaryViewMode: 'preview' }, 'preview']
  ];
  for (const [state, want] of rows) assert.strictEqual(VL.viewOf(state), want, JSON.stringify(state));
});

check('viewOf: the preview alone wins over a split (the two never hold together; if they did the sheet would fill the window)', () => {
  assert.strictEqual(VL.viewOf({ isPreviewMode: true, isSplitMode: true, secondaryViewMode: 'editor' }), 'preview');
  assert.strictEqual(VL.viewOf({ isPreviewMode: true, isSplitMode: true, secondaryViewMode: 'preview' }), 'preview');
});

check('viewOf: no state, or a state that says nothing, is one page', () => {
  assert.strictEqual(VL.viewOf(), 'page');
  assert.strictEqual(VL.viewOf(null), 'page');
  assert.strictEqual(VL.viewOf({}), 'page');
  assert.strictEqual(VL.viewOf({ isSplitMode: true }), 'pair', 'a split with no mode named is two editors');
});

// ---- the divider: dragging -------------------------------------------------------------------------------
check('ratioAfterDrag: the share is of the room left by the divider, not of the whole window', () => {
  // 1000px window, a 24px divider: 976px to share; half of it is 488px
  near(VL.ratioAfterDrag(488, 0, 1000, 24), 0.5, 'not moved');
  near(VL.ratioAfterDrag(488, 97.6, 1000, 24), 0.6, '97.6px to the right');
  near(VL.ratioAfterDrag(488, -97.6, 1000, 24), 0.4, 'and to the left');
  assert.notStrictEqual(VL.ratioAfterDrag(500, 0, 1000, 24), 0.5, 'a left page of 500px of 1000 is NOT half when the divider takes 24px');
});

check('ratioAfterDrag: kept between 15% and 85%', () => {
  assert.strictEqual(VL.ratioAfterDrag(100, -5000, 1000, 24), VL.MIN_RATIO);
  assert.strictEqual(VL.ratioAfterDrag(100, 5000, 1000, 24), VL.MAX_RATIO);
  near(VL.MIN_RATIO, 0.15);
  near(VL.MAX_RATIO, 0.85);
});

check('ratioAfterDrag: a window with no room (not laid out yet) gives no answer, and so does nonsense', () => {
  assert.strictEqual(VL.ratioAfterDrag(0, 0, 0, 0), null);
  assert.strictEqual(VL.ratioAfterDrag(10, 5, 24, 24), null, 'the divider alone fills the window');
  assert.strictEqual(VL.ratioAfterDrag(NaN, 5, 1000, 24), null);
  near(VL.ratioAfterDrag(488, 0, 1000, undefined) * 1000, 488, 'no divider width given: the whole window');
});

// ---- the divider: keys --------------------------------------------------------------------------------------
check('ratioAfterKey: the arrows move two points, Shift ten', () => {
  near(VL.ratioAfterKey(0.5, 'ArrowRight', false), 0.52);
  near(VL.ratioAfterKey(0.5, 'ArrowLeft', false), 0.48);
  near(VL.ratioAfterKey(0.5, 'ArrowRight', true), 0.6);
  near(VL.ratioAfterKey(0.5, 'ArrowLeft', true), 0.4);
});

check('ratioAfterKey: Home and End go to the ends, Enter to half and half', () => {
  assert.strictEqual(VL.ratioAfterKey(0.7, 'Home', false), 0.15);
  assert.strictEqual(VL.ratioAfterKey(0.3, 'End', false), 0.85);
  assert.strictEqual(VL.ratioAfterKey(0.3, 'Enter', false), 0.5);
  assert.strictEqual(VL.ratioAfterKey(0.3, 'Enter', true), 0.5);
});

check('ratioAfterKey: it stops at the ends and does not wrap', () => {
  assert.strictEqual(VL.ratioAfterKey(0.16, 'ArrowLeft', false), 0.15);
  assert.strictEqual(VL.ratioAfterKey(0.15, 'ArrowLeft', true), 0.15);
  assert.strictEqual(VL.ratioAfterKey(0.84, 'ArrowRight', false), 0.85);
  assert.strictEqual(VL.ratioAfterKey(0.85, 'ArrowRight', true), 0.85);
});

check('ratioAfterKey: any other key is not for the divider (null), so the page keeps it', () => {
  for (const key of ['a', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape', ' ', 'PageUp', 'Delete', '', undefined]) assert.strictEqual(VL.ratioAfterKey(0.5, key, false), null, String(key));
});

check('ratioAfterKey: a ratio that is nonsense starts from half', () => {
  near(VL.ratioAfterKey(NaN, 'ArrowRight', false), 0.52);
  near(VL.ratioAfterKey(undefined, 'ArrowLeft', false), 0.48);
  near(VL.ratioAfterKey(7, 'ArrowLeft', false), 0.83, 'out of range is brought in first');
});

check('a drag and the keys agree: Enter then a drag of nothing is half', () => {
  const room = 1000 - 24;
  const half = VL.ratioAfterKey(0.2, 'Enter', false);
  near(VL.ratioAfterDrag(room * half, 0, 1000, 24), 0.5);
});

// ---- what the page shows -------------------------------------------------------------------------------------
check('percentOf: whole percent for aria-valuenow, inside 15..85', () => {
  assert.strictEqual(VL.percentOf(0.5), 50);
  assert.strictEqual(VL.percentOf(0.524), 52);
  assert.strictEqual(VL.percentOf(0.526), 53);
  assert.strictEqual(VL.percentOf(0.01), 15);
  assert.strictEqual(VL.percentOf(2), 85);
});

check('basisOf: a calc of the room the divider leaves, with the divider\'s variable', () => {
  assert.strictEqual(VL.basisOf(0.5), 'calc((100% - var(--split-w, 5px)) * 0.5000)');
  assert.strictEqual(VL.basisOf(0.123456, '--x'), 'calc((100% - var(--x, 5px)) * 0.1500)');
  assert.strictEqual(VL.basisOf(0.62), 'calc((100% - var(--split-w, 5px)) * 0.6200)');
});

// ---- the module itself ---------------------------------------------------------------------------------------
check('loading the module defines ViewLayout and starts nothing (no document, no window, no module)', () => {
  const vm = require('vm');
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, 'view_layout.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  assert.strictEqual(typeof ctx.ViewLayout, 'object');
  assert.deepStrictEqual(Object.keys(ctx.ViewLayout).sort(), ['DEFAULT_RATIO', 'KEY_STEP', 'KEY_STEP_BIG', 'MAX_RATIO', 'MIN_RATIO', 'basisOf', 'clampRatio', 'percentOf', 'ratioAfterDrag', 'ratioAfterKey', 'viewOf']);
  assert.ok(!/\bdocument\b|\bwindow\.(?!ViewLayout)/.test(src.replace(/\/\/.*$/gm, '').replace("typeof window !== 'undefined' ? window : globalThis", '')), 'it touches no document and no window');
});

console.log('\n' + passed + ' checks passed');
