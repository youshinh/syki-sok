// Mutation check of frontend/js/view_layout_test.js: each change below to frontend/js/view_layout.js (the kind of mistake the test is meant to
// catch) must make that test fail. The copies live in a temporary folder; the real files are never written.
//
// Node only. Run: node tests/view_layout_mutation_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const src = fs.readFileSync('frontend/js/view_layout.js', 'utf8').replace(/\r\n/g, '\n');
const test = fs.readFileSync('frontend/js/view_layout_test.js', 'utf8').replace(/\r\n/g, '\n');

const MUTATIONS = [
  ['the preview alone no longer wins', "if (s.isPreviewMode) return 'preview';", ''],
  ['a split with a preview is two editors', "return s.secondaryViewMode === 'preview' ? 'side' : 'pair';", "return s.secondaryViewMode === 'preview' ? 'pair' : 'side';"],
  ['a split is always two editors', "return s.secondaryViewMode === 'preview' ? 'side' : 'pair';", "return 'pair';"],
  ['a state with no flags is not one page', "return 'page';\n  }\n\n  function clampRatio", "return 'pair';\n  }\n\n  function clampRatio"],
  ['the drag counts the divider as room', 'const room = Number(totalPx) - (Number(dividerPx) || 0);', 'const room = Number(totalPx);'],
  ['the drag answers for a window with no room', 'if (!(room > 0)) return null;', ''],
  ['the drag forgets where the page began', 'const left = Number(startLeftPx) + (Number(dxPx) || 0);', 'const left = Number(dxPx) || 0;'],
  ['the drag answers nonsense', 'if (!Number.isFinite(left)) return null;', ''],
  ['the ratio has no lower limit', 'return Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));', 'return Math.min(MAX_RATIO, r);'],
  ['the ratio has no upper limit', 'return Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));', 'return Math.max(MIN_RATIO, r);'],
  ['the lower limit is 10%', 'const MIN_RATIO = 0.15;', 'const MIN_RATIO = 0.1;'],
  ['the upper limit is 90%', 'const MAX_RATIO = 0.85;', 'const MAX_RATIO = 0.9;'],
  ['a nonsense ratio is kept', 'if (!Number.isFinite(r)) return DEFAULT_RATIO;', ''],
  ['an arrow moves one point', 'const KEY_STEP = 0.02;', 'const KEY_STEP = 0.01;'],
  ['Shift moves five points', 'const KEY_STEP_BIG = 0.1;', 'const KEY_STEP_BIG = 0.05;'],
  ['Shift does nothing', 'const step = shift ? KEY_STEP_BIG : KEY_STEP;', 'const step = KEY_STEP;'],
  ['the arrows are swapped', "case 'ArrowLeft': return clampRatio(clampRatio(ratio) - step);", "case 'ArrowLeft': return clampRatio(clampRatio(ratio) + step);"],
  ['an arrow can go past the end', "case 'ArrowLeft': return clampRatio(clampRatio(ratio) - step);", "case 'ArrowLeft': return clampRatio(ratio) - step;"],
  ['Home goes to the wrong end', "case 'Home': return MIN_RATIO;", "case 'Home': return MAX_RATIO;"],
  ['End goes nowhere', "case 'End': return MAX_RATIO;", "case 'End': return clampRatio(ratio);"],
  ['Enter does not reset', "case 'Enter': return DEFAULT_RATIO;", "case 'Enter': return clampRatio(ratio);"],
  ['any key moves the divider', 'default: return null;', 'default: return clampRatio(ratio);'],
  ['percent is cut, not rounded', 'return Math.round(clampRatio(ratio) * 100);', 'return Math.floor(clampRatio(ratio) * 100);'],
  ['percent is not kept inside the limits', 'return Math.round(clampRatio(ratio) * 100);', 'return Math.round(Number(ratio) * 100);'],
  ['the basis is not clamped', "clampRatio(ratio).toFixed(4)", 'Number(ratio).toFixed(4)'],
  ['the basis is rounded to two digits', 'clampRatio(ratio).toFixed(4)', 'clampRatio(ratio).toFixed(2)'],
  ['the basis ignores the divider', "'calc((100% - var(' + (dividerVar || '--split-w') + ', 5px)) * '", "'calc(100% * '"],
  ['the module exports nothing to the page', 'global.ViewLayout = api;', '']
];

// the premise: the unmutated pair passes (otherwise every mutation would "be caught" by a test that fails for another reason)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlmut-'));
  try {
    fs.writeFileSync(path.join(dir, 'view_layout.js'), src);
    fs.writeFileSync(path.join(dir, 'view_layout_test.js'), test);
    const r = spawnSync(process.execPath, [path.join(dir, 'view_layout_test.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, 'view_layout_test.js passes on the real view_layout.js: ' + r.stdout + r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const bad = [];
for (const [name, find, replace] of MUTATIONS) {
  if (!src.includes(find)) { bad.push('target missing (the mutation no longer applies): ' + name); continue; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlmut-'));
  try {
    fs.writeFileSync(path.join(dir, 'view_layout.js'), src.replace(find, replace));
    fs.writeFileSync(path.join(dir, 'view_layout_test.js'), test);
    const r = spawnSync(process.execPath, [path.join(dir, 'view_layout_test.js')], { encoding: 'utf8' });
    if (r.status === 0) bad.push('SURVIVED: ' + name);
    else console.log('caught: ' + name);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
assert.deepEqual(bad, [], 'view_layout_test.js does not catch:\n  ' + bad.join('\n  '));
console.log('\nAll ' + MUTATIONS.length + ' mutations of view_layout.js are caught by view_layout_test.js');
