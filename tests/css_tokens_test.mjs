// v2 phase P1a: every colour of the app is a token (frontend/css/tokens.css) and nothing else writes one.
//
// What is locked:
//   1. frontend/css/style.css and every other style sheet in frontend/css/ except tokens.css and print.css (the printed page
//      keeps its own paper colours on purpose) contain no colour literal: no #hex, rgb()/rgba()/hsl()/hsla()/color(), no named
//      colour, no %23hex inside a data: URL. (transparent, currentColor, inherit and the system colour keywords are not literals.)
//   2. index.html has none in an inline style="", in a <style> block or in a paint attribute (fill="#..."); the one
//      exception is the <meta name="theme-color">, which cannot hold a var().
//   3. The scripts of the page (frontend/js, not the tests) write none either, except the lines in ALLOWED_JS below, each
//      with the reason: a colour that is not the app's own look (text of an AI prompt) or that a library parses itself.
//   4. Every var(--name) that CSS, HTML and scripts use is defined (a typo would silently draw nothing), every token a look
//      (body.theme-*) sets is also set by the base block body.dark-theme, and tokens.css is linked before style.css.
//   5. The system colours (Canvas, CanvasText, Highlight, ButtonText, GrayText, LinkText ...) are not literals, but they are written only inside
//      @media (forced-colors: active) (Windows high contrast, css/chrome.css last section), in every style sheet; anywhere else they are a finding.
//   6. The scanners work: the same scanners find a colour that is written into a copy of the real files (the mutation check).
//
// Node only, no browser. Run: node tests/css_tokens_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const lf = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => lf(fs.readFileSync(p, 'utf8'));

// ---- the scanners -----------------------------------------------------------------------------------------------

const NAMED = ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
  'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
  'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey ' +
  'darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
  'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen ' +
  'lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
  'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
  'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
  'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
  'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown ' +
  'salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle ' +
  'tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' ');
const HEX = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\\w-])';
// A colour function is a literal, except rgb(var(--x-rgb) / alpha): its colour is a channel token (css/tokens.css), only the alpha is written
// (contract 1.5: the way to make a tint without color-mix()). `rgb(var(--a) 1 2 / 0.5)` or `rgb(1 2 3)` are still literals.
const FUNC = '\\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\\((?!\\s*var\\(\\s*--[\\w-]+\\s*\\)\\s*(?:\\/|\\)))';
const ENCODED = '%23(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\\w-])';
const LITERAL = new RegExp(HEX + '|' + FUNC + '|' + ENCODED, 'g');
const NAMED_RE = new RegExp('(?<![\\w#%.-])(?:' + NAMED.join('|') + ')(?![\\w-])', 'gi');
// properties whose value can be a colour: a named colour is only looked for there ("white-space: nowrap" is not one)
const COLOUR_PROP = /^(?:-webkit-)?(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color|fill|stroke|stop-color|flood-color|column-rule(?:-color)?|scrollbar-color|-webkit-text-fill-color|-webkit-tap-highlight-color|mask(?:-image)?|filter|drop-shadow)$/;

const blank = (s) => s.replace(/[^\n]/g, ' ');
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, blank);
const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;

// The colour literals in the declarations of a style sheet (or the text of a style attribute / <style> block).
function cssLiterals(css) {
  const text = stripCssComments(lf(css));
  const found = [];
  const seg = /([^{};]*)([{};]|$)/g;
  let m;
  while ((m = seg.exec(text)) !== null) {
    if (m[0] === '') { seg.lastIndex++; continue; }
    if (m[2] === '{') continue; // a selector or an at-rule prelude
    const colon = m[1].indexOf(':');
    if (colon === -1) continue;
    const prop = m[1].slice(0, colon).trim().toLowerCase();
    const valueStart = m.index + colon + 1;
    const value = m[1].slice(colon + 1);
    if (prop.startsWith('--')) continue; // a token definition lives in tokens.css; nothing else defines one with a colour
    if (prop === 'content' || prop === 'quotes' || prop === 'font-family') continue; // text, not paint
    for (const hit of value.matchAll(LITERAL)) found.push({ line: lineOf(text, valueStart + hit.index), text: hit[0], where: prop });
    if (COLOUR_PROP.test(prop)) {
      const unquoted = value.replace(/"[^"]*"|'[^']*'/g, blank);
      for (const hit of unquoted.matchAll(NAMED_RE)) found.push({ line: lineOf(text, valueStart + hit.index), text: hit[0], where: prop });
    }
  }
  // a colour written inside a custom property is a literal as well, unless it is in tokens.css (which is not scanned)
  for (const hit of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*)/g)) {
    for (const lit of hit[2].matchAll(LITERAL)) found.push({ line: lineOf(text, hit.index), text: lit[0], where: hit[1] });
  }
  return found;
}

// The system colours (CSS Color 4: Canvas, CanvasText, Highlight ...) are not literals: they are the person's own palette, and the only time
// the app writes one is for forced colours (Windows high contrast), where every colour of the page is replaced by one of them anyway. So they
// are allowed inside @media (forced-colors: active), and nowhere else: a system colour in an ordinary rule would paint the window in the
// operating system's colours in normal use (css/chrome.css, the last section).
const SYSTEM_COLOURS = 'Canvas CanvasText LinkText VisitedText ActiveText ButtonFace ButtonText ButtonBorder Field FieldText GrayText Highlight HighlightText SelectedItem SelectedItemText Mark MarkText AccentColor AccentColorText'.split(' ');
const SYSTEM_RE = new RegExp('(?<![\\w#%.-])(?:' + SYSTEM_COLOURS.join('|') + ')(?![\\w-])', 'i');
const FORCED_BLOCK = /^@media\s*\(\s*forced-colors\s*:\s*active\s*\)$/i;

// Every declaration of a style sheet with the at-rules it is inside: [{ prop, value, line, atrules: ['@media (forced-colors: active)', ...] }].
// (A block that opens with a selector is read to its closing brace; a block that opens with @ is a context for what follows.)
function contextualDecls(css) {
  const text = stripCssComments(lf(css));
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (prelude.startsWith('@')) { stack.push(prelude); continue; }
      let depth = 0, quote = '', j = i + 1, start = j;
      const flush = (end) => {
        const decl = text.slice(start, end);
        const colon = decl.indexOf(':');
        if (colon > -1) out.push({ prop: decl.slice(0, colon).trim().toLowerCase(), value: decl.slice(colon + 1).trim(), line: lineOf(text, start + decl.search(/\S|$/)), atrules: stack.slice(), selector: prelude });
        start = end + 1;
      };
      for (; j < text.length; j++) {
        const d = text[j];
        if (quote) { if (d === quote) quote = ''; continue; }
        if (d === '"' || d === "'") { quote = d; continue; }
        if (d === '(') depth++;
        else if (d === ')') depth--;
        else if (d === ';' && depth === 0) flush(j);
        else if (d === '}' && depth === 0) { flush(j); break; }
      }
      i = j;
    } else if (c === '}') {
      stack.pop();
      buf = '';
    } else if (c === ';') {
      buf = '';
    } else {
      buf += c;
    }
  }
  return out;
}

// The declarations that write a system colour outside @media (forced-colors: active).
function systemColoursOutsideForced(css) {
  return contextualDecls(css).filter((d) => !d.prop.startsWith('--') && SYSTEM_RE.test(d.value.replace(/"[^"]*"|'[^']*'/g, ''))
    && !d.atrules.some((a) => FORCED_BLOCK.test(a)))
    .map((d) => ({ line: d.line, text: d.prop + ': ' + d.value, where: d.atrules.join(' ') || 'top level' }));
}

// index.html: style="" attributes, <style> blocks and paint attributes.
const stripHtmlComments = (h) => h.replace(/<!--[\s\S]*?-->/g, blank);
function htmlLiterals(html) {
  const text = stripHtmlComments(lf(html));
  const found = [];
  for (const m of text.matchAll(/\sstyle="([^"]*)"/g)) {
    for (const f of cssLiterals('x{' + m[1] + '}')) found.push({ line: lineOf(text, m.index), text: f.text, where: 'style=""' });
  }
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const f of cssLiterals(m[1])) found.push({ line: lineOf(text, m.index) + f.line - 1, text: f.text, where: '<style>' });
  }
  for (const m of text.matchAll(/\s(fill|stroke|stop-color|flood-color|lighting-color|color)="([^"]*)"/g)) {
    const v = m[2].trim();
    if (new RegExp('^(?:' + HEX + '|' + FUNC + ')').test(v) || NAMED.includes(v.toLowerCase())) found.push({ line: lineOf(text, m.index), text: v, where: m[1] + '=""' });
  }
  for (const m of text.matchAll(/<meta\s+name="theme-color"\s+content="([^"]*)"/g)) found.push({ line: lineOf(text, m.index), text: m[1], where: 'meta theme-color' });
  return found;
}

// Scripts: every line that is not a comment. A script that builds a <style> block or sets style.x is the target, but the
// scan is for any literal on any code line, so a colour cannot hide in a new helper.
function jsLiterals(js) {
  const text = lf(js);
  const found = [];
  let inBlock = false;
  text.split('\n').forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = ' '.repeat(end + 2) + line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*[\s\S]*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open !== -1) { line = line.slice(0, open); inBlock = true; }
    line = line.replace(/(^|\s)\/\/.*$/, '$1');
    line = line.replace(/&#\d+;|&#x[0-9a-fA-F]+;/g, ''); // HTML character references are not colours
    for (const hit of line.matchAll(LITERAL)) found.push({ line: i + 1, text: hit[0], where: raw.trim().slice(0, 90) });
  });
  return found;
}

// ---- the files --------------------------------------------------------------------------------------------------
const CSS_DIR = 'frontend/css';
const cssFiles = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
const SCANNED_CSS = cssFiles.filter((f) => f !== 'tokens.css' && f !== 'print.css');
const jsFiles = fs.readdirSync('frontend/js').filter((f) => f.endsWith('.js') && !f.endsWith('_test.js'));

// The colours the scripts may write, each with the reason. A line is matched by file and by a part of its text; an entry
// that matches nothing fails the test (so the list cannot go stale).
const ALLOWED_JS = [
  { file: 'appearance.js', includes: "'rgba('", reason: 'colour maths of a self-chosen accent: builds the text of a gradient from computed numbers (no colour of the app is written here)' },
  { file: 'app.js', includes: 'Page canvas is a slightly blue-tinted light grey', reason: 'text of an AI image prompt, not a colour of the app' },
  { file: 'app.js', includes: 'Primary accent is Action Blue', reason: 'text of an AI image prompt' },
  { file: 'app.js', includes: 'Slide layout: wide 16:9', reason: 'text of an AI image prompt' },
  { file: 'app.js', includes: 'Material Design 3', reason: 'text of an AI image prompt' }
];

// ---- tokens.css ---------------------------------------------------------------------------------------------------
const tokensCss = stripCssComments(read(path.join(CSS_DIR, 'tokens.css')));

// rules of tokens.css: { selectors: [...], decls: Map }
function tokenRules(css) {
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map();
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls.set(d[1], d[2].trim());
    rules.push({ selectors: m[1].split(',').map((s) => s.trim()), decls });
  }
  return rules;
}
const rules = tokenRules(tokensCss);
const baseRules = rules.filter((r) => r.selectors.includes('body.dark-theme'));
const base = new Map();
for (const r of baseRules) for (const [k, v] of r.decls) base.set(k.slice(2), v);
function baseValue(name) {
  assert.ok(base.has(name), '--' + name + ' is defined by body.dark-theme in tokens.css');
  return base.get(name);
}
const rootRule = rules.find((r) => r.selectors.includes(':root'));

const failures = [];
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (e) {
    failures.push(name);
    console.log('FAIL: ' + name);
    console.log(e && e.message ? e.message : e);
  }
}
const show = (list) => list.map((f) => '  ' + f.file + ':' + f.line + '  ' + f.text + '   (' + f.where + ')').join('\n');

check('the style sheets of the app (everything in frontend/css except tokens.css and print.css) write no colour', () => {
  assert.ok(SCANNED_CSS.includes('style.css'), 'style.css is scanned');
  const all = [];
  for (const f of SCANNED_CSS) for (const hit of cssLiterals(read(path.join(CSS_DIR, f)))) all.push({ ...hit, file: f });
  assert.equal(all.length, 0, 'a colour is written outside tokens.css; make it a token and use var(--name):\n' + show(all));
});

check('index.html writes no colour in an inline style, a <style> block or a paint attribute (only the theme-color meta is allowed)', () => {
  const hits = htmlLiterals(read('frontend/index.html')).map((f) => ({ ...f, file: 'index.html' }));
  const rest = hits.filter((f) => f.where !== 'meta theme-color');
  assert.equal(rest.length, 0, 'a colour is written in index.html; use a token:\n' + show(rest));
  const meta = hits.filter((f) => f.where === 'meta theme-color');
  assert.equal(meta.length, 1, 'the theme-color meta is the one allowed literal (a <meta> cannot hold var()); it is the dark canvas colour');
  assert.equal(meta[0].text.toLowerCase(), rootRule.decls.get('--canvas-bg').toLowerCase(), '<meta name="theme-color"> equals --canvas-bg');
});

check('the scripts of the page write no colour, except the listed lines', () => {
  const used = new Set();
  const bad = [];
  for (const f of jsFiles) {
    for (const hit of jsLiterals(read(path.join('frontend/js', f)))) {
      const idx = ALLOWED_JS.findIndex((a) => a.file === f && hit.where.includes(a.includes));
      if (idx === -1) bad.push({ ...hit, file: f }); else used.add(idx);
    }
  }
  assert.equal(bad.length, 0, 'a script writes a colour; use var(--token) from tokens.css:\n' + show(bad));
  const stale = ALLOWED_JS.filter((_, i) => !used.has(i));
  assert.equal(stale.length, 0, 'these ALLOWED_JS entries match no line any more; remove them:\n' + stale.map((a) => '  ' + a.file + ' ' + a.includes).join('\n'));
});

check('system colours (Canvas, CanvasText, Highlight ...) are written only inside @media (forced-colors: active), in every style sheet of the app', () => {
  assert.ok(cssFiles.includes('chrome.css') && cssFiles.includes('style.css'), 'the sheets that hold forced-colours rules are scanned');
  const all = [];
  for (const f of cssFiles) for (const hit of systemColoursOutsideForced(read(path.join(CSS_DIR, f)))) all.push({ ...hit, file: f });
  assert.equal(all.length, 0, 'a system colour is written outside @media (forced-colors: active) (it would paint the window in the operating system\'s colours in normal use):\n' + show(all));
  // and they are used: the rules this guard allows exist (the guard is not passing because the parser sees nothing)
  const inForced = cssFiles.flatMap((f) => contextualDecls(read(path.join(CSS_DIR, f))).filter((d) => d.atrules.some((a) => FORCED_BLOCK.test(a)) && SYSTEM_RE.test(d.value)));
  assert.ok(inForced.length >= 25, 'the forced-colours blocks use system colours (' + inForced.length + ' declarations found)');
});

check('tokens.css: the base block exists, every look (body.theme-*) only changes tokens the base block defines, no token is defined twice in one rule', () => {
  assert.ok(baseRules.length >= 1 && base.size > 100, 'body.dark-theme defines the tokens (' + base.size + ' found)');
  const unknown = [];
  for (const r of rules) {
    if (r.selectors.includes('body.dark-theme') || r.selectors.includes(':root')) continue;
    if (r.selectors.includes(':root.look-paper')) continue; // the canvas of the paper look: --canvas-bg / --canvas-fg, which only :root defines
    for (const k of r.decls.keys()) if (!base.has(k.slice(2))) unknown.push(r.selectors.join(', ') + ' sets ' + k);
  }
  assert.deepEqual(unknown, [], 'a look sets a token that the base block does not define:\n  ' + unknown.join('\n  '));
  for (const m of tokensCss.matchAll(/\{([^{}]*)\}/g)) {
    const names = [...m[1].matchAll(/(--[\w-]+)\s*:/g)].map((d) => d[1]);
    assert.equal(names.length, new Set(names).size, 'a token is defined twice in one rule of tokens.css');
  }
});

check('tokens.css: the canvas colours exist on :root (the page background before and outside <body>) and match the base surface', () => {
  assert.ok(rootRule && rootRule.decls.has('--canvas-bg') && rootRule.decls.has('--canvas-fg'), ':root defines --canvas-bg and --canvas-fg');
  assert.equal(rootRule.decls.get('--canvas-bg').toLowerCase(), baseValue('bg-main').toLowerCase());
});

check('every var(--name) of the style sheet, index.html and the scripts is a token that tokens.css defines (or one of the few set elsewhere)', () => {
  // set by a script at run time, or a typeface rather than a colour
  const ELSEWHERE = new Set(['font-mono', 'ghost-diff-duration', 'editor-font-user', 'tab-scrollbar-w', 'tab-pinned-w', 'rw', 'st', 'bgs']); // editor-font-user: a typeface (Settings > Appearance), set on <html> by js/appearance.js; tab-scrollbar-w: the width of the system's scrollbar, measured by app.js (measureStripGap) when the right strip is first shown, set on that strip only; tab-pinned-w: the width a pinned strip was dragged to, set on <html> by app.js (initTabResizer); rw / st / bgs: a tab's width, how much of its name shows and how much of it the base colour covers, set per row by js/tab_dock.js while the mouse is over a strip
  const defined = new Set(base.keys());
  for (const r of rules) for (const k of r.decls.keys()) defined.add(k.slice(2));
  defined.add('canvas-bg'); defined.add('canvas-fg');
  const styleCss = stripCssComments(read(path.join(CSS_DIR, 'style.css')));
  for (const m of styleCss.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1].slice(2)); // the layout variables --panel-* of style.css
  for (const m of stripCssComments(read(path.join(CSS_DIR, 'chrome.css'))).matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1].slice(2)); // the layout numbers of chrome.css (--ov-*, --pad-*, --panel-modal-top, --bar-a ...)
  const sources = [['style.css', styleCss], ['index.html', stripHtmlComments(read('frontend/index.html'))]];
  for (const f of jsFiles) sources.push([f, read(path.join('frontend/js', f))]);
  const missing = [];
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/var\(\s*--([\w-]+)/g)) {
      if (!defined.has(m[1]) && !ELSEWHERE.has(m[1])) missing.push(file + ': var(--' + m[1] + ')');
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'a var() names a token that nothing defines:\n  ' + [...new Set(missing)].join('\n  '));
});

check('index.html links tokens.css before style.css, and the app embeds the whole frontend folder (so tokens.css is shipped)', () => {
  const html = read('frontend/index.html');
  const t = html.search(/<link[^>]+href="css\/tokens\.css[^"]*"/);
  const s = html.search(/<link[^>]+href="css\/style\.css[^"]*"/);
  assert.ok(t !== -1 && s !== -1 && t < s, 'tokens.css is linked, and before style.css');
  assert.ok(!/<link[^>]+href="css\/tokens\.css[^"]*"[^>]*media=/.test(html), 'tokens.css applies to every medium (no media attribute)');
  assert.ok(/\/\/go:embed frontend\/\*/.test(read('main.go')), 'main.go embeds frontend/* (so css/tokens.css is part of the program)');
});

// ---- the mutation check: the scanners must catch a colour that is written into the real files ----------------------
check('mutation check: a colour written into a copy of style.css, index.html or a script is found; look-alikes are not', () => {
  const style = read(path.join(CSS_DIR, 'style.css'));
  const html = read('frontend/index.html');
  const js = read('frontend/js/app.js');
  assert.equal(cssLiterals(style).length, 0, 'the real style.css is clean (the premise of the mutations)');
  const mutantsCss = [
    '.x { color: #123456; }',
    '.x { color: #fff; }',
    '.x { background: rgba(1, 2, 3, 0.4); }',
    '.x { border: 1px solid hsl(10 20% 30%); }',
    '.x { background: white; }',
    '.x { box-shadow: 0 1px 2px red; }',
    '.x { color: var(--text-main, #d4d4d4); }',
    '.x { background-image: url("data:image/svg+xml,%3Csvg stroke=\'%23abcdef\'%3E"); }',
    '@media (min-width: 1px) { .x { fill: #000; } }',
    '.x { --mine: #abcdef; }',
    '.x { background: rgb(255 0 0 / 0.5); }',
    '.x { background: rgb(var(--ink-rgb) 1 2 / 0.5); }',
    '.x { background: rgb(var(--ink-rgb), 0.5); }'
  ];
  for (const m of mutantsCss) assert.ok(cssLiterals(style + '\n' + m + '\n').length >= 1, 'not found in style.css: ' + m);
  const fine = [
    '.x { color: var(--text-main); background: transparent; border: 1px solid currentColor; outline: 2px solid var(--accent-hover); }',
    '#add-btn:hover { white-space: nowrap; font-family: Arial, sans-serif; content: "red #fff"; }',
    '.x { background: color-mix(in srgb, var(--a) 65%, var(--b)); box-shadow: 0 1px 2px var(--shadow-menu); }',
    '.x { color: CanvasText; background: Canvas; border-color: ButtonBorder; }',
    '.x { background: rgb(var(--bar-top-rgb) / var(--bar-a)); color: rgb(var(--text-muted-rgb) / 0.5); }'
  ];
  for (const f of fine) assert.equal(cssLiterals(style + '\n' + f + '\n').length, 0, 'wrongly found: ' + f);
  // system colours: fine inside a forced-colours block, a finding anywhere else
  const sysOut = (css) => systemColoursOutsideForced(css).length;
  const baseSys = sysOut(style);
  assert.equal(baseSys, 0, 'the real style.css writes no system colour outside forced colours (the premise)');
  for (const m of [
    '.x { color: CanvasText; }',
    '.x { background: Highlight; }',
    '.x { border: 1px solid ButtonText; }',
    '.x { outline: 2px solid highlight; }',
    '@media (prefers-contrast: more) { .x { color: Canvas; } }',
    '@media (prefers-reduced-motion: reduce) { .x { background: GrayText; } }',
    '@media (forced-colors: none) { .x { color: LinkText; } }',
    '@media (forced-colors: active) { .y { color: Canvas; } }\n.x { color: CanvasText; }',
    '@media print { .x { color: Canvas; } }'
  ]) assert.ok(sysOut(style + '\n' + m + '\n') > baseSys, 'a system colour outside forced colours is not found: ' + m);
  for (const f of [
    '@media (forced-colors: active) { .x { color: CanvasText; background: Canvas; border: 1px solid Highlight; } }',
    '@media (forced-colors: active) { @supports (x: y) { .x { color: Highlight; } } }',
    '.x { content: "Highlight and Canvas"; }',
    '.x { --note-highlight: var(--accent-color); background: transparent; }',
    '.x { animation: HighlightFlash 1s; }',
    '.canvas-card { color: var(--text-main); }'
  ]) assert.equal(sysOut(style + '\n' + f + '\n'), baseSys, 'wrongly found: ' + f);
  const mutantsHtml = [
    '<div style="color:#fff">x</div>',
    '<div style="background: rgba(0,0,0,.3)">x</div>',
    '<circle cx="1" cy="1" r="1" fill="#1e1e1e"></circle>',
    '<style>.y { color: red; }</style>',
    '<path stroke="#abc" />'
  ];
  for (const m of mutantsHtml) assert.ok(htmlLiterals(html.replace('</body>', m + '</body>')).filter((f) => f.where !== 'meta theme-color').length >= 1, 'not found in index.html: ' + m);
  assert.equal(htmlLiterals(html.replace('</body>', '<div style="color: var(--text-main); background: var(--veil-07)"><svg stroke="currentColor" fill="none"></svg></div></body>')).filter((f) => f.where !== 'meta theme-color').length, 0, 'tokens and currentColor are fine in index.html');
  const mutantsJs = [
    "el.style.color = '#abc';",
    "el.style.background = 'rgba(0,0,0,0.5)';",
    "style.textContent = '.a{color:#ff0000}';",
    'x.innerHTML = `<b style="color:#e5c07b">x</b>`;'
  ];
  const base0 = jsLiterals(js).length;
  for (const m of mutantsJs) assert.ok(jsLiterals(js + '\n' + m + '\n').length === base0 + 1, 'not found in a script: ' + m);
  const fineJs = ["el.style.color = 'var(--text-ok)';", "// a comment about #ffffff", "/* and rgba(0,0,0,.5) */", "const e = '&#039;';", "document.querySelector('#editor');"];
  for (const f of fineJs) assert.equal(jsLiterals(js + '\n' + f + '\n').length, base0, 'wrongly found: ' + f);
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
console.log('\nAll css token tests passed!');
