// Unit tests for appearance.js: the setting (normalized, unknown keys kept, the old general.theme as the accent), the colour maths of a
// self-chosen accent (contrast on both looks), the font name guard, and apply() (a fake DOM that counts its writes: the default look writes nothing).
const assert = require('assert');

global.window = global;
const A = require('./appearance.js');

// ---- the setting --------------------------------------------------------------------------------------------

(function testDefaults() {
  assert.deepStrictEqual(A.normalize(undefined), { look: 'ink', accent: 'olive', accentCustom: '', editorFont: '', bars: A.DEFAULT_BARS, autoHide: true, splitBoundary: 'dots' }, 'nothing saved is the look the app always had, with the bars as v2 draws them, auto-hide on and the dots between two pages');
  assert.deepStrictEqual(A.normalize(null), A.normalize({}));
  assert.deepStrictEqual(A.normalize('paper'), A.normalize({}), 'a value that is not an object is ignored');
  assert.deepStrictEqual(A.normalize([1, 2]), A.normalize({}));
  assert.deepStrictEqual(A.fromConfig({}), A.normalize({}));
  assert.deepStrictEqual(A.fromConfig(null), A.normalize({}));
})();

(function testInvalidValuesFallBack() {
  assert.strictEqual(A.normalize({ look: 'sepia' }).look, 'ink');
  assert.strictEqual(A.normalize({ look: 'paper' }).look, 'paper');
  assert.strictEqual(A.normalize({ accent: 'magenta' }).accent, 'olive');
  assert.strictEqual(A.normalize({ accent: 'magenta' }, 'blue').accent, 'blue', 'an accent nobody knows becomes the old theme');
  for (const a of A.ACCENTS.filter((x) => x !== 'custom')) assert.strictEqual(A.normalize({ accent: a }).accent, a);
  const custom = A.normalize({ accent: 'custom', accentCustom: '#ABCDEF' });
  assert.strictEqual(custom.accent, 'custom');
  assert.strictEqual(custom.accentCustom, '#abcdef', 'the colour is stored lower case');
  assert.strictEqual(A.normalize({ accent: 'custom', accentCustom: '#abc' }).accentCustom, '#aabbcc', 'three digits are widened');
  assert.strictEqual(A.normalize({ accent: 'custom', accentCustom: 'ff8800' }).accentCustom, '#ff8800', 'the # may be missing');
  assert.strictEqual(A.normalize({ accent: 'custom' }, 'forest').accent, 'forest', 'a custom accent without a colour is the old theme');
  assert.strictEqual(A.normalize({ accent: 'custom', accentCustom: 'not a colour' }).accent, 'olive');
  assert.strictEqual(A.normalize({ accent: 'blue', accentCustom: '#123456' }).accentCustom, '#123456', 'the colour is remembered while another accent is on');
})();

(function testBarsAndAutoHide() {
  assert.deepStrictEqual(A.BARS, ['solid', 'light', 'glass']);
  assert.ok(A.BARS.indexOf(A.DEFAULT_BARS) >= 0, 'the default is one of the three');
  for (const b of A.BARS) assert.strictEqual(A.normalize({ bars: b }).bars, b, b + ' is kept');
  assert.strictEqual(A.normalize({}).bars, A.DEFAULT_BARS, 'nothing saved: the default');
  for (const bad of ['frosted', '', 'GLASS', ' glass', null, 1, true, {}, []]) assert.strictEqual(A.normalize({ bars: bad }).bars, A.DEFAULT_BARS, 'not one of the three: ' + JSON.stringify(bad));
  assert.strictEqual(A.normalize({ autoHide: false }).autoHide, false, 'turned off stays off');
  assert.strictEqual(A.normalize({ autoHide: true }).autoHide, true);
  assert.strictEqual(A.normalize({}).autoHide, true, 'nothing saved: on');
  for (const bad of ['false', 'no', 0, 1, null, {}, []]) assert.strictEqual(A.normalize({ autoHide: bad }).autoHide, true, 'only a real boolean turns it off: ' + JSON.stringify(bad));
  // a setting saved by this version reads back as itself
  const saved = JSON.parse(JSON.stringify(A.normalize({ look: 'paper', bars: 'solid', autoHide: false })));
  assert.deepStrictEqual(A.normalize(saved), saved);
  assert.strictEqual(A.fromConfig({ appearance: { bars: 'glass', autoHide: false } }).bars, 'glass');
  assert.strictEqual(A.fromConfig({ appearance: { bars: 'glass', autoHide: false } }).autoHide, false);
})();

(function testSplitBoundary() {
  assert.deepStrictEqual(A.BOUNDARIES, ['dots', 'shade', 'line'], 'the three looks of the divider, the default first');
  assert.strictEqual(A.DEFAULT_BOUNDARY, 'dots');
  assert.ok(A.BOUNDARIES.indexOf(A.DEFAULT_BOUNDARY) >= 0, 'the default is one of the three');
  for (const b of A.BOUNDARIES) assert.strictEqual(A.normalize({ splitBoundary: b }).splitBoundary, b, b + ' is kept');
  assert.strictEqual(A.normalize({}).splitBoundary, 'dots', 'nothing saved: the dots');
  assert.strictEqual(A.normalize(undefined).splitBoundary, 'dots');
  // the plan of P4 first called the default "gutter", a stored word that is not one of the three is the default, not an error
  for (const bad of ['gutter', '', 'LINE', ' line', 'Dots', null, 1, true, {}, [], 'line; x', '"] { display:none } [x="']) {
    assert.strictEqual(A.normalize({ splitBoundary: bad }).splitBoundary, 'dots', 'not one of the three: ' + JSON.stringify(bad));
  }
  assert.strictEqual(A.fromConfig({ appearance: { splitBoundary: 'shade' } }).splitBoundary, 'shade');
  assert.strictEqual(A.fromConfig({ general: { theme: 'blue' } }).splitBoundary, 'dots', 'a config from before the setting');
  // a setting saved by this version reads back as itself, and the other keys are not touched by it
  const saved = JSON.parse(JSON.stringify(A.normalize({ look: 'paper', splitBoundary: 'line', bars: 'solid' })));
  assert.deepStrictEqual(A.normalize(saved), saved);
  assert.strictEqual(saved.look, 'paper');
  assert.strictEqual(saved.bars, 'solid');
  assert.strictEqual(A.normalize({ splitBoundary: 'line' }).bars, A.DEFAULT_BARS, 'the other settings keep their defaults');
})();

(function testLegacyTheme() {
  // config.general.theme is the accent of a config that has no appearance (every config saved before this version)
  assert.strictEqual(A.fromConfig({ general: { theme: 'blue' } }).accent, 'blue');
  assert.strictEqual(A.fromConfig({ general: { theme: 'charcoal' } }).accent, 'charcoal');
  assert.strictEqual(A.fromConfig({ general: { theme: 'olive' } }).accent, 'olive');
  assert.strictEqual(A.fromConfig({ general: { theme: 'nope' } }).accent, 'olive');
  assert.strictEqual(A.fromConfig({ general: { theme: 'blue' }, appearance: { accent: 'forest' } }).accent, 'forest', 'the appearance setting wins when it has an accent');
  assert.strictEqual(A.fromConfig({ general: { theme: 'blue' }, appearance: { look: 'paper' } }).accent, 'blue', 'an appearance without an accent keeps the old theme');
  // what an older version is told: the accent when it knows it, else what was there
  assert.strictEqual(A.legacyThemeFor({ accent: 'forest' }, 'blue'), 'forest');
  assert.strictEqual(A.legacyThemeFor({ accent: 'vermilion' }, 'blue'), 'blue', 'an accent an older version does not know leaves its theme as it was');
  assert.strictEqual(A.legacyThemeFor({ accent: 'custom' }, 'charcoal'), 'charcoal');
  assert.strictEqual(A.legacyThemeFor({ accent: 'custom' }, undefined), 'olive');
  assert.strictEqual(A.legacyThemeFor(undefined, 'blue'), 'blue');
})();

(function testUnknownKeysAreKept() {
  // later phases put their own settings into the same object (the bars and the split boundary are known now): this version must not drop them
  const raw = { look: 'paper', accent: 'blue', bars: 'glass', autoHide: false, splitBoundary: 'line', futureKey: 'later', nested: { a: [1, 2] } };
  const out = A.normalize(raw);
  assert.strictEqual(out.bars, 'glass', 'the bars are known now: kept when valid');
  assert.strictEqual(out.autoHide, false);
  assert.strictEqual(out.splitBoundary, 'line', 'the split boundary is known now: kept when valid');
  assert.strictEqual(out.futureKey, 'later', 'a key nobody knows yet is kept');
  assert.deepStrictEqual(out.nested, { a: [1, 2] });
  assert.notStrictEqual(out, raw, 'a new object: the saved one is not changed');
  assert.strictEqual(raw.accentCustom, undefined);
  const again = A.normalize(out);
  assert.deepStrictEqual(again, out, 'normalizing twice changes nothing');
  assert.strictEqual(A.fromConfig({ appearance: raw }).bars, 'glass');
})();

(function testNoPrototypePollution() {
  const raw = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": {"x": 1}, "prototype": 2, "look": "paper"}');
  const out = A.normalize(raw);
  assert.strictEqual(out.polluted, undefined);
  assert.strictEqual(({}).polluted, undefined);
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'constructor'));
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'prototype'));
  assert.strictEqual(out.look, 'paper');
})();

(function testSignature() {
  const a = A.normalize({ look: 'paper', accent: 'blue' });
  assert.strictEqual(A.signature(a), A.signature(A.normalize({ look: 'paper', accent: 'blue', futureKey: 'glass' })), 'an unknown key does not change what is painted');
  assert.strictEqual(A.signature(a), A.signature(A.normalize({ look: 'paper', accent: 'blue', splitBoundary: 'glass' })), 'a split boundary that is not one of the three is the default');
  assert.notStrictEqual(A.signature(a), A.signature(A.normalize({ look: 'paper', accent: 'blue', splitBoundary: 'line' })), 'the divider is painted');
  assert.notStrictEqual(A.signature(A.normalize({ splitBoundary: 'shade' })), A.signature(A.normalize({ splitBoundary: 'line' })));
  assert.notStrictEqual(A.signature(a), A.signature(A.normalize({ look: 'paper', accent: 'blue', bars: A.BARS.find((b) => b !== A.DEFAULT_BARS) })), 'the bars are painted');
  assert.notStrictEqual(A.signature(a), A.signature(A.normalize({ look: 'paper', accent: 'blue', autoHide: false })), 'auto-hide is part of what the window does');
  assert.notStrictEqual(A.signature(a), A.signature(A.normalize({ look: 'ink', accent: 'blue' })));
  assert.notStrictEqual(A.signature(a), A.signature(A.normalize({ look: 'paper', accent: 'forest' })));
  assert.notStrictEqual(A.signature(a), A.signature(A.normalize({ look: 'paper', accent: 'blue', editorFont: 'Consolas' })));
  const c1 = A.normalize({ accent: 'custom', accentCustom: '#112233' });
  const c2 = A.normalize({ accent: 'custom', accentCustom: '#112234' });
  assert.notStrictEqual(A.signature(c1), A.signature(c2));
  assert.strictEqual(A.signature(A.normalize({ accent: 'blue', accentCustom: '#112233' })), A.signature(A.normalize({ accent: 'blue', accentCustom: '#445566' })), 'a colour that is not used does not count');
})();

(function testMarker() {
  // the text index.html's first script reads to put the look on the page before the first paint
  assert.strictEqual(A.markerFor(A.normalize(undefined)), '', 'the default look needs none');
  assert.strictEqual(A.markerFor(undefined), '');
  assert.strictEqual(A.markerFor(A.normalize({ look: 'paper' })), 'paper|');
  assert.strictEqual(A.markerFor(A.normalize({ look: 'paper', accent: 'blue' })), 'paper|blue');
  assert.strictEqual(A.markerFor(A.normalize({ accent: 'forest' })), 'ink|forest');
  assert.strictEqual(A.markerFor(A.normalize({ accent: 'olive', look: 'ink' })), '');
  assert.strictEqual(A.markerFor(A.normalize({ accent: 'custom', accentCustom: '#336699' })), '', 'a colour of your own is computed later');
  assert.strictEqual(A.markerFor(A.normalize({ look: 'paper', accent: 'custom', accentCustom: '#336699' })), 'paper|');
  assert.strictEqual(A.markerFor(A.normalize({ look: 'paper', accent: 'vermilion', bars: 'x' })), 'paper|vermilion');
})();

// ---- the font name -------------------------------------------------------------------------------------------

(function testFontName() {
  assert.strictEqual(A.safeFontFamily('Cascadia Code'), '"Cascadia Code"');
  assert.strictEqual(A.safeFontFamily('  Fira   Code  '), '"Fira Code"', 'space is tidied');
  assert.strictEqual(A.safeFontFamily('BIZ UDゴシック'), '"BIZ UDゴシック"', 'a Japanese name passes');
  assert.strictEqual(A.safeFontFamily('MS ゴシック'), '"MS ゴシック"');
  assert.strictEqual(A.safeFontFamily(''), '');
  assert.strictEqual(A.safeFontFamily('   '), '');
  assert.strictEqual(A.safeFontFamily(undefined), '');
  assert.strictEqual(A.safeFontFamily('x'.repeat(81)), '', 'longer than 80 characters');
  assert.strictEqual(A.safeFontFamily('x'.repeat(80)), '"' + 'x'.repeat(80) + '"');
  // nothing that can leave the quotes or start another declaration or rule gets through
  for (const bad of ['Arial"; } body { display: none', "a'b", 'a\\b', 'a;b', 'a{b', 'a}b', 'url(x)', 'a<b', 'a>b', 'a:b', 'a,b', 'a\u0000b', 'a\u007fb', 'a"b']) {
    assert.strictEqual(A.safeFontFamily(bad), '', 'refused: ' + JSON.stringify(bad));
  }
  assert.strictEqual(A.safeFontFamily('a\nb\tc'), '"a b c"', 'a line break or tab inside the name is only white space');
  assert.strictEqual(A.normalize({ editorFont: 'Consolas' }).editorFont, 'Consolas', 'the name is stored as typed, without quotes');
  assert.strictEqual(A.normalize({ editorFont: 'Bad;Name' }).editorFont, '', 'a refused name is not stored');
  assert.strictEqual(A.normalize({ editorFont: 42 }).editorFont, '');
  assert.strictEqual(A.normalize({ editorFont: '  Menlo ' }).editorFont, 'Menlo');
  assert.ok(A.EDITOR_STACK.endsWith('monospace'), 'the stack ends in a generic family');
})();

// ---- the colour maths -----------------------------------------------------------------------------------------

(function testColourBasics() {
  assert.strictEqual(A.normHex('#ABC'), '#aabbcc');
  assert.strictEqual(A.normHex(''), '');
  assert.strictEqual(A.normHex('#12345'), '');
  assert.strictEqual(A.normHex('#12345g'), '');
  assert.strictEqual(A.normHex(undefined), '');
  assert.deepStrictEqual(A.hexToRgb('#ff8000'), [255, 128, 0]);
  assert.strictEqual(A.rgbToHex([255, 128, 0]), '#ff8000');
  assert.strictEqual(A.rgbToHex([300, -4, 0.4]), '#ff0000', 'out of range values are clamped');
  assert.ok(Math.abs(A.contrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.ok(Math.abs(A.contrast('#ffffff', '#ffffff') - 1) < 1e-9);
  assert.ok(Math.abs(A.contrast('#767676', '#ffffff') - 4.54) < 0.01, 'the well known 4.54:1 grey');
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#556b2f', '#808080', '#123456']) {
    const back = A.hslToRgb.apply(null, A.rgbToHsl(A.hexToRgb(hex)));
    assert.strictEqual(A.rgbToHex(back), hex, 'HSL round trip of ' + hex);
  }
})();

const SAMPLES = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#808080', '#556b2f', '#007acc', '#2e6656',
  '#b8472c', '#fff8dc', '#101010', '#f5f5f5', '#7f7f00', '#ffcc00', '#3366ff', '#d946ef', '#ff6600', '#00b894', '#8e44ad'];
const PAPER_PAGE = '#fbfbf9';
const PAPER_DARK = '#d9d9d3';
const INK_PAGE = '#1e1e1e';
const INK_LIGHT = '#3c3c3c';
const chan = (v) => v.split(' ').map(Number);

(function testCustomAccentContrastInk() {
  const bad = [];
  for (const hex of SAMPLES) {
    const t = A.customAccent(hex, 'ink');
    assert.ok(t, hex + ' gives tokens');
    assert.strictEqual(t['--accent-color'], hex, 'the chosen colour is the fill on ink, as it is');
    const check = (what, ratio, min) => { if (ratio < min) bad.push('ink ' + hex + ' ' + what + ' ' + ratio.toFixed(2) + ' < ' + min); };
    check('text on the fill', A.contrast(t['--text-on-accent'], t['--accent-color']), 4.5);
    check('label on the lightest surface', A.contrast(t['--accent-label'], INK_LIGHT), 4.5);
    check('hover on the page', A.contrast(t['--accent-hover'], INK_PAGE), 4.5);
    check('white on the selected row', A.contrast('#ffffff', t['--accent-active-bg']), 7);
    check('white on the status bar', A.contrast('#ffffff', t['--bg-statusbar']), 7);
    check('white on the menu hover', A.contrast('#ffffff', t['--bg-context-hover']), 4.5);
    assert.deepStrictEqual(chan(t['--accent-rgb']).map((v) => v), A.hexToRgb(t['--accent-hover']), 'on ink --accent-rgb is the colour of --accent-hover');
    assert.deepStrictEqual(chan(t['--bar-bottom-rgb']), A.hexToRgb(t['--bg-statusbar']), '--bar-bottom-rgb is the status bar colour');
    assert.ok(/^#[0-9a-f]{6}$/.test(t['--text-on-accent']) && t['--text-badge'] === t['--text-on-accent']);
    assert.ok(/^radial-gradient\(circle, rgba\(\d+, \d+, \d+, 0\.15\) 0%, rgba\(\d+, \d+, \d+, 0\.07\) 45%, rgba\(\d+, \d+, \d+, 0\) 75%\)$/.test(t['--aura-gradient']), 'the aura: ' + t['--aura-gradient']);
  }
  assert.deepStrictEqual(bad, [], 'a self-chosen accent stays readable on ink:\n  ' + bad.join('\n  '));
})();

// A sticky note's paper on ink is the sheet with the accent laid over it at --note-tint-a (css/tokens.css, 0.12): a very bright accent would lift
// the paper until the supporting text on it falls under 4.5:1, so a self-chosen accent thins the tint, and only when it has to.
(function testCustomAccentNoteTint() {
  const SHEET = [37, 37, 38];
  const MUTED = [157, 157, 157];
  const bad = [];
  for (const hex of SAMPLES) {
    const t = A.customAccent(hex, 'ink');
    const a = t['--note-tint-a'] === undefined ? 0.12 : parseFloat(t['--note-tint-a']);
    assert.ok(a >= 0.02 && a <= 0.12, hex + ': the tint is between 2% and 12%: ' + a);
    const rgb = chan(t['--accent-rgb']);
    const paper = SHEET.map((v, i) => v * (1 - a) + rgb[i] * a);
    const r = A.contrast(MUTED, paper);
    if (r < 4.5) bad.push('ink ' + hex + ' the supporting text on a note ' + r.toFixed(2) + ' < 4.5 at a tint of ' + a);
  }
  assert.deepStrictEqual(bad, [], 'a self-chosen accent leaves the supporting text of a note readable on ink:\n  ' + bad.join('\n  '));
  assert.ok(A.customAccent('#ffffff', 'ink')['--note-tint-a'] !== undefined, 'a white accent thins the tint');
  assert.ok(A.customAccent('#ffff00', 'ink')['--note-tint-a'] !== undefined, 'so does a pure yellow');
  assert.strictEqual(A.customAccent('#556b2f', 'ink')['--note-tint-a'], undefined, 'an ordinary colour leaves the strength to the style sheet');
  assert.strictEqual(A.customAccent('#ffffff', 'paper')['--note-tint-a'], undefined, 'paper never needs it');
})();

(function testCustomAccentContrastPaper() {
  const bad = [];
  for (const hex of SAMPLES) {
    const t = A.customAccent(hex, 'paper');
    assert.ok(t, hex + ' gives tokens');
    const check = (what, ratio, min) => { if (ratio < min) bad.push('paper ' + hex + ' ' + what + ' ' + ratio.toFixed(2) + ' < ' + min); };
    check('text on the fill', A.contrast(t['--text-on-accent'], t['--accent-color']), 4.5);
    check('the fill as text on the page', A.contrast(t['--accent-color'], PAPER_PAGE), 4.5);
    check('hover as text on the page', A.contrast(t['--accent-hover'], PAPER_PAGE), 4.5);
    check('label on the darkest surface', A.contrast(t['--accent-label'], PAPER_DARK), 4.5);
    check('ink on the selected row', A.contrast('#0b0c10', t['--accent-active-bg']), 7);
    check('ink on the menu hover', A.contrast('#0b0c10', t['--bg-context-hover']), 7);
    assert.deepStrictEqual(chan(t['--accent-rgb']), A.hexToRgb(t['--accent-color']), 'on paper --accent-rgb is the colour of --accent-color');
    assert.strictEqual(t['--bg-statusbar'], undefined, 'the paper status bar is neutral: a custom accent does not paint it');
    assert.strictEqual(t['--bar-bottom-rgb'], undefined);
    assert.ok(A.contrast(t['--accent-label'], PAPER_PAGE) >= 4.5);
  }
  assert.deepStrictEqual(bad, [], 'a self-chosen accent stays readable on paper:\n  ' + bad.join('\n  '));
  assert.strictEqual(A.customAccent('#556b2f', 'paper')['--accent-color'], '#556b2f', 'a colour that is dark enough is kept as chosen');
  assert.notStrictEqual(A.customAccent('#ffff00', 'paper')['--accent-color'], '#ffff00', 'a pale colour is darkened on paper (it is also text there)');
})();

(function testCustomAccentNotAColour() {
  assert.strictEqual(A.customAccent('', 'ink'), null);
  assert.strictEqual(A.customAccent('red', 'paper'), null);
  assert.strictEqual(A.customAccent(undefined, 'ink'), null);
})();

// ---- apply: a fake DOM that counts its writes -----------------------------------------------------------------

function makeDoc(opts) {
  opts = opts || {};
  const log = [];
  const mkEl = (name, classes, attrsInit) => {
    const set = new Set(classes || []);
    const props = new Map();
    const attrs = new Map(attrsInit || []);
    return {
      name,
      classList: {
        contains: (c) => set.has(c),
        add: (c) => { set.add(c); log.push(name + '+' + c); },
        remove: (c) => { set.delete(c); log.push(name + '-' + c); }
      },
      style: {
        setProperty: (k, v) => { props.set(k, v); log.push(name + ' set ' + k); },
        removeProperty: (k) => { props.delete(k); log.push(name + ' unset ' + k); },
        getPropertyValue: (k) => props.get(k) || ''
      },
      _classes: set,
      _props: props,
      _attrs: attrs,
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => { attrs.set(k, v); log.push(name + ' attr ' + k + '=' + v); },
      removeAttribute: (k) => { attrs.delete(k); log.push(name + ' unattr ' + k); }
    };
  };
  const metas = { 'meta[name="color-scheme"]': { v: 'dark' }, 'meta[name="theme-color"]': { v: '#000001' } };
  const meta = (m) => ({
    getAttribute: () => m.v,
    setAttribute: (k, v) => { m.v = v; log.push('meta ' + k + '=' + v); }
  });
  const body = mkEl('body', ['dark-theme', 'theme-olive'], [['data-bars', A.DEFAULT_BARS]]); // index.html ships the default in its markup
  const root = mkEl('html');
  const doc = {
    body, documentElement: root, log, metas,
    querySelector: (sel) => (metas[sel] ? meta(metas[sel]) : null)
  };
  if (opts.noMeta) doc.querySelector = () => null;
  return doc;
}

(function testDefaultLookWritesNothing() {
  delete require.cache[require.resolve('./appearance.js')];
  const A2 = require('./appearance.js');
  const doc = makeDoc();
  const changed = A2.apply(doc, A2.normalize(undefined));
  assert.deepStrictEqual(changed, { look: false, accent: false, font: false, bars: false, boundary: false });
  assert.deepStrictEqual(doc.log, [], 'ink, Dark Olive and no font: the page already is that, nothing is written');
  assert.deepStrictEqual(A2.apply(doc, undefined), { look: false, accent: false, font: false, bars: false, boundary: false }, 'no setting at all is the default');
  assert.deepStrictEqual(doc.log, []);
})();

(function testApplySequence() {
  delete require.cache[require.resolve('./appearance.js')];
  const A2 = require('./appearance.js');
  const doc = makeDoc();
  // paper + blue
  let changed = A2.apply(doc, A2.normalize({ look: 'paper', accent: 'blue' }));
  assert.deepStrictEqual(changed, { look: true, accent: true, font: false, bars: false, boundary: false });
  assert.ok(doc.body._classes.has('look-paper') && doc.documentElement._classes.has('look-paper'), 'the look is on <body> and on <html> (the canvas)');
  assert.ok(doc.body._classes.has('theme-blue') && !doc.body._classes.has('theme-olive'));
  assert.ok(doc.body._classes.has('dark-theme'), 'the base class stays');
  assert.strictEqual(doc.metas['meta[name="color-scheme"]'].v, 'light', 'the engine is told the page is light');
  assert.strictEqual(doc.body._props.size, 0, 'a built-in accent sets no custom property');
  // the same again: nothing to write
  const n = doc.log.length;
  changed = A2.apply(doc, A2.normalize({ look: 'paper', accent: 'blue' }));
  assert.deepStrictEqual(changed, { look: false, accent: false, font: false, bars: false, boundary: false });
  assert.strictEqual(doc.log.length, n, 'applying the same setting writes nothing');
  // an unknown key changes nothing
  A2.apply(doc, A2.normalize({ look: 'paper', accent: 'blue', futureKey: 'line' }));
  assert.strictEqual(doc.log.length, n);
  // the bars: one attribute on <body>, written when it differs, nothing more
  const other = A2.BARS.find((b) => b !== A2.DEFAULT_BARS);
  changed = A2.apply(doc, A2.normalize({ look: 'paper', accent: 'blue', bars: other }));
  assert.deepStrictEqual(changed, { look: false, accent: false, font: false, bars: true, boundary: false });
  assert.strictEqual(doc.body.getAttribute('data-bars'), other);
  const m = doc.log.length;
  assert.strictEqual(A2.apply(doc, A2.normalize({ look: 'paper', accent: 'blue', bars: other })).bars, false, 'the same bars again: nothing to write');
  assert.strictEqual(doc.log.length, m);
  changed = A2.apply(doc, A2.normalize({ look: 'paper', accent: 'blue' }));
  assert.strictEqual(changed.bars, true, 'back to the default (an absent value is the default)');
  assert.strictEqual(doc.body.getAttribute('data-bars'), A2.DEFAULT_BARS);
  assert.strictEqual(doc.log.length, m + 1);
  // a value that is not one of the three never reaches the page, even handed to apply() without normalizing
  A2.apply(doc, { look: 'paper', accent: 'blue', editorFont: '', bars: '"] { display:none } [x="' });
  assert.strictEqual(doc.body.getAttribute('data-bars'), A2.DEFAULT_BARS);
  // vermilion
  changed = A2.apply(doc, A2.normalize({ look: 'paper', accent: 'vermilion' }));
  assert.deepStrictEqual(changed, { look: false, accent: true, font: false, bars: false, boundary: false });
  assert.ok(doc.body._classes.has('theme-vermilion') && !doc.body._classes.has('theme-blue'));
  // custom: properties are set on <body>
  changed = A2.apply(doc, A2.normalize({ look: 'paper', accent: 'custom', accentCustom: '#336699' }));
  assert.strictEqual(changed.accent, true);
  assert.ok(doc.body._classes.has('theme-custom') && !doc.body._classes.has('theme-vermilion'));
  assert.ok(doc.body._props.has('--accent-color') && doc.body._props.has('--accent-rgb') && doc.body._props.has('--text-on-accent'), 'the custom accent sets its properties');
  const paperProps = Array.from(doc.body._props.keys());
  // the same custom colour on ink: the properties are set again for the look, those the ink look needs and paper did not are added
  changed = A2.apply(doc, A2.normalize({ look: 'ink', accent: 'custom', accentCustom: '#336699' }));
  assert.deepStrictEqual([changed.look, changed.accent], [true, true]);
  assert.ok(!doc.body._classes.has('look-paper') && !doc.documentElement._classes.has('look-paper'));
  assert.strictEqual(doc.metas['meta[name="color-scheme"]'].v, 'dark');
  assert.ok(doc.body._props.has('--bg-statusbar') && doc.body._props.has('--bar-bottom-rgb'), 'the ink look gives the status bar the accent');
  assert.ok(paperProps.length > 0);
  // back to a built-in accent: every custom property is taken off
  changed = A2.apply(doc, A2.normalize({ look: 'ink', accent: 'forest' }));
  assert.strictEqual(changed.accent, true);
  assert.strictEqual(doc.body._props.size, 0, 'a built-in accent leaves no custom property behind');
  assert.ok(doc.body._classes.has('theme-forest') && !doc.body._classes.has('theme-custom'));
  // a custom accent while paper -> ink -> paper never leaves a property of the other look
  A2.apply(doc, A2.normalize({ look: 'ink', accent: 'custom', accentCustom: '#336699' }));
  A2.apply(doc, A2.normalize({ look: 'paper', accent: 'custom', accentCustom: '#336699' }));
  assert.ok(!doc.body._props.has('--bg-statusbar'), 'the property only the ink look sets is taken off when the look changes');
  A2.apply(doc, A2.normalize({ look: 'paper', accent: 'olive' }));
  assert.strictEqual(doc.body._props.size, 0);
})();

(function testApplyBoundary() {
  delete require.cache[require.resolve('./appearance.js')];
  const A2 = require('./appearance.js');
  const doc = makeDoc();
  const attr = () => doc.body.getAttribute('data-boundary');
  // the page ships without the attribute, and that is the dots: the default writes nothing (at start-up, or when applied again)
  assert.strictEqual(attr(), null, 'index.html carries no data-boundary');
  assert.strictEqual(A2.apply(doc, A2.normalize({ splitBoundary: 'dots' })).boundary, false);
  assert.strictEqual(A2.apply(doc, A2.normalize(undefined)).boundary, false);
  assert.strictEqual(A2.apply(doc, undefined).boundary, false);
  assert.deepStrictEqual(doc.log, [], 'dots on a page that has none: nothing is written');
  // shade and line set it on <body>; the dots take it off again
  let changed = A2.apply(doc, A2.normalize({ splitBoundary: 'shade' }));
  assert.deepStrictEqual(changed, { look: false, accent: false, font: false, bars: false, boundary: true });
  assert.strictEqual(attr(), 'shade');
  let n = doc.log.length;
  assert.strictEqual(A2.apply(doc, A2.normalize({ splitBoundary: 'shade' })).boundary, false, 'the same again: nothing to write');
  assert.strictEqual(doc.log.length, n);
  changed = A2.apply(doc, A2.normalize({ splitBoundary: 'line' }));
  assert.strictEqual(changed.boundary, true);
  assert.strictEqual(attr(), 'line');
  changed = A2.apply(doc, A2.normalize({ splitBoundary: 'dots' }));
  assert.strictEqual(changed.boundary, true, 'back to the dots');
  assert.strictEqual(attr(), null, 'the dots are no attribute at all (the CSS default)');
  assert.ok(doc.log.some((l) => l === 'body unattr data-boundary'), 'it is taken off, not set to a word the CSS does not know');
  n = doc.log.length;
  A2.apply(doc, A2.normalize({ splitBoundary: 'dots' }));
  assert.strictEqual(doc.log.length, n, 'and the dots again write nothing');
  // an unknown word never reaches the page, even when apply() is handed it without normalizing
  A2.apply(doc, { look: 'ink', accent: 'olive', splitBoundary: '"] { display:none } [x="' });
  assert.strictEqual(attr(), null);
  A2.apply(doc, A2.normalize({ splitBoundary: 'line' }));
  A2.apply(doc, { look: 'ink', accent: 'olive', splitBoundary: 'gutter' });
  assert.strictEqual(attr(), null, 'an unknown word is the default: the attribute goes');
  // it does not disturb the bars, the look or the font
  A2.apply(doc, A2.normalize({ look: 'paper', accent: 'blue', bars: 'solid', splitBoundary: 'line' }));
  assert.strictEqual(doc.body.getAttribute('data-bars'), 'solid');
  assert.strictEqual(attr(), 'line');
  assert.ok(doc.body._classes.has('theme-blue'));
  // a body that cannot take attributes is left alone (the hand-made DOMs of the app's own tests)
  const bare = { body: { classList: { contains: () => false, add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} } }, documentElement: { classList: { contains: () => false, add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} } } };
  assert.doesNotThrow(() => A2.apply(bare, A2.normalize({ splitBoundary: 'line' })));
})();

(function testApplyFont() {
  delete require.cache[require.resolve('./appearance.js')];
  const A2 = require('./appearance.js');
  const doc = makeDoc();
  let changed = A2.apply(doc, A2.normalize({ editorFont: 'Fira Code' }));
  assert.deepStrictEqual(changed, { look: false, accent: false, font: true, bars: false, boundary: false });
  const value = doc.documentElement._props.get('--editor-font-user');
  assert.ok(value.startsWith('"Fira Code", '), 'the chosen font comes first: ' + value);
  assert.ok(value.endsWith(A2.EDITOR_STACK), 'the editor\'s own list follows, so a missing glyph falls back as before');
  const n = doc.log.length;
  assert.strictEqual(A2.apply(doc, A2.normalize({ editorFont: 'Fira Code' })).font, false);
  assert.strictEqual(doc.log.length, n, 'the same font again writes nothing');
  changed = A2.apply(doc, A2.normalize({ editorFont: 'Menlo' }));
  assert.strictEqual(changed.font, true);
  assert.ok(doc.documentElement._props.get('--editor-font-user').startsWith('"Menlo", '));
  changed = A2.apply(doc, A2.normalize({ editorFont: '' }));
  assert.strictEqual(changed.font, true);
  assert.strictEqual(doc.documentElement._props.size, 0, 'an empty font takes the property off: the editor is back to its own list');
  // an invalid font never reaches the page, even if it is handed to apply() without normalizing
  A2.apply(doc, { look: 'ink', accent: 'olive', editorFont: 'x"; } body { display: none; /*' });
  assert.strictEqual(doc.documentElement._props.size, 0);
})();

(function testApplyIsSafeWithoutAPage() {
  delete require.cache[require.resolve('./appearance.js')];
  const A2 = require('./appearance.js');
  assert.deepStrictEqual(A2.apply({}, A2.normalize({ look: 'paper' })), { look: false, accent: false, font: false, bars: false, boundary: false }, 'a document without a body is left alone');
  const doc = makeDoc({ noMeta: true });
  A2.apply(doc, A2.normalize({ look: 'paper' })); // no <meta>: must not throw
  assert.ok(doc.body._classes.has('look-paper'));
})();

console.log('appearance tests passed');
