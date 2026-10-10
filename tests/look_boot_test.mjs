// v2 P1b: a profile that chose paper (or an accent other than Dark Olive) must not see the ink look for a moment at start. The scripts at the
// end of index.html run after the first paint, so a very small script at the start of <body> puts the look on the page from a key of its own
// (syki_look), which app.js (applyTheme -> rememberLook) writes only when the look is not the default.
//
//   1. The script is the first thing in <body>, inline, ES5, and does nothing without the key (the default profile: no read result, no write).
//   2. For every look and accent, the text Appearance.markerFor makes is turned by that script into the classes appearance.js apply() would set.
//   3. rememberLook writes only what differs, removes the key for the default look and survives a storage that throws.
//   4. The mutation check: each of those fails on a copy of the script / the function that is broken the way the check is meant to catch.
//
// Node only. Run: node tests/look_boot_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
global.window = global;
const Appearance = require('../frontend/js/appearance.js');
const html = fs.readFileSync('frontend/index.html', 'utf8').replace(/\r\n/g, '\n');
const appJs = fs.readFileSync('frontend/js/app.js', 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS: ' + name); } catch (e) { failed++; console.log('FAIL: ' + name); console.log(e && e.message ? e.message : e); }
}

// ---- the inline script of index.html ---------------------------------------------------------------------------------------------------
const bodyAt = html.indexOf('<body');
const afterBody = html.slice(html.indexOf('>', bodyAt) + 1);
const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(afterBody);
assert.ok(scriptMatch, 'there is an inline script in <body>');
const SCRIPT = scriptMatch[1];

function makeDoc() {
  const mk = () => { const set = new Set(); return { set, classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) } }; };
  const body = mk();
  body.set.add('dark-theme');
  body.set.add('theme-olive');
  const root = mk();
  return { body, documentElement: root };
}

// runs a copy of the script against a fake page whose localStorage holds `value` (or throws when value is the string 'THROW')
function run(script, value) {
  const document = makeDoc();
  const reads = [];
  const localStorage = {
    getItem: (k) => { reads.push(k); if (value === 'THROW') throw new Error('storage blocked'); return value === undefined ? null : value; },
    setItem: () => { throw new Error('the boot script must not write'); }
  };
  vm.runInNewContext(script, { document, localStorage });
  return { body: [...document.body.set].sort(), html: [...document.documentElement.set].sort(), reads };
}

check('the script is the first thing in <body>: inline, before the app markup and every other script, ES5 only, reading the one key', () => {
  assert.ok(afterBody.slice(0, scriptMatch.index).replace(/<!--[\s\S]*?-->/g, '').trim() === '', 'nothing but a comment comes before it');
  assert.ok(scriptMatch.index < afterBody.indexOf('<div id="app">'), 'before the app');
  assert.ok(!/<script[^>]*\ssrc=/.test(afterBody.slice(0, scriptMatch.index)), 'before every other script');
  assert.ok(!/=>|\blet\b|\bconst\b|`/.test(SCRIPT), 'plain ES5 (it must run in the oldest WebView)');
  assert.deepEqual([...SCRIPT.matchAll(/getItem\('([^']+)'\)/g)].map((m) => m[1]), ['syki_look'], 'it reads one key, syki_look');
  assert.ok(!/setItem|removeItem/.test(SCRIPT), 'and never writes');
  assert.ok(SCRIPT.length < 600, 'it is tiny (' + SCRIPT.length + ' characters)');
  assert.ok(/syki_look/.test(appJs.slice(appJs.indexOf('function rememberLook'))), 'app.js writes that key');
});

check('without the key (the default profile) the script changes nothing', () => {
  const r = run(SCRIPT, undefined);
  assert.deepEqual(r.body, ['dark-theme', 'theme-olive']);
  assert.deepEqual(r.html, []);
  assert.deepEqual(r.reads, ['syki_look'], 'one read');
  for (const junk of ['', 'junk', '||', 'light|', 'ink|olive', 'ink|', 'ink|custom', 'ink|<img src=x>', 'paper|"; alert(1)']) {
    const j = run(SCRIPT, junk);
    if (!/^paper/.test(junk)) assert.deepEqual(j.body, ['dark-theme', 'theme-olive'], JSON.stringify(junk) + ' is ignored');
  }
  assert.deepEqual(run(SCRIPT, 'THROW').body, ['dark-theme', 'theme-olive'], 'a storage that throws is not an error');
});

check('every look and accent: the text Appearance.markerFor makes becomes the classes apply() sets', () => {
  for (const look of Appearance.LOOKS) {
    for (const accent of Appearance.ACCENTS) {
      const ap = Appearance.normalize({ look, accent, accentCustom: accent === 'custom' ? '#336699' : '' });
      const marker = Appearance.markerFor(ap);
      const r = run(SCRIPT, marker || undefined);
      const paper = look === 'paper';
      const wantAccent = ['blue', 'forest', 'charcoal', 'vermilion'].includes(accent) ? accent : 'olive'; // olive and a colour of one's own: the page's own class
      assert.ok(r.body.includes('dark-theme'), 'the base class stays: ' + marker);
      assert.equal(r.body.includes('look-paper'), paper, look + '/' + accent + ' look class on <body> (marker ' + JSON.stringify(marker) + ')');
      assert.equal(r.html.includes('look-paper'), paper, look + '/' + accent + ' look class on <html>');
      assert.deepEqual(r.body.filter((c) => /^theme-/.test(c)), ['theme-' + wantAccent], look + '/' + accent + ' accent class');
    }
  }
  assert.equal(Appearance.markerFor(Appearance.normalize(undefined)), '', 'the default look has no marker');
  assert.equal(Appearance.markerFor(Appearance.normalize({ accent: 'custom', accentCustom: '#336699' })), '', 'a colour of one\'s own has none (computed after the scripts have run)');
  assert.equal(Appearance.markerFor(Appearance.normalize({ look: 'paper' })), 'paper|');
  assert.equal(Appearance.markerFor(Appearance.normalize({ accent: 'blue' })), 'ink|blue');
  assert.equal(Appearance.markerFor(Appearance.normalize({ look: 'paper', accent: 'vermilion', bars: 'glass' })), 'paper|vermilion', 'a key of a later phase does not change it');
});

// ---- rememberLook ------------------------------------------------------------------------------------------------------------------------
function extract(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start !== -1, name + ' not found');
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

function runRemember(source, initial, ap) {
  const store = new Map();
  if (initial !== undefined) store.set('syki_look', initial);
  const calls = [];
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { calls.push('set ' + k + '=' + v); store.set(k, v); },
    removeItem: (k) => { calls.push('remove ' + k); store.delete(k); }
  };
  const ctx = vm.createContext({ window: { Appearance }, localStorage });
  vm.runInContext(extract(source, 'rememberLook') + '\nthis.__f = rememberLook;', ctx);
  ctx.__f(Appearance.normalize(ap));
  return { calls, value: store.get('syki_look') };
}

check('rememberLook writes only what differs, and removes the key for the default look', () => {
  assert.deepEqual(runRemember(appJs, undefined, undefined).calls, [], 'the default profile writes nothing');
  assert.deepEqual(runRemember(appJs, undefined, { look: 'paper' }).calls, ['set syki_look=paper|']);
  assert.deepEqual(runRemember(appJs, 'paper|', { look: 'paper' }).calls, [], 'already there: nothing');
  assert.deepEqual(runRemember(appJs, 'paper|', { look: 'paper', accent: 'blue' }).calls, ['set syki_look=paper|blue']);
  assert.deepEqual(runRemember(appJs, 'paper|blue', undefined).calls, ['remove syki_look'], 'back to the default: the key goes');
  assert.deepEqual(runRemember(appJs, 'ink|forest', { accent: 'custom', accentCustom: '#123456' }).calls, ['remove syki_look'], 'a colour of one\'s own has no marker');
  // a storage that throws
  const ctx = vm.createContext({ window: { Appearance }, localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } } });
  vm.runInContext(extract(appJs, 'rememberLook') + '\nthis.__f = rememberLook;', ctx);
  ctx.__f(Appearance.normalize({ look: 'paper' })); // must not throw
  // applyTheme remembers the saved look (not a Settings preview)
  const applyTheme = extract(appJs, 'applyTheme');
  assert.match(applyTheme, /applyAppearance\(ap\);\s*rememberLook\(ap\);/);
  assert.ok(!/rememberLook/.test(extract(appJs, 'previewAppearance')), 'a preview is not remembered');
  assert.ok(!/rememberLook/.test(extract(appJs, 'applyAppearance')), 'applyAppearance (also the preview) does not remember');
});

// ---- the mutation check ------------------------------------------------------------------------------------------------------------------
check('mutation check: a broken script or rememberLook is caught', () => {
  const mutate = (text, find, replace) => { assert.ok(text.includes(find), 'target exists: ' + find); return text.replace(find, replace); };
  const caught = (fn) => { try { fn(); return false; } catch (e) { return true; } };
  const accents = () => {
    for (const accent of ['blue', 'forest', 'charcoal', 'vermilion']) {
      const r = run(MUTANT, 'ink|' + accent);
      assert.deepEqual(r.body.filter((c) => /^theme-/.test(c)), ['theme-' + accent]);
    }
  };
  const paperOnBoth = () => {
    const r = run(MUTANT, 'paper|');
    assert.ok(r.body.includes('look-paper') && r.html.includes('look-paper'));
  };
  const ignoresJunk = () => { assert.deepEqual(run(MUTANT, 'ink|<img src=x>').body, ['dark-theme', 'theme-olive']); };
  let MUTANT = SCRIPT;
  assert.ok(!caught(() => { accents(); paperOnBoth(); ignoresJunk(); }), 'the real script passes (the premise of the mutations)');
  MUTANT = mutate(SCRIPT, "b.classList.remove('theme-olive');", '');
  assert.ok(caught(accents), 'keeping theme-olive next to the chosen accent is caught');
  MUTANT = mutate(SCRIPT, "document.documentElement.classList.add('look-paper');", '');
  assert.ok(caught(paperOnBoth), 'not putting the look on <html> (the canvas) is caught');
  MUTANT = mutate(SCRIPT, "/^(blue|forest|charcoal|vermilion)$/.test(p[1])", 'true');
  assert.ok(caught(ignoresJunk), 'accepting any accent text is caught');
  const noRemove = mutate(appJs, "else localStorage.removeItem('syki_look');", ';');
  assert.deepEqual(runRemember(appJs, 'paper|blue', undefined).calls, ['remove syki_look']);
  assert.notDeepEqual(runRemember(noRemove, 'paper|blue', undefined).calls, ['remove syki_look'], 'a key that is never removed (the default look would keep a stale paper) is caught');
  const alwaysWrite = mutate(appJs, 'if (want === have) return;', '');
  assert.notDeepEqual(runRemember(alwaysWrite, 'paper|', { look: 'paper' }).calls, [], 'a write on every start is caught');
});

console.log(failed ? '\n' + failed + ' look boot test(s) FAILED' : '\nAll look boot tests passed!');
if (failed) process.exit(1);
