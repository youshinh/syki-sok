// v2 P2b: the rules of the see-through bars, Zen mode and the line numbers in the margin. (The geometry of the overlay is
// tests/chrome_overlay_wiring_test.mjs; the state machine is frontend/js/chrome_overlay_test.js; the contrast of all of it is
// tests/look_contrast_test.mjs. The pixels were checked in the real app.)
//
//   1. The bars: how see-through they are is one attribute on <body> (data-bars) that css/chrome.css turns into --bar-a on the two bars, and
//      only there; the colour is the channel token with that alpha; glass blurs behind an @supports guard with both spellings and an engine
//      without it keeps the light value; forced colours and "reduce transparency" make them solid. index.html ships the default value that
//      js/appearance.js says (so the default writes nothing at start-up), and the dialog offers exactly the values the setting knows.
//   2. Zen mode: the margins stay (the numbers --pad-x / --pad-y), no column is folded, the numbers fade by alpha (30%, 80% under the mouse),
//      an ordinary message is visually hidden but stays in the live region, a failure is not; the bars fade through the same rule as the
//      auto-hide; toggleZenMode tells the overlay; showMessage marks a failure; every failure the owner listed is marked, routine messages are not.
//   3. The numbers in the margin: no panel (no background, no rule), their colour is the muted colour at an alpha, never an opacity on the
//      gutter, and style.css no longer says any of it.
//   4. The title in the header: built (first child of the header, before the tabs), hidden, kept up to date.
//   5. The mutation check: each check fails on a copy of the file broken the way it is meant to catch.
//
// Node only. Run: node tests/chrome_bars_zen_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
global.window = global;
const Appearance = require('../frontend/js/appearance.js');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const html = read('frontend/index.html');
const chromeRaw = read('frontend/css/chrome.css');
const styleRaw = read('frontend/css/style.css');
const appJs = read('frontend/js/app.js');
const I18N = new Function(read('frontend/js/i18n.js') + '\nreturn I18N;')();

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS: ' + name); } catch (e) { failed++; console.log('FAIL: ' + name + '\n  ' + (e && e.message)); }
}
const none = (list, what) => assert.deepEqual(list, [], what + ':\n  ' + list.join('\n  '));

// the declarations of every rule whose selector list is exactly `selector` (whitespace-insensitive), inside or outside an at-rule
function declarations(css, selector) {
  const want = selector.replace(/\s+/g, ' ').trim();
  const found = [];
  for (const m of noComments(css).matchAll(/([^{}@;][^{}]*)\{([^{}]*)\}/g)) {
    if (m[1].replace(/\s+/g, ' ').trim() === want) found.push(m[2]);
  }
  return found.join('\n');
}
const prop = (decls, name) => {
  const m = decls.match(new RegExp('(?:^|[;\\s])' + name.replace(/-/g, '\\-') + ':\\s*([^;]+);'));
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
};

// ---- 1. the bars ---------------------------------------------------------------------------------------------------------------------------
function barsProblems(chrome) {
  const p = [];
  const css = noComments(chrome);
  const header = declarations(chrome, '#header');
  const status = declarations(chrome, '#status-bar');
  if (prop(header, 'background-color') !== 'rgb(var(--bar-top-rgb) / var(--bar-a))') p.push('#header is not the --bar-top-rgb channel at --bar-a: ' + prop(header, 'background-color'));
  if (prop(status, 'background') !== 'rgb(var(--bar-bottom-rgb) / var(--bar-a))') p.push('#status-bar is not the --bar-bottom-rgb channel at --bar-a: ' + prop(status, 'background'));
  if (prop(declarations(chrome, '#header, #status-bar'), '--bar-a') !== '1') p.push('without data-bars (and for "solid") the bars are not opaque');
  const light = declarations(chrome, 'body[data-bars="light"] #header, body[data-bars="light"] #status-bar, body[data-bars="glass"] #header, body[data-bars="glass"] #status-bar');
  const lightA = parseFloat(prop(light, '--bar-a'));
  if (!(lightA > 0.5 && lightA < 1)) p.push('light (and the glass fallback) --bar-a is ' + prop(light, '--bar-a') + ': it must be see-through but not by much');
  if (/backdrop-filter/.test(light)) p.push('light blurs: it must not');
  // glass: inside @supports for both spellings, with the lower alpha
  const sup = /@supports\s*\(\(-webkit-backdrop-filter:\s*blur\(1px\)\)\s*or\s*\(backdrop-filter:\s*blur\(1px\)\)\)\s*\{\s*(body\[data-bars="glass"\] #header,\s*body\[data-bars="glass"\] #status-bar)\s*\{([^{}]*)\}\s*\}/.exec(css);
  if (!sup) p.push('the glass rule is not inside @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))');
  else {
    const glass = sup[2];
    const glassA = parseFloat(prop(glass, '--bar-a'));
    if (!(glassA > 0.3 && glassA < lightA)) p.push('glass --bar-a ' + prop(glass, '--bar-a') + ' must be more see-through than light ' + lightA);
    if (!/-webkit-backdrop-filter:\s*blur\(\d+px\)/.test(glass) || !/(^|[;\s])backdrop-filter:\s*blur\(\d+px\)/.test(glass)) p.push('glass: both -webkit-backdrop-filter and backdrop-filter are needed (Safari 15 has only the prefixed one)');
    if (prop(glass, '-webkit-backdrop-filter') !== prop(glass, 'backdrop-filter')) p.push('the two spellings blur differently');
  }
  if ((css.match(/backdrop-filter/g) || []).length !== 4 + 2) p.push('backdrop-filter is written in places other than the glass rule and the reset: ' + (css.match(/backdrop-filter/g) || []).length);
  // --bar-a lives on the bars only (a custom property that changes on <body> restyles the whole page)
  for (const m of css.matchAll(/([^{}@;][^{}]*)\{([^{}]*--bar-a:[^{}]*)\}/g)) {
    for (const sel of m[1].split(',').map((x) => x.trim())) if (!/#(header|status-bar)$/.test(sel)) p.push('--bar-a is set on ' + sel + ', not on a bar');
  }
  // solid for forced colours and for "reduce transparency"
  const reset = /@media\s*\(forced-colors:\s*active\),\s*\(prefers-reduced-transparency:\s*reduce\)\s*\{\s*#header,\s*#status-bar\s*\{([^{}]*)\}/.exec(css);
  if (!reset) p.push('no @media (forced-colors: active), (prefers-reduced-transparency: reduce) block');
  else {
    if (!/--bar-a:\s*1\s*!important/.test(reset[1])) p.push('that block does not make the bars opaque (!important)');
    if (!/backdrop-filter:\s*none\s*!important/.test(reset[1]) || !/-webkit-backdrop-filter:\s*none\s*!important/.test(reset[1])) p.push('that block does not switch the blur off');
  }
  if (/color-mix|@container/.test(css)) p.push('chrome.css uses a syntax macOS 10.15 cannot read');
  return p;
}

check('the bars: the channel token at --bar-a on the two bars only; light does not blur; glass blurs inside @supports; solid for forced colours / reduced transparency', () => {
  none(barsProblems(chromeRaw), 'the bars rules are wrong');
});

check('index.html ships the default bars in its markup, the dialog offers exactly the three values, the setting knows its default', () => {
  const body = /<body[^>]*>/.exec(html)[0];
  assert.ok(new RegExp('data-bars="' + Appearance.DEFAULT_BARS + '"').test(body), 'the page ships data-bars="' + Appearance.DEFAULT_BARS + '" (the default of js/appearance.js), so the default look writes nothing at start-up: ' + body);
  const sel = /<select id="cfg-bars"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(sel, 'the select exists');
  assert.deepEqual([...sel[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]), Appearance.BARS, 'the options are the values of the setting, in order');
  assert.ok(/<input type="checkbox" id="cfg-auto-hide"/.test(html), 'the auto-hide switch exists');
  assert.ok(html.indexOf('id="cfg-bars"') > html.indexOf('id="cfg-editor-font"') && html.indexOf('id="cfg-bars"') < html.indexOf('id="cfg-mermaid-tone"'), 'both sit in the Appearance section, after the editor font');
  for (const key of ['barsLabel', 'barsSolid', 'barsLight', 'barsGlass', 'barsHint', 'autoHideLabel', 'autoHideHint']) {
    for (const lang of ['en', 'ja']) assert.ok(typeof I18N[lang][key] === 'string' && I18N[lang][key].length >= 2, key + ' in ' + lang);
    assert.ok(!/[぀-ヿ㐀-鿿]/.test(I18N.en[key]), key + ': English has no Japanese');
    for (const lang of ['en', 'ja']) assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(I18N[lang][key]), key + ' has no emoji');
    assert.ok(html.includes('data-i18n="' + key + '"'), key + ' is used in index.html');
  }
});

check('Settings: the bars and auto-hide are read from their controls, shown, and previewed at once (Cancel restores through applyTheme)', () => {
  assert.match(appJs, /if \(el\('cfg-bars'\)\) next\.bars = el\('cfg-bars'\)\.value;/);
  assert.match(appJs, /if \(el\('cfg-auto-hide'\)\) next\.autoHide = el\('cfg-auto-hide'\)\.checked;/);
  assert.match(appJs, /if \(el\('cfg-bars'\)\) el\('cfg-bars'\)\.value = ap\.bars;/);
  assert.match(appJs, /if \(el\('cfg-auto-hide'\)\) el\('cfg-auto-hide'\)\.checked = ap\.autoHide !== false;/);
  assert.match(appJs, /el\('cfg-bars'\)\.onchange = previewAppearance;/);
  assert.match(appJs, /el\('cfg-auto-hide'\)\.onchange = previewAppearance;/);
  assert.match(appJs, /if \(themeChanged \|\| appearancePreviewing\) applyTheme\(\);/, 'Cancel puts the saved setting back (applyTheme -> applyAppearance -> configure)');
});

// ---- 2. Zen mode ---------------------------------------------------------------------------------------------------------------------------
function zenProblems(chrome, style, app) {
  const p = [];
  const zen = declarations(chrome, 'body.zen-mode');
  for (const [k, v] of [['--pad-x', '32px'], ['--pad-y', '24px'], ['--ov-inset-top', '0px'], ['--ov-inset-bottom', '0px'], ['--linenum-a', '0.3']]) {
    if (prop(zen, k) !== v) p.push('body.zen-mode ' + k + ' is ' + prop(zen, k) + ', expected ' + v + ' (the margins stay as they were; the numbers fade to 30%)');
  }
  if (prop(declarations(chrome, 'body.zen-mode #line-numbers:hover'), '--linenum-a') !== '0.8') p.push('the line numbers do not come up to 80% under the mouse in Zen mode');
  if (prop(declarations(chrome, 'body.zen-mode .result-accent'), 'opacity') !== '0.3') p.push('the result bars do not fade to 30% with the numbers');
  const msg = declarations(chrome, 'body.zen-mode #stat-message:not([data-important])');
  if (!msg) p.push('no rule hides an ordinary message in Zen mode');
  else {
    if (prop(msg, 'width') !== '1px' || prop(msg, 'height') !== '1px' || prop(msg, 'overflow') !== 'hidden' || prop(msg, 'clip') !== 'rect(0 0 0 0)' || prop(msg, 'position') !== 'absolute') p.push('the hidden message is not the visually-hidden recipe');
    if (/display\s*:|visibility\s*:|opacity\s*:/.test(msg)) p.push('the message is taken out of the reading order (display / visibility / opacity): the live region would not speak it');
  }
  // the bars fade through the same rule as the auto-hide, and Zen takes no room back by shrinking the bars
  const fade = noComments(chrome).match(/body\.zen-mode #header:not\(:focus-within\):not\(\[data-pin\]\)/g);
  if (!fade) p.push('the fade rule does not name body.zen-mode #header');
  if (!/body\.zen-mode #status-bar:not\(:focus-within\):not\(\[data-pin\]\)/.test(noComments(chrome))) p.push('the fade rule does not name body.zen-mode #status-bar');
  if (/zen-mode[^{]*\{[^}]*(height\s*:\s*0|visibility|display\s*:\s*none)/.test(noComments(chrome + '\n' + style))) p.push('Zen mode shrinks or hides a bar by height / visibility / display (the old way)');
  if (/zen-mode/.test(noComments(style))) p.push('style.css still has a rule for Zen mode');
  // the script
  if (!/function toggleZenMode\(\) \{\s*const isZen = document\.body\.classList\.toggle\('zen-mode'\);\s*if \(chromeOverlay\) chromeOverlay\.setZen\(isZen\);/.test(app)) p.push('toggleZenMode does not tell the overlay first');
  if (!/if \(opts && opts\.important\) statMessage\.setAttribute\('data-important', ''\); else statMessage\.removeAttribute\('data-important'\);/.test(app)) p.push('showMessage does not mark / unmark a failure');
  if (!/statMessage\.removeAttribute\('data-important'\);\s*\}\s*\}, duration/.test(app)) p.push('the failure mark is not removed with the message');
  return p;
}

check('Zen mode: the margins stay, the numbers fade by alpha, an ordinary message is visually hidden, the bars fade through the shared rule, the overlay is told', () => {
  none(zenProblems(chromeRaw, styleRaw, appJs), 'Zen mode is not what the owner decided');
});

// every failure the owner listed (and the ones found by reading the code) is marked important; routine messages are not
const FAILURES = ['saveError', 'configSaveFailed', 'configNotSavedUnreadable', 'diskChangedUnsaved', 'diskConflictLoadFailed', 'startupFileFailed', 'sessionUnreadable',
  'globalShortcutRegisterFailed', 'openError', 'exportPlainTextError', 'pasteImageSaveFailed', 'pasteClipboardUnreadable', 'llmError', 'cliError', 'cliBlockedError',
  'cliErrorTabOpened', 'deepSearchFailed', 'previewPrintFailed', 'tagEditFailed', 'lessonsOpenFailed', 'lessonsInfoFailed', 'resultCopyFailed',
  'gitTestFailed', 'gitSetupFailed', 'agentsConfigError', 'ollamaStartFailed', 'ollamaSetupFailed', 'fanchorImportUnavailable'];
const ROUTINE = ['saveSuccess', 'settingsSaved', 'zenModeEnabled', 'zenModeDisabled', 'toastAutosaveOn', 'toastAutosaveOff', 'cliSuccess', 'aiCorrectionSuccess', 'gitTestSuccess'];
function importanceProblems(app) {
  const p = [];
  const lines = app.split('\n');
  const callsOf = (key) => lines.filter((l) => l.includes('showMessage(') && l.includes("'" + key + "'"));
  for (const key of FAILURES) {
    const calls = callsOf(key);
    if (!calls.length) { p.push(key + ': no showMessage call found'); continue; }
    for (const l of calls) if (!/important: true/.test(l)) p.push(key + ' is not marked important: ' + l.trim().slice(0, 110));
  }
  for (const key of ROUTINE) {
    for (const l of callsOf(key)) if (/important: true/.test(l)) p.push(key + ' is routine but marked important: ' + l.trim().slice(0, 110));
  }
  const askFail = lines.filter((l) => l.includes('showMessage(askFailureToast(f, failure)'));
  if (askFail.length < 2 || askFail.some((l) => !/important: true/.test(l))) p.push('the ask bar failures are not all marked important');
  return p;
}

// The lint that stands behind the lists above: any message whose i18n key names a failure must be marked, in every script, so a failure added
// later cannot be forgotten. (Messages written without a key are not seen by it; the lists above name those.) A toast of voice_input.js and
// file_anchor.js goes through its own toast() function, which decides by key / for every message.
const FAILURE_WORD = /(?:Failed|Failure|Error|Unreadable|Denied|Blocked|NotFound|Busy|Unavailable|Missing|Timeout)\b/;
function lintProblems(sources) {
  const p = [];
  for (const [name, text] of sources) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (!/showMessage\(/.test(line) || /function showMessage|^\s*\/\//.test(line)) return;
      const keys = [...line.matchAll(/['"`]([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)['"`]/g)].map((m) => m[1]).filter((k) => FAILURE_WORD.test(k));
      if (keys.length && !/important/.test(line)) p.push(name + ':' + (i + 1) + ' shows ' + keys.join(', ') + ' without { important: true }');
    });
  }
  return p;
}
const jsSources = () => fs.readdirSync('frontend/js').filter((f) => f.endsWith('.js') && !f.endsWith('_test.js')).map((f) => [f, read('frontend/js/' + f)]);
function toastProblems(voice, anchor) {
  const p = [];
  const list = /const FAILURE_KEYS = \[([^\]]*)\]/.exec(voice);
  const listed = list ? [...list[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
  if (!list) p.push('voice_input.js has no FAILURE_KEYS');
  if (!/FAILURE_KEYS\.indexOf\(key\) >= 0 \? \{ important: true \} : undefined/.test(voice)) p.push('voice_input.js toast() does not mark the keys of FAILURE_KEYS');
  const used = new Set([...voice.matchAll(/(?:toast\(bridge|giveUpWaiting\(id), '(\w+)'/g)].map((m) => m[1]));
  for (const k of used) if (FAILURE_WORD.test(k) && listed.indexOf(k) < 0) p.push('voice_input.js: ' + k + ' is a failure but not in FAILURE_KEYS');
  if (!/bridge\.showMessage\(text, 4000, \{ important: true \}\)/.test(anchor)) p.push('file_anchor.js toast() does not mark its messages (every one of them is a failure)');
  return p;
}

check('every failure toast is marked important (it calls the status bar back in Zen mode), the routine ones are not', () => {
  none(importanceProblems(appJs), 'a toast is wrongly (un)marked');
  none(lintProblems(jsSources()), 'a message that names a failure is not marked');
  none(toastProblems(read('frontend/js/voice_input.js'), read('frontend/js/file_anchor.js')), 'the toasts of the voice and link scripts');
  assert.match(read('frontend/js/slot_agent.js'), /global\.showMessage\(text, 8000, \{ important: true \}\)/, 'a run that could not start (notifyRunProblem)');
  assert.equal((read('frontend/js/tag_edit.js').match(/showMessage\([^;\n]*\{ important: true \}\)/g) || []).length, 3, 'the tag edit failures');
});

// ---- 3. the numbers in the margin ----------------------------------------------------------------------------------------------------------
function marginCssProblems(chrome, style) {
  const p = [];
  for (const sel of ['#line-numbers, .secondary-editor-pane .line-numbers']) {
    const d = declarations(chrome, sel);
    if (prop(d, 'background') !== 'none') p.push(sel + ': background is ' + prop(d, 'background') + ' (the numbers sit on the page, no panel)');
    if (prop(d, 'border-right') !== 'none') p.push(sel + ': border-right is ' + prop(d, 'border-right') + ' (no rule beside the numbers)');
    if (!/^rgb\(var\(--text-muted-rgb\) \/ var\(--linenum-a(, [0-9.]+)?\)\)$/.test(prop(d, 'color') || '')) p.push(sel + ': the colour is ' + prop(d, 'color') + ', not the muted channel at --linenum-a');
    if (/\bopacity\s*:/.test(d)) p.push(sel + ' fades with opacity: a gutter 80,000 lines tall would get an off-screen copy of all of it; use the alpha of the colour');
    if (prop(d, 'padding') !== 'var(--editor-pad-top) 6px var(--editor-pad-bottom)') p.push(sel + ': the padding is no longer the textarea\'s');
  }
  // style.css says none of it any more
  const css = noComments(style);
  for (const sel of ['#line-numbers', '.secondary-editor-pane .line-numbers']) {
    const d = declarations(css, sel);
    if (!d) { p.push(sel + ': no rule in style.css'); continue; }
    for (const name of ['background', 'border-right', 'color', 'padding']) if (prop(d, name) !== null) p.push('style.css still sets ' + name + ' on ' + sel);
    if (prop(d, 'width') !== '44px') p.push(sel + ': the width is ' + prop(d, 'width') + ' (it follows the digits from 44px)');
  }
  return p;
}

check('the line numbers: no panel, no rule, the muted colour at --linenum-a (not an opacity); style.css no longer says it', () => {
  none(marginCssProblems(chromeRaw, styleRaw), 'the numbers are not in the margin');
});

check('--linenum-a exists for both looks, the strength is a number below 1 and the same token feeds Zen\'s 30%', () => {
  const tokens = read('frontend/css/tokens.css');
  const ink = /--linenum-a:\s*([0-9.]+);/.exec(tokens.slice(0, tokens.indexOf('body.look-paper {')));
  const paper = /--linenum-a:\s*([0-9.]+);/.exec(tokens.slice(tokens.indexOf('body.look-paper {')));
  assert.ok(ink && paper, 'defined for ink and for paper');
  for (const m of [ink, paper]) assert.ok(parseFloat(m[1]) > 0.3 && parseFloat(m[1]) < 1);
});

// ---- 4. the title in the header ------------------------------------------------------------------------------------------------------------
check('#header-title: the first child of the header, shown beside the icons (the tabs are not in the header any more), placed from the strip, the gutter width and the margin, kept up to date', () => {
  const head = /<header id="header">([\s\S]*?)<div id="header-actions">/.exec(html);
  assert.ok(head && /<div id="header-title" aria-hidden="true"><\/div>/.test(head[1]), 'it is in front of the icons, empty, and not read twice by a screen reader (the tab has the name)');
  assert.ok(!/id="tabs-bar"|id="tabs-list"|id="btn-new-tab"/.test(head[1]), 'the tabs are not in the header: they stand on the edge of the window (#tab-index-left in #workspace)');
  const t = declarations(chromeRaw, '#header-title');
  assert.ok(!/display\s*:\s*none/.test(t), 'shown now that the index tabs took the tabs out of the header');
  assert.equal(prop(t, 'margin-left'), 'calc(var(--tab-strip-w) + var(--linenum-w) + var(--pad-x))', 'left-aligned to where the text starts: after the strip, the gutter and the margin');
  assert.equal(prop(t, 'flex'), '1 1 0', 'it takes the room the icons leave and is cut with an ellipsis before them');
  assert.equal(prop(t, 'position'), null, 'in the flow of the header, so it can never lie under the icons');
  assert.match(prop(declarations(chromeRaw, '#header'), '--linenum-w'), /^max\(44px, calc\(13px \+ var\(--linenum-digits, 0\) \* var\(--editor-fs, 14px\) \* 0\.6\)\)$/);
  // the text of the active tab, file name only, written when it changed
  const fn = (() => { const i = appJs.indexOf('function updateHeaderTitle()'); let d = 0; let j = appJs.indexOf('{', i); for (; j < appJs.length; j++) { if (appJs[j] === '{') d++; else if (appJs[j] === '}' && --d === 0) break; } return appJs.slice(i, j + 1); })();
  const writes = [];
  const el = { set textContent(v) { writes.push(v); } };
  const ctx = vm.createContext({ document: { getElementById: (id) => (id === 'header-title' ? el : null) }, getTab: (id) => ({ 1: { title: 'a.md' }, 2: { title: 'b.md' }, 3: { title: '' } })[id] || null, activeTabId: 1, headerTitleEl: null, headerTitleText: null });
  vm.runInContext(fn + '\nthis.__run = function (id) { activeTabId = id; updateHeaderTitle(); };', ctx);
  ctx.__run(1); ctx.__run(1); ctx.__run(2); ctx.__run(2); ctx.__run(3); ctx.__run(99);
  assert.deepEqual(writes, ['a.md', 'b.md', ''], 'the file name of the active tab, written only when it changed (and emptied when there is none)');
  const render = appJs.slice(appJs.indexOf('  function renderTabs() {'), appJs.indexOf('  // Number of "\\n" in text.substring(0, end)'));
  assert.ok(/updateHeaderTitle\(\);\s*renderAutosaveStatus\(\);/.test(render), 'renderTabs updates it');
  assert.ok(!/refreshTabActiveClasses/.test(appJs), 'a change of the page in focus needs no redraw of the title: it is the note of the left page, which a focus change does not change');
  const auto = appJs.slice(appJs.indexOf("// Zero-Taxonomy: If tab is unfiled/untitled"), appJs.indexOf('// Sync between primary and secondary editor if editing the same note'));
  assert.ok(/updateHeaderTitle\(\);/.test(auto), 'and the automatic title while you type');
  assert.match(appJs, /el\.id === 'line-numbers' && typeof noteHeaderGutterDigits === 'function'\) noteHeaderGutterDigits\(digits\)/, 'the gutter width reaches the header');
});

// ---- 5. the mutation check -----------------------------------------------------------------------------------------------------------------
function mutate(text, find, replace) {
  assert.ok(text.includes(find), 'the mutation target exists: ' + find);
  return text.replace(find, replace);
}
check('mutation check: broken copies of chrome.css, style.css and app.js are caught', () => {
  assert.equal(barsProblems(chromeRaw).length, 0, 'the real file is clean (the premise of the mutations)');
  assert.equal(zenProblems(chromeRaw, styleRaw, appJs).length, 0);
  assert.equal(marginCssProblems(chromeRaw, styleRaw).length, 0);
  assert.equal(importanceProblems(appJs).length, 0);
  const caught = (list, re, what) => assert.ok(list.some((x) => re.test(x)), what + ' (got: ' + list.join(' | ') + ')');
  // the bars
  caught(barsProblems(mutate(chromeRaw, 'background-color: rgb(var(--bar-top-rgb) / var(--bar-a));', 'background-color: rgb(var(--bar-top-rgb));')), /#header is not/, 'an opaque header');
  caught(barsProblems(mutate(chromeRaw, 'background: rgb(var(--bar-bottom-rgb) / var(--bar-a));', 'background: var(--bg-statusbar);')), /#status-bar is not/, 'a status bar that ignores --bar-a');
  caught(barsProblems(mutate(chromeRaw, '#header,\n#status-bar {\n  --bar-a: 1;\n}', '#header,\n#status-bar {\n  --bar-a: 0.9;\n}')), /not opaque/, 'solid that is not');
  caught(barsProblems(mutate(chromeRaw, '--bar-a: 0.86;', '--bar-a: 0.3;')), /light .*--bar-a/, 'a light so see-through that nothing reads');
  caught(barsProblems(mutate(chromeRaw, '--bar-a: 0.55;', '--bar-a: 0.95;')), /glass --bar-a/, 'a glass less see-through than light');
  caught(barsProblems(mutate(chromeRaw, '    -webkit-backdrop-filter: blur(8px) saturate(1.15);\n', '')), /both -webkit-backdrop-filter and backdrop-filter/, 'glass without the prefixed spelling');
  caught(barsProblems(mutate(chromeRaw, '@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))', '@supports (backdrop-filter: blur(1px))')), /not inside @supports/, 'an @supports that Safari 15 fails');
  caught(barsProblems(mutate(chromeRaw, 'body[data-bars="light"] #header,', 'body[data-bars="light"] #header { -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }\nbody[data-bars="light"] #header,')), /backdrop-filter is written in places|light blurs/, 'a blur outside the glass rule');
  caught(barsProblems(mutate(chromeRaw, '#header,\n#status-bar {\n  --bar-a: 1;\n}', 'body {\n  --bar-a: 1;\n}')), /--bar-a is set on body/, '--bar-a on <body>');
  caught(barsProblems(mutate(chromeRaw, '--bar-a: 1 !important;', '--bar-a: 1;')), /opaque \(!important\)/, 'reduced transparency that does not win');
  caught(barsProblems(mutate(chromeRaw, '(forced-colors: active), (prefers-reduced-transparency: reduce)', '(forced-colors: active)')), /no @media/, 'a missing reduced-transparency block');
  caught(barsProblems(chromeRaw + '\n.x { background: color-mix(in srgb, red, blue); }'), /cannot read/, 'color-mix');
  // Zen
  caught(zenProblems(mutate(chromeRaw, '  --pad-x: 32px;\n  --pad-y: 24px;', '  --pad-x: 14px;\n  --pad-y: 12px;'), styleRaw, appJs), /--pad-x/, 'a Zen mode that removes the margins');
  caught(zenProblems(mutate(chromeRaw, '--linenum-a: 0.3;', '--linenum-a: 0;'), styleRaw, appJs), /--linenum-a is 0/, 'numbers that vanish');
  caught(zenProblems(mutate(chromeRaw, 'body.zen-mode #stat-message:not([data-important]) {', 'body.zen-mode #stat-message {'), styleRaw, appJs), /no rule hides an ordinary message/, 'a failure that is hidden too');
  caught(zenProblems(mutate(chromeRaw, '  clip: rect(0 0 0 0);\n  white-space: nowrap;\n}\n', '  clip: rect(0 0 0 0);\n  white-space: nowrap;\n  display: none;\n}\n'), styleRaw, appJs), /reading order/, 'a message that leaves the live region');
  caught(zenProblems(mutate(chromeRaw, 'body.zen-mode #header:not(:focus-within):not([data-pin]),\n', ''), styleRaw, appJs), /#header/, 'a header that Zen does not fade');
  caught(zenProblems(chromeRaw, styleRaw + '\nbody.zen-mode #header { height: 0; }', appJs), /style\.css still has a rule for Zen|shrinks or hides/, 'the old Zen rules back in style.css');
  caught(zenProblems(chromeRaw, styleRaw, mutate(appJs, 'if (chromeOverlay) chromeOverlay.setZen(isZen);', '')), /does not tell the overlay/, 'a toggle that forgets the overlay');
  caught(zenProblems(chromeRaw, styleRaw, mutate(appJs, "if (opts && opts.important) statMessage.setAttribute('data-important', ''); else statMessage.removeAttribute('data-important');", '')), /does not mark/, 'a showMessage that cannot mark a failure');
  caught(importanceProblems(mutate(appJs, "showMessage(`${t('saveError')}${goErr(e.message || e)}`, 4000, { important: true });", "showMessage(`${t('saveError')}${goErr(e.message || e)}`, 4000);")), /saveError is not marked/, 'a save failure that Zen would hide');
  caught(importanceProblems(mutate(appJs, "showMessage(t('configSaveFailed', { err: (why.length > 120 ? why.slice(0, 120) + '…' : why) || t('configSaveFailedUnknown') }), 9000, { important: true });", "showMessage(t('configSaveFailed', { err: (why.length > 120 ? why.slice(0, 120) + '…' : why) || t('configSaveFailedUnknown') }), 9000);")), /configSaveFailed is not marked/, 'a config failure that Zen would hide');
  caught(importanceProblems(mutate(appJs, "showMessage(t('settingsSaved'), 2000);", "showMessage(t('settingsSaved'), 2000, { important: true });")), /settingsSaved is routine/, 'a routine message that breaks into Zen');
  // the lint over every script, and the two scripts that toast on their own
  assert.equal(lintProblems(jsSources()).length, 0, 'the real scripts are clean (the premise of the mutations)');
  assert.equal(toastProblems(read('frontend/js/voice_input.js'), read('frontend/js/file_anchor.js')).length, 0);
  const withoutMark = jsSources().map(([n, t]) => [n, n === 'app.js' ? mutate(t, "showMessage(t('gitTestFailed', { err: errDetail }), 6000, { important: true });", "showMessage(t('gitTestFailed', { err: errDetail }), 6000);") : t]);
  caught(lintProblems(withoutMark), /app\.js:\d+ shows gitTestFailed/, 'a failure of the settings dialog that Zen would hide');
  const newFailure = jsSources().concat([['new_feature.js', "host.showMessage(t('thingDidNotWorkError'), 4000);"]]);
  caught(lintProblems(newFailure), /new_feature\.js:1 shows thingDidNotWorkError/, 'a failure added later and forgotten');
  assert.equal(lintProblems(jsSources().concat([['new_feature.js', "host.showMessage(t('thingSaved'), 4000);"]])).length, 0, 'a routine message is left alone');
  caught(toastProblems(mutate(read('frontend/js/voice_input.js'), "'voiceTranscribeFailed', ", ''), read('frontend/js/file_anchor.js')), /voiceTranscribeFailed is a failure but not in FAILURE_KEYS/, 'a voice failure that is forgotten');
  caught(toastProblems(read('frontend/js/voice_input.js').replace('FAILURE_KEYS.indexOf(key) >= 0 ? { important: true } : undefined', 'undefined'), read('frontend/js/file_anchor.js')), /does not mark the keys/, 'a voice toast() that marks nothing');
  caught(toastProblems(read('frontend/js/voice_input.js'), read('frontend/js/file_anchor.js').replace('bridge.showMessage(text, 4000, { important: true })', 'bridge.showMessage(text, 4000)')), /file_anchor\.js toast\(\)/, 'a link toast that marks nothing');
  // the margin
  caught(marginCssProblems(mutate(chromeRaw, '  background: none;\n  border-right: none;\n  color: rgb(var(--text-muted-rgb) / var(--linenum-a, 0.7));', '  border-right: none;\n  color: rgb(var(--text-muted-rgb) / var(--linenum-a, 0.7));'), styleRaw), /background is null/, 'a gutter with a panel');
  caught(marginCssProblems(mutate(chromeRaw, '  background: none;\n  border-right: none;\n  color: rgb(var(--text-muted-rgb) / var(--linenum-a, 0.7));', '  background: none;\n  color: rgb(var(--text-muted-rgb) / var(--linenum-a, 0.7));'), styleRaw), /border-right/, 'a rule beside the numbers');
  caught(marginCssProblems(mutate(chromeRaw, 'color: rgb(var(--text-muted-rgb) / var(--linenum-a, 0.7));', 'color: var(--text-muted);\n  opacity: 0.55;'), styleRaw), /not the muted channel|opacity/, 'numbers faded by opacity');
  caught(marginCssProblems(chromeRaw, mutate(styleRaw, '#line-numbers {\r\n  position: relative;\r\n  width: 44px;'.replace(/\r\n/g, '\n'), '#line-numbers {\n  position: relative;\n  width: 44px;\n  background: var(--bg-line-num);')), /style\.css still sets background/, 'a background back in style.css');
});

if (failed) {
  console.log('\n' + failed + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nAll P2b bars / Zen / margin tests PASSED!');
