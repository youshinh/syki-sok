// Unit tests for tab_strip.js (the pure parts of the v2 index tabs: which strips, shading, keys, reordering, keyed update).
const assert = require('assert');

const TS = require('./tab_strip.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('PASS: ' + name);
}

// ---- which strips a view shows ------------------------------------------------------------------------
check('stripsFor: one page and the note with its preview beside it have the left strip only', () => {
  assert.deepStrictEqual(TS.stripsFor({ isPreviewMode: false, isSplitMode: false, secondaryViewMode: 'editor' }), { mode: 'left', left: true, right: false });
  assert.deepStrictEqual(TS.stripsFor({ isPreviewMode: false, isSplitMode: true, secondaryViewMode: 'preview' }), { mode: 'left', left: true, right: false });
});

check('stripsFor: two note pages have a strip each, the preview alone has none', () => {
  assert.deepStrictEqual(TS.stripsFor({ isPreviewMode: false, isSplitMode: true, secondaryViewMode: 'editor' }), { mode: 'both', left: true, right: true });
  assert.deepStrictEqual(TS.stripsFor({ isPreviewMode: true, isSplitMode: false, secondaryViewMode: 'editor' }), { mode: 'none', left: false, right: false });
});

check('stripsFor: the preview alone wins over a split (the two never hold together, but if they did there would be no strip)', () => {
  assert.strictEqual(TS.stripsFor({ isPreviewMode: true, isSplitMode: true, secondaryViewMode: 'editor' }).mode, 'none');
});

check('stripsFor: no state is one page', () => {
  assert.strictEqual(TS.stripsFor().mode, 'left');
  assert.strictEqual(TS.stripsFor(null).left, true);
});

// ---- shading ---------------------------------------------------------------------------------------------
check('distanceOf: the index distance from the selected tab, in both directions, the selected one being 0', () => {
  assert.strictEqual(TS.distanceOf(3, 3), 0);
  assert.strictEqual(TS.distanceOf(1, 3), 2);
  assert.strictEqual(TS.distanceOf(6, 3), 3);
});

check('distanceOf: far tabs share one value (moving the selection rewrites only the tabs near it); no selection is "far" for all', () => {
  assert.strictEqual(TS.distanceOf(40, 0), TS.MAX_DISTANCE);
  assert.strictEqual(TS.distanceOf(99, 0), TS.MAX_DISTANCE);
  assert.strictEqual(TS.distanceOf(2, -1), TS.MAX_DISTANCE);
  assert.strictEqual(TS.distanceOf(-1, 2), TS.MAX_DISTANCE);
});

check('mixFor: the selected tab is full, then 68% minus 12% per step, never below 20% (the design: max(20%, 68% - 12% x distance))', () => {
  assert.strictEqual(TS.mixFor(0), 1);
  const near = [1, 2, 3, 4, 5, 20].map((d) => Math.round(TS.mixFor(d) * 100));
  assert.deepStrictEqual(near, [56, 44, 32, 20, 20, 20]);
});

check('mixFor: the numbers can be given (the CSS variables are the source of truth, the tests compare them)', () => {
  assert.strictEqual(TS.mixFor(2, 0.1, 0.5, 0.1), 0.3);
  assert.strictEqual(TS.mixFor(9, 0.1, 0.5, 0.1), 0.1);
  assert.strictEqual(TS.mixFor(0, 0.1, 0.5, 0.1), 1);
});

// ---- keys ----------------------------------------------------------------------------------------------------
check('keyMove: Up and Down walk one tab and wrap around; Left and Right do the same', () => {
  assert.strictEqual(TS.keyMove('ArrowDown', 0, 5), 1);
  assert.strictEqual(TS.keyMove('ArrowDown', 4, 5), 0);
  assert.strictEqual(TS.keyMove('ArrowUp', 0, 5), 4);
  assert.strictEqual(TS.keyMove('ArrowUp', 3, 5), 2);
  assert.strictEqual(TS.keyMove('ArrowRight', 1, 5), 2);
  assert.strictEqual(TS.keyMove('ArrowLeft', 1, 5), 0);
});

check('keyMove: Home and End jump to the ends; other keys, an empty strip and a lost position are handled', () => {
  assert.strictEqual(TS.keyMove('Home', 3, 5), 0);
  assert.strictEqual(TS.keyMove('End', 1, 5), 4);
  assert.strictEqual(TS.keyMove('a', 1, 5), -1);
  assert.strictEqual(TS.keyMove('Enter', 1, 5), -1);
  assert.strictEqual(TS.keyMove('ArrowDown', 0, 0), -1);
  assert.strictEqual(TS.keyMove('ArrowDown', -1, 3), 1, 'from nowhere it starts at the first tab');
  assert.strictEqual(TS.keyMove('ArrowUp', 9, 3), 2, 'a position past the end counts as the first');
  assert.strictEqual(TS.keyMove('ArrowDown', 0, 1), 0, 'one tab: it stays');
});

// ---- reordering ------------------------------------------------------------------------------------------
const rects = [
  { id: 'a', top: 0, bottom: 30 }, { id: 'b', top: 30, bottom: 60 }, { id: 'c', top: 60, bottom: 90 }, { id: 'd', top: 90, bottom: 120 }
];

check('dropTarget: the upper half of a tab takes the dragged one before it, the lower half after it', () => {
  assert.deepStrictEqual(TS.dropTarget(rects, 40, 'd'), { id: 'b', after: false });
  assert.deepStrictEqual(TS.dropTarget(rects, 50, 'd'), { id: 'b', after: true });
  assert.deepStrictEqual(TS.dropTarget(rects, 80, 'a'), { id: 'c', after: true });
});

check('dropTarget: the dragged tab is never its own target; over it there is none', () => {
  assert.strictEqual(TS.dropTarget(rects, 45, 'b'), null);
  assert.strictEqual(TS.dropTarget(rects, 75, 'c'), null);
});

check('dropTarget: above the first tab goes to the front, below the last to the end; the dragged end tab has none', () => {
  assert.deepStrictEqual(TS.dropTarget(rects, -10, 'c'), { id: 'a', after: false });
  assert.deepStrictEqual(TS.dropTarget(rects, 500, 'a'), { id: 'd', after: true });
  assert.strictEqual(TS.dropTarget(rects, -10, 'a'), null, 'a tab dragged above the first, being the first');
  assert.strictEqual(TS.dropTarget(rects, 500, 'd'), null);
  assert.strictEqual(TS.dropTarget([{ id: 'a', top: 0, bottom: 30 }], 500, 'x'), null, 'one tab: nothing to reorder');
  assert.strictEqual(TS.dropTarget(null, 5, 'x'), null);
});

check('reorder: moves a tab before or after another', () => {
  assert.deepStrictEqual(TS.reorder(['a', 'b', 'c', 'd'], 'd', 'b', false), ['a', 'd', 'b', 'c']);
  assert.deepStrictEqual(TS.reorder(['a', 'b', 'c', 'd'], 'a', 'c', true), ['b', 'c', 'a', 'd']);
  assert.deepStrictEqual(TS.reorder(['a', 'b', 'c', 'd'], 'a', 'd', true), ['b', 'c', 'd', 'a']);
  assert.deepStrictEqual(TS.reorder(['a', 'b', 'c', 'd'], 'd', 'a', false), ['d', 'a', 'b', 'c']);
});

check('reorder: a move that changes nothing, onto itself or with an unknown id gives null; the input is not touched', () => {
  const ids = ['a', 'b', 'c'];
  assert.strictEqual(TS.reorder(ids, 'b', 'a', true), null, 'already right after a');
  assert.strictEqual(TS.reorder(ids, 'a', 'b', false), null, 'already right before b');
  assert.strictEqual(TS.reorder(ids, 'a', 'a', true), null);
  assert.strictEqual(TS.reorder(ids, 'x', 'a', true), null);
  assert.strictEqual(TS.reorder(ids, 'a', 'x', true), null);
  assert.strictEqual(TS.reorder(null, 'a', 'b', true), null);
  assert.deepStrictEqual(ids, ['a', 'b', 'c']);
});

// ---- keyed update ------------------------------------------------------------------------------------------
// A list element that has only what the app's test doubles have: children, appendChild, and innerHTML = ''.
function fakeList() {
  const list = { children: [], appends: 0, clears: 0 };
  list.appendChild = (c) => { list.children.push(c); list.appends++; return c; };
  Object.defineProperty(list, 'innerHTML', { get: () => '', set: (v) => { if (v === '') { list.children = []; list.clears++; } } });
  return list;
}

function setup() {
  const list = fakeList();
  const cache = new Map();
  const log = { made: [], updated: [] };
  const hooks = {
    keyOf: (item) => item.id,
    make: (item) => { log.made.push(item.id); return { id: item.id, writes: 0 }; },
    update: (el, item, index) => { log.updated.push(item.id + '@' + index); el.writes++; el.title = item.title; }
  };
  return { list, cache, log, hooks, run: (items) => TS.reconcile(list, items, cache, hooks) };
}
const items = (...ids) => ids.map((id) => ({ id, title: id + '.md' }));
const order = (list) => list.children.map((c) => c.id).join(',');

check('reconcile: the first draw makes an element per item, in order, appended', () => {
  const s = setup();
  const r = s.run(items('a', 'b', 'c'));
  assert.strictEqual(order(s.list), 'a,b,c');
  assert.deepStrictEqual(s.log.made, ['a', 'b', 'c']);
  assert.deepStrictEqual(r, { structural: false, created: 3, removed: 0 }, 'an empty list gaining items is not a change of shape');
  assert.strictEqual(s.list.clears, 0);
});

check('reconcile: drawing the same tabs again touches the list not at all and makes nothing', () => {
  const s = setup();
  s.run(items('a', 'b', 'c'));
  const before = s.list.appends;
  const r = s.run(items('a', 'b', 'c'));
  assert.strictEqual(s.list.appends, before);
  assert.strictEqual(s.list.clears, 0);
  assert.deepStrictEqual(s.log.made, ['a', 'b', 'c'], 'no new element');
  assert.deepStrictEqual(r, { structural: false, created: 0, removed: 0 });
  assert.strictEqual(s.list.children[0].writes, 2, 'update was asked about every item (it decides what to write)');
});

check('reconcile: a new tab at the end is appended and the others are left in place', () => {
  const s = setup();
  s.run(items('a', 'b'));
  const kept = s.list.children.slice();
  const r = s.run(items('a', 'b', 'c'));
  assert.strictEqual(order(s.list), 'a,b,c');
  assert.strictEqual(s.list.children[0], kept[0]);
  assert.strictEqual(s.list.clears, 0);
  assert.strictEqual(r.structural, false);
  assert.strictEqual(r.created, 1);
});

check('reconcile: a closed tab in the middle drops its element and keeps the other elements (same objects, nothing made again)', () => {
  const s = setup();
  s.run(items('a', 'b', 'c', 'd'));
  const els = Object.fromEntries(s.list.children.map((c) => [c.id, c]));
  const r = s.run(items('a', 'c', 'd'));
  assert.strictEqual(order(s.list), 'a,c,d');
  assert.strictEqual(s.list.children[1], els.c);
  assert.strictEqual(s.cache.has('b'), false, 'the cache forgets it');
  assert.strictEqual(s.cache.size, 3);
  assert.deepStrictEqual(r, { structural: true, created: 0, removed: 1 });
  assert.strictEqual(s.log.made.length, 4);
});

check('reconcile: the last tab closed only shortens the list', () => {
  const s = setup();
  s.run(items('a', 'b', 'c'));
  const r = s.run(items('a', 'b'));
  assert.strictEqual(order(s.list), 'a,b');
  assert.strictEqual(r.structural, true, 'the list had to be emptied: an element is gone');
  assert.strictEqual(r.removed, 1);
});

check('reconcile: a reordered list holds the same elements in the new order', () => {
  const s = setup();
  s.run(items('a', 'b', 'c'));
  const els = Object.fromEntries(s.list.children.map((c) => [c.id, c]));
  const r = s.run(items('c', 'a', 'b'));
  assert.strictEqual(order(s.list), 'c,a,b');
  assert.strictEqual(s.list.children[0], els.c);
  assert.deepStrictEqual(r, { structural: true, created: 0, removed: 0 });
});

check('reconcile: a tab inserted in the middle is made and the later ones are kept', () => {
  const s = setup();
  s.run(items('a', 'c'));
  const c = s.list.children[1];
  const r = s.run(items('a', 'b', 'c'));
  assert.strictEqual(order(s.list), 'a,b,c');
  assert.strictEqual(s.list.children[2], c);
  assert.strictEqual(r.created, 1);
});

check('reconcile: update gets the index of the item, and every element is written with its own item', () => {
  const s = setup();
  s.run(items('a', 'b', 'c'));
  s.log.updated.length = 0;
  s.run([{ id: 'c', title: 'renamed' }, { id: 'a', title: 'a.md' }]);
  assert.deepStrictEqual(s.log.updated, ['c@0', 'a@1']);
  assert.strictEqual(s.list.children[0].title, 'renamed');
});

check('reconcile: no tabs at all empties the list and the cache', () => {
  const s = setup();
  s.run(items('a', 'b'));
  s.run([]);
  assert.strictEqual(s.list.children.length, 0);
  assert.strictEqual(s.cache.size, 0);
});

// ---- the module itself -----------------------------------------------------------------------------------
check('loading the module defines TabStrip and starts nothing', () => {
  const vm = require('vm');
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, 'tab_strip.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx); // an empty world: no document, no window, no module
  assert.strictEqual(typeof ctx.TabStrip, 'object');
  assert.deepStrictEqual(Object.keys(ctx.TabStrip).sort(), ['MAX_DISTANCE', 'MIX_BASE', 'MIX_FLOOR', 'MIX_STEP', 'distanceOf', 'dropTarget', 'keyMove', 'mixFor', 'reconcile', 'reorder', 'stripsFor']);
  assert.ok(!/document|innerHTML\s*=\s*[^'']/.test(src.replace(/\/\/.*$/gm, '').replace("innerHTML = ''", '')), 'it touches no document and writes no markup');
});

console.log('\n' + passed + ' checks passed');
