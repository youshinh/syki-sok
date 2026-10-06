// The floating panels and the dialogs follow docs/design/panel-template.md and docs/design/settings-dialog.md.
//   Place and size (v1.10.5, kept): one width, one place, one field rule, labels that are not buttons, switches, three levels of button.
//   The face (v2 P5): a floating panel is a STICKY NOTE (a paper layer under an adhesive strip, a folded corner, a lifted shadow), a dialog is
//   a plain SHEET. The rules this test keeps from being undone are in sections 5 to 8; they are written as functions of the style sheets so that
//   section 9 can break a copy of them the way a careless edit would and see that each rule notices.
// The pixel checks were made in a real browser (tests/smoke/118 and 119, docshots); this test is about the rules.
import fs from 'fs';
import assert from 'assert';
import { withTokens } from './lib/css_tokens_lib.mjs';

console.log('=== Panel template tests ===');

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const rawStyle = read('frontend/css/style.css'); // names kept as var(--name): sections 5 to 8 assert on the use of the tokens
const rawChrome = read('frontend/css/chrome.css');
const rawTokens = read('frontend/css/tokens.css');
const css = withTokens(rawStyle).replace(/\/\*[\s\S]*?\*\//g, '');
const chromeCss = stripComments(rawChrome); // the header and the status bar are overlays (v2): the bars' places are computed from their heights there
const html = read('frontend/index.html');
const app = read('frontend/js/app.js');
const jevJs = read('frontend/js/jev_action.js');
const I18N = new Function(read('frontend/js/i18n.js') + '\nreturn I18N;')();

const rule = (selector) => {
  const at = css.indexOf(selector + ' {');
  assert.notStrictEqual(at, -1, selector + ' must exist');
  return css.slice(at, css.indexOf('}', at));
};

// The floating panels: the six roots of the sticky note (the ask / rewrite bar and the command bar are both .inline-prompt-bar; the palette, the search,
// the tag picker and the lessons card are all .quick-pick-modal)
const ROOTS = ['.inline-prompt-bar', '.quick-pick-modal', '.jev-action-panel', '.tab-list-panel', '.status-ai-pop', '#slot-quick-selector'];

// ---- a small CSS reader: rules as { selectors, body } (nested at-rules are flattened; the at-rule prefix is not part of the selector) ----------------
function readRules(text) {
  const out = [];
  for (const m of stripComments(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue; // an at-rule whose body is declarations (@keyframes steps are not matched here: they have a name)
    out.push({ selectors: prelude.split(',').map((s) => s.trim()), body: m[2] });
  }
  return out;
}
// the text of every block that starts at `header` (e.g. '@media (forced-colors: active)'), by counting braces (the sheet has several: one per part)
function blocksOf(text, header) {
  const t = stripComments(text);
  const out = [];
  for (let at = t.indexOf(header); at !== -1; at = t.indexOf(header, at + header.length)) {
    const open = t.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < t.length; i++) {
      if (t[i] === '{') depth++;
      else if (t[i] === '}' && --depth === 0) { out.push(t.slice(open + 1, i)); break; }
    }
  }
  return out;
}
// the sheet without its forced-colours blocks (what applies to everybody else)
function withoutForced(text) {
  let t = stripComments(text);
  for (const block of blocksOf(text, '@media (forced-colors: active)')) t = t.replace('@media (forced-colors: active) {' + block + '}', '');
  return t;
}
// the rule with exactly these selectors inside one of the forced-colours blocks (or null)
function forcedRule(text, test) {
  for (const block of blocksOf(text, '@media (forced-colors: active)')) {
    const hit = readRules(block).find(test);
    if (hit) return hit;
  }
  return null;
}
const sameList = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const none = (list, what) => assert.deepStrictEqual(list, [], what + ':\n  ' + list.join('\n  '));

// Where a panel stands. The bar's top edge in the "does it cover the text" test is the bar's own computed `top` (so the style sheet and the script cannot
// disagree: the header's height plus 16 is only what stands in when the page has no styles to ask); the Quick Actions panel is a child of the workspace
// like the other bars, put there once and not moved into an editor's box when it opens (an editor's box clips the shadow, and the panel must be
// centred on the window whichever page has the keyboard).
function placeProblems({ app, jev }) {
  const problems = [];
  const dock = app.slice(app.indexOf('function panelTopEdge('), app.indexOf('const askBarFade'));
  if (!/getComputedStyle\(bar\)\.top/.test(dock) || !/classList\.remove\('panel-dock-bottom'\)/.test(dock)) problems.push('the bar\'s top edge is not its computed top, read with the bottom-edge class off');
  if (!/const topEdge = panelTopEdge\(bar\);/.test(dock)) problems.push('dockPanelBar does not ask the bar for its own top');
  if (!/Number\.isFinite\(topEdge\) \? topEdge : overlayInsets\(workspaceEl\)\.top \+ 16/.test(dock)) problems.push('dockPanelBar has no fallback (the header\'s height and the 16px gap) for a page without styles');
  if (!/document\.getElementById\('workspace'\) \|\| document\.getElementById\('editor-wrapper'\) \|\| document\.body/.test(jev)) problems.push('the Quick Actions panel is not created in the workspace');
  if (/jevPanelEl\.parentElement !== wrapper/.test(jev) || /wrapper\.appendChild\(jevPanelEl\)/.test(jev)) problems.push('the Quick Actions panel is moved into an editor box when it opens');
  return problems;
}

// ---- 1. One width for every panel, one gap under the header (v1.10.5; the face is NOT here any more: section 5) -------------------------------------------
{
  assert.ok(/--panel-width:\s*560px/.test(css), 'the panel width is 560px');
  assert.ok(/--panel-top:\s*16px/.test(css), 'the gap under the header is 16px');
  for (const sel of ['.inline-prompt-bar', '.quick-pick-modal', '.jev-action-panel']) {
    const r = rule(sel);
    assert.ok(/width:\s*min\(var\(--panel-width, 560px\), calc\(100% - 32px\)\)/.test(r), sel + ' uses the shared width');
    assert.ok(!/\b(background|border|border-radius|box-shadow)\s*:/.test(r), sel + ' says nothing of its own face: the one face of the sticky notes is in one block (section 5)');
  }
  assert.ok(!/#cli-filter-bar\s*\{/.test(css), 'the command bar has no width of its own');
  assert.ok(/scraps-search-dialog\s*\{\s*max-width:\s*none/.test(css), 'the search is not wider than the others');
  assert.ok(/left:\s*0;\s*right:\s*0;\s*margin:\s*0 auto;/.test(rule('.inline-prompt-bar')), 'the bars are centred');
  assert.ok(/\.inline-prompt-bar\.panel-dock-bottom\s*\{[^}]*top:\s*auto/.test(chromeCss), 'the bottom-edge exception exists');
  assert.ok(!/\.inline-prompt-bar(\.panel-dock-bottom)?\s*\{[^}]*(?:top|bottom):/.test(css), 'and style.css leaves where the bars sit to chrome.css (the header and the status bar float over the text)');
  // v2: "16px under the header" is 16px under the header bar, which floats over the top of the workspace (and 16px above the status bar for the exception)
  assert.ok(/\.inline-prompt-bar\s*\{[^}]*top:\s*calc\(var\(--ov-top\) \+ var\(--panel-top, 16px\)\)/.test(chromeCss), 'the bars sit 16px under the header bar');
  assert.ok(/\.inline-prompt-bar\.panel-dock-bottom\s*\{[^}]*bottom:\s*calc\(var\(--ov-bottom\) \+ var\(--panel-top, 16px\)\)/.test(chromeCss), 'and the exception 16px above the status bar');
  assert.ok(/\.jev-action-panel\s*\{[^}]*bottom:\s*calc\(var\(--ov-bottom\) \+ var\(--panel-top, 16px\)\)/.test(chromeCss), 'the Quick Actions panel too');
  assert.ok(/--panel-modal-top:\s*calc\(var\(--ov-top\) \+ 15px\)/.test(chromeCss), 'the palette and the search: 53px, from the header bar');
  assert.ok(/\.status-ai-pop,\s*\.running-tasks-panel\s*\{[^}]*bottom:\s*calc\(var\(--ov-bottom\) \+ 6px\)/.test(chromeCss), 'the AI popover 6px above the status bar');
  console.log('PASS: every floating panel is 560px wide and centred, placed from the bars, and none says anything of its own face.');
}

// ---- 2. Rewrite looks like the others; the field has no box of its own -----------------------------------------------------------------------------------------
{
  assert.ok(!/\.inline-prompt-rewrite/.test(css), 'no amber Rewrite variant');
  for (const sel of ['#inline-prompt-input,\n#cli-filter-input']) {
    const at = css.indexOf(sel + ' {');
    assert.notStrictEqual(at, -1, 'the field rule exists');
    const r = css.slice(at, css.indexOf('}', at));
    assert.ok(/background:\s*transparent/.test(r) && /border:\s*0/.test(r), 'the field has neither a background nor a border');
  }
  assert.ok(/\.quick-pick-input\s*\{[^}]*background:\s*transparent/.test(css), 'the palette field is bare too');
  assert.ok(/\.inline-prompt-row\s*\{[^}]*height:\s*44px/.test(css), 'the header row is 44px');
  assert.ok(/\.quick-pick-input-wrap\s*\{[^}]*height:\s*44px/.test(css), 'and so is the palette\'s');
  console.log('PASS: Rewrite is the same panel as Ask; the field is bare inside a 44px header.');
}

// ---- 3. The palette and the search carry a kind label like the others; the suggest panel's is localized; the bars are placed by one function ------------
{
  assert.ok(/data-i18n="badgeCommands">Commands</.test(html) && /data-i18n="badgeSearch">Search</.test(html), 'labels in the palette and the search');
  for (const k of ['badgeCommands', 'badgeSearch', 'badgeSuggest']) assert.ok(I18N.en[k] && I18N.ja[k], k + ' in both languages');
  assert.ok(/dockPanelBar\(inlinePromptBar,/.test(app) && /dockPanelBar\(cliFilterBar,/.test(app), 'both bars are placed by dockPanelBar');
  assert.ok(!/inlinePromptBar\.style\.(left|top|width)\s*=\s*[`'"]/.test(app), 'the ask bar no longer follows the caret with inline coordinates');
  none(placeProblems({ app, jev: jevJs }), 'where a panel stands');
  console.log('PASS: the palette and search have labels; the bars are placed by one function from their own top; the suggest panel stands in the workspace.');
}

// ---- 4. The Settings dialog: its measures (v1.10.5, kept) ---------------------------------------------------------------------------------------------------
{
  const card = rule('#settings-modal .modal-card');
  assert.ok(/width:\s*min\(var\(--panel-width, 560px\), calc\(100vw - 32px\)\)/.test(card), 'Settings is as wide as the panels');
  assert.ok(/height:\s*min\(620px, 88vh\)/.test(card), 'its size does not change with the tab');
  assert.ok(/\.modal-header\s*\{[^}]*height:\s*48px/.test(css.slice(css.indexOf('#settings-modal .modal-header'))), 'header 48px');
  assert.ok(/\.settings-tabs\s*\{[^}]*height:\s*40px/.test(css), 'tabs 40px');
  const tab = css.slice(css.indexOf('.settings-tab-btn.active {'), css.indexOf('.settings-tab-btn.active {') + 200);
  assert.ok(!/background/.test(tab), 'the selected tab is not filled');
  assert.ok(/#settings-modal \.settings-section-header h4\s*\{[^}]*color:\s*var\(--accent-label/.test(css), 'category names use the bright accent');
  assert.ok(/#settings-modal \.settings-pane\s*\{[^}]*gap:\s*12px/.test(css), 'fields are 12px apart');
  assert.ok(/#settings-modal input\[type="checkbox"\]\s*\{[^}]*appearance:\s*none[^}]*width:\s*32px;[^}]*height:\s*18px/.test(css), 'on/off options are 32 x 18 switches');
  assert.ok(/#settings-modal input\[type="checkbox"\]:checked::after\s*\{[^}]*left:\s*16px/.test(css), 'the switch knob moves');
  // three levels of button; the quiet one still has a fill
  const footerBtn = rule('#settings-modal .modal-footer .btn-primary,\n#settings-modal .modal-footer .btn-secondary,\n#settings-modal #btn-reset-shortcuts');
  assert.ok(/height:\s*28px/.test(footerBtn), 'buttons are 28px');
  const tertiary = css.slice(css.indexOf('#settings-modal #btn-export-settings,'), css.indexOf('#settings-modal #btn-export-settings,') + 260);
  assert.ok(/background:\s*rgba\(255, 255, 255, 0\.07\)/.test(tertiary), 'Export / Import have a pale fill so they read as buttons');
  // shortcuts: keys are chips, recording is green rather than red
  const rec = rule('#settings-modal .shortcut-key-btn.recording');
  assert.ok(!/#e51400|red|255, ?136, ?136/i.test(rec), 'recording is not red');
  assert.ok(/:has\(#pane-shortcuts:not\(\.hidden\)\)/.test(css), 'the shortcut list scrolls under a fixed hint line');
  console.log('PASS: Settings shares the panels\' width, rows, labels, buttons and keys.');
}

// ===== The face (v2 P5). The checks are functions of the three style sheets, so section 9 can run them on broken copies. ===================================
const FACE = { style: rawStyle, tokens: rawTokens };

// 5. The sticky note: one block for the six roots, the paper and the fold on the pseudo-elements, nothing on the root that would clip or blur it
function stickyProblems({ style, tokens }) {
  const problems = [];
  const rules = readRules(withoutForced(style)); // forced colours are section (f)
  const fail = (m) => problems.push(m);
  const exact = (r, sels) => sameList(r.selectors, sels);
  const pseudo = (p) => ROOTS.map((r) => r + p);

  // (a) the face of the six roots is ONE rule, with the face and nothing else that costs
  const root = rules.find((r) => exact(r, ROOTS));
  if (!root) fail('the six panel roots (' + ROOTS.join(', ') + ') are not one rule: the face must be written once');
  else {
    const b = root.body;
    if (!/background:\s*transparent;/.test(b)) fail('the root is not transparent (the paper is its ::before layer)');
    if (!/border:\s*0;/.test(b)) fail('the root has a border (the strip of the paper, not a border, shows focus)');
    if (!/border-radius:\s*0;/.test(b)) fail('the root has a radius (a sticky note is square)');
    if (!/box-shadow:\s*var\(--note-shadow\);/.test(b)) fail('the root does not carry the note shadow (--note-shadow)');
    if (!/padding-bottom:\s*var\(--note-fold\);/.test(b)) fail('the root keeps no band for the fold (padding-bottom: var(--note-fold)): a child could be drawn into the notch');
  }
  // (b) nothing on a root (anywhere in the sheets) clips, blurs, filters or fades it: a clip-path would clip the shadow, a filter would grey the text
  // and cost a repaint, and the opacity belongs to the fade (.panel-fading)
  for (const r of rules) {
    if (!r.selectors.some((s) => ROOTS.includes(s))) continue;
    const bad = /\b(clip-path|filter|backdrop-filter|-webkit-backdrop-filter|will-change|mix-blend-mode|opacity)\s*:/.exec(r.body);
    if (bad) fail('a rule for ' + r.selectors.filter((s) => ROOTS.includes(s)).join(', ') + ' sets ' + bad[1] + ': the root of a sticky note is left alone (clip-path clips its shadow, a filter greys its text)');
  }
  // (c) the paper: ::before, three stacked backgrounds (strip, tint, sheet), the corner cut from that layer only
  const before = rules.find((r) => exact(r, pseudo('::before')));
  if (!before) fail('the paper layer (::before of the six roots) is missing');
  else {
    const b = before.body;
    if (!/content:\s*"";/.test(b) || !/position:\s*absolute;/.test(b) || !/inset:\s*0;/.test(b)) fail('the paper layer is not an absolutely placed box over the whole note (inset: 0)');
    if (!/z-index:\s*-1;/.test(b) || !/pointer-events:\s*none;/.test(b)) fail('the paper layer is not behind the content and out of the way of the pointer');
    const bg = /background:\s*([\s\S]*?);\s*(?:clip-path|$)/.exec(b);
    const layers = bg ? bg[1].split(/\n/).map((x) => x.trim()).filter(Boolean) : [];
    if (layers.length !== 3) fail('the paper layer is not three stacked backgrounds (the strip, the tint, var(--sheet)): ' + layers.length);
    else {
      if (!/^linear-gradient\(var\(--note-strip\), var\(--note-strip\)\) top \/ 100% 6px no-repeat,$/.test(layers[0])) fail('the paper layer does not start with the adhesive strip (a 6px band at the top in var(--note-strip))');
      if (!/^linear-gradient\(var\(--note-tint\), var\(--note-tint\)\),$/.test(layers[1]) || layers[2] !== 'var(--sheet)') fail('the paper layer is not the tint over var(--sheet)');
    }
    if (!/--note-strip:\s*var\(--note-tape\);/.test(b)) fail('the strip at rest is not var(--note-tape)');
    if (!/clip-path:\s*polygon\(0 0, 100% 0, 100% calc\(100% - var\(--note-fold\)\), calc\(100% - var\(--note-fold\)\) 100%, 0 100%\);/.test(b)) fail('the folded corner is not cut from the paper layer with clip-path: polygon(...) of var(--note-fold)');
  }
  // (d) focus is shown by the strip: solid accent while focus is inside the note (this replaces the accent border of v1.10.5)
  const focus = rules.find((r) => exact(r, ROOTS.map((x) => x + ':focus-within::before')));
  if (!focus || !/--note-strip:\s*var\(--note-tape-focus\);/.test(focus.body)) fail('focus inside a note does not turn its strip solid (--note-strip: var(--note-tape-focus) on :focus-within::before)');
  for (const r of rules) {
    if (r.selectors.some((s) => ROOTS.some((x) => s === x + ':focus-within')) && /border-color\s*:/.test(r.body)) fail('a note\'s border turns accent on focus again (v1.10.5): the strip does that now');
  }
  // (e) the flap: the same square as the notch, a triangle of the shade colour
  const after = rules.find((r) => exact(r, pseudo('::after')));
  if (!after) fail('the flap (::after of the six roots) is missing');
  else {
    const b = after.body;
    if (!/right:\s*0;/.test(b) || !/bottom:\s*0;/.test(b) || !/width:\s*var\(--note-fold\);/.test(b) || !/height:\s*var\(--note-fold\);/.test(b)) fail('the flap is not the --note-fold square in the bottom right corner');
    if (!/background:\s*linear-gradient\(to bottom right, var\(--note-flap\) 50%, transparent 50%\);/.test(b)) fail('the flap is not a triangle of var(--note-flap)');
    if (!/pointer-events:\s*none;/.test(b)) fail('the flap takes the pointer');
  }
  // (f) forced colours: a line instead of tints and shadows, an outline for focus, no pseudo-elements
  if (!blocksOf(style, '@media (forced-colors: active)').length) fail('there is no @media (forced-colors: active) block');
  else {
    const froot = forcedRule(style, (r) => exact(r, ROOTS));
    if (!froot || !/background:\s*Canvas;/.test(froot.body) || !/border:\s*1px solid CanvasText;/.test(froot.body) || !/box-shadow:\s*none;/.test(froot.body) || !/padding-bottom:\s*0;/.test(froot.body)) fail('forced colours: a note is not Canvas with a 1px CanvasText border, no shadow and no fold band');
    const fgone = forcedRule(style, (r) => ROOTS.every((x) => r.selectors.includes(x + '::before') && r.selectors.includes(x + '::after')));
    if (!fgone || !/display:\s*none;/.test(fgone.body)) fail('forced colours: the paper layer and the flap are not hidden');
    const ffocus = forcedRule(style, (r) => exact(r, ROOTS.map((x) => x + ':focus-within')));
    if (!ffocus || !/outline:\s*2px solid Highlight;/.test(ffocus.body)) fail('forced colours: focus inside a note is not a 2px Highlight outline');
  }
  // (g) the tokens: the paper is the accent channel laid over the sheet, no color-mix(), no container queries (macOS 10.15 = Safari 15.6 has neither)
  const t = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!/--note-tint:\s*rgb\(var\(--accent-rgb\) \/ var\(--note-tint-a\)\);/.test(t)) fail('--note-tint is not the accent channel at --note-tint-a');
  if (!/--note-tape:\s*rgb\(var\(--accent-rgb\) \/ 0\.\d+\);/.test(t)) fail('--note-tape is not the accent channel at a fraction');
  if (!/--note-fold:\s*14px;/.test(t)) fail('--note-fold is not 14px');
  for (const name of ['note-tint-a', 'note-tape-focus', 'note-flap', 'note-shadow', 'bg-scrim-note']) {
    const defs = t.split('--' + name + ':').length - 1;
    if (defs < 2) fail('--' + name + ' is not defined for both looks (ink and paper): ' + defs);
  }
  if (/color-mix\(|@container/.test(style.replace(/\/\*[\s\S]*?\*\//g, '') + t)) fail('color-mix() or @container in the sheets: macOS 10.15 (Safari 15.6) has neither');
  return problems;
}

// 6. The fade is the fade of v1.10.5: the class, the timings and the open animation are untouched; the face adds no motion of its own
function fadeProblems({ style }) {
  const problems = [];
  const rules = readRules(style);
  const fading = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === '.panel-fading');
  if (!fading || !/opacity:\s*0;/.test(fading.body) || !/transition:\s*opacity 0\.2s ease-out;/.test(fading.body)) problems.push('.panel-fading is no longer a 0.2 s fade of the opacity');
  if (!/@keyframes promptFadeIn\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(-4px\);\s*\}\s*to\s*\{\s*opacity:\s*1;\s*transform:\s*translateY\(0\);/.test(stripComments(style))) problems.push('the 120 ms fade-in (promptFadeIn: 4px from above) changed');
  const face = rules.filter((r) => r.selectors.some((s) => /::(before|after)$/.test(s) && ROOTS.some((x) => s.startsWith(x))));
  for (const r of face) if (/\b(animation|transition|opacity)\s*:/.test(r.body)) problems.push('the face of a note (' + r.selectors[0] + ') brings a motion of its own: the open and close are the fade of v1.10.5');
  return problems;
}

// 7. The dialogs: a plain sheet. The same colour as the sheet of a preview, no border, a lifted shadow; no strip and no fold (those are the notes')
function dialogProblems({ style }) {
  const problems = [];
  const rules = readRules(withoutForced(style));
  const card = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === '.modal-card');
  if (!card) return ['.modal-card is missing'];
  if (!/background:\s*var\(--sheet\);/.test(card.body)) problems.push('a dialog is not the sheet colour (background: var(--sheet))');
  if (!/border:\s*0;/.test(card.body)) problems.push('a dialog has a border: the sheet and its shadow are its edge');
  if (!/border-radius:\s*0;/.test(card.body)) problems.push('a dialog is not square like the sheet of a preview');
  if (!/box-shadow:\s*var\(--shadow-modal\);/.test(card.body)) problems.push('a dialog has no lifted shadow (--shadow-modal)');
  for (const r of rules) {
    if (r.selectors.some((s) => /\.modal-card(?!\w|-)[^,]*::(before|after)$/.test(s))) problems.push('a dialog has a pseudo-element (' + r.selectors[0] + '): the strip and the fold are the notes\' own');
    if (r.selectors.some((s) => /(#settings-modal|#about-modal|#pack-modal) \.modal-card$/.test(s)) && /\b(box-shadow|background|border)\s*:/.test(r.body)) problems.push(r.selectors[0] + ' sets its own face: every dialog is the one sheet of .modal-card');
  }
  const fcard = forcedRule(style, (r) => r.selectors.includes('.modal-card'));
  if (!fcard || !/border:\s*1px solid CanvasText;/.test(fcard.body) || !/box-shadow:\s*none;/.test(fcard.body)) problems.push('forced colours: a dialog is not drawn with a 1px CanvasText border and no shadow');
  return problems;
}

// 8. The scrim: the notes that are modal dim the page less than a dialog does, and nothing is blurred
function scrimProblems({ style, tokens }) {
  const problems = [];
  const rules = readRules(style);
  const dim = rules.find((r) => ['#quick-pick-modal', '#tag-pick-modal', '#scraps-search-modal', '#lesson-modal'].every((s) => r.selectors.includes(s)));
  if (!dim || !/background:\s*var\(--bg-scrim-note\);/.test(dim.body)) problems.push('the palette, the search, the tag picker and the lessons card do not dim the page with --bg-scrim-note');
  const back = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === '.modal-backdrop');
  if (!back || !/background:\s*var\(--bg-scrim\);/.test(back.body)) problems.push('a dialog no longer dims the page with --bg-scrim');
  if (back && /backdrop-filter/.test(back.body)) problems.push('the scrim blurs the whole window (backdrop-filter): a repaint of everything under it');
  const alpha = (text, look) => {
    const at = look === 'paper' ? text.indexOf('body.look-paper {') : 0;
    const m = /--bg-scrim-note:\s*rgba\([^)]*,\s*([\d.]+)\)/.exec(text.slice(at));
    const n = /--bg-scrim:\s*rgba\([^)]*,\s*([\d.]+)\)/.exec(text.slice(at));
    return m && n ? [parseFloat(m[1]), parseFloat(n[1])] : null;
  };
  for (const look of ['ink', 'paper']) {
    const a = alpha(tokens.replace(/\/\*[\s\S]*?\*\//g, ''), look);
    if (!a) problems.push(look + ': --bg-scrim-note or --bg-scrim is not a translucent colour');
    else if (!(a[0] < a[1])) problems.push(look + ': the scrim of a note (' + a[0] + ') is not lighter than the scrim of a dialog (' + a[1] + ')');
  }
  return problems;
}

{
  none(stickyProblems(FACE), 'the sticky note');
  console.log('PASS: the six panel roots are one sticky note: a transparent square root with the note shadow and a fold band, a paper layer (strip, tint, sheet) cut at the corner, a flap, a strip that turns solid on focus, a forced-colours line; nothing clips, filters or fades the root.');
}
{
  none(fadeProblems(FACE), 'the fade');
  console.log('PASS: the open and close of a panel are the 120 ms fade-in and the 0.2 s .panel-fading of v1.10.5; the face has no motion of its own.');
}
{
  none(dialogProblems(FACE), 'the dialogs');
  console.log('PASS: every dialog is a plain sheet (--sheet, no border, square, lifted by --shadow-modal), without the strip or the fold, and a line in forced colours.');
}
{
  none(scrimProblems(FACE), 'the scrim');
  console.log('PASS: the modal notes dim the page less than a dialog does, and nothing is blurred.');
}

// ---- 9. The mutation check: each rule above notices the edit that would undo it ------------------------------------------------------------------------
{
  const must = (list, re, what) => assert.ok(list.some((p) => re.test(p)), 'the mutation "' + what + '" is caught (got: ' + (list.join(' | ') || 'nothing') + ')');
  const style = rawStyle;
  const tokens = rawTokens;
  const swap = (text, find, replace, what) => {
    assert.ok(text.includes(find), 'the mutation target exists: ' + what);
    return text.replace(find, replace);
  };
  assert.deepStrictEqual(stickyProblems(FACE), [], 'the premise: the real sheets are clean');

  must(stickyProblems({ style: swap(style, '.inline-prompt-bar,\n.quick-pick-modal,\n.jev-action-panel,\n.tab-list-panel,\n.status-ai-pop,\n#slot-quick-selector {\n  background: transparent;', '.inline-prompt-bar,\n.quick-pick-modal,\n.jev-action-panel,\n.tab-list-panel,\n.status-ai-pop {\n  background: transparent;', 'a root left out of the block'), tokens }), /not one rule/, 'a seventh panel left out of the block');
  must(stickyProblems({ style: swap(style, '  background: transparent;\n  border: 0;\n  border-radius: 0;\n  box-shadow: var(--note-shadow);', '  background: var(--bg-modal);\n  border: 0;\n  border-radius: 0;\n  box-shadow: var(--note-shadow);', 'an opaque root'), tokens }), /not transparent/, 'a root with its own background');
  must(stickyProblems({ style: swap(style, '  border: 0;\n  border-radius: 0;\n  box-shadow: var(--note-shadow);', '  border: 1px solid var(--border-color);\n  border-radius: 0;\n  box-shadow: var(--note-shadow);', 'a border'), tokens }), /has a border/, 'a border on the root');
  must(stickyProblems({ style: swap(style, '  border: 0;\n  border-radius: 0;\n  box-shadow: var(--note-shadow);', '  border: 0;\n  border-radius: 8px;\n  box-shadow: var(--note-shadow);', 'a radius'), tokens }), /has a radius/, 'a rounded root');
  must(stickyProblems({ style: swap(style, 'box-shadow: var(--note-shadow);\n  padding-bottom: var(--note-fold);', 'box-shadow: var(--panel-shadow);\n  padding-bottom: var(--note-fold);', 'the old shadow'), tokens }), /note shadow/, 'the old panel shadow back');
  must(stickyProblems({ style: swap(style, '  padding-bottom: var(--note-fold);\n  isolation: isolate;', '  isolation: isolate;', 'no fold band'), tokens }), /band for the fold/, 'no band for the fold');
  must(stickyProblems({ style: swap(style, '  box-shadow: var(--note-shadow);\n  padding-bottom: var(--note-fold);', '  box-shadow: var(--note-shadow);\n  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);\n  padding-bottom: var(--note-fold);', 'a clip on the root'), tokens }), /sets clip-path/, 'a clip-path on the root (it would clip the shadow)');
  must(stickyProblems({ style: swap(style, '  box-shadow: var(--note-shadow);\n  padding-bottom: var(--note-fold);', '  box-shadow: none;\n  filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.4));\n  padding-bottom: var(--note-fold);', 'a drop shadow'), tokens }), /sets filter/, 'a drop-shadow filter on the root (it would grey the text)');
  must(stickyProblems({ style: style + '\n.status-ai-pop {\n  backdrop-filter: blur(8px);\n}\n', tokens }), /sets backdrop-filter/, 'a blur behind one panel');
  must(stickyProblems({ style: style + '\n.quick-pick-modal {\n  will-change: transform;\n}\n', tokens }), /sets will-change/, 'a will-change on one panel');
  must(stickyProblems({ style: swap(style, '  z-index: -1;\n  pointer-events: none;\n  background:', '  z-index: 1;\n  pointer-events: none;\n  background:', 'paper above the content'), tokens }), /not behind the content/, 'the paper layer in front of the text');
  must(stickyProblems({ style: swap(style, 'linear-gradient(var(--note-strip), var(--note-strip)) top / 100% 6px no-repeat,', 'linear-gradient(var(--note-strip), var(--note-strip)) top / 100% 2px no-repeat,', 'a thin strip'), tokens }), /adhesive strip/, 'a strip that is no longer 6px');
  must(stickyProblems({ style: swap(style, '    linear-gradient(var(--note-tint), var(--note-tint)),\n    var(--sheet);', '    var(--sheet);', 'no tint'), tokens }), /three stacked backgrounds/, 'a paper without the tint');
  must(stickyProblems({ style: swap(style, 'clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--note-fold)), calc(100% - var(--note-fold)) 100%, 0 100%);', 'clip-path: none;', 'no notch'), tokens }), /folded corner/, 'a paper without the notch');
  must(stickyProblems({ style: swap(style, '#slot-quick-selector:focus-within::before {\n  --note-strip: var(--note-tape-focus);', '#slot-quick-selector:focus-within::before {\n  --note-strip: var(--note-tape);', 'focus does nothing'), tokens }), /turn its strip solid/, 'focus that does not show');
  must(stickyProblems({ style: style + '\n.quick-pick-modal:focus-within {\n  border-color: var(--accent-hover);\n}\n', tokens }), /border turns accent/, 'the accent border of v1.10.5 back');
  must(stickyProblems({ style: swap(style, '  background: linear-gradient(to bottom right, var(--note-flap) 50%, transparent 50%);', '  background: var(--note-flap);', 'a square flap'), tokens }), /triangle/, 'a flap that is a square');
  must(stickyProblems({ style: swap(style, '    border: 1px solid CanvasText;\n    box-shadow: none;\n    padding-bottom: 0;', '    box-shadow: none;\n    padding-bottom: 0;', 'no forced border'), tokens }), /forced colours: a note/, 'forced colours without a line');
  must(stickyProblems({ style: swap(style, '  #slot-quick-selector:focus-within {\n    outline: 2px solid Highlight;\n    outline-offset: -2px;', '  #slot-quick-selector:focus-within {\n    outline-offset: -2px;', 'no forced outline'), tokens }), /Highlight outline/, 'forced colours without a focus outline');
  must(stickyProblems({ style: swap(style, '@media (forced-colors: active) {\n  .inline-prompt-bar,', '@media (forced-colors: none) {\n  .inline-prompt-bar,', 'no forced block'), tokens }), /forced colours: a note is not Canvas/, 'a forced-colours block that no longer covers the panels');
  must(stickyProblems({ style, tokens: swap(tokens, '--note-tint: rgb(var(--accent-rgb) / var(--note-tint-a));', '--note-tint: color-mix(in srgb, var(--accent-color) 12%, transparent);', 'color-mix') }), /--note-tint is not the accent channel|color-mix/, 'a paper made with color-mix()');
  must(stickyProblems({ style, tokens: swap(tokens, '--note-fold: 14px;', '--note-fold: 20px;', 'another fold') }), /--note-fold is not 14px/, 'a fold of another size');
  must(stickyProblems({ style, tokens: swap(tokens, '--note-shadow: 0 1px 3px rgb(var(--shade-rgb) / 0.2), 0 12px 28px rgb(var(--shade-rgb) / 0.18);', '', 'no paper shadow') }), /--note-shadow is not defined for both looks/, 'a look without the note shadow');

  must(fadeProblems({ style: swap(style, 'transition: opacity 0.2s ease-out;', 'transition: opacity 0.6s ease-out;', 'a slow fade') }), /0\.2 s fade/, 'a changed close fade');
  must(fadeProblems({ style: swap(style, '.panel-fading {\n  opacity: 0;', '.panel-fading {\n  opacity: 0.5;', 'a half fade') }), /0\.2 s fade/, 'a close that does not finish');
  must(fadeProblems({ style: swap(style, '    transform: translateY(-4px);\n  }\n  to {\n    opacity: 1;', '    transform: translateY(-40px);\n  }\n  to {\n    opacity: 1;', 'a long fall') }), /120 ms fade-in/, 'a changed open');
  must(fadeProblems({ style: swap(style, '  pointer-events: none;\n  background: linear-gradient(to bottom right,', '  pointer-events: none;\n  animation: promptFadeIn 1s;\n  background: linear-gradient(to bottom right,', 'a moving flap') }), /motion of its own/, 'a flap that moves');

  must(dialogProblems({ style: swap(style, '  background: var(--sheet);\n  border: 0;\n  border-radius: 0;\n  width: 480px;', '  background: var(--bg-modal);\n  border: 0;\n  border-radius: 0;\n  width: 480px;', 'a dialog colour') }), /not the sheet colour/, 'a dialog that is not the sheet colour');
  must(dialogProblems({ style: swap(style, '  border: 0;\n  border-radius: 0;\n  width: 480px;', '  border: 1px solid var(--border-color);\n  border-radius: 0;\n  width: 480px;', 'a dialog border') }), /has a border/, 'a dialog with a border');
  must(dialogProblems({ style: swap(style, '  border-radius: 0;\n  width: 480px;', '  border-radius: 8px;\n  width: 480px;', 'a dialog radius') }), /not square/, 'a rounded dialog');
  must(dialogProblems({ style: swap(style, 'width: 480px;\n  max-width: 90vw;\n  box-shadow: var(--shadow-modal);', 'width: 480px;\n  max-width: 90vw;\n  box-shadow: none;', 'a flat dialog') }), /no lifted shadow/, 'a dialog without its shadow');
  must(dialogProblems({ style: style + '\n.modal-card::before {\n  content: "";\n}\n' }), /pseudo-element/, 'a tape on a dialog');
  must(dialogProblems({ style: style + '\n#settings-modal .modal-card {\n  box-shadow: var(--panel-shadow);\n}\n' }), /sets its own face/, 'Settings with a face of its own');
  must(dialogProblems({ style: swap(style, '  .modal-card {\n    border: 1px solid CanvasText;\n    box-shadow: none;\n  }', '  .modal-card {\n    box-shadow: none;\n  }', 'no forced dialog border') }), /forced colours: a dialog/, 'a dialog without a line in forced colours');

  must(scrimProblems({ style: swap(style, '  background: var(--bg-scrim-note);', '  background: var(--bg-scrim);', 'one scrim') , tokens }), /do not dim the page with --bg-scrim-note/, 'the same scrim for a note and a dialog');
  must(scrimProblems({ style: swap(style, '#lesson-modal {\n  background: var(--bg-scrim-note);', '#lesson-card-backdrop {\n  background: var(--bg-scrim-note);', 'a backdrop left out'), tokens }), /do not dim the page/, 'a modal note that is left out');
  must(scrimProblems({ style: swap(style, 'background: var(--bg-scrim);', 'background: var(--bg-scrim);\n  backdrop-filter: blur(6px);', 'a blur'), tokens }), /blurs the whole window/, 'a blurred scrim');
  must(scrimProblems({ style, tokens: swap(tokens, '--bg-scrim-note: rgba(0, 0, 0, 0.32);', '--bg-scrim-note: rgba(0, 0, 0, 0.7);', 'a heavier scrim') }), /ink: the scrim of a note/, 'a note that dims more than a dialog');

  // where a panel stands (section 3)
  assert.deepStrictEqual(placeProblems({ app, jev: jevJs }), [], 'the premise: the real scripts are clean');
  must(placeProblems({ app: swap(app, 'const topEdge = panelTopEdge(bar);', 'const topEdge = NaN;', 'a bar that does not ask its own top'), jev: jevJs }), /does not ask the bar for its own top/, 'a bar placed from a literal 16 again');
  must(placeProblems({ app: swap(app, 'Number.isFinite(topEdge) ? topEdge : overlayInsets(workspaceEl).top + 16', 'topEdge', 'no fallback'), jev: jevJs }), /no fallback/, 'no fallback for a page without styles');
  must(placeProblems({ app: swap(app, "classList.remove('panel-dock-bottom');\n      if (typeof getComputedStyle", "classList.add('x');\n      if (typeof getComputedStyle", 'the class is left on'), jev: jevJs }), /computed top, read with the bottom-edge class off/, 'a top read while the bottom-edge class is on');
  must(placeProblems({ app, jev: swap(jevJs, "document.getElementById('workspace') || document.getElementById('editor-wrapper') || document.body", "document.getElementById('editor-wrapper') || document.body", 'the old parent') }), /not created in the workspace/, 'the Quick Actions panel back in the editor\'s box');
  must(placeProblems({ app, jev: swap(jevJs, "    // The panel stays where it was put (the workspace): it does not follow the pane that has the keyboard, so it is always centred on the window.\n", "    const wrapper = (panelEditor || getActiveEditor()).parentElement;\n    if (jevPanelEl.parentElement !== wrapper) wrapper.appendChild(jevPanelEl);\n", 'follows the pane') }), /moved into an editor box/, 'a panel that follows the pane that has the keyboard');
  console.log('PASS: mutation check: every rule of sections 3 and 5 to 8 fails on a copy of the sources broken the way it is meant to catch (sticky note, fade, dialogs, scrim, place).');
}

console.log('\nAll panel template tests PASSED!');
