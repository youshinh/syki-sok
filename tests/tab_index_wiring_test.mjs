// v2 P3: the index tabs (thin strips on the window's edge; docs/design/v2-plan-P3.md) are wired the way the plan says. What is locked here is
// read from the source (no browser; the behaviour in a real browser is tests/smoke/108_tab_index_expand.mjs, the arithmetic is
// frontend/js/tab_strip_test.js, and tests/tab_overflow_wiring_test.mjs has the column's scrolling):
//   1. The DOM contract the tests, the smoke flows, the manual's pictures and the docshots rely on is kept: the ids and the classes.
//   2. The numbers are variables (6px strip, 12px hit area, 200px open, 30px / 20px tabs, the timing, the shading), the shading is the
//      pseudo-element's opacity from --d (no color-mix()), corners are square, the open strip is an overlay (no rule makes room for it
//      but the 6px of the page's own padding), the keyboard has a ring, reduced motion has no wait, forced colours have borders.
//   3. app.js draws through the keyed update (one element per note, written when it changed), the dot is patched once, the keys are
//      handled, F6 stops at the strip, the column scrolls through tab_overflow.js with axis y.
//   4. The mutation check: each of these checks fails on a copy of the sources that is broken the way the check is meant to catch.
//
// Node only. Run: node tests/tab_index_wiring_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TS = require('../frontend/js/tab_strip.js');

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const files = {
  html: read('frontend/index.html'),
  style: read('frontend/css/style.css'),
  chrome: read('frontend/css/chrome.css'),
  print: read('frontend/css/print.css'),
  app: read('frontend/js/app.js'),
  overlay: read('frontend/js/chrome_overlay.js'),
  a11y: read('frontend/js/a11y.js')
};

// The declarations of the first rule whose selector (text before the "{") is exactly `selector`; null when there is none.
function declarations(css, selector) {
  const text = noComments(css);
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('(?:^|[}\\n])\\s*' + esc + '\\s*\\{([^{}]*)\\}').exec(text);
  return m ? m[1] : null;
}
const prop = (decls, name) => {
  if (decls === null) return null;
  const m = new RegExp('(?:^|[;\\s])' + name.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;]+)').exec(decls);
  return m ? m[1].trim() : null;
};

// ---- 1. the DOM contract --------------------------------------------------------------------------------------------------------------------
function contractProblems({ html, app }) {
  const p = [];
  for (const id of ['tabs-list', 'tabs-scroll', 'btn-new-tab', 'btn-all-tabs']) {
    const n = (html.match(new RegExp('id="' + id + '"', 'g')) || []).length;
    if (n !== 1) p.push('id="' + id + '" must appear once in index.html (it appears ' + n + ' times): tests, smoke flows, docshots and the manual use it');
  }
  const workspace = html.slice(html.indexOf('<main id="workspace">'), html.indexOf('</main>'));
  if (!/^<main id="workspace">\s*<!--[\s\S]*?-->\s*<div id="tab-index-left" class="tab-index" data-side="left">/.test(workspace)) p.push('the left strip is the first thing in #workspace (an overlay in the window, not a part of the header)');
  if (!/<div id="tab-index-right" class="tab-index" data-side="right" hidden>\s*<div id="tabs-scroll-right">\s*<div id="tabs-list-right" role="tablist" aria-orientation="vertical"><\/div>/.test(workspace)) p.push('the right strip is there, hidden until two note pages are on screen, with its own scroll box and list');
  if (/id="tabs-list"|id="btn-new-tab"|id="tabs-bar"/.test(html.slice(html.indexOf('<header id="header">'), html.indexOf('</header>')))) p.push('the header has no tabs, no "+" and no #tabs-bar any more');
  for (const cls of ['tab-item', 'tab-title', 'tab-dirty-dot', 'tab-conflict-mark', 'tab-close']) {
    if (!app.includes("className = '" + cls + "'") && !app.includes("el.className = '" + cls + "'")) p.push("app.js does not make a ." + cls);
  }
  if (!app.includes('el.dataset.tabId = id;')) p.push('every tab carries data-tab-id');
  const order = ['js/tab_strip.js?v=', 'js/tab_overflow.js?v=', 'js/app.js?v='].map((s) => html.indexOf(s));
  if (order.some((i) => i < 0) || !(order[0] < order[1] && order[1] < order[2])) p.push('tab_strip.js loads before tab_overflow.js, which loads before app.js');
  if (!/<script src="js\/tab_strip\.js\?v=\d+\.\d+\.\d+"><\/script>/.test(html)) p.push('tab_strip.js has the usual ?v= pattern');
  return p;
}

// ---- 2. the stylesheet ----------------------------------------------------------------------------------------------------------------------
function styleProblems({ style, chrome, print }) {
  const p = [];
  const css = noComments(style);
  const root = prop(declarations(style, ':root'), '--tab-strip-w') !== null ? declarations(style, ':root') : null;
  const want = { '--tab-strip-w': '12px', '--tab-fill-w': '24px', '--tab-hit-w': '36px', '--tab-open-w': '200px', '--tab-h': '30px', '--tab-h-min': '20px', '--tab-open-ms': '220ms', '--tab-open-delay': '120ms', '--tab-mix-floor': '0.2', '--tab-mix-base': '0.68', '--tab-mix-step': '0.12', '--tab-strip-top': 'var(--ov-top)', '--tab-strip-bottom': 'var(--ov-bottom)', '--tab-strip-gap-right': '9px', '--tab-strip-pane-head': 'var(--pane-band-h)' };
  if (!root) p.push('style.css has no :root with --tab-strip-w');
  else for (const [k, v] of Object.entries(want)) if (prop(root, k) !== v) p.push(k + ' is ' + prop(root, k) + ', expected ' + v + ' (the sizes are variables, 6 / 12 / 200 px to start with: the owner sets them by looking at the app)');
  // the shading numbers are the ones tab_strip.js tests with
  const num = (k) => parseFloat(prop(root || '', k));
  if (num('--tab-mix-floor') !== TS.MIX_FLOOR || num('--tab-mix-base') !== TS.MIX_BASE || num('--tab-mix-step') !== TS.MIX_STEP) p.push('--tab-mix-* differ from TabStrip.MIX_FLOOR / MIX_BASE / MIX_STEP');

  const strip = declarations(style, '.tab-index');
  if (prop(strip, 'position') !== 'absolute') p.push('.tab-index is not position: absolute (an overlay: the text is not laid out again when it opens)');
  if (prop(strip, 'top') !== 'var(--tab-strip-top)' || prop(strip, 'bottom') !== 'var(--tab-strip-bottom)') p.push('.tab-index does not stand between the header and the status bar');
  if (prop(strip, 'width') !== 'var(--tab-hit-w)') p.push('.tab-index is not --tab-hit-w wide when collapsed');
  if (prop(strip, 'pointer-events') !== 'none') p.push('.tab-index takes pointer events over its empty length (the text under it could not be pressed)');
  if (!/layout paint/.test(prop(strip, 'contain') || '')) p.push('.tab-index has no `contain: layout paint` (its widening may not reach the text)');
  if (prop(strip, 'overflow') !== 'hidden') p.push('.tab-index does not clip to its width');
  if (!/^width var\(--tab-open-ms\) ease var\(--tab-delay\)/.test(prop(strip, 'transition') || '')) p.push('.tab-index widens with a transition of width and --tab-delay');
  const hover = declarations(style, '.tab-index:hover');
  const focus = declarations(style, '.tab-index:focus-within');
  if (prop(hover, 'width') !== 'var(--tab-open-w)' || prop(hover, '--tab-delay') !== 'var(--tab-open-delay)') p.push('a strip under the mouse widens to --tab-open-w after --tab-open-delay');
  if (prop(focus, 'width') !== 'var(--tab-open-w)' || prop(focus, '--tab-delay') !== '0s') p.push('a strip with the keyboard in it widens at once');
  if (css.indexOf('.tab-index:focus-within {') < css.indexOf('.tab-index:hover {')) p.push(':focus-within comes after :hover, so a focused strip under the mouse does not wait either');

  // the shading: the fill is a pseudo-element, its opacity max(floor, base - step x --d), the selected tab is 1
  const tab = declarations(style, '.tab-item');
  if (prop(tab, '--tab-o') !== 'max(var(--tab-mix-floor), calc(var(--tab-mix-base) - var(--tab-mix-step) * var(--d)))') p.push('--tab-o is not max(floor, base - step * --d)');
  if (prop(declarations(style, '.tab-item.active'), '--tab-o') !== '1') p.push('the selected tab is not at full strength');
  const fill = declarations(style, '.tab-item::before');
  if (prop(fill, 'opacity') !== 'var(--tab-o)' || prop(fill, 'background') !== 'var(--tab-accent)') p.push('the fill is not the ::before in --tab-accent at --tab-o (an opacity on the row itself would fade its text)');
  if (prop(fill, 'z-index') !== '-1' || prop(tab, 'isolation') !== 'isolate') p.push('the fill is not behind the name (z-index -1 in an isolated row)');
  if (prop(fill, 'width') !== 'var(--tab-fill-w)') p.push('the collapsed fill is not --tab-fill-w wide');
  if (prop(declarations(style, '.tab-index:is(:hover, :focus-within) .tab-item::before'), 'width') !== '100%') p.push('the open fill does not cover the row');
  if (prop(tab, 'flex') !== '0 1 var(--tab-h)' || prop(tab, 'min-height') !== 'var(--tab-h-min)') p.push('a tab is not --tab-h squeezed to --tab-h-min');
  if (prop(tab, 'width') !== '100%' || prop(tab, 'padding') !== '0') p.push('a tab is as wide as its strip with no padding of its own (a row wider than its strip would scroll the strip sideways when it takes the focus)');
  if (prop(declarations(style, '.tab-item.dragging::before'), 'opacity') !== 'calc(var(--tab-o) * 0.45)') p.push('the dragged tab is not paler');

  // square corners everywhere on tabs: the only border-radius of the strip is the round mark
  const block = css.slice(css.indexOf('.tab-index {'), css.indexOf('.tab-list-panel {')); // the strip's rules; the All tabs list's follow
  const radii = [...block.matchAll(/([^{}]*)\{[^{}]*border-radius:\s*([^;]+);/g)].map((m) => m[1].trim() + ' ' + m[2].trim());
  const allowed = ['.tab-item.is-dirty::after,\n.tab-item.has-conflict::after 50%', '.tab-item .tab-dirty-dot 50%', '.tab-item.has-conflict::after 0'];
  for (const r of radii) if (!allowed.some((a) => r.replace(/\s+/g, ' ') === a.replace(/\s+/g, ' '))) p.push('a rounded corner in the strip: ' + r);
  if (/color-mix\(|@container/.test(block)) p.push('color-mix() or @container in the strip (macOS 10.15 / Safari 15.6 has neither)');
  if (/[^{}]\{[^{}]*\{/.test(block.replace(/@media[^{]*\{/g, '').replace(/:root \{/g, ''))) p.push('CSS nesting in the strip');
  if (/will-change|backdrop-filter/.test(block)) p.push('a layer or a blur for the strip (it is a few small boxes; nothing here may cost the 80,000-line note a frame)');

  // the right page's strip: the same tabs mirrored, on the right edge of the right page, left of its scrollbar, below its own title bar
  const rs = declarations(style, '.tab-index[data-side="right"]');
  if (prop(rs, 'left') !== 'auto' || prop(rs, 'right') !== 'max(var(--tab-strip-gap-right), var(--tab-scrollbar-w, 0px))') p.push('the right strip does not stand left of the scrollbar of the right page (at least --tab-strip-gap-right, or the scrollbar width app.js measured)');
  if (prop(rs, 'top') !== 'calc(var(--tab-strip-top) + var(--tab-strip-pane-head))') p.push('the right strip does not start below the title bar of the right page');
  if (prop(declarations(style, '.tab-index[data-side="right"] .tab-item'), 'flex-direction') !== 'row-reverse') p.push('the tabs of the right strip are not mirrored (row-reverse: the name reads towards the edge)');
  const rf = declarations(style, '.tab-index[data-side="right"] .tab-item::before');
  if (prop(rf, 'left') !== 'auto' || prop(rf, 'right') !== '0') p.push('the fill of the right strip is not on its right edge');
  if (prop(declarations(style, '.tab-index[data-side="right"] .tab-title'), 'text-align') !== 'right') p.push('the names of the right strip do not read towards its edge');
  if (!/#tabs-list,\s*#tabs-list-right \{[^}]*flex-direction: column/.test(css) || !/#tabs-scroll,\s*#tabs-scroll-right \{[^}]*overflow-y: auto/.test(css)) p.push('the right strip\'s column and scroll box are not styled like the left one');
  // the text keeps its place
  if (prop(declarations(style, '#editor-pane'), 'padding-left') !== 'var(--tab-strip-w)') p.push('#editor-pane does not leave the strip its own padding-left (the result bars of the gutter would lie under the strip)');
  if (/#workspace\s*\{[^}]*padding/.test(css)) p.push('#workspace has a padding (the pane resizer divides by its width: the room goes into the pane)');
  // keyboard, motion, forced colours
  if (prop(declarations(style, '.tab-item:focus-visible'), 'outline') !== '2px solid currentColor') p.push('a tab with the keyboard has no ring in its own text colour (it reads on its fill)');
  if (prop(declarations(style, '.tab-index-btn:focus-visible'), 'outline') !== '2px solid currentColor') p.push('"+" and All tabs have no keyboard ring');
  const motion = /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(css.slice(css.indexOf('.tab-index {')));
  if (!motion || prop(motion[1], '--tab-open-delay') !== '0ms' || prop(motion[1], '--tab-text-lag') !== '0ms') p.push('reduced motion keeps a wait before the strip opens');
  const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(css.slice(css.indexOf('.tab-index {')));
  if (!forced || !/CanvasText/.test(forced[1]) || !/Highlight/.test(forced[1]) || !/\.tab-item::before \{\s*display: none/.test(forced[1])) p.push('forced colours: tabs are told apart by borders (CanvasText, Highlight), not by fills');
  if (prop(declarations(style, '#workspace[data-tabs="none"] .tab-index'), 'visibility') !== 'hidden') p.push('a view with no strip hides it from the Tab order too (visibility: hidden)');
  // the header's title takes the room the tabs left
  if (prop(declarations(chrome, '#header-title'), 'flex') !== '1 1 0') p.push('the title in the header is not in the flow');
  // Zen: away like the bars, the keyboard brings one back
  const zen = declarations(chrome, 'body.zen-mode .tab-index:not(:focus-within)');
  if (prop(zen, 'opacity') !== '0' || prop(zen, '--tab-hit') !== 'none') p.push('Zen mode: the strips are not away (opacity 0 and no pointer events) unless the keyboard is in one');
  if (/visibility/.test(noComments(chrome))) p.push('chrome.css hides something with visibility (the bars and the strips stay in the reading order)');
  // print
  if (!/#workspace > \*:not\(#preview-pane\)/.test(noComments(print))) p.push('print.css no longer hides every child of #workspace but the preview, so the strips would print');
  return p;
}

// ---- 3. the script --------------------------------------------------------------------------------------------------------------------------
const fnBody = (src, head) => {
  const at = src.indexOf(head);
  if (at < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  return '';
};

function scriptProblems({ app, overlay, a11y, html }) {
  const p = [];
  if (!/side: 'left', pane: 'primary'[^}]*selected: \(\) => activeTabId \}/.test(app) || !/side: 'right', pane: 'secondary'[^}]*selected: \(\) => secondaryTabId \}/.test(app)) p.push('the left strip does not mark the note of the left page, or the right strip does not mark the note of the right page');
  const draw = fnBody(app, 'function drawStrip(strip) {');
  const drawAll = fnBody(app, 'function drawTabs() {');
  const render = fnBody(app, 'function renderTabs() {');
  if (!/window\.TabStrip\.reconcile\(listEl, tabs, els, \{/.test(draw)) p.push('drawStrip does not go through TabStrip.reconcile (one element per note, kept)');
  if (!/make: \(x\) => makeTabEl\(x, strip\),\s*update: \(el, x, i\) => updateTabEl\(el, x, i, selectedIndex\)/.test(draw)) p.push('the keyed update does not make an element once and update the same ones');
  if (!/const selectedId = strip\.selected\(\);/.test(draw)) p.push('a strip does not mark its own page\'s note (strip.selected())');
  if (!/const view = syncStripMode\(\);[\s\S]*strip\.side === 'right' && !view\.right\)\) return;[\s\S]*drawStrip\(strip\);/.test(drawAll)) p.push('drawTabs does not draw the left strip always and the right one only while it is shown');
  if (!/if \(structural && focusedId !== null\)/.test(draw) || !/el\.focus\(\{ preventScroll: true \}\)/.test(draw)) p.push('a tab with the keyboard loses it when the list changes shape');
  if (/innerHTML\s*=\s*''/.test(render) || /createElement/.test(render)) p.push('renderTabs builds the list again (it must only call drawTabs)');
  const sync = fnBody(app, 'function syncStripMode() {');
  if (!/window\.TabStrip\s*\?\s*window\.TabStrip\.stripsFor\(\{ isPreviewMode, isSplitMode, secondaryViewMode \}\)/.test(sync) || !/workspaceEl\.setAttribute\('data-tabs', view\.mode\)/.test(sync) || !/right\.root\.hidden = !view\.right/.test(sync)) p.push('syncStripMode does not put TabStrip.stripsFor on the workspace (data-tabs) and hide the right strip');
  if (!/if \(view\.mode !== stripMode\) \{/.test(sync)) p.push('syncStripMode writes on every call (it must write only when the view changed)');
  const toggle = fnBody(app, 'async function togglePreview() {');
  if ((toggle.match(/syncStripMode\(\);/g) || []).length < 2) p.push('togglePreview does not tell the strips in both directions (the preview alone has none)');
  if (!/updateSecondaryPane\(\);\s*renderTabs\(\);[^\n]*\n\s*if \(secondaryViewMode === 'editor' && editorSecondary\)/.test(app)) p.push('the right page\'s preview/editor switch does not redraw the strips');
  const pane = fnBody(app, 'function paneForSelect() {');
  if (!/isSplitMode && secondaryViewMode === 'editor' && activePane === 'secondary' \? 'secondary' : 'primary'/.test(pane)) p.push('paneForSelect: the right page only when it is a note page and the person is in it (a preview follows the left page)');
  const click = fnBody(app, 'function handleTabClick(tabId, altKey = false, pane) {');
  if (!/const target = pane \|\| paneForSelect\(\);/.test(click) || !/target === 'secondary' && secondaryViewMode === 'editor'/.test(click) || !/openSplitEditor\(tabId\)/.test(click)) p.push('handleTabClick: the strip that was clicked names the page, the rest get the page you work in, Alt+click opens to the side');
  if (!/function showTab\(tabId\) \{\s*if \(paneForSelect\(\) === 'secondary'\)/.test(app)) p.push('a new note goes to the page you work in (paneForSelect)');
  if (!/drawTabs\(\);\s*updateHeaderTitle\(\);\s*renderAutosaveStatus\(\);[^\n]*\n\s*notifyTabOverflow\(\);\s*\}$/.test(render)) p.push('renderTabs does not end with the header title, the autosave item and the overflow module, in that order');
  const update = fnBody(app, 'function updateTabEl(el, tab, index, selectedIndex) {');
  for (const [what, re] of [['tabindex 0 on the selected tab only (one tab stop)', /const tabindex = active \? '0' : '-1';/], ['the distance --d', /setStyleVar\(el, '--d', String\(d\)\)/], ['writes only what changed', /if \(v\.title !== title\)[\s\S]*if \(v\.tip !== tip\)[\s\S]*if \(v\.tabindex !== tabindex\)[\s\S]*if \(v\.d !== d\)/], ['the dot exists only while the note is unsaved', /if \(dirty !== !!v\.dotEl\)/], ['the flags is-dirty / has-conflict / active', /setTabFlag\(el, v, 'active', active\);\s*setTabFlag\(el, v, 'is-dirty', dirty\);\s*setTabFlag\(el, v, 'has-conflict', conflict\);/]]) {
    if (!re.test(update)) p.push('updateTabEl: ' + what);
  }
  const patch = fnBody(app, 'function patchTabItem(tabId) {');
  if (!/updateTabEl\(el, tab, tabs\.indexOf\(tab\)/.test(patch) || !/tabStrips\.forEach\(\(strip\) => \{\s*const el = strip\.els\.get\(tabId\);/.test(patch)) p.push('patchTabItem does not update the note\'s element in every strip that has one');
  if ((app.match(/syncSecondaryTitle\(/g) || []).length < 6) p.push('the right page\'s title is kept by one function at every place that renames or saves a note');
  if ((app.match(/patchTabItem\(/g) || []).length < 5) p.push('the dot and the automatic title (both editors) go through patchTabItem');
  if (/tabsListEl\.querySelector/.test(app)) p.push('a tab element is looked up with querySelector (the Map has it)');
  if (!/tabStrips\.forEach\(\(strip\) => \{\s*if \(!strip\.listEl\) return;\s*strip\.listEl\.addEventListener\('keydown'/.test(app)) p.push('every strip has a keyboard handler');
  const keys = app.slice(app.indexOf("strip.listEl.addEventListener('keydown'"), app.indexOf('// Called when a page gets the focus or a click'));
  for (const [what, re] of [['Enter and Space choose the tab (an Alt chord opens it to the side)', /e\.key === 'Enter' \|\| e\.key === ' '\) \{\s*e\.preventDefault\(\);\s*handleTabClick\(id, e\.altKey, strip\.pane\);/], ['Delete closes the tab (with the question of an unsaved one)', /e\.key === 'Delete'[\s\S]*closeTab\(id\)/], ['the arrows, Home and End move the focus only', /window\.TabStrip\.keyMove\(e\.key, ids\.indexOf\(id\), ids\.length\)[\s\S]*el\.focus\(\)/], ['Ctrl and Cmd chords are left alone', /e\.ctrlKey \|\| e\.metaKey\) return;/]]) {
    if (!re.test(keys)) p.push('keys: ' + what);
  }
  const drag = fnBody(app, 'function onTabPointerDown(e, tabEl, tabId, strip) {');
  if (!/clientY/.test(drag) || /clientX >=/.test(drag) || !/window\.TabStrip\.dropTarget\(rects, moveEv\.clientY, tabId\)/.test(drag)) p.push('dragging: the pointer\'s height picks the place');
  if (!/window\.TabStrip\.reorder\(tabs\.map/.test(drag) || !/saveSessionDebounced\(\);/.test(drag)) p.push('dragging: the new order is kept in the session');
  if (!/handleTabClick\(tabId, e\.altKey, strip\.pane\)/.test(drag)) p.push('a press that does not move is a click for the strip\'s page (Alt+click opens to the side)');
  if (!/ev\.key !== 'Escape' \|\| !isDragging\) return;[\s\S]*finish\(false\)/.test(drag) || !/addEventListener\('keydown', onDragKey, true\)/.test(drag)) p.push('dragging: Esc lets the tab go');
  if (!/window\.addEventListener\('pointercancel', onPointerCancel\)/.test(drag) || !/const onPointerCancel = \(\) => finish\(false\)/.test(drag)) p.push('dragging: the system taking the pointer lets the tab go');
  if (!/farFromStrip\(moveEv\)/.test(drag) || !/const DRAG_LEAVE_PX = /.test(app)) p.push('dragging: the pointer leaving the strip takes the drop away');
  if (!/const held = document\.activeElement;[\s\S]*ed\.focus\(\)/.test(drag)) p.push('dragging: the dragged tab keeps the focus, so its strip stays open: the note gets the focus back');
  const menu = app.slice(app.indexOf("window.addEventListener('contextmenu'"), app.indexOf('syncTagContextItems();', app.indexOf("window.addEventListener('contextmenu'")));
  const forget = fnBody(app, 'function forgetContextTabUnlessOnTab(target) {');
  if (!/forgetContextTabUnlessOnTab\(e\.target\);/.test(menu) || !/tabStrips\.some\(\(strip\) => tabIdOfNode\(target, strip\) !== null\)\) contextMenuTargetTabId = null;/.test(forget)) p.push('a right-click anywhere but on a tab forgets the tab that was named for "Open to the Side"');
  if (!/const target = contextMenuTargetTabId \|\| activeTabId;\s*contextMenuTargetTabId = null;/.test(app)) p.push('"Open to the Side" uses the named tab once');
  const overflow = fnBody(app, 'function getTabOverflow() {');
  if (/axis/.test(overflow) || !/panelPlacement: 'side'/.test(overflow) || !/panelAnchor: stripListAnchor/.test(overflow)) p.push('the columns scroll with tab_overflow.js (it has only the vertical way now) and its list opens beside the strip');
  if (!/tabs-scroll-right/.test(overflow) || !/getActiveId: \(\) => secondaryTabId/.test(overflow) || !/focusedIds: \[activeTabId, secondaryTabId\]/.test(app)) p.push('both strips are kept in view, each by its own page\'s note');
  if (!/strips: \(\) => \['tab-index-left', 'tab-index-right', 'pane-resizer'\]/.test(app)) p.push('F6 does not ask for the strips');
  // F6 goes round the strips
  const focusBar = fnBody(overlay, 'function focusBar(direction) {');
  if (!/\[\{ name: 'note' \}, \{ name: 'header', el: header \}\][\s\S]*\.concat\(strips\.map[\s\S]*\{ name: 'footer', el: footer \}/.test(focusBar)) p.push('F6: note -> header -> strips -> status bar');
  if (!/stripEls\(\)\.some\(\(strip\) => isIn\(strip, a\)\)/.test(overlay)) p.push('Esc from a strip does not take the focus back to the note (focusInBar knows the strips)');
  // names for a screen reader
  if (!/aria-orientation="vertical"/.test(html)) p.push('the tablist is not marked vertical');
  if (!/list\.setAttribute\('role', 'tablist'\)/.test(a11y) || !/'tabs-list-right'/.test(a11y)) p.push('a11y.js no longer names the tabs (both lists)');
  if (!/observer\.observe\(right, \{ attributes: true, attributeFilter: \['hidden'\] \}\)/.test(a11y)) p.push('a11y.js does not follow the right strip appearing (the left list is called "Tabs of the left page" only then)');
  return p;
}

// ---- running --------------------------------------------------------------------------------------------------------------------------------
const failures = [];
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS: ' + name); } catch (e) { failures.push(name); console.log('FAIL: ' + name); console.log(e && e.message ? e.message : e); }
}
const none = (list, what) => assert.deepEqual(list, [], what + ':\n  ' + list.join('\n  '));

check('the DOM contract is kept: the ids and classes, the strip in the workspace, the scripts in order', () => {
  none(contractProblems(files), 'the contract is broken');
});

check('the stylesheet: variables for every number, an overlay that opens by width only, shading by the fill\'s opacity, square corners, ring, reduced motion, forced colours, Zen, print', () => {
  none(styleProblems(files), 'the strip\'s CSS is not what the plan says');
});

check('the script: keyed draw, one dot patch, keys, drag by height, the column on its vertical axis, F6 stops at the strip', () => {
  none(scriptProblems(files), 'the strip\'s script is not what the plan says');
});

// ---- the mutation check ---------------------------------------------------------------------------------------------------------------------
function mutate(text, find, replace) {
  assert.ok(text.includes(find), 'the mutation target exists: ' + find);
  return text.replace(find, replace);
}
const caught = (list, re, what) => assert.ok(list.some((x) => re.test(x)), what + ' (got: ' + list.join(' | ') + ')');

check('mutation check: broken copies of the sources are caught', () => {
  assert.equal(contractProblems(files).length, 0, 'the real files are clean (the premise of the mutations)');
  assert.equal(styleProblems(files).length, 0);
  assert.equal(scriptProblems(files).length, 0);
  // the contract
  caught(contractProblems({ ...files, html: mutate(files.html, 'id="btn-new-tab"', 'id="btn-new"') }), /btn-new-tab/, 'a renamed "+" is caught');
  caught(contractProblems({ ...files, html: mutate(files.html, '<div id="tab-index-left" class="tab-index" data-side="left">', '<div id="tab-index-left" class="tab-index" data-side="left" style="">') }), /left strip is the first thing/, 'a different strip markup is caught');
  caught(contractProblems({ ...files, html: mutate(files.html, '  <script src="js/tab_strip.js?v=1.0.0"></script>\n', '') }), /loads before tab_overflow/, 'the script missing is caught');
  // the stylesheet
  const s = (find, replace) => styleProblems({ ...files, style: mutate(files.style, find, replace) });
  caught(s('--tab-strip-w: 12px;', '--tab-strip-w: 8px;'), /--tab-strip-w is 8px/, 'a changed width is caught (change the test with the number)');
  caught(s('opacity: var(--tab-o);', 'opacity: 0.5;'), /fill is not the ::before/, 'a fixed fill is caught');
  caught(s('--tab-mix-step: 0.12;', '--tab-mix-step: 0.2;'), /--tab-mix-\* differ/, 'shading numbers that drifted from tab_strip.js are caught');
  caught(s('position: absolute;\n  z-index: -1;', 'position: absolute;\n  z-index: 1;'), /not behind the name/, 'a fill above the name is caught');
  caught(s('.tab-index {\n  --tab-delay: 0s;\n  position: absolute;', '.tab-index {\n  --tab-delay: 0s;\n  position: relative;'), /not position: absolute/, 'a strip that takes room is caught');
  caught(s('  contain: layout paint;\n', ''), /contain/, 'a strip without containment is caught');
  caught(s('  right: max(var(--tab-strip-gap-right), var(--tab-scrollbar-w, 0px));', '  right: 0;'), /left of the scrollbar/, 'a right strip over the scrollbar is caught');
  caught(s('  flex-direction: row-reverse;', '  flex-direction: row;'), /not mirrored/, 'tabs that are not mirrored on the right are caught');
  caught(s('.tab-index[data-side="right"] .tab-item::before {\n  left: auto;\n  right: 0;', '.tab-index[data-side="right"] .tab-item::before {\n  left: 0;\n  right: auto;'), /fill of the right strip/, 'a fill on the wrong edge is caught');
  caught(s('top: calc(var(--tab-strip-top) + var(--tab-strip-pane-head));', 'top: var(--tab-strip-top);'), /below the title bar/, 'a right strip over the title bar of the right page is caught');
  caught(s('outline: 2px solid currentColor;\n  outline-offset: -4px;\n}\n\n.tab-title', 'outline: none;\n}\n\n.tab-title'), /no ring/, 'a tab without a keyboard ring is caught');
  caught(s('  --tab-open-delay: 0ms;\n', ''), /reduced motion keeps a wait/, 'a wait kept under reduced motion is caught');
  caught(s('  padding: 0;\n  background-color: transparent;\n  color: var(--tab-ink);\n  font-size: 12px;', '  padding: 0 12px;\n  background-color: transparent;\n  color: var(--tab-ink);\n  font-size: 12px;'), /no padding of its own/, 'a padded row (wider than the strip) is caught');
  caught(s('.tab-item.dragging::before {\n  opacity: calc(var(--tab-o) * 0.45);', '.tab-item.dragging::before {\n  opacity: 0.45;'), /dragged tab is not paler/, 'a dragged tab that is not shaded is caught');
  caught(s('#editor-pane {\n  padding-left: var(--tab-strip-w);', '#editor-pane {\n  padding-left: 0;'), /padding-left/, 'text under the strip is caught');
  caught(s('.tab-item .tab-dirty-dot {\n  flex: none;\n  width: var(--tab-dot);\n  height: var(--tab-dot);\n  margin: 0 8px 0 0;\n  border-radius: 50%;', '.tab-item .tab-dirty-dot {\n  flex: none;\n  width: var(--tab-dot);\n  height: var(--tab-dot);\n  margin: 0 8px 0 0;\n  border-radius: 50%;\n  background-image: color-mix(in srgb, red, blue);'), /color-mix/, 'color-mix() in the strip is caught');
  caught(s('.tab-index-btn {\n  display: flex;', '.tab-index-btn {\n  border-radius: 4px;\n  display: flex;'), /rounded corner/, 'a rounded corner is caught');
  caught(styleProblems({ ...files, chrome: mutate(files.chrome, '  opacity: 0;\n  --tab-hit: none;', '  visibility: hidden;') }), /Zen mode: the strips are not away|visibility/, 'Zen that hides by visibility is caught');
  caught(styleProblems({ ...files, print: files.print.replace('#workspace > *:not(#preview-pane)', '#workspace > *:not(#something)') }), /would print/, 'a strip that prints is caught');
  // the script
  const a = (find, replace) => scriptProblems({ ...files, app: mutate(files.app, find, replace) });
  caught(a('structural = window.TabStrip.reconcile(listEl, tabs, els, {', 'structural = window.TabStrip.somethingElse(listEl, tabs, els, {'), /reconcile/, 'a draw that is not keyed is caught');
  caught(a("const tabindex = active ? '0' : '-1';", "const tabindex = '0';"), /tabindex 0 on the selected tab only/, 'every tab a tab stop is caught');
  caught(a('if (v.d !== d) {', 'if (true) {'), /writes only what changed/, 'a write on every draw is caught');
  caught(a("if (e.key === 'Delete') {", "if (e.key === 'Backspace') {"), /Delete closes/, 'a missing Delete is caught');
  caught(a('window.TabStrip.dropTarget(rects, moveEv.clientY, tabId)', 'window.TabStrip.dropTarget(rects, moveEv.clientX, tabId)'), /pointer's height/, 'a drag by width is caught');
  caught(a("panelPlacement: 'side',", ''), /list opens beside the strip/, 'a list that hangs under its button is caught');
  caught(a("strips,\n        panelPlacement", "strips,\n        axis: 'x',\n        panelPlacement"), /columns scroll with tab_overflow/, 'a leftover horizontal axis is caught');
  caught(a("strip.listEl.addEventListener('keydown', (e) => {", "strip.listEl.addEventListener('keyup', (e) => {"), /every strip has a keyboard handler/, 'no keys is caught');
  // the pages: a strip changes its own page, the right strip exists only for two note pages, the preview alone has none
  caught(a('    forgetContextTabUnlessOnTab(e.target);\n', ''), /forgets the tab that was named/, 'a right-click that does not forget the tab named before is caught');
  caught(a('contextMenuTargetTabId = null; // used up', '// used up'), /uses the named tab once/, 'a tab that stays named after it was used is caught');
  caught(a('? window.TabStrip.stripsFor({ isPreviewMode, isSplitMode, secondaryViewMode })', '? window.TabStrip.stripsFor({ isPreviewMode, isSplitMode: false, secondaryViewMode })'), /syncStripMode does not put/, 'a view that forgets the split is caught');
  caught(a('syncStripMode(); // the preview alone has no strip\n', ''), /togglePreview does not tell the strips/, 'a preview alone that keeps its strip is caught');
  caught(a('const target = pane || paneForSelect();', 'const target = paneForSelect();'), /handleTabClick: the strip that was clicked names the page/, 'a click that goes to the page with the keyboard, not to the strip\'s page, is caught');
  caught(a("return isSplitMode && secondaryViewMode === 'editor' && activePane === 'secondary' ? 'secondary' : 'primary';", "return isSplitMode && activePane === 'secondary' ? 'secondary' : 'primary';"), /paneForSelect/, 'a preview that can be chosen from is caught');
  caught(a('els: new Map(), selected: () => secondaryTabId }', 'els: new Map(), selected: () => activeTabId }'), /right strip does not mark the note of the right page/, 'a right strip that marks the note of the left page is caught');
  caught(a("if (ev.key !== 'Escape' || !isDragging) return;", "if (ev.key !== 'Enter' || !isDragging) return;"), /Esc lets the tab go/, 'a drag that Esc does not let go is caught');
  caught(a('const next = window.TabStrip && !farFromStrip(moveEv) ?', 'const next = window.TabStrip ?'), /leaving the strip takes the drop away/, 'a drop far from the strip that still moves a note is caught');
  caught(a('window.addEventListener(\'pointercancel\', onPointerCancel);', 'window.addEventListener(\'pointercancel\', onPointerUp);'), /system taking the pointer/, 'a cancelled pointer that drops the tab is caught');
  caught(a('        const held = document.activeElement;\n', '        const held = null;\n'), /note gets the focus back/, 'a drag that leaves the focus on the tab is caught');
  caught(scriptProblems({ ...files, overlay: mutate(files.overlay, ".concat(strips.map((el) => ({ name: stripName(el), el })))", '') }), /F6/, 'an F6 that skips the strip is caught');
  caught(scriptProblems({ ...files, overlay: mutate(files.overlay, '|| stripEls().some((strip) => isIn(strip, a))', '') }), /Esc from a strip/, 'an Esc that does not leave the strip is caught');
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
console.log('\nAll index tab wiring tests passed!');
