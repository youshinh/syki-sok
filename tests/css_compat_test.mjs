// v2: the style sheets and the scripts of the page stay inside what macOS 10.15 can draw (its WKWebView is Safari 15.6 at most;
// docs/design/v2-implementation-contract.md 1.5). Not allowed in frontend/css/*.css, in the style blocks and attributes of index.html or in
// the style strings of the scripts:
//   * color-mix()                 Safari 16.2    -> a channel token (--accent-rgb: 85 107 47) and rgb(var(--accent-rgb) / 0.14), or a precomputed token
//   * @container, container-type, container-name, cqw / cqi / cqh / cqb units      Safari 16
//   * CSS nesting (a rule inside a rule)                                           Safari 16.5
//   * scrollbar-gutter                                                             Safari 18.2
//   * :has( more than the uses that are already there (the settings dialog, the printed preview; Safari 15.4)
// The one exception: js/file_anchor.js writes color-mix() in a line that has a declaration without it right before it (a browser that cannot
// read the second line keeps the first).
//
// Node only. Run: node tests/css_compat_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const lf = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => lf(fs.readFileSync(p, 'utf8'));
const blank = (s) => s.replace(/[^\n]/g, ' ');
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, blank);
const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;

// the :has() uses that exist (frontend/css file -> number of occurrences outside comments). A new use needs a new reason, so it is a new number here.
const HAS_BASELINE = { 'style.css': 1, 'print.css': 3, 'tokens.css': 0 }; // style.css: 6 until the auto-hide (chrome.css, JS pins) replaced the five of the old typing dimmer

const FORBIDDEN = [
  [/color-mix\s*\(/gi, 'color-mix() (Safari 16.2): use a channel token with rgb(var(--x-rgb) / alpha), or a precomputed token'],
  [/@container\b/gi, '@container (Safari 16)'],
  [/\bcontainer-(?:type|name)\s*:/gi, 'container-type / container-name (Safari 16)'],
  [/\d(?:cqw|cqh|cqi|cqb|cqmin|cqmax)\b/gi, 'a container query unit (Safari 16)'],
  [/\bscrollbar-gutter\s*:/gi, 'scrollbar-gutter (Safari 18.2)']
];

// CSS nesting: a block opened while the block that is open is a style rule (not an at-rule such as @media, @supports, @keyframes)
function nestingProblems(css) {
  const text = stripCssComments(css).replace(/"[^"\n]*"|'[^'\n]*'/g, blank);
  const problems = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      const prelude = text.slice(start, i).trim();
      const kind = prelude.startsWith('@') ? 'at' : 'rule';
      // a rule inside a plain rule is nesting; a rule inside an at-rule, or an at-rule anywhere, is fine (@media may sit in a rule only as nesting too)
      if (stack.length && stack[stack.length - 1] === 'rule') problems.push({ line: lineOf(text, i), text: (prelude || '{').slice(0, 60) });
      stack.push(kind);
      start = i + 1;
    } else if (ch === '}') {
      stack.pop();
      start = i + 1;
    } else if (ch === ';') {
      start = i + 1;
    }
  }
  return problems;
}

function cssProblems(css, file) {
  const out = [];
  const text = stripCssComments(css).replace(/"[^"\n]*"|'[^'\n]*'/g, blank); // text in quotes (content: "...") is not syntax
  for (const [re, what] of FORBIDDEN) for (const m of text.matchAll(re)) out.push({ file, line: lineOf(text, m.index), what });
  for (const n of nestingProblems(css)) out.push({ file, line: n.line, what: 'CSS nesting (Safari 16.5): a rule inside "' + n.text + '"' });
  return out;
}

function hasCount(css) {
  return (stripCssComments(css).match(/:has\s*\(/gi) || []).length;
}

// Scripts: the text of a style that a script writes. Comments are dropped (a comment may name color-mix()); the one exception is described above.
function stripJsComments(js) {
  return lf(js).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[\s;{}(),])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

function jsProblems(js, file) {
  const out = [];
  const text = stripJsComments(js);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [re, what] of FORBIDDEN) {
      re.lastIndex = 0;
      if (!re.test(line)) continue;
      const isMix = what.startsWith('color-mix');
      if (isMix && file === 'file_anchor.js') {
        // allowed only right after a declaration of the same property that does not use it (the fallback)
        let j = i - 1;
        while (j >= 0 && !lines[j].trim()) j--;
        if (j >= 0 && /text-decoration-color:var\(/.test(lines[j]) && /text-decoration-color:color-mix\(/.test(line)) continue;
      }
      out.push({ file, line: i + 1, what });
    }
  });
  return out;
}

// ---- the checks --------------------------------------------------------------------------------------------------------------------------
const failures = [];
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS: ' + name); } catch (e) { failures.push(name); console.log('FAIL: ' + name); console.log(e && e.message ? e.message : e); }
}
const show = (list) => list.map((p) => '  ' + p.file + ':' + p.line + '  ' + p.what).join('\n');

const CSS_DIR = 'frontend/css';
const cssFiles = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
const jsFiles = fs.readdirSync('frontend/js').filter((f) => f.endsWith('.js') && !f.endsWith('_test.js'));

check('the style sheets of the app use none of the syntax macOS 10.15 cannot draw (color-mix, @container, nesting, scrollbar-gutter)', () => {
  assert.ok(cssFiles.includes('style.css') && cssFiles.includes('tokens.css'), 'the sheets are found');
  const all = [];
  for (const f of cssFiles) all.push(...cssProblems(read(path.join(CSS_DIR, f)), f));
  assert.equal(all.length, 0, 'unsupported syntax:\n' + show(all));
});

check('index.html (its style blocks and attributes) uses none of it either', () => {
  const html = read('frontend/index.html');
  const all = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) all.push(...cssProblems(m[1], 'index.html <style>'));
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) all.push(...cssProblems('x{' + m[1] + '}', 'index.html style=""').filter((p) => !/nesting/.test(p.what)));
  assert.equal(all.length, 0, 'unsupported syntax:\n' + show(all));
});

check('no script writes it into a style (except file_anchor.js, right after a declaration without it)', () => {
  const all = [];
  for (const f of jsFiles) all.push(...jsProblems(read(path.join('frontend/js', f)), f));
  assert.equal(all.length, 0, 'unsupported syntax in a script:\n' + show(all));
  assert.ok(/color-mix\(/.test(read('frontend/js/file_anchor.js')), 'the exception still exists (if it is gone, remove it from this test)');
});

check(':has( is used only where it already was (settings dialog, printed preview); a new use needs a new baseline here', () => {
  for (const f of cssFiles) assert.equal(hasCount(read(path.join(CSS_DIR, f))), HAS_BASELINE[f] === undefined ? 0 : HAS_BASELINE[f], f + ': the number of :has( uses');
});

// ---- the mutation check ------------------------------------------------------------------------------------------------------------------
check('mutation check: each kind of unsupported syntax is found in a copy of the real files, and the allowed look-alikes are not', () => {
  const style = read(path.join(CSS_DIR, 'style.css'));
  assert.equal(cssProblems(style, 'style.css').length, 0, 'the real style.css is clean (the premise of the mutations)');
  const mutants = [
    '.x { background: color-mix(in srgb, var(--a) 40%, var(--b)); }',
    '.x { color: COLOR-MIX (in srgb, red, blue); }',
    '@container (min-width: 400px) { .x { color: var(--ink); } }',
    '.x { container-type: inline-size; }',
    '.x { width: 50cqw; }',
    '.x { scrollbar-gutter: stable; }',
    '.x { color: var(--ink); .y { color: var(--ink-2); } }',
    '.x { & .y { color: var(--ink-2); } }',
    '.x { color: var(--ink); @media (min-width: 1px) { color: var(--ink-2); } }',
    '@media (min-width: 1px) { .x { .y { color: var(--ink); } } }'
  ];
  for (const m of mutants) assert.ok(cssProblems(style + '\n' + m + '\n', 'style.css').length >= 1, 'not found: ' + m);
  const fine = [
    '@media (min-width: 1px) { .x { color: var(--ink); } }',
    '@keyframes k { from { opacity: 0; } 50% { opacity: .5; } to { opacity: 1; } }',
    '@supports (backdrop-filter: blur(1px)) { .x { backdrop-filter: blur(1px); } }',
    '.x { color: rgb(var(--accent-rgb) / 0.14); width: max(10px, 2vw); }',
    '/* color-mix( and @container in a comment */ .x { color: var(--ink); }',
    '.x::before { content: "color-mix(" ; }'
  ];
  for (const f of fine) assert.equal(cssProblems(style + '\n' + f + '\n', 'style.css').length, 0, 'wrongly found: ' + f);
  // :has( count
  assert.equal(hasCount(style + '\n.x:has(.y) { color: var(--ink); }\n'), hasCount(style) + 1, 'a new :has( is counted');
  // scripts
  const js = read('frontend/js/app.js');
  assert.equal(jsProblems(js, 'app.js').length, 0, 'the real app.js is clean');
  assert.equal(jsProblems(js + "\nel.style.cssText = 'background:color-mix(in srgb, red, blue)';\n", 'app.js').length, 1, 'color-mix() in a script is found');
  assert.equal(jsProblems(js + "\nstyle.textContent = '.a{container-type:inline-size}';\n", 'app.js').length, 1);
  assert.equal(jsProblems(js + '\n// color-mix( only in a comment\n/* @container */\n', 'app.js').length, 0, 'a comment is not a use');
  const anchor = read('frontend/js/file_anchor.js');
  assert.equal(jsProblems(anchor, 'file_anchor.js').length, 0, 'the real exception passes');
  assert.equal(jsProblems(anchor, 'other.js').length, 1, 'but only in file_anchor.js');
  assert.equal(jsProblems(anchor.replace("'text-decoration-color:var(--accent-hover);' +", "'x:y;' +"), 'file_anchor.js').length, 1, 'and only after its fallback line');
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
console.log('\nAll css compatibility tests passed!');
