// v2 P1b, trap F7: config.appearance must survive a save and a reload.
//
// The page writes the WHOLE config back on every save (savePersistentConfig: JSON.stringify(config)), but it reads a saved config
// group by group (loadLocalConfigSync for the copy in localStorage, syncBackendConfig for config.json). A group that is not copied in
// both places is gone after the next save (config.semantic was the first to be lost this way). So:
//   1. appearance goes through the real save, the real loaders (extracted from app.js and run against stubs) and a second save, unchanged,
//      unknown keys included (later phases put their own settings into the same object);
//   2. a config saved before the setting existed (only general.theme) keeps its accent and is not given an appearance by a save;
//   3. the dialog's own reading of its controls keeps keys that it has no control for;
//   4. the mutation check: with the copy line taken out of either loader the round trip fails.
//
// Node only. Run: node tests/appearance_roundtrip_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const appJs = read('frontend/js/app.js');

global.window = global;
const Appearance = require('../frontend/js/appearance.js');
const SecretStrip = require('../frontend/js/secret_strip.js');

function extract(source, name) {
  const asyncMarker = 'async function ' + name + '(';
  const plainMarker = 'function ' + name + '(';
  let start = source.indexOf(asyncMarker);
  if (start === -1) start = source.indexOf(plainMarker);
  assert.ok(start !== -1, 'function ' + name + ' not found in app.js');
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

// A page that has the functions of app.js under test and stubs for everything they call.
function makePage(source, savedLocal, savedFile, startConfig) {
  const calls = [];
  const store = new Map();
  if (savedLocal) store.set('md_notepad_config_v3', savedLocal);
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  let fileText = savedFile || '';
  const config = startConfig || {
    text: {}, autocomplete: {}, vision: {}, voice: {}, cli: {}, image: {}, scraps: {}, discordBridge: {}, inbox: {}, action: {}, autoSelector: {},
    general: { theme: 'olive', language: 'en' }, shortcuts: {}
  };
  const rec = (name) => (...a) => { calls.push(name); return undefined; };
  const globals = {
    config, localStorage, console: { warn() {} }, Promise, JSON,
    hasSavedConfig: false, hasPersistedImeGuardianSetting: false, calmToolbarApplied: false, shortcutMigrationDirty: false, backendConfigLoadFailed: false,
    DEFAULT_SHORTCUTS: {}, usableShortcuts: (x) => x || {}, t: (k) => k, showMessage: rec('showMessage'),
    migrateInsertLineShortcuts: rec('mig1'), migrateZenShortcut: rec('mig2'), migrateAskShortcuts: rec('mig3'), migrateMacShortcuts: rec('mig4'),
    migrateFullscreenShortcut: rec('mig5'), migrateImeHelpers: rec('mig6'), applyImeGuardianCapabilityDefault: rec('ime'),
    applyCalmToolbarForNewProfile: rec('calm'), applyLanguage: rec('applyLanguage'), applyChromeLayout: rec('applyChromeLayout'),
    updateShortcutLabels: rec('labels'), updateActionStatus: rec('action'), renderAutosaveStatus: rec('autosave'), renderImeStatus: rec('ime-status'),
    applyTheme: () => { calls.push('applyTheme'); },
    window: {
      Appearance, SecretStrip,
      SlotAgent: { updateConfig: rec('slot') },
      backend: {
        getConfig: async () => fileText,
        saveConfig: async (text) => { fileText = text; calls.push('saveConfig'); }
      }
    }
  };
  const ctx = vm.createContext(globals);
  const names = ['legacyScrapSettings', 'loadAgentSafetyState', 'loadAppearanceGroup', 'appearanceSignature', 'loadLocalConfigSync', 'syncBackendConfig', 'savePersistentConfig'];
  const code = names.map((n) => extract(source, n)).join('\n') +
    '\nthis.__api = { loadLocalConfigSync, syncBackendConfig, savePersistentConfig, appearanceSignature };';
  vm.runInContext(code, ctx);
  return { ctx, api: ctx.__api, config, calls, store, file: () => fileText };
}

const APPEARANCE = { look: 'paper', accent: 'vermilion', accentCustom: '#112233', editorFont: 'Consolas', bars: 'glass', autoHide: false, splitBoundary: 'line', nested: { a: [1, 2] } };

// The scenario: save in one page, load the saved copies in fresh pages, save again.
async function roundTrip(source) {
  const problems = [];
  const same = (what, got) => { try { assert.deepStrictEqual(JSON.parse(JSON.stringify(got === undefined ? null : got)), APPEARANCE); } catch (e) { problems.push(what + ': config.appearance is ' + JSON.stringify(got)); } };

  // 1. a page with the setting saves
  const first = makePage(source);
  first.config.appearance = JSON.parse(JSON.stringify(APPEARANCE));
  first.config.general.theme = 'blue';
  assert.strictEqual(await first.api.savePersistentConfig(), true);
  const savedFile = first.file();
  const savedLocal = first.store.get('md_notepad_config_v3');
  if (JSON.parse(savedFile).appearance === undefined) problems.push('the save wrote no appearance into config.json');
  if (!savedLocal || JSON.parse(savedLocal).appearance === undefined) problems.push('the save wrote no appearance into the local copy');

  // 2. a fresh page loads the local copy (before the first paint)
  const second = makePage(source, savedLocal, '');
  second.api.loadLocalConfigSync();
  same('loadLocalConfigSync', second.config.appearance);
  if (!second.calls.includes('applyTheme')) problems.push('loadLocalConfigSync did not apply the setting');

  // 3. a fresh page loads config.json (the authority, a moment later)
  const third = makePage(source, '', savedFile);
  await third.api.syncBackendConfig();
  same('syncBackendConfig', third.config.appearance);

  // 3b. the file wins over the local copy, and the setting is applied when it differs
  const fourth = makePage(source, JSON.stringify({ general: { theme: 'olive' } }), savedFile);
  fourth.api.loadLocalConfigSync();
  await fourth.api.syncBackendConfig();
  same('local copy without it, then config.json', fourth.config.appearance);
  if (!fourth.calls.includes('applyTheme')) problems.push('syncBackendConfig did not apply an appearance that came from config.json');

  // 4. the second save of those pages keeps it (the trap: a group that was not read is lost here)
  for (const [name, page] of [['after loadLocalConfigSync', second], ['after syncBackendConfig', third], ['after both', fourth]]) {
    await page.api.savePersistentConfig();
    const again = JSON.parse(page.file()).appearance;
    try { assert.deepStrictEqual(again, APPEARANCE); } catch (e) { problems.push('the save ' + name + ' wrote appearance ' + JSON.stringify(again)); }
  }
  return problems;
}

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS: ' + name); } catch (e) { failed++; console.log('FAIL: ' + name); console.log(e && e.message ? e.message : e); }
}

await check('F7: config.appearance survives save -> reload (local copy and config.json) -> save, unknown keys included', async () => {
  const problems = await roundTrip(appJs);
  assert.deepEqual(problems, [], 'the setting is lost somewhere:\n  ' + problems.join('\n  '));
});

await check('a config saved before the setting existed keeps its accent (general.theme) and a save does not invent an appearance', async () => {
  const old = JSON.stringify({ general: { theme: 'forest', language: 'en' } });
  const page = makePage(appJs, old, '');
  page.api.loadLocalConfigSync();
  assert.strictEqual(page.config.appearance, undefined, 'nothing is made up');
  assert.strictEqual(Appearance.fromConfig(page.config).accent, 'forest', 'general.theme is the accent');
  assert.strictEqual(Appearance.fromConfig(page.config).look, 'ink');
  await page.api.savePersistentConfig();
  assert.strictEqual(JSON.parse(page.file()).appearance, undefined, 'a save of an old config does not write one');
  assert.strictEqual(JSON.parse(page.file()).general.theme, 'forest');
  // the signature that decides whether to apply: the same before and after loading the same config
  const sig = page.api.appearanceSignature();
  assert.strictEqual(sig, Appearance.signature(Appearance.normalize(undefined, 'forest')));
});

await check('a config.json whose appearance is not an object (hand-edited) is ignored, not copied', async () => {
  for (const bad of ['"paper"', '5', '[1,2]', 'null', 'true']) {
    const page = makePage(appJs, '', '{"general":{"theme":"blue"},"appearance":' + bad + '}');
    await page.api.syncBackendConfig();
    assert.strictEqual(page.config.appearance, undefined, 'appearance ' + bad + ' is left out');
    assert.strictEqual(Appearance.fromConfig(page.config).accent, 'blue');
  }
});

await check('the copy of the setting in the page is a new object (a later edit of the loaded config does not reach the saved file text)', async () => {
  const text = JSON.stringify({ appearance: { look: 'paper' } });
  const page = makePage(appJs, text, '');
  page.api.loadLocalConfigSync();
  page.config.appearance.look = 'ink';
  assert.strictEqual(JSON.parse(text).appearance.look, 'paper');
});

// The divider between two pages: the problems found in a copy of app.js (empty when it is right). A function of the source so that the
// mutation check below can hand it a broken one.
async function dividerProblems(source) {
  const problems = [];
  for (const value of Appearance.BOUNDARIES) {
    const first = makePage(source);
    first.config.appearance = { look: 'ink', accent: 'olive', splitBoundary: value };
    await first.api.savePersistentConfig();
    const file = first.file();
    const local = first.store.get('md_notepad_config_v3');
    if (JSON.parse(file).appearance.splitBoundary !== value) problems.push(value + ' is not in config.json');
    if (JSON.parse(local).appearance.splitBoundary !== value) problems.push(value + ' is not in the local copy');
    const second = makePage(source, local, file);
    second.api.loadLocalConfigSync();
    await second.api.syncBackendConfig();
    if (second.config.appearance.splitBoundary !== value) problems.push(value + ' is not loaded');
    await second.api.savePersistentConfig();
    if (JSON.parse(second.file()).appearance.splitBoundary !== value) problems.push(value + ' is not saved again');
  }
  // the window already shows the local copy (dots); config.json, the authority, says line: the page applies it (the signature differs)
  const local = JSON.stringify({ general: { theme: 'olive' }, appearance: { look: 'ink', accent: 'olive', splitBoundary: 'dots' } });
  const file = JSON.stringify({ general: { theme: 'olive' }, appearance: { look: 'ink', accent: 'olive', splitBoundary: 'line' } });
  const page = makePage(source, local, file);
  page.api.loadLocalConfigSync();
  page.calls.length = 0;
  await page.api.syncBackendConfig();
  if (page.config.appearance.splitBoundary !== 'line') problems.push('config.json did not win');
  if (!page.calls.includes('applyTheme')) problems.push('the divider that came from config.json was not applied');
  // and when the two say the same, nothing is applied again
  const same = makePage(source, file, file);
  same.api.loadLocalConfigSync();
  same.calls.length = 0;
  await same.api.syncBackendConfig();
  if (same.calls.includes('applyTheme')) problems.push('the same divider in both still applied twice');
  return problems;
}

await check('the divider between two pages (appearance.splitBoundary): each of the three values survives save -> load -> save, and config.json differing only in it is applied', async () => {
  assert.deepEqual(await dividerProblems(appJs), []);
});

await check('Settings reads its controls over the saved setting: a key with no control (a later phase\'s) is kept, the rest is normalized', () => {
  const fn = extract(appJs, 'readAppearanceControls');
  const values = { 'cfg-look': 'paper', 'cfg-theme': 'custom', 'cfg-accent-custom-hex': '#ABCDEF', 'cfg-editor-font': 'Fira Code', 'cfg-bars': 'solid', 'cfg-split-boundary': 'line' };
  const checks = { 'cfg-auto-hide': false };
  const ctx = vm.createContext({
    config: { general: { theme: 'blue' }, appearance: { look: 'ink', bars: 'glass', autoHide: true, splitBoundary: 'shade', futureKey: { later: 1 } } },
    document: { getElementById: (id) => (id in values || id in checks ? { value: values[id], checked: checks[id] } : null) },
    window: { Appearance }
  });
  vm.runInContext(fn + '\nthis.__read = readAppearanceControls;', ctx);
  const got = ctx.__read();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), { look: 'paper', accent: 'custom', accentCustom: '#abcdef', editorFont: 'Fira Code', bars: 'solid', autoHide: false, splitBoundary: 'line', futureKey: { later: 1 } }, 'the bars, auto-hide and the divider are read from their controls, the key with no control is kept');
  values['cfg-split-boundary'] = 'zigzag';
  assert.strictEqual(ctx.__read().splitBoundary, 'dots', 'a divider value that is not one of the three is not saved');
  values['cfg-split-boundary'] = 'shade';
  assert.strictEqual(ctx.__read().splitBoundary, 'shade');
  delete values['cfg-split-boundary'];
  assert.strictEqual(ctx.__read().splitBoundary, 'shade', 'a page without the control keeps the saved divider');
  values['cfg-split-boundary'] = 'line';
  values['cfg-theme'] = 'custom';
  values['cfg-accent-custom-hex'] = 'nonsense';
  assert.strictEqual(ctx.__read().accent, 'blue', 'a custom accent without a valid colour falls back to the old theme');
  values['cfg-editor-font'] = 'x";}body{';
  assert.strictEqual(ctx.__read().editorFont, '', 'a font name that is not a plain name is not saved');
  values['cfg-bars'] = 'frosted';
  assert.strictEqual(ctx.__read().bars, Appearance.DEFAULT_BARS, 'a bars value that is not one of the three is not saved');
  checks['cfg-auto-hide'] = true;
  assert.strictEqual(ctx.__read().autoHide, true);
});

await check('Save also writes the accent into general.theme (an older version reads only that) and applies only when something changed', () => {
  const save = appJs.slice(appJs.indexOf("document.getElementById('btn-save-settings').onclick"));
  assert.match(save, /config\.appearance = readAppearanceControls\(\);\s*config\.general\.theme = window\.Appearance\.legacyThemeFor\(config\.appearance, config\.general\.theme\);/);
  assert.match(save, /if \(config\.general\.theme !== prevGeneral\.theme \|\| appearancePreviewing \|\| appearanceSignature\(\) !== prevAppearanceSignature\) \{\s*applyTheme\(\);/);
  const cancel = extract(appJs, 'restoreLiveConfigFromSnapshot');
  assert.match(cancel, /if \(themeChanged \|\| appearancePreviewing\) applyTheme\(\);/, 'Cancel puts the saved look back when a preview was up');
});

await check('the editor font: the five editor rules read --editor-font-user in front of their own list, and appearance.js puts the chosen font in front of the editor list', () => {
  const css = read('frontend/css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = ['#editor', '#editor-secondary', '#ghost-overlay', '#line-numbers', '.secondary-editor-pane .line-numbers'];
  for (const sel of rules) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp('(?:^|\\})\\s*' + esc + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(m, sel + ' has a rule');
    assert.match(m[1], /font-family:\s*var\(--editor-font-user,\s*"Cascadia Code"/, sel + ' takes the typeface from --editor-font-user and falls back to its own list');
  }
  const editor = /#editor \{[^}]*font-family:\s*var\(--editor-font-user,\s*([^;]*)\);/.exec(css);
  assert.ok(editor, '#editor has the variable');
  assert.strictEqual(editor[1].trim(), Appearance.EDITOR_STACK, 'the list that follows the chosen font is the list of the editor itself (a glyph the font lacks falls back as before)');
  const count = (css.match(/var\(--editor-font-user/g) || []).length;
  assert.strictEqual(count, 5, 'exactly the five editor rules read it (the preview and the dialogs keep their own fonts)');
});

await check('mutation check: take the copy out of loadLocalConfigSync, or of syncBackendConfig, or of the helper, and the round trip fails', async () => {
  assert.deepEqual(await roundTrip(appJs), [], 'the real app.js passes (the premise of the mutations)');
  const lines = appJs.split('\n');
  const hits = lines.map((l, i) => (l.trim() === 'loadAppearanceGroup(parsed);' || l.includes('loadAppearanceGroup(fileConfig);') ? i : -1)).filter((i) => i >= 0);
  assert.strictEqual(hits.length, 2, 'loadAppearanceGroup is called once per loader');
  for (const at of hits) {
    const mutated = lines.slice();
    mutated[at] = '';
    const problems = await roundTrip(mutated.join('\n'));
    assert.ok(problems.length > 0, 'removing line ' + (at + 1) + ' (' + lines[at].trim() + ') must break the round trip');
  }
  const noCopy = appJs.replace("if (v && typeof v === 'object' && !Array.isArray(v)) config.appearance = Object.assign({}, v);", '');
  assert.notStrictEqual(noCopy, appJs, 'the mutation target exists');
  assert.ok((await roundTrip(noCopy)).length > 0, 'a helper that copies nothing breaks it');
  // the divider: a page that never applies what config.json says (the signature no longer decides), or never copies it
  assert.deepEqual(await dividerProblems(appJs), [], 'the real app.js passes the divider cases (the premise of the mutations)');
  const noApply = appJs.replace('if (appearanceSignature() !== prevAppearance) {', 'if (false) {');
  assert.notStrictEqual(noApply, appJs, 'the mutation target exists');
  assert.ok((await dividerProblems(noApply)).length > 0, 'a loader that does not apply a changed divider is caught');
  const alwaysApply = appJs.replace('if (appearanceSignature() !== prevAppearance) {', 'if (true) {');
  assert.ok((await dividerProblems(alwaysApply)).length > 0, 'a loader that applies a second time for nothing is caught');
  const shallowDrop = appJs.replace("config.appearance = Object.assign({}, v);", "config.appearance = { look: v.look, accent: v.accent };");
  assert.ok((await roundTrip(shallowDrop)).length > 0, 'a copy that keeps only the known keys drops the unknown ones and is caught');
});

console.log(failed ? '\n' + failed + ' appearance round-trip test(s) FAILED' : '\nAll appearance round-trip tests passed!');
if (failed) process.exit(1);
