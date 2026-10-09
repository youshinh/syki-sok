// The Dock's magnification of the index tabs (frontend/js/tab_dock.js) and the width rule of a pinned strip (TabStrip.pinnedWidth).
import assert from 'assert';
import { createRequire } from 'module';
import fs from 'fs';

console.log('=== tab dock tests ===');
const require = createRequire(import.meta.url);
const D = require('../frontend/js/tab_dock.js');
const T = require('../frontend/js/tab_strip.js');

// 1. the bell: 1 under the pointer, falling off smoothly and symmetrically
assert.strictEqual(D.bell(100, 100), 1);
assert.ok(Math.abs(D.bell(70, 100) - D.bell(130, 100)) < 1e-12);
assert.ok(D.bell(130, 100) < 1 && D.bell(130, 100) > D.bell(190, 100));
assert.ok(D.bell(100 + 3 * D.SIGMA, 100) < 0.001, 'three bell widths away is not magnified');

// 2. the width of a row: collapsed -> resting width over the strip -> full under the pointer
assert.strictEqual(D.rowWidth(18, 90, 200, 0, 0), 18);
assert.strictEqual(D.rowWidth(18, 90, 200, 1, 0), 90);
assert.strictEqual(D.rowWidth(18, 90, 200, 1, 1), 200);
assert.ok(D.rowWidth(18, 90, 200, 1, 0.5) > 90 && D.rowWidth(18, 90, 200, 1, 0.5) < 200);
assert.strictEqual(D.rowWidth(18, 90, 60, 1, 1), 60, 'a full width below the resting one still wins: the strip never gets wider than it opens');

// 2b. the strength the person sets: kept between the least that still shows and 100, a bad value is the full strength
assert.strictEqual(D.strengthOf(100), 100);
assert.strictEqual(D.strengthOf(60), 60);
assert.strictEqual(D.strengthOf(0), D.MIN_STRENGTH);
assert.strictEqual(D.strengthOf(500), 100);
assert.strictEqual(D.strengthOf('x'), 100);
assert.strictEqual(D.strengthOf(undefined), 100);
assert.ok(D.MIN_STRENGTH >= 10 && D.MIN_STRENGTH <= 30);

// 2c. easing by elapsed time: the same curve at any frame rate, nothing when no time has passed, one when there is no easing
assert.strictEqual(D.easeShare(0, 60), 0);
assert.strictEqual(D.easeShare(16, 0), 1);
assert.ok(Math.abs(D.easeShare(30, 60) - (1 - Math.exp(-0.5))) < 1e-12, 'dt over tau is 1 - e^-(dt/tau)');
const twoFrames = 1 - (1 - D.easeShare(8, 60)) * (1 - D.easeShare(8, 60));
assert.ok(Math.abs(twoFrames - D.easeShare(16, 60)) < 1e-12, 'two 8ms frames move a tab as far as one 16ms frame');
assert.strictEqual(D.easeShare(5000, 60), D.easeShare(50, 60), 'a stalled page does not jump');

// 3. the names: hidden on a thin strip, readable at the resting width
assert.strictEqual(D.textShare(18), 0);
assert.strictEqual(D.textShare(D.BASE_W), 1);
assert.ok(D.textShare(70) > 0 && D.textShare(70) < 1);

// 4. a pinned strip: clamped to what holds its buttons, let go when dragged further in
assert.deepStrictEqual(T.pinnedWidth(200), { width: 200, unpin: false });
assert.deepStrictEqual(T.pinnedWidth(1000), { width: T.PINNED_MAX, unpin: false });
assert.deepStrictEqual(T.pinnedWidth(80), { width: T.PINNED_MIN, unpin: false }, 'between the least and the let-go point it holds at the least');
assert.deepStrictEqual(T.pinnedWidth(T.PINNED_UNPIN - 1), { width: T.PINNED_MIN, unpin: true });
assert.deepStrictEqual(T.pinnedWidth('x'), { width: T.PINNED_DEFAULT, unpin: false });
assert.ok(T.PINNED_UNPIN < T.PINNED_MIN && T.PINNED_MIN < T.PINNED_DEFAULT && T.PINNED_DEFAULT < T.PINNED_MAX);

// 5. nothing is loaded at start-up: the page's script list does not name tab_dock.js (app.js loads it on the first hover)
const html = fs.readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
assert.ok(!/tab_dock\.js/.test(html), 'tab_dock.js is loaded on the first hover, not by index.html');
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');
assert.ok(/loadScript\('js\/tab_dock\.js/.test(app), 'app.js loads tab_dock.js on the first hover');
assert.ok(/id="cfg-tab-dock-follow-os"/.test(html) && /tabDockFollowOs: false/.test(app), 'following the reduce-motion setting of the system is a setting, off unless chosen: the magnification eases by default');
assert.ok(/id="cfg-tab-dock-strength" min="20" max="100"/.test(html), 'Settings has the strength slider next to the on/off box, within the range the dock allows');

// 6. unpinning closes the strips: the focus leaves them and they stop answering the pointer until it has been out of them
const css = fs.readFileSync(new URL('../frontend/css/style.css', import.meta.url), 'utf8');
assert.ok(/\.tab-index\.tabs-away\s*\{\s*--tab-hit:\s*none;/.test(css), 'a strip just unpinned takes no pointer events');
assert.ok(/function closeStripsAfterUnpin\(\)/.test(app) && /if \(wasPinned && !isTabsPinned\) closeStripsAfterUnpin\(\);/.test(app), 'setPinTabs closes the strips when it unpins');
assert.ok(/focused\.blur\(\)/.test(app), 'the focus leaves the strip (the pin button would hold it open)');

console.log('tab dock tests passed');
