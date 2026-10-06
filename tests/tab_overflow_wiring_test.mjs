// B2: the tab strip with more tabs than fit. The behaviour of the module is in frontend/js/tab_overflow_test.js and was checked
// in a real browser (docshots: tabs-overflow, tabs-overflow-narrow, tabs-all-list); this test keeps the pieces wired together:
//   markup ("+" and All tabs outside the scrolling part), styles (hidden scrollbar, fade, panel tokens), strings in both languages,
//   the hooks in app.js, and the rule that the module does nothing until it is asked to.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const html = read('frontend/index.html');
const cssRaw = read('frontend/css/style.css');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const app = read('frontend/js/app.js');
const moduleSrc = read('frontend/js/tab_overflow.js');
const I18N = new Function(read('frontend/js/i18n.js') + '\nreturn I18N;')();

const queue = [];
const check = (name, fn) => queue.push({ name, fn });
const rule = (selector) => {
  const at = css.indexOf(selector + ' {');
  assert.notStrictEqual(at, -1, `${selector} must have a rule`);
  return css.slice(at, css.indexOf('}', at));
};

check('markup: the tabs scroll in #tabs-scroll in the left strip; "+" and All tabs are the strip\'s foot, beside it, not inside; the right strip has a scroll box and a list of its own and no foot', () => {
  const at = html.indexOf('<div id="tab-index-left"');
  assert.ok(at > html.indexOf('<main id="workspace">'), 'the strip is in the workspace (over the text), not in the header');
  const bar = html.slice(at, html.indexOf('<div id="tab-index-right"'));
  assert.ok(!html.slice(html.indexOf('<header id="header">'), html.indexOf('</header>')).includes('id="tabs-list"'), 'and the header has no tabs');
  const scrollStart = bar.indexOf('<div id="tabs-scroll">');
  assert.ok(scrollStart > 0, '#tabs-scroll exists inside the strip');
  const listAt = bar.indexOf('<div id="tabs-list" role="tablist" aria-orientation="vertical"></div>');
  const scrollEnd = bar.indexOf('</div>', listAt + 10);
  assert.ok(listAt > scrollStart && scrollEnd > listAt, '#tabs-list is inside #tabs-scroll, a vertical tablist');
  const foot = bar.indexOf('<div class="tab-index-foot">');
  assert.ok(foot > scrollEnd, 'the foot is after the scrolling part');
  assert.ok(bar.indexOf('id="btn-new-tab"') > foot, '"+" is in the foot');
  assert.ok(bar.indexOf('id="btn-all-tabs"') > bar.indexOf('id="btn-new-tab"'), 'All tabs follows it');
  assert.match(bar, /<button id="btn-all-tabs" class="tab-index-btn hidden"/, 'All tabs starts hidden: with tabs that fit it never shows');
  assert.match(bar, /<button id="btn-new-tab" class="tab-index-btn"/);
  assert.match(bar, /id="btn-all-tabs"[^>]*data-i18n-title="allTabsTitle"/, 'its tooltip (and, through a11y.js, its name) follows the language');
  assert.match(bar, /id="btn-all-tabs"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  assert.match(bar.slice(bar.indexOf('id="btn-all-tabs"')), /<svg[\s\S]*?<polyline points="6 9 12 15 18 9">/, 'a line-art chevron, no glyph or emoji');
  const right = html.slice(html.indexOf('<div id="tab-index-right"'), html.indexOf('<!-- Floating Find & Replace Bar -->'));
  assert.match(right, /<div id="tabs-scroll-right">\s*<div id="tabs-list-right" role="tablist" aria-orientation="vertical"><\/div>\s*<\/div>/, 'the right strip scrolls in #tabs-scroll-right, a vertical tablist');
  assert.ok(!right.includes('btn-new-tab') && !right.includes('btn-all-tabs') && !right.includes('tab-index-foot'), '"+" and All tabs are the left strip\'s: one of each in the window');
});

check('markup: tab_overflow.js loads before app.js with the usual ?v= pattern', () => {
  const at = html.indexOf('js/tab_overflow.js?v=');
  assert.ok(at > 0 && at < html.indexOf('js/app.js?v='));
  assert.match(html, /<script src="js\/tab_overflow\.js\?v=\d+\.\d+\.\d+"><\/script>/);
});

check('css: the columns scroll without a scrollbar, squeeze their tabs before they scroll, and the foot never shrinks', () => {
  const strip = rule('.tab-index');
  assert.ok(/position:\s*absolute/.test(strip) && /flex-direction:\s*column/.test(strip), 'the strip is an overlay and a column');
  assert.ok(/overflow:\s*hidden/.test(strip), 'the open strip is clipped to its width, nothing outside it moves');
  const scroll = rule('#tabs-scroll,\n#tabs-scroll-right');
  assert.ok(/overflow-y:\s*auto/.test(scroll) && /overflow-x:\s*hidden/.test(scroll));
  assert.ok(/flex:\s*0 1 auto/.test(scroll) && /min-height:\s*0/.test(scroll), 'it takes the tabs\' height and shrinks first, so "+" stays in view');
  assert.ok(/scrollbar-width:\s*none/.test(scroll), 'the 3px scrollbar is gone');
  assert.ok(/#tabs-scroll::-webkit-scrollbar,\s*#tabs-scroll-right::-webkit-scrollbar\s*\{\s*display:\s*none/.test(css), 'neither column shows a scrollbar');
  const list = rule('#tabs-list,\n#tabs-list-right');
  assert.ok(/flex-direction:\s*column/.test(list) && /flex:\s*0 1 auto/.test(list) && /min-height:\s*0/.test(list), 'the column of tabs shrinks with the strip, which squeezes the tabs');
  const tab = rule('.tab-item');
  assert.ok(/flex:\s*0 1 var\(--tab-h\)/.test(tab) && /min-height:\s*var\(--tab-h-min\)/.test(tab), 'a tab is squeezed from --tab-h to --tab-h-min, then the column scrolls');
  assert.ok(/flex:\s*none/.test(rule('.tab-index-foot')), 'the foot ("+", All tabs) never shrinks');
  assert.ok(/flex:\s*none/.test(rule('.tab-index-btn')));
});

check('css: a cut-off end of the column fades (mask, both engines), at the top, the bottom or both', () => {
  for (const sel of ['#tabs-scroll.tabs-fade-top,\n#tabs-scroll-right.tabs-fade-top', '#tabs-scroll.tabs-fade-bottom,\n#tabs-scroll-right.tabs-fade-bottom', '#tabs-scroll.tabs-fade-top.tabs-fade-bottom,\n#tabs-scroll-right.tabs-fade-top.tabs-fade-bottom']) {
    const r = rule(sel);
    assert.ok(/-webkit-mask-image:\s*linear-gradient/.test(r) && /\n\s*mask-image:\s*linear-gradient/.test(r), `${sel} sets both mask-image forms`);
  }
  assert.ok(/#tabs-scroll\.tabs-fade-top\.tabs-fade-bottom[\s\S]*?transparent 100%/.test(css), 'the two-ended fade closes at the bottom');
});

check('css: the All tabs list follows the panel tokens (docs/design/panel-template.md)', () => {
  const panel = rule('.tab-list-panel');
  // v2 P5: the list is a sticky note like the other floating panels: one of the six roots of the one face block, saying nothing of its own face
  assert.ok(!/\b(background|border|border-radius|box-shadow)\s*:/.test(panel), 'the list says nothing of its own face (background, border, radius, shadow)');
  assert.ok(/\.tab-list-panel,\s*\.status-ai-pop,\s*#slot-quick-selector\s*\{\s*background:\s*transparent;\s*border:\s*0;\s*border-radius:\s*0;\s*box-shadow:\s*var\(--note-shadow\);/.test(css), 'it is a root of the sticky-note face');
  assert.ok(/\.tab-list-panel:focus-within::before,[^{]*\{\s*--note-strip:\s*var\(--note-tape-focus\);/.test(css), 'focus inside shows on its adhesive strip, not on a frame');
  assert.ok(!/\.tab-list-panel:focus-within\s*\{[^}]*border-color/.test(css), 'the frame that took the accent while focus was inside is gone');
  assert.ok(/position:\s*fixed/.test(panel), 'it is not clipped by the header');
  assert.ok(/min-height:\s*36px/.test(rule('.tab-list-row')), 'rows are 36px');
  assert.ok(/background:\s*var\(--accent-active-bg/.test(rule('.tab-list-row:hover,\n.tab-list-row.is-cursor')));
  assert.ok(/font-weight:\s*600/.test(rule('.tab-list-row.is-current .tab-list-title')));
  const block = css.slice(css.indexOf('.tab-list-panel {'), css.indexOf('.tab-list-hint {'));
  for (const w of block.matchAll(/font-weight:\s*(\d+)/g)) assert.ok(w[1] === '400' || w[1] === '600', 'weights are 400 or 600: ' + w[1]);
  for (const s of block.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(['11', '12', '13', '14'].includes(s[1]), 'sizes come from the scale: ' + s[1]);
  assert.ok(html.includes('class="inline-prompt-badge"') && moduleSrc.includes("'inline-prompt-badge'"), 'the label is the shared badge: accent text and a divider, no fill');
});

check('strings: allTabs* exist in both languages, the English has no Japanese, the Japanese no English sentence, no emoji', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  const JAPANESE = /[\u3040-\u30ff\u4e00-\u9fff]/;
  for (const key of ['allTabsTitle', 'allTabsHead', 'allTabsUnsaved', 'allTabsHint']) {
    for (const lang of ['en', 'ja']) {
      assert.ok(typeof I18N[lang][key] === 'string' && I18N[lang][key].length > 0, `${lang}.${key}`);
      assert.ok(!EMOJI.test(I18N[lang][key]), `${lang}.${key} has no emoji`);
    }
    assert.ok(!JAPANESE.test(I18N.en[key]), `en.${key} has no Japanese`);
    assert.ok(JAPANESE.test(I18N.ja[key]), `ja.${key} is Japanese`);
    assert.notEqual(I18N.en[key], I18N.ja[key]);
  }
  assert.ok(!/[A-Za-z]/.test(I18N.ja.allTabsHint.replace(/Enter|Esc/g, '')), 'the Japanese hint keeps only the key names in English');
});

check('app.js: the tab bar tells the module what changed, in both places that change the focused tab', () => {
  const render = app.slice(app.indexOf('function renderTabs() {'), app.indexOf('// Number of "\\n" in text.substring'));
  assert.ok(/notifyTabOverflow\(\);\s*\}\s*$/.test(render.trimEnd()), 'renderTabs ends by calling it');
  assert.ok(!/refreshTabActiveClasses/.test(app), 'which page has the focus changes nothing in a strip (each strip marks the note of its own page), so no focus or click handler redraws the strips');
  assert.ok(/function focusedTabId\(\) \{\s*return paneForSelect\(\) === 'secondary' \? secondaryTabId : activeTabId;\s*\}/.test(app), 'the list of all tabs marks the note of the page you work in');
  assert.ok(/function notifyTabOverflow\(\) \{[^}]*overflow\.update\(\{ focusedIds: \[activeTabId, secondaryTabId\], count: tabs\.length \}\)/.test(app), 'each strip is told the note of its own page');
  const create = app.slice(app.indexOf('function getTabOverflow() {'), app.indexOf('function notifyTabOverflow() {'));
  assert.ok(/window\.TabOverflow \? window\.TabOverflow\.create\(/.test(create), 'a page without the module keeps working');
  assert.ok(create.includes("getElementById('tabs-scroll')") && create.includes("getElementById('tabs-scroll-right')") && create.includes("getElementById('btn-all-tabs')"));
  assert.ok(/strips,\s*panelPlacement: 'side'/.test(create), 'the module gets both strips (one list, one button) and hangs the list beside the strip');
  assert.ok(/onSelect: \(tabId\) => handleTabClick\(tabId\)/.test(create), 'choosing a tab from the list is a tab click (split panes included)');
  assert.ok(/let tabOverflow; /.test(app) && app.indexOf('let tabOverflow;') < app.indexOf('function getTabOverflow()'), 'declared early enough that no early render can hit it');
  assert.ok(app.includes("id: 'cmd_all_tabs'") && /cmdPaletteAllTabs/.test(app), 'the palette can open the list');
});

check('tab_overflow.js: nothing runs at load, nothing dynamic goes into innerHTML, no emoji', () => {
  const context = vm.createContext({});
  vm.runInContext(moduleSrc, context); // an empty world (no document, no window, no module): loading only defines TabOverflow
  assert.equal(typeof context.TabOverflow, 'object');
  assert.deepEqual(Object.keys(context.TabOverflow).sort(), ['PANEL_WIDTH', 'PEEK', 'create', 'measure', 'panelPosition', 'rowsFor', 'scrollTargetFor', 'stepIndex']);
  const assignments = moduleSrc.match(/\.innerHTML\s*=\s*[^;]+;/g) || [];
  assert.deepEqual(assignments, ['.innerHTML = CHECK_SVG;'], 'the only innerHTML is the constant check mark');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(moduleSrc.replace('●', '')), 'no emoji (the dot is the same character the tabs use)');
  assert.equal((moduleSrc.match(/createElement\(/g) || []).length, 1, 'elements are made in one helper, from text');
});

check('tab_overflow.js: create() with no elements does nothing and touches no listener', () => {
  const context = vm.createContext({});
  vm.runInContext(moduleSrc, context);
  assert.equal(context.TabOverflow.create({ doc: {}, scrollEl: null, listEl: null }), null);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of queue) {
    try {
      await fn();
      console.log('PASS: ' + name);
    } catch (err) {
      failed++;
      console.log('FAIL: ' + name + '\n  ' + (err && err.stack || err));
    }
  }
  if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log(`\n${queue.length} checks passed.`);
})();
