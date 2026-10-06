// v2 P2a: the header and the status bar are overlays that the text scrolls under, and they fade away while you write. This test keeps the
// RULES of that from being undone (the pixels were checked in the real app and in docshots):
//   * the style sheet and the script are loaded the way the plan says (chrome.css for the screen only, after style.css);
//   * the four boxes that show the same lines take their padding from the same two numbers, and the inset is the bars' own height;
//   * everything that used to be placed "under the header" is placed from --ov-top / --ov-bottom, the code that places things by
//     hand asks ChromeOverlay.insets();
//   * the fade changes opacity and pointer-events of the two bars and nothing else (no layout, no visibility, never the text boxes);
//   * the old typing dimmer (body.zen-active, with its :has() probes) is gone, the quiet-message rule of showMessage is kept;
//     (the rules of P2b - the bars' tint, Zen, the line numbers in the margin - are in tests/chrome_bars_zen_test.mjs);
//   * the shortcut that takes the focus round the note and the bars exists on both platforms, with names in both languages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const html = read('frontend/index.html');
const style = noComments(read('frontend/css/style.css'));
const chrome = noComments(read('frontend/css/chrome.css'));
const app = read('frontend/js/app.js');
const jev = read('frontend/js/jev_action.js');
const I18N = new Function(read('frontend/js/i18n.js') + '\nreturn I18N;')();
const CO = require('../frontend/js/chrome_overlay.js');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL: ' + name + '\n  ' + (e && e.message));
  }
}

// the declarations of the rule(s) whose selector list is exactly `selector` (whitespace-insensitive)
function declarations(css, selector) {
  const want = selector.replace(/\s+/g, ' ').trim();
  const found = [];
  for (const m of css.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) {
    if (m[1].replace(/\s+/g, ' ').trim() === want) found.push(m[2]);
  }
  assert.ok(found.length > 0, 'chrome.css has a rule for ' + selector);
  return found.join('\n');
}
const prop = (decls, name) => {
  const m = decls.match(new RegExp('(?:^|[;\\s])' + name.replace(/[-]/g, '\\-') + ':\\s*([^;]+);'));
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
};

check('chrome.css is a screen-only sheet after style.css; chrome_overlay.js is loaded before app.js', () => {
  const link = html.match(/<link rel="stylesheet" href="css\/chrome\.css[^"]*"([^>]*)>/);
  assert.ok(link, 'chrome.css is linked');
  assert.ok(/media="screen"/.test(link[1]), 'for the screen only (print.css hides the bars and must not meet them floating)');
  assert.ok(html.indexOf('css/style.css') < html.indexOf('css/chrome.css'), 'after style.css, so it wins with the same specificity');
  assert.ok(html.indexOf('css/tokens.css') < html.indexOf('css/style.css'));
  const s = html.indexOf('js/chrome_overlay.js');
  assert.ok(s > 0 && s < html.indexOf('js/app.js'), 'the module is there before app.js asks for it');
  assert.ok(!/chrome/.test(read('frontend/css/print.css')), 'print.css knows nothing of it');
});

check('the bars stay direct children of #app (print.css hides every child of #app but #workspace)', () => {
  const app0 = html.indexOf('<div id="app">');
  const header = html.indexOf('<header id="header">');
  const main = html.indexOf('<main id="workspace">');
  const footer = html.indexOf('<footer id="status-bar">');
  assert.ok(app0 > 0 && header > app0 && main > header && footer > main, 'order: #app > header, workspace, footer');
  const mainEnd = html.indexOf('</main>');
  assert.ok(footer > mainEnd, 'the status bar is outside #workspace');
  assert.ok(html.indexOf('</header>') < main, 'and the header too');
});

check('the numbers: the bars are 38 and 24px, the insets are those heights, the text margin is 14 x 12', () => {
  const root = declarations(chrome, ':root');
  assert.equal(prop(root, '--ov-top'), '38px');
  assert.equal(prop(root, '--ov-bottom'), '24px');
  assert.equal(prop(root, '--ov-inset-top'), 'var(--ov-top)', 'the text runs under the header by its whole height');
  assert.equal(prop(root, '--ov-inset-bottom'), 'var(--ov-bottom)');
  assert.equal(prop(root, '--pad-x'), '14px');
  assert.equal(prop(root, '--pad-y'), '12px');
  assert.equal(prop(root, '--pad-top-extra'), '0px');
  assert.equal(prop(declarations(chrome, '#header'), 'height'), 'var(--ov-top)');
  assert.equal(prop(declarations(chrome, '#status-bar'), 'height'), 'var(--ov-bottom)');
  // the geometry is chrome.css's alone: style.css no longer says the bars' height, position or fade (P2b removed the old duplicates)
  assert.ok(!/#header \{[^}]*(?:height|position|transition|background)/.test(style) && !/#status-bar \{[^}]*(?:height|position|transition|background)/.test(style), 'style.css leaves the bars\' height, position, tint and fade to chrome.css');
  assert.ok(!/(?:^|\n)(?:#editor|#editor-secondary|#ghost-overlay|#line-numbers|\.secondary-editor-pane \.line-numbers) \{[^}]*\bpadding:/.test(style), 'and the padding of the four boxes of the lines');
});

check('the four boxes of the lines share ONE padding: textarea, ghost text, gutter (and the same in the second pane)', () => {
  const panes = declarations(chrome, '#editor-pane, .secondary-editor-pane');
  const top = prop(panes, '--editor-pad-top');
  const bottom = prop(panes, '--editor-pad-bottom');
  assert.equal(top, 'calc(var(--ov-inset-top) + var(--pad-y) + var(--pad-top-extra))', 'the top: the room under the header, the margin, what a view asks for');
  assert.equal(bottom, 'calc(var(--ov-inset-bottom) + var(--pad-y))', 'the bottom: the room over the status bar and the margin');
  assert.equal(prop(declarations(chrome, '#editor, #editor-secondary, #ghost-overlay'), 'padding'), 'var(--editor-pad-top) var(--pad-x) var(--editor-pad-bottom)', 'the textareas and the ghost text overlay');
  assert.equal(prop(declarations(chrome, '#line-numbers, .secondary-editor-pane .line-numbers'), 'padding'), 'var(--editor-pad-top) 6px var(--editor-pad-bottom)', 'the gutters: the same top and bottom, digits right-aligned in 6px');
  // the second page runs under the header bar exactly like the first one (P4): it has no padding of its own at the top and does not undo the inset,
  // so the textareas of the two pages and the sheet beside the editor start at the same height (the room for the right page's name band is the
  // view's --pad-top-extra, which css/style.css gives to both pages alike: tests/split_view_style_test.mjs)
  assert.ok(!/#secondary-pane\s*\{[^}]*(?:--ov-inset-top|padding)/.test(chrome), 'chrome.css leaves the second pane no room of its own at the top');
});

check('the caret and a revealed element stay out from under the bars (scroll-padding), the HTML page sits between them', () => {
  const ed = declarations(chrome, '#editor, #editor-secondary');
  assert.equal(prop(ed, 'scroll-padding-top'), 'var(--ov-inset-top)');
  assert.equal(prop(ed, 'scroll-padding-bottom'), 'calc(var(--ov-inset-bottom) + 8px)');
  const pv = declarations(chrome, '#preview-pane');
  assert.equal(prop(pv, 'padding'), 'calc(var(--ov-inset-top) + 24px + var(--pad-top-extra, 0px)) 36px calc(var(--ov-inset-bottom) + 24px)', 'a sheet clears the bars, and the room a view keeps at the top');
  assert.equal(prop(declarations(chrome, '.secondary-preview-pane'), 'padding'), 'calc(var(--ov-inset-top) + 24px + var(--pad-top-extra, 0px)) 24px calc(var(--ov-inset-bottom) + 24px)', 'the sheet beside the editor too: it is the whole height of the page and runs under the bars');
  const html1 = declarations(chrome, '#preview-pane.html-mode, #workspace.split-mode #preview-pane.html-mode');
  assert.equal(prop(html1, 'padding'), 'var(--ov-inset-top) 0 var(--ov-inset-bottom) !important', 'the iframe scrolls by itself: put between the bars, not under them');
  assert.equal(prop(declarations(chrome, '.secondary-preview-pane.html-mode'), 'padding'), 'var(--ov-inset-top) 0 var(--ov-inset-bottom) !important', 'the same for the HTML page beside the editor: the pane is the whole height of the page now');
});

check('everything that was "16px under the header" is placed from the bars\' heights', () => {
  assert.equal(prop(declarations(chrome, '.preview-badge'), 'top'), 'calc(var(--ov-top) + 7px)');
  assert.equal(prop(declarations(chrome, '.preview-print-btn'), 'top'), 'calc(var(--ov-top) + 5px)');
  assert.equal(prop(declarations(chrome, '.find-replace-bar'), 'top'), 'calc(var(--ov-top) + 8px)');
  assert.equal(prop(declarations(chrome, '.inline-prompt-bar'), 'top'), 'calc(var(--ov-top) + var(--panel-top, 16px))');
  const dock = declarations(chrome, '.inline-prompt-bar.panel-dock-bottom');
  assert.equal(prop(dock, 'bottom'), 'calc(var(--ov-bottom) + var(--panel-top, 16px))', 'the bottom-edge exception sits above the status bar');
  assert.equal(prop(dock, 'top'), 'auto');
  assert.equal(prop(declarations(chrome, '.jev-action-panel'), 'bottom'), 'calc(var(--ov-bottom) + var(--panel-top, 16px))');
  assert.equal(prop(declarations(chrome, 'body.dark-theme'), '--panel-modal-top'), 'calc(var(--ov-top) + 15px)', 'the palette and the search keep their 53px');
  assert.equal(prop(declarations(chrome, '.status-ai-pop, .running-tasks-panel'), 'bottom'), 'calc(var(--ov-bottom) + 6px)');
  assert.ok(/--panel-top:\s*16px/.test(style), 'the gap itself is still 16px (docs/design/panel-template.md)');
});

check('the code that places things by hand asks ChromeOverlay.insets(): panels, search jump, RPC reveal, the Jev panel', () => {
  assert.ok(/function overlayInsets\(el\)/.test(app) && /window\.ChromeOverlay\.insets\(el\)/.test(app));
  const dock = app.slice(app.indexOf('function dockPanelBar('), app.indexOf('const askBarFade'));
  // v2 P5: the bar's top edge is its own computed top (css/chrome.css: the header bar and the 16px under it); the bars' height + 16 stands in
  // only for a page without styles (tests/panel_template_test.mjs holds the rule, and breaks it to see it caught)
  assert.ok(/overlayInsets\(workspaceEl\)\.top \+ 16/.test(dock) && /panelTopEdge\(bar\)/.test(dock), 'the bar is 16px under the header bar, from its own top');
  assert.ok(dock.includes('keepCoordsInView(getCharPixelCoords(index, editor), editor)'), 'the huge-note guard of the caret position is kept (tests/huge_note_perf_test.mjs)');
  const match = app.slice(app.indexOf('function goToMatch('), app.indexOf('function isFocusInFindBar('));
  assert.ok(/const topReserved = ov\.top \+ 85;/.test(match) && /viewHeight - ov\.bottom - 20/.test(match), 'a search hit lands below the find bar and above the status bar');
  const reveal = app.slice(app.indexOf('function rpcRevealOffset('), app.indexOf('function rpcPreviewState('));
  assert.ok(/top >= editor\.scrollTop \+ ov\.top && top \+ lineHeight <= editor\.scrollTop \+ viewHeight - ov\.bottom/.test(reveal), 'a line under a bar is not "already in view"');
  assert.ok(/ChromeOverlay\.insets\(box\)/.test(jev) && /wrapRect\.height - ov\.bottom - gap - panelH/.test(jev) && /ov\.top \+ gap \+ panelH/.test(jev), 'the Jev panel docks inside what the bars leave');
  assert.ok(/jevPanelEl\.style\.top = \(o\.top \+ 16\) \+ 'px'/.test(jev) && /jevPanelEl\.style\.bottom = \(o\.bottom \+ 16\) \+ 'px'/.test(jev));
});

check('the fade: opacity and pointer-events on the two bars (and the name band of the right page), nothing else, and never on the text', () => {
  const rules = [...chrome.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)].filter((m) => /chrome-faded|zen-mode #(header|status-bar|secondary-pane-header)/.test(m[1]));
  assert.ok(rules.length >= 1, 'there is a rule');
  for (const m of rules) {
    for (const sel of m[1].split(',').map((x) => x.trim())) {
      assert.ok(/^body\.(chrome-faded|zen-mode) #(header|status-bar|secondary-pane-header)(:not\([^)]*\))*$/.test(sel), 'only the bars and the band are named: ' + sel);
      assert.ok(/:not\(:focus-within\)/.test(sel) && /:not\(\[data-pin\]\)/.test(sel), 'a bar with the keyboard in it, or pinned, is not faded: ' + sel);
    }
    const props = m[2].split(';').map((d) => d.split(':')[0].trim()).filter(Boolean).sort();
    assert.deepEqual(props, ['opacity', 'pointer-events'], 'the fade changes nothing but opacity and pointer-events (no layout, the bars stay in the reading order)');
  }
  const t = declarations(chrome, '#header, #status-bar, #secondary-pane-header');
  assert.ok(/opacity 0\.2s/.test(prop(t, 'transition')), 'a short fade');
  assert.ok(/body\.chrome-faded #secondary-pane-header:not\(:focus-within\):not\(\[data-pin\]\)/.test(chrome) && /body\.zen-mode #secondary-pane-header:not\(:focus-within\):not\(\[data-pin\]\)/.test(chrome), 'the band of the right page fades with the bars, and in Zen mode, and comes back with the keyboard in it');
  assert.ok(!/visibility|will-change/.test(chrome), 'no visibility change and no layer promotion anywhere in the sheet');
  assert.deepEqual([...chrome.matchAll(/([^{}@][^{}]*)\{([^{}]*\bdisplay\s*:[^{}]*)\}/g)].map((m) => m[1].trim()), [], 'the sheet hides nothing with display (the header title is shown; the index tabs are away in Zen mode by opacity)');
  assert.equal(CO.AWAY_CLASS, 'chrome-faded');
});

check('Zen mode sets the numbers, not the boxes: the three stay on one padding', () => {
  const zen = declarations(chrome, 'body.zen-mode');
  assert.equal(prop(zen, '--pad-x'), '32px', 'the text is wider apart on the sides (as it was: 24px 32px)');
  assert.equal(prop(zen, '--pad-y'), '24px');
  assert.equal(prop(zen, '--ov-inset-top'), '0px', 'the bars are away in Zen mode: no room kept for them');
  assert.equal(prop(zen, '--ov-inset-bottom'), '0px');
  assert.ok(!/body\.zen-mode #editor\s*\{/.test(style), 'no padding of its own on the textarea: the ghost text and the line numbers would not follow it');
  assert.ok(/function toggleZenMode\(\) \{\s*const isZen = document\.body\.classList\.toggle\('zen-mode'\);[\s\S]{0,300}?invalidateCharPixelMirrors\(\);/.test(app), 'and the measuring copies are told that the margin changed');
});

check('the old typing dimmer is gone, the quiet-message rule stays', () => {
  assert.ok(!/zen-active/.test(style + chrome), 'no body.zen-active in the CSS');
  assert.ok(!/zen-active|triggerZenModeActive|endZenModeActiveIfEditorLost|isNoteEditorFocused/.test(app), 'and none of its script');
  assert.ok(/function showMessage\(msg, duration, opts\)/.test(app) && /setAttribute\('data-quiet', ''\)/.test(app) && /removeAttribute\('data-quiet'\)/.test(app), 'showMessage marks a quiet message and clears the mark');
  assert.ok(/showMessage\(`\$\{t\('saveSuccess'\)\}\$\{tab\.title\}`, 2000, \{ quiet: !!\(opts && opts\.auto\) \}\)/.test(app), 'only an automatic save is quiet');
  assert.ok(CO.FOOTER_PINS[0].includes(':not([data-quiet])'), 'and a quiet message does not pin the status bar');
  assert.ok(!/zen-mode/.test(style.replace(/\/\*[\s\S]*?\*\//g, '')), 'the old rules of the permanent Zen mode (bars of no height, hidden) are gone from style.css: it is chrome.css and chrome_overlay.js now');
});

check('app.js: one controller, switched on once, F6 and Esc wired; the iframe page tells it about its scrolling', () => {
  assert.ok(/window\.ChromeOverlay && window\.ChromeOverlay\.create \? window\.ChromeOverlay\.create\(\{/.test(app), 'created only when the module is there (a test page without it works)');
  assert.ok(/isEditor: \(node\) => node === editorEl \|\| \(!!editorSecondary && node === editorSecondary\)/.test(app));
  assert.ok(/scrollers: \(\) => \[editorEl, editorSecondary, previewPane, secondaryPreviewPane\]/.test(app), 'the editors and the two previews');
  assert.ok(!/chromeOverlay\.configure\(/.test(app), 'the switch is Settings > Appearance\'s: applyAppearance configures it, nothing else does');
  assert.ok(/const overlay = window\.ChromeOverlay && window\.ChromeOverlay\.current;\s*if \(overlay\) overlay\.configure\(\{ autoHide: !appearance \|\| appearance\.autoHide !== false \}\);/.test(app), 'applyAppearance hands the setting to the overlay (on unless the setting is false)');
  assert.equal((app.match(/ChromeOverlay\.create\(/g) || []).length, 1, 'one controller');
  assert.ok(/if \(!isSyncingPreviewScroll && chromeOverlay\) chromeOverlay\.scrolled\(\);/.test(app), 'an HTML page scrolling inside its iframe');
  const esc = app.slice(app.indexOf("if (e.key === 'Escape') {\n      if (contextMenu"), app.indexOf('// Toggle Zen Mode: only the configured shortcut'));
  assert.ok(esc.indexOf('chromeOverlay.leaveBar()') > esc.indexOf('cancelMobileDrop()') && esc.indexOf('chromeOverlay.leaveBar()') < esc.indexOf("classList.contains('zen-mode')"), 'Esc in a bar goes back to the note before it can leave Zen mode');
  assert.ok(/chromeOverlay\.focusBar\(backwards \? -1 : 1\)/.test(app) && /config\.shortcuts\.focusChrome && !isDialogOpen\(\)/.test(app), 'F6 / Shift+F6, not while a dialog is open');
});

check('the shortcut: F6 on both platforms, listed in Settings > Shortcuts, named in both languages', () => {
  assert.ok(/const DEFAULT_SHORTCUTS_WIN = \{[\s\S]*?focusChrome: 'F6',[\s\S]*?\};/.test(app));
  assert.ok(/const DEFAULT_SHORTCUTS_MAC = \{[\s\S]*?focusChrome: 'F6',[\s\S]*?\};/.test(app));
  assert.ok(/\{ key: 'focusChrome', labelKey: 'shortcutActionFocusChrome' \}/.test(app));
  for (const lang of ['en', 'ja']) assert.ok(typeof I18N[lang].shortcutActionFocusChrome === 'string' && I18N[lang].shortcutActionFocusChrome.length > 3, 'the name in ' + lang);
  assert.ok(!/[぀-ヿ㐀-鿿]/.test(I18N.en.shortcutActionFocusChrome), 'English has no Japanese');
  for (const lang of ['en', 'ja']) assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(I18N[lang].shortcutActionFocusChrome), 'no emoji');
});

check('compatibility: nothing in chrome.css that macOS 10.15 (Safari 15.6) cannot read', () => {
  assert.ok(!/color-mix\s*\(|@container|container-type|\bcq[a-z]+\b/.test(chrome), 'no color-mix / container queries');
  assert.ok(!/:has\(/.test(chrome), 'no :has()');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|hsla?\(/.test(chrome), 'no colour of its own: every colour is a token');
  assert.ok(![...chrome.matchAll(/\brgba?\(/g)].some((m) => !/^rgba?\(var\(--[\w-]+-rgb\) \/ /.test(chrome.slice(m.index, m.index + 60))), 'the only colour function is rgb(var(--x-rgb) / alpha), a channel token with an alpha');
  // nesting: a rule inside a rule
  let depth = 0;
  for (const ch of chrome.replace(/@media[^{]*\{|@supports[^{]*\{/g, '')) { if (ch === '{') { depth++; assert.ok(depth <= 1, 'no nested rule'); } else if (ch === '}') depth--; }
});

if (failed) {
  console.log('\n' + failed + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nAll chrome overlay wiring tests PASSED!');
