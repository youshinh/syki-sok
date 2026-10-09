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

// 2d. the pointer in the unmagnified layout: with nothing added it is where it is; with height added above, the row on screen under the
// pointer maps to that row's own centre (so the widest tab is the one under the pointer, not one below it)
{
  const centres = [15, 45, 75, 105, 135];
  assert.strictEqual(D.toUnmagnified(centres, [0, 0, 0, 0, 0], 80), 80);
  const extras = [2, 6, 12, 6, 2]; // heights added so far
  let above = 0; const shown = centres.map((c, i) => { const v = c + above + extras[i] / 2; above += extras[i]; return v; });
  centres.forEach((c, i) => assert.ok(Math.abs(D.toUnmagnified(centres, extras, shown[i]) - c) < 1e-9, 'the centre of row ' + i + ' on screen is its own centre'));
  const mid = (shown[1] + shown[2]) / 2;
  assert.ok(Math.abs(D.toUnmagnified(centres, extras, mid) - 60) < 1e-9, 'half way between two rows on screen is half way between their centres');
  assert.ok(D.toUnmagnified(centres, extras, shown[0] - 10) < centres[0], 'above the first row');
  assert.ok(D.toUnmagnified(centres, extras, shown[4] + 10) > centres[4], 'below the last row');
  assert.strictEqual(D.toUnmagnified([], [], 50), 50);
}

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

// 7. the three buttons under the tabs wear the accent like the tabs (not the bare wall colour, black in the ink look), open, pinned and magnified
assert.ok(/.tab-index-btn::before\s*\{[^}]*background:\s*var\(--tab-accent\)/.test(css), 'the buttons have the accent tint');
assert(/\.tab-index:is\(:hover, :focus-within\) \.tab-index-btn::before\s*\{\s*opacity:\s*0\.2/.test(css), 'open: tinted');
assert(/body\.tabs-pinned \.tab-index \.tab-index-btn::before\s*\{\s*opacity:\s*0\.2/.test(css), 'pinned: tinted');
assert(/\.tab-index\.dock-live \.tab-index-btn::before\s*\{\s*opacity:\s*calc\(var\(--bgs, 0\) \* 0\.2\)/.test(css), 'magnified: tinted with the fill');

// 8. the thin width of the strips is a setting from 12px (the old width) up, and the default is the style sheet's own
assert.ok(/id="cfg-tab-strip-width" min="12" max="48"/.test(html), 'Settings has the width of the tab edge, the old 12px as the least');
assert.ok(/tabStripWidth: 24,/.test(app) && /--tab-fill-w: 24px;/.test(css) && /--tab-hit-w: 36px;/.test(css), 'the default is 24px (fill) and 36px (hit area), twice the old width');
assert.ok(/--tab-strip-w: 12px;/.test(css) && /#editor-pane \{[^}]*padding-left: var\(--tab-strip-w\)/.test(css), 'the layout keeps its 12px: a wider strip covers the line numbers instead of pushing the text');
assert.ok(/Math\.round\(n \* 1\.5\)/.test(app), 'the hit area stays half as wide again as the fill');

// 9. the side preview moves the editor only while the person is moving the preview: a redraw clamps the preview's scroll position, and that
// event used to carry the editor away from the line being typed on (found in a note whose preview was scrolled to the end: the editor jumped to the top)
assert.ok(/let previewUserActive = false;/.test(app) && /secondaryPreviewPane\.addEventListener\('scroll', \(\) => \{\s*if \(!shouldSyncScroll\(\) \|\| isSyncingPreviewScroll \|\| !previewUserActive\) return;/.test(app), 'the preview-to-editor sync waits for the person');
assert.ok(/\['wheel', 'touchstart', 'touchmove', 'keydown'\]/.test(app) && /addEventListener\('pointerdown', \(\) => markPreviewUser\(true\)/.test(app), 'the wheel, a touch, a key and the scrollbar mark the preview as moved by the person');

// 10. the sliders of the settings are rows of their own (name, slider, value), in this order: dock switch, follow-the-system, strength, then width
const iDock = html.indexOf('id="cfg-tab-dock"'), iOs = html.indexOf('id="cfg-tab-dock-follow-os"'), iStr = html.indexOf('id="cfg-tab-dock-strength"'), iWid = html.indexOf('id="cfg-tab-strip-width"');
assert.ok(iDock > 0 && iDock < iOs && iOs < iStr && iStr < iWid, 'the width of the tab edge is under the strength');
assert.ok(/<div class="settings-slider-row">\s*<label for="cfg-tab-dock-strength"/.test(html) && /<div class="settings-slider-row">\s*<label for="cfg-tab-strip-width"/.test(html), 'both sliders are slider rows');
assert.ok(/\.settings-slider-row > input\[type="range"\],[^{]*\{[^}]*padding: 0;[^}]*border: 0;/.test(css), 'a slider has no box padding, so the thumb reaches both ends');

console.log('tab dock tests passed');
