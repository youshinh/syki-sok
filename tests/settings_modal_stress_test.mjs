// Stateful stress and VM isolation tests for syki::sok Settings Modal (SykiSettingsModal + app.js).
// Verifies tab switching, snapshot rollback on Cancel, duplicate-open guard, listener deduplication,
// async provider-detection race cancellation, and unsaved-note preservation across Settings Save/Cancel.
//
//   node tests/settings_modal_stress_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const SykiSettingsModal = require('../frontend/js/settings_modal.js');

const HIDDEN_AT_START = new Set([
  'settings-modal', 'context-menu', 'text-provider-detect-line',
  'find-replace-bar', 'goto-line-modal', 'quick-pick-modal', 'inline-prompt-bar',
  'cli-filter-bar', 'cli-filter-preview', 'stat-llm-indicator', 'mobile-drop-modal',
  'confirm-modal', 'scraps-search-modal', 'stat-selection', 'secondary-pane',
  'pane-resizer', 'preview-pane', 'inline-prompt-error', 'inline-prompt-setup'
]);

const TABS = ['general', 'model', 'agent', 'sync', 'shortcuts'];
const TAB_ALIASES = ['general', 'model', 'agent', 'sync', 'shortcuts', 'text', 'autocomplete', 'vision', 'image', 'cli', 'scraps', 'keys'];
const EXPECTED_CANONICAL = {
  general: 'general',
  text: 'general',
  model: 'model',
  autocomplete: 'model',
  vision: 'model',
  image: 'model',
  agent: 'agent',
  cli: 'agent',
  sync: 'sync',
  scraps: 'sync',
  shortcuts: 'shortcuts',
  keys: 'shortcuts'
};

function makeDomHarness() {
  const elements = new Map();
  const windowListeners = {};

  const addListener = (map, evt, fn, option) => {
    const capture = option === true || !!(option && typeof option === 'object' && option.capture);
    (map[evt] = map[evt] || []).push({ fn, capture });
  };
  const removeListener = (map, evt, fn, option) => {
    const capture = option === true || !!(option && typeof option === 'object' && option.capture);
    map[evt] = (map[evt] || []).filter((l) => !(l.fn === fn && l.capture === capture));
  };
  const makeEvent = (type, init) => Object.assign({
    type, key: '', code: '', keyCode: 0, isComposing: false, shiftKey: false, ctrlKey: false,
    altKey: false, metaKey: false, repeat: false, defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.propagationStopped = true; }
  }, init);

  let doc;

  function createEl(id, tagName = 'div') {
    const classes = new Set(HIDDEN_AT_START.has(id) ? ['hidden'] : []);
    const attrs = {};
    let innerHTML = '';
    let textContent = '';
    const el = {
      id,
      tagName: tagName.toUpperCase(),
      dataset: {},
      style: {},
      children: [],
      checked: false,
      disabled: false,
      value: '',
      title: '',
      placeholder: '',
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: 'none',
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 1000,
      clientHeight: 500,
      offsetHeight: 500,
      offsetWidth: 500,
      onclick: null,
      _listeners: {},
      _listenerCount(evt) { return (el._listeners[evt] || []).length; },
      classList: {
        add: (...cls) => cls.forEach((c) => classes.add(c)),
        remove: (...cls) => cls.forEach((c) => classes.delete(c)),
        toggle: (c, force) => {
          const on = force === undefined ? !classes.has(c) : !!force;
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
        contains: (c) => classes.has(c)
      },
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      get innerHTML() { return innerHTML; },
      set innerHTML(v) { innerHTML = v; textContent = v; if (v === '') el.children = []; },
      get textContent() { return textContent; },
      set textContent(v) { textContent = v; innerHTML = v; },
      addEventListener: (evt, fn, option) => addListener(el._listeners, evt, fn, option),
      removeEventListener: (evt, fn, option) => removeListener(el._listeners, evt, fn, option),
      dispatchEvent: (e) => dispatchOn(el, e.type, e),
      focus: () => { doc.activeElement = el; dispatchOn(el, 'focus', {}); },
      blur: () => { if (doc.activeElement === el) doc.activeElement = doc.body; },
      select: () => { el.selectionStart = 0; el.selectionEnd = String(el.value || '').length; },
      setSelectionRange: (s, e, dir) => { el.selectionStart = s; el.selectionEnd = e; if (dir) el.selectionDirection = dir; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 500, right: 600, bottom: 500 }),
      scrollIntoView: () => {},
      appendChild: (child) => { el.children.push(child); child.parentElement = el; return child; },
      insertBefore: (node, ref) => {
        const i = el.children.indexOf(ref);
        if (i !== -1) el.children.splice(i, 0, node); else el.children.push(node);
        node.parentElement = el;
        return node;
      },
      querySelector: (sel) => (sel.startsWith('#') ? elements.get(sel.slice(1)) || null : null),
      querySelectorAll: () => [],
      getAttribute: (name) => (name in attrs ? attrs[name] : (name === 'data-i18n' ? el.dataset.i18n || null : null)),
      hasAttribute: (name) => name in attrs,
      setAttribute: (name, val) => { attrs[name] = val; if (name === 'data-i18n') el.dataset.i18n = val; },
      removeAttribute: (name) => { delete attrs[name]; },
      closest: () => null,
      contains: (target) => target === el || el.children.some((c) => c === target || (c.contains && c.contains(target)))
    };
    return el;
  }

  function dispatchOn(el, evt, init) {
    const e = makeEvent(evt, init);
    e.target = el;
    const run = (capture) => {
      (el._listeners[evt] || []).filter((l) => l.capture === capture).slice().forEach((l) => l.fn(e));
      return e.propagationStopped;
    };
    if (run(true)) return e;
    run(false);
    return e;
  }

  doc = {
    getElementById(id) {
      let el = elements.get(id);
      if (!el) {
        const tag = (id === 'editor' || id === 'editor-secondary') ? 'textarea' : 'div';
        el = createEl(id, tag);
        elements.set(id, el);
      }
      return el;
    },
    querySelector: (sel) => (sel.startsWith('#') ? doc.getElementById(sel.slice(1)) : null),
    querySelectorAll: () => [],
    createElement: (tag) => createEl('', tag),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: null,
    hasFocus: () => true,
    hidden: false,
    documentElement: { lang: 'en' }
  };
  doc.body = createEl('body');
  doc.activeElement = doc.getElementById('editor');

  return { elements, doc, windowListeners, addListener, removeListener, makeEvent, dispatchOn };
}

// ---------------------------------------------------------------------------
// Part A: SykiSettingsModal stateful stress (120 cycles + async race)
// ---------------------------------------------------------------------------
async function runSettingsModalUnitStress() {
  const { doc } = makeDomHarness();
  const byId = (id) => doc.getElementById(id);

  // Pre-register key modal/tab elements so SettingsModal.open sees full DOM.
  const tabBtns = Object.fromEntries(TABS.map((name) => [name, byId('tab-btn-' + name)]));
  const panes = Object.fromEntries(TABS.map((name) => [name, byId('pane-' + name)]));
  const settingsModal = byId('settings-modal');
  const contextMenu = byId('context-menu');
  const activeEditor = byId('editor');
  byId('cfg-base-url');
  byId('cfg-model');
  byId('cfg-api-key');
  byId('cfg-autosave');
  byId('cfg-language');
  byId('cfg-theme');
  byId('cfg-scrap-dir');
  byId('cfg-tab-strip-width');
  byId('cfg-tab-hide-delay');
  byId('cfg-tab-hide-duration');
  byId('cfg-tab-dock');
  byId('cfg-tab-dock-strength');
  byId('text-provider-detect-line');

  const config = {
    default_agent: 'claude-code',
    timeout_seconds: 180,
    ghost_diff_duration_ms: 4000,
    hover_peek_enabled: true,
    general: {
      language: 'en',
      theme: 'olive',
      autoSave: false,
      trayResident: true,
      toolbarLayout: { order: ['btn-new', 'btn-open'], hidden: [] },
      contextMenuLayout: { order: ['ctx-copy'], hidden: ['ctx-cut'] },
      cloudConsent: { 'generativelanguage.googleapis.com': true }
    },
    text: {
      model: 'gemini-3.8-flash',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'secret-init'
    },
    scraps: { scrapDir: '~/Documents/syki-sok/scraps', gitSyncEnabled: false },
    shortcuts: { globalSummon: 'Ctrl+Alt+M', quickCapture: 'Ctrl+Shift+C' }
  };

  let snapshot = null;
  let snapshotCount = 0;
  let recordingAction = null;
  let clearRecordingCount = 0;
  let lastDetectedProvider = null;
  let shortcutsDirty = true;
  let shortcutsRendered = 0;
  let refreshRequested = false;
  let applyLangCalls = 0;
  let applyThemeCalls = 0;
  let applyLayoutCalls = 0;
  let clearShortcutCacheCalls = 0;

  let detectCalls = 0;
  let detectResolvers = [];

  const win = {
    backend: {
      detectLLMProvider() {
        detectCalls++;
        return new Promise((resolve) => detectResolvers.push(resolve));
      },
      retypeWithImeAsync: () => {}
    },
    Appearance: {
      fromConfig: (c) => ({ theme: c.general.theme }),
      normalize: () => ({}),
      signature: () => 'sig'
    },
    VoiceProfiles: {
      resolve: () => ({ model: 'gemini-3.5-transcribe', apiStyle: 'auto' })
    },
    MermaidTone: { normalizeTone: (t) => t || 'auto' },
    SlotAgent: { updateConfig: () => {} }
  };

  const modal = SykiSettingsModal.create({
    document: doc,
    window: win,
    t: (k) => k,
    oneLineFailure: (e) => String(e),
    getConfig: () => config,
    setSnapshot: (s) => { snapshot = s; snapshotCount++; },
    getSnapshot: () => snapshot,
    consumeRefreshRequested: () => { const v = refreshRequested; refreshRequested = false; return v; },
    getElements: () => ({
      settingsModal,
      contextMenu,
      tabBtnGeneral: tabBtns.general,
      tabBtnModel: tabBtns.model,
      tabBtnAgent: tabBtns.agent,
      tabBtnSync: tabBtns.sync,
      tabBtnShortcuts: tabBtns.shortcuts,
      paneGeneral: panes.general,
      paneModel: panes.model,
      paneAgent: panes.agent,
      paneSync: panes.sync,
      paneShortcuts: panes.shortcuts
    }),
    getActiveEditor: () => activeEditor,
    getRecordingAction: () => recordingAction,
    clearRecordingAction: () => { recordingAction = null; clearRecordingCount++; },
    isShortcutsDirtyOrUnrendered: () => shortcutsDirty,
    renderShortcutsTable: () => { shortcutsRendered++; shortcutsDirty = false; },
    updateOllamaStatus: () => {},
    checkActiveAgentsConfigStatus: () => {},
    checkGitInstalledStatusUI: () => {},
    updateGitRepoStatusUI: () => {},
    setLastDetectedProvider: (p) => { lastDetectedProvider = p; },
    renderProviderDetectLine: () => {},
    syncTextProviderSelect: () => {},
    updateApiKeyPlaceholders: () => {},
    listToText: (v) => (Array.isArray(v) ? v.join(', ') : ''),
    voiceRefineEnabled: () => false,
    initMeetingAudioSettings: () => {},
    cliResultPlacement: () => 'below',
    showAppearanceControls: () => {},
    updateImeGuardianCapabilityHint: () => {},
    applyTrayCapabilityUI: () => {},
    updateCheckAtStartup: () => true,
    renderCloudConsentRow: () => {},
    getAutoSelectorConfig: () => ({ enabled: false, agentConfirm: false }),
    updateAutoSelectorFieldStates: () => {},
    updateCFBridgeFieldStates: () => {},
    getPlatformCapabilities: () => ({ os: 'win32' }),
    isMac: () => false,
    updateQuickActionsFieldStates: () => {},
    refreshSendToStatus: () => {},
    refreshFileTypesStatus: () => {},
    updateShortcutLabels: () => {},
    clearShortcutParseCache: () => { clearShortcutCacheCalls++; },
    applyLanguage: () => { applyLangCalls++; },
    getIsAppearancePreviewing: () => false,
    applyTheme: () => { applyThemeCalls++; },
    applyChromeLayout: () => { applyLayoutCalls++; }
  });

  for (let i = 0; i < 120; i++) {
    const expectedSnapBefore = snapshotCount + 1;
    modal.open();
    assert.strictEqual(snapshotCount, expectedSnapBefore, `cycle ${i}: open() should snapshot`);
    assert.strictEqual(settingsModal.classList.contains('hidden'), false);

    // Calling open() while already visible must preserve original snapshot (must not overwrite).
    modal.open();
    assert.strictEqual(snapshotCount, expectedSnapBefore, `cycle ${i}: duplicate open() overwrote snapshot`);

    for (const rawTab of TAB_ALIASES) {
      if (rawTab === 'shortcuts') shortcutsDirty = true;
      modal.switchTab(rawTab);
      const canon = EXPECTED_CANONICAL[rawTab];
      const activeBtns = TABS.filter((n) => tabBtns[n].classList.contains('active'));
      const visiblePanes = TABS.filter((n) => !panes[n].classList.contains('hidden'));
      assert.deepStrictEqual(activeBtns, [canon], `cycle ${i} tab ${rawTab}: expected single active tab button ${canon}`);
      assert.deepStrictEqual(visiblePanes, [canon], `cycle ${i} tab ${rawTab}: expected single visible pane ${canon}`);

      if (canon === 'shortcuts') {
        recordingAction = 'quickCapture';
      } else if (recordingAction !== null) {
        assert.fail(`cycle ${i}: switching away from shortcuts did not clear recordingAction`);
      }
    }

    // Mutate live config fields, then cancel on even/most iterations to verify full rollback.
    config.general.language = 'ja';
    config.general.theme = 'bamboo';
    config.default_agent = 'codex-cli';
    config.shortcuts = { globalSummon: 'Ctrl+Alt+Z', quickCapture: 'Ctrl+Shift+X' };
    config.general.toolbarLayout = { order: ['btn-save'], hidden: ['btn-new'] };
    config.general.cloudConsent = { 'api.openai.com': true };

    modal.cancel();
    assert.strictEqual(settingsModal.classList.contains('hidden'), true);
    assert.strictEqual(config.general.language, 'en');
    assert.strictEqual(config.general.theme, 'olive');
    assert.strictEqual(config.default_agent, 'claude-code');
    assert.strictEqual(config.shortcuts.globalSummon, 'Ctrl+Alt+M');
    assert.deepStrictEqual(config.general.toolbarLayout, { order: ['btn-new', 'btn-open'], hidden: [] });
    assert.deepStrictEqual(config.general.cloudConsent, { 'generativelanguage.googleapis.com': true });
  }

  assert.strictEqual(byId('cfg-api-key')._listenerCount('input'), 1, 'cfg-api-key input listener leaked across 120 opens');
  assert.strictEqual(byId('cfg-tab-strip-width')._listenerCount('input'), 1, 'cfg-tab-strip-width input listener leaked across 120 opens');
  assert.ok(applyLangCalls === 120 && applyThemeCalls === 120 && applyLayoutCalls === 120 && clearShortcutCacheCalls === 120);
  assert.ok(shortcutsRendered >= 120 && clearRecordingCount >= 120);

  // Async race test for updateProviderDetection: second request resolves first, stale first response resolves last and must be ignored.
  detectResolvers = [];
  lastDetectedProvider = null;
  byId('cfg-base-url').value = 'http://localhost:11434';
  const pSlow = modal.updateProviderDetection();
  byId('cfg-base-url').value = 'https://generativelanguage.googleapis.com';
  const pFast = modal.updateProviderDetection();
  assert.strictEqual(detectResolvers.length, 2, 'expected two detectLLMProvider calls');
  detectResolvers[1]('gemini');
  await pFast;
  assert.strictEqual(lastDetectedProvider, 'gemini');
  detectResolvers[0]('ollama');
  await pSlow;
  assert.strictEqual(lastDetectedProvider, 'gemini', 'stale detectLLMProvider response overwrote latest provider');

  // Allow open()'s 20ms/50ms deferred timers to flush cleanly without errors.
  await new Promise((r) => setTimeout(r, 70));
}

// ---------------------------------------------------------------------------
// Part B: Real app.js + settings_modal.js VM isolation under 20 Settings cycles
// ---------------------------------------------------------------------------
async function runAppVmSettingsIsolationStress() {
  const harness = makeDomHarness();
  const { elements, doc, windowListeners, addListener, removeListener, makeEvent, dispatchOn } = harness;
  const undoStack = [];
  const store = new Map();
  const errors = [];
  const savedConfigs = [];
  const savedSessions = [];
  const heldTimers = new Map();
  let timerSeq = 0;

  // Wire textarea undo value property on #editor (same pattern as stability_lifecycle_fuzz_test.mjs).
  const editorEl = doc.getElementById('editor');
  let editorText = '';
  Object.defineProperty(editorEl, 'value', {
    configurable: true,
    enumerable: true,
    get: () => editorText,
    set: (v) => { editorText = String(v); undoStack.length = 0; }
  });
  editorEl._setValueKeepingHistory = (v) => { editorText = String(v); };

  doc.execCommand = (cmd, _, text) => {
    if (cmd !== 'insertText') return false;
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    undoStack.push({ before: editorEl.value, start, end, inserted: text });
    editorEl._setValueKeepingHistory(editorEl.value.substring(0, start) + text + editorEl.value.substring(end));
    editorEl.selectionStart = editorEl.selectionEnd = start + text.length;
    return true;
  };

  let persistedConfig = JSON.stringify({
    default_agent: 'claude-code',
    general: { language: 'en', theme: 'olive', autoSave: false, trayResident: true },
    scraps: { scrapDir: '~/Documents/syki-sok/scraps', gitSyncEnabled: false }
  });

  const backend = {
    getConfig: async () => persistedConfig,
    saveConfig: async (json) => {
      JSON.parse(json);
      persistedConfig = json;
      savedConfigs.push(json);
      return true;
    },
    getPlatformCapabilities: async () => ({ os: 'win32', nativeImeSwitch: true, tray: true, globalHotkey: true }),
    detectLLMProvider: async () => 'gemini',
    getGitRepoStatus: async () => ({ is_git: false }),
    getSession: async () => null,
    saveSession: async (json) => { savedSessions.push(json); },
    getStartupFile: async () => null,
    trimMemory: async () => {},
    watchActiveFile: () => {},
    unwatchActiveFile: () => {},
    scanFolderFiles: async () => [],
    closeWindow: () => {},
    readFileByPath: async (p) => ({ path: p, content: '# Daily Scrap\n- background entry\n', encoding: 'UTF-8' }),
    saveFile: async () => ({ success: true, mtime: Date.now() }),
    saveFileChecked: async () => ({ success: true, mtime: Date.now() }),
    saveFileAs: async () => null,
    queryLLMAsync: () => {}
  };

  const setTimeoutMock = (fn, ms) => {
    const id = ++timerSeq;
    if (typeof ms === 'number' && ms >= 100) {
      heldTimers.set(id, { fn, ms });
      return id;
    }
    fn();
    return id;
  };

  const windowMock = {
    document: doc,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    backend,
    navigator: { platform: 'Win32', userAgent: 'Windows', language: 'en-US' },
    addEventListener: (evt, fn, option) => addListener(windowListeners, evt, fn, option),
    removeEventListener: (evt, fn, option) => removeListener(windowListeners, evt, fn, option),
    setTimeout: setTimeoutMock,
    clearTimeout: (id) => { heldTimers.delete(id); },
    requestAnimationFrame: (fn) => { fn(); return 1; },
    innerWidth: 1200,
    innerHeight: 800,
    TaskManager: { addTask: (o) => o, updateTask: () => {} }
  };
  doc.defaultView = windowMock;

  const logArgs = (args) => Array.from(args).map((a) => (a && a.stack ? a.stack.split('\n')[0] : String(a))).join(' ');
  const context = {
    window: windowMock,
    document: doc,
    localStorage: windowMock.localStorage,
    navigator: windowMock.navigator,
    setTimeout: setTimeoutMock,
    clearTimeout: windowMock.clearTimeout,
    requestAnimationFrame: windowMock.requestAnimationFrame,
    Date,
    URL,
    Event: class { constructor(type, init) { Object.assign(this, { type, defaultPrevented: false }, init || {}); } },
    console: {
      log() {},
      warn() {},
      error: (...a) => errors.push('console.error: ' + logArgs(a))
    }
  };
  vm.createContext(context);

  const read = (p) => fs.readFileSync(path.resolve(p), 'utf-8').replace(/\r\n/g, '\n');
  const scriptFiles = [
    'frontend/js/i18n.js',
    'frontend/js/chrome_layout.js',
    'frontend/js/mermaid_tone.js',
    'frontend/js/llm_error.js',
    'frontend/js/note_title.js',
    'frontend/js/note_hash.js',
    'frontend/js/disk_sync.js',
    'frontend/js/first_run.js',
    'frontend/js/rpc_bridge.js',
    'frontend/js/search_workbench.js',
    'frontend/js/settings_modal.js',
    'frontend/js/app.js'
  ];

  const flush = async () => {
    for (let i = 0; i < 16; i++) await new Promise((r) => setImmediate(r));
  };

  for (const file of scriptFiles) {
    new vm.Script(read(file), { filename: file }).runInContext(context);
    await flush();
  }

  const rpc = windowMock.__sykiRPC;
  assert.ok(rpc, '__sykiRPC missing');

  const clickEl = (id) => {
    const e = doc.getElementById(id);
    if (typeof e.onclick === 'function') e.onclick(makeEvent('click', { target: e }));
    dispatchOn(e, 'click', {});
  };

  const tabA = rpc.openTab({ title: 'keep-clean.md', content: '# Clean note\n', background: true });
  const tabB = rpc.openTab({ title: 'dirty-note.md', content: '# Dirty base\n', background: false });
  const dirtyText = '# Dirty base\nUNSAVED_USER_DRAFT_MARKER_991\n';
  editorEl.value = dirtyText;
  editorEl.selectionStart = editorEl.selectionEnd = dirtyText.length;
  dispatchOn(editorEl, 'input', {});

  const settingsModal = doc.getElementById('settings-modal');
  const autosaveCheckbox = doc.getElementById('cfg-autosave');
  let expectedSaves = 0;

  for (let i = 0; i < 20; i++) {
    clickEl('btn-settings');
    assert.strictEqual(settingsModal.classList.contains('hidden'), false, `cycle ${i}: settings modal did not open`);

    clickEl('tab-btn-model');
    clickEl('tab-btn-sync');
    clickEl('tab-btn-general');

    const prevChecked = !!autosaveCheckbox.checked;
    autosaveCheckbox.checked = !prevChecked;

    if (i % 2 === 0) {
      clickEl('btn-save-settings');
      expectedSaves++;
      await flush();
      assert.strictEqual(savedConfigs.length, expectedSaves, `cycle ${i}: Save should call backend.saveConfig`);
    } else {
      clickEl('btn-cancel-settings');
      await flush();
      assert.strictEqual(savedConfigs.length, expectedSaves, `cycle ${i}: Cancel must not call backend.saveConfig`);
    }
    assert.strictEqual(settingsModal.classList.contains('hidden'), true, `cycle ${i}: settings modal did not close`);

    // Simulate background scrap arrival while dirty tab is active (must NOT clobber dirty note).
    if (typeof windowMock.onScrapAppended === 'function') {
      await windowMock.onScrapAppended({
        filePath: `/scraps/2026-11-${String((i % 28) + 1).padStart(2, '0')}.md`,
        fileName: `2026-11-${String((i % 28) + 1).padStart(2, '0')}.md`,
        date: '2026-11-19'
      });
      await flush();
    }

    rpc.switchTab(tabB.id);
    assert.ok(editorEl.value.includes('UNSAVED_USER_DRAFT_MARKER_991'), `cycle ${i}: dirty note content lost`);
    const curTabs = rpc.getTabs();
    const dirtyEntry = curTabs.find((t) => t.id === tabB.id);
    assert.ok(dirtyEntry && dirtyEntry.isModified, `cycle ${i}: isModified flag dropped`);
    assert.ok(curTabs.some((t) => t.id === tabA.id), `cycle ${i}: first tab lost`);
  }

  assert.strictEqual(expectedSaves, 10);
  assert.strictEqual(errors.length, 0, 'VM console errors observed: ' + errors.join(' | '));
}

await runSettingsModalUnitStress();
await runAppVmSettingsIsolationStress();
console.log('settings_modal_stress_test PASSED (120 modal cycles + async race + 20 VM isolation cycles).');
