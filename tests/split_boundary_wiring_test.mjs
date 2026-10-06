// v2 P4b: the setting that picks how the divider between two pages looks (appearance.splitBoundary: dots | shade | line), wired from the
// setting to the page and back. (The values and the attribute are frontend/js/appearance_test.js; the save -> load -> save round trip is
// tests/appearance_roundtrip_test.mjs; the pixels of the three looks are in tests/smoke/117_split_boundary.mjs and were looked at in the
// real app.)
//
//   1. index.html: the page ships WITHOUT <body data-boundary> (dots is no attribute, so the default writes nothing at start-up), and the
//      Settings > Appearance section has <select id="cfg-split-boundary"> offering exactly the values the setting knows, in order, each with
//      its own label; the label, the three option names and the hint exist in English and Japanese (no Japanese in English, no emoji).
//   2. app.js: the dialog reads the control over the saved setting, shows the saved value, and previews a change at once through the same
//      path as the other Appearance controls (Cancel restores through applyTheme).
//   3. style.css: every value the CSS answers (body[data-boundary="..."]) is a value of the setting, and every value other than the default
//      is answered. Dots, the default, is the CSS without the attribute: nothing may answer data-boundary="dots".
//   4. the mutation check: each check fails on a copy of the file broken the way it is meant to catch.
//
// Node only. Run: node tests/split_boundary_wiring_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
global.window = global;
const Appearance = require('../frontend/js/appearance.js');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SRC = {
  html: read('frontend/index.html'),
  style: read('frontend/css/style.css'),
  app: read('frontend/js/app.js'),
  i18n: read('frontend/js/i18n.js')
};
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const KEYS = ['splitBoundaryLabel', 'splitBoundaryHint'].concat(Appearance.BOUNDARIES.map((b) => 'splitBoundary' + cap(b)));

function problems(src) {
  const p = [];
  const I18N = new Function(src.i18n + '\nreturn I18N;')();

  // 1. the page
  const body = /<body[^>]*>/.exec(src.html);
  if (!body) p.push('index.html has no <body>');
  else if (/data-boundary/.test(body[0])) p.push('index.html ships data-boundary: the default (dots) must be no attribute, so that the default writes nothing: ' + body[0]);
  const sel = /<select id="cfg-split-boundary"[^>]*>([\s\S]*?)<\/select>/.exec(src.html);
  if (!sel) p.push('the select #cfg-split-boundary is missing');
  else {
    const values = [...sel[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    if (JSON.stringify(values) !== JSON.stringify(Appearance.BOUNDARIES)) p.push('the options are ' + JSON.stringify(values) + ', the setting knows ' + JSON.stringify(Appearance.BOUNDARIES));
    for (const b of Appearance.BOUNDARIES) {
      if (!new RegExp('<option value="' + b + '" data-i18n="splitBoundary' + cap(b) + '"').test(sel[1])) p.push('the option ' + b + ' is not labelled with splitBoundary' + cap(b));
    }
  }
  if (!/<label for="cfg-split-boundary" data-i18n="splitBoundaryLabel"/.test(src.html)) p.push('the select has no label that points at it');
  const at = (id) => src.html.indexOf('id="' + id + '"');
  if (!(at('cfg-split-boundary') > at('cfg-auto-hide') && at('cfg-split-boundary') < at('cfg-mermaid-tone'))) p.push('the select does not sit in the Appearance section (after the auto-hide switch, before the diagram colours)');
  if (!/data-i18n="splitBoundaryHint"/.test(src.html)) p.push('the hint is not in the page');
  for (const key of KEYS) {
    for (const lang of ['en', 'ja']) {
      const v = I18N[lang] && I18N[lang][key];
      if (typeof v !== 'string' || v.length < 2) p.push(key + ' is missing in ' + lang);
      else if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(v)) p.push(key + ' has an emoji in ' + lang);
    }
    if (I18N.en[key] && /[぀-ヿ㐀-鿿]/.test(I18N.en[key])) p.push(key + ': the English text has Japanese in it');
    if (!src.html.includes('data-i18n="' + key + '"')) p.push(key + ' is not used in index.html');
  }

  // 2. the dialog
  const need = (re, what) => { if (!re.test(src.app)) p.push('app.js: ' + what); };
  need(/if \(el\('cfg-split-boundary'\)\) next\.splitBoundary = el\('cfg-split-boundary'\)\.value;/, 'readAppearanceControls does not read the divider');
  need(/if \(el\('cfg-split-boundary'\)\) el\('cfg-split-boundary'\)\.value = ap\.splitBoundary;/, 'showAppearanceControls does not show the saved divider');
  need(/if \(el\('cfg-split-boundary'\)\) el\('cfg-split-boundary'\)\.onchange = previewAppearance;/, 'a change of the divider is not previewed at once');
  need(/if \(themeChanged \|\| appearancePreviewing\) applyTheme\(\);/, 'Cancel does not put the saved setting back');

  // 3. the CSS
  const css = noComments(src.style);
  const cssValues = [...new Set([...css.matchAll(/\[data-boundary="([^"]*)"\]/g)].map((m) => m[1]))];
  for (const v of cssValues) if (Appearance.BOUNDARIES.indexOf(v) < 0) p.push('style.css answers data-boundary="' + v + '", which the setting does not know');
  if (cssValues.indexOf(Appearance.DEFAULT_BOUNDARY) >= 0) p.push('style.css answers data-boundary="' + Appearance.DEFAULT_BOUNDARY + '": the default is the page without the attribute');
  for (const b of Appearance.BOUNDARIES) {
    if (b !== Appearance.DEFAULT_BOUNDARY && cssValues.indexOf(b) < 0) p.push('style.css does not answer data-boundary="' + b + '"');
  }
  // an attribute that is only present (no value) would also show the dots' CSS as something else
  if (/\[data-boundary\]/.test(css)) p.push('style.css reads [data-boundary] without a value');
  return p;
}

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS: ' + name); } catch (e) { failed++; console.log('FAIL: ' + name + '\n  ' + (e && e.message)); }
}

check('the divider setting is wired from index.html and i18n through the dialog (app.js) to the CSS', () => {
  assert.deepEqual(problems(SRC), [], 'the wiring is wrong');
});

check('the setting, the page and the CSS agree on the names (a rename in one place shows here)', () => {
  assert.deepEqual(Appearance.BOUNDARIES, ['dots', 'shade', 'line']);
  assert.equal(Appearance.DEFAULT_BOUNDARY, 'dots');
  assert.equal(KEYS.length, 5);
});

// ---- the mutation check ------------------------------------------------------------------------------------------------------------------
check('mutation check: each of these breakages of the wiring is caught', () => {
  assert.deepEqual(problems(SRC), [], 'the real files pass (the premise of the mutations)');
  const MUTATIONS = [
    ['html', 'the page ships a divider look', /<body class="dark-theme theme-olive"/, '<body data-boundary="line" class="dark-theme theme-olive"'],
    ['html', 'the select is gone', /<select id="cfg-split-boundary"/, '<select id="cfg-split-x"'],
    ['html', 'an option is missing', /\s*<option value="shade" data-i18n="splitBoundaryShade">[^<]*<\/option>/, ''],
    ['html', 'the options are in another order', /(<option value="dots"[^>]*>[^<]*<\/option>)(\s*)(<option value="shade"[^>]*>[^<]*<\/option>)/, '$3$2$1'],
    ['html', 'an option has no label key', /<option value="line" data-i18n="splitBoundaryLine"/, '<option value="line"'],
    ['html', 'the label does not point at the select', /<label for="cfg-split-boundary"/, '<label for="cfg-split-x"'],
    ['html', 'the hint is gone from the page', /<small data-i18n="splitBoundaryHint">[^<]*<\/small>/, ''],
    ['i18n', 'the English hint is missing', /\n    splitBoundaryHint: "The divider[^\n]*/, ''],
    ['i18n', 'the Japanese label is missing', /\n    splitBoundaryLabel: "2つのページの仕切り:",/, ''],
    ['i18n', 'the English label has Japanese in it', /splitBoundaryShade: "Shadow only"/, 'splitBoundaryShade: "影だけ"'],
    ['app', 'the dialog does not read the divider', /if \(el\('cfg-split-boundary'\)\) next\.splitBoundary = el\('cfg-split-boundary'\)\.value;/, ''],
    ['app', 'the dialog does not show the saved divider', /if \(el\('cfg-split-boundary'\)\) el\('cfg-split-boundary'\)\.value = ap\.splitBoundary;/, ''],
    ['app', 'a change is not previewed', /if \(el\('cfg-split-boundary'\)\) el\('cfg-split-boundary'\)\.onchange = previewAppearance;/, ''],
    ['style', 'the line look is not answered', /body\[data-boundary="line"\] \.pane-resizer \{/g, 'body[data-boundary="thin"] .pane-resizer {'],
    ['style', 'the shade look is not answered', /body\[data-boundary="shade"\]/g, 'body[data-boundary="shadow"]'],
    ['style', 'the dots get a rule of their own', /body\[data-boundary="shade"\]/, 'body[data-boundary="dots"] .pane-resizer { top: 0; }\nbody[data-boundary="shade"]']
  ];
  const missed = [];
  for (const [file, name, find, replace] of MUTATIONS) {
    const mutated = SRC[file].replace(find, replace);
    if (mutated === SRC[file]) { missed.push('target missing (the mutation no longer applies): ' + name); continue; }
    if (problems(Object.assign({}, SRC, { [file]: mutated })).length === 0) missed.push('SURVIVED: ' + name);
  }
  assert.deepEqual(missed, [], 'the checks do not catch:\n  ' + missed.join('\n  '));
});

console.log(failed ? '\n' + failed + ' split boundary wiring check(s) FAILED' : '\nAll split boundary wiring checks passed!');
if (failed) process.exit(1);
