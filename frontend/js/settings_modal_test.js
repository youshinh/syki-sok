const assert = require('assert');
const SykiSettingsModal = require('./settings_modal.js');

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (...c) => c.forEach((k) => set.add(k)),
    remove: (...c) => c.forEach((k) => set.delete(k)),
    toggle: (k, force) => {
      if (force === undefined) {
        if (set.has(k)) { set.delete(k); return false; }
        set.add(k); return true;
      }
      if (force) set.add(k); else set.delete(k);
      return !!force;
    },
    contains: (k) => set.has(k),
  };
}

function makeEl(initialClasses = []) {
  return {
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    dataset: {},
    focused: false,
    classList: makeClassList(initialClasses),
    addEventListener: () => {},
    focus() { this.focused = true; },
    querySelector: () => null,
    contains: () => false,
    closest: () => null,
  };
}

// 1. Tab switching normalizes legacy names and clears recording action
{
  let recording = 'save';
  const els = {
    settingsModal: makeEl(['hidden']),
    tabBtnGeneral: makeEl(),
    tabBtnModel: makeEl(),
    tabBtnAgent: makeEl(),
    tabBtnSync: makeEl(),
    tabBtnShortcuts: makeEl(),
    paneGeneral: makeEl(['hidden']),
    paneText: makeEl(),
    paneImage: makeEl(),
    paneModel: makeEl(['hidden']),
    paneAgent: makeEl(['hidden']),
    paneSync: makeEl(['hidden']),
    paneShortcuts: makeEl(['hidden']),
  };
  els.settingsModal.querySelector = () => ({ classList: makeClassList() });
  const modal = SykiSettingsModal.create({
    document: { getElementById: () => null, activeElement: null },
    window: {},
    getConfig: () => ({ general: {}, text: {} }),
    getElements: () => els,
    getRecordingAction: () => recording,
    clearRecordingAction: () => { recording = null; },
  });

  modal.switchTab('autocomplete'); // legacy alias -> model
  assert.strictEqual(els.tabBtnModel.classList.contains('active'), true);
  assert.strictEqual(els.paneModel.classList.contains('hidden'), false);
  assert.strictEqual(els.paneGeneral.classList.contains('hidden'), true);
  assert.strictEqual(recording, null);
}

// 2. Cancel restores live-mutated config fields from snapshot and closes modal
{
  const config = {
    default_agent: 'gemini-cli',
    general: { language: 'en', theme: 'dark', toolbarLayout: { order: ['b'], hidden: [] } },
    shortcuts: { save: 'Ctrl+K' },
  };
  const snap = {
    default_agent: 'claude-code',
    general: { language: 'ja', theme: 'light', toolbarLayout: { order: ['a'], hidden: [] } },
    shortcuts: { save: 'Ctrl+S' },
  };
  const calls = [];
  const editor = makeEl();
  const settingsModal = makeEl();
  const modal = SykiSettingsModal.create({
    document: { getElementById: () => null },
    window: {},
    getConfig: () => config,
    getSnapshot: () => snap,
    getElements: () => ({ settingsModal }),
    clearRecordingAction: () => calls.push('clearRec'),
    clearShortcutParseCache: () => calls.push('clearCache'),
    updateShortcutLabels: () => calls.push('updateLabels'),
    applyLanguage: () => calls.push('applyLang'),
    applyTheme: () => calls.push('applyTheme'),
    applyChromeLayout: () => calls.push('applyChrome'),
    getActiveEditor: () => editor,
  });

  modal.cancel();
  assert.strictEqual(config.general.language, 'ja');
  assert.strictEqual(config.general.theme, 'light');
  assert.strictEqual(config.default_agent, 'claude-code');
  assert.strictEqual(config.shortcuts.save, 'Ctrl+S');
  assert.deepStrictEqual(config.general.toolbarLayout.order, ['a']);
  assert.strictEqual(settingsModal.classList.contains('hidden'), true);
  assert.strictEqual(editor.focused, true);
  assert.ok(calls.includes('applyLang'));
  assert.ok(calls.includes('applyTheme'));
  assert.ok(calls.includes('applyChrome'));
}

// 3. Stale provider detection response is ignored
(async () => {
  const lineEl = makeEl(['hidden']);
  const urlEl = { value: 'http://localhost:11434' };
  let resolveFirst;
  let callCount = 0;
  let lastProvider = null;
  const modal = SykiSettingsModal.create({
    document: {
      getElementById: (id) => (id === 'text-provider-detect-line' ? lineEl : id === 'cfg-base-url' ? urlEl : null),
    },
    window: {
      backend: {
        detectLLMProvider: () => {
          callCount++;
          if (callCount === 1) return new Promise((r) => { resolveFirst = r; });
          return Promise.resolve('openai');
        },
      },
    },
    getConfig: () => ({}),
    setLastDetectedProvider: (p) => { lastProvider = p; },
    renderProviderDetectLine: () => {},
  });

  const p1 = modal.updateProviderDetection();
  urlEl.value = 'https://api.openai.com/v1';
  await modal.updateProviderDetection();
  resolveFirst('ollama');
  await p1;

  assert.strictEqual(lastProvider, 'openai');
  assert.strictEqual(lineEl.classList.contains('hidden'), false);

  // 4. inferBaseUrlForModel & shouldAutoFillBaseUrl
  const { inferBaseUrlForModel, shouldAutoFillBaseUrl } = SykiSettingsModal;
  assert.strictEqual(inferBaseUrlForModel('gemini-decision-1', { kind: 'action' }), 'https://generativelanguage.googleapis.com');
  assert.strictEqual(inferBaseUrlForModel('gemini-3.8-flash'), 'https://generativelanguage.googleapis.com');
  assert.strictEqual(inferBaseUrlForModel('gemini-embedding-2', { kind: 'embed' }), 'https://generativelanguage.googleapis.com');
  assert.strictEqual(inferBaseUrlForModel('gpt-6-luna', { kind: 'action' }), 'https://api.openai.com/v1');
  assert.strictEqual(inferBaseUrlForModel('gpt-6.1-sol'), 'https://api.openai.com/v1');
  assert.strictEqual(inferBaseUrlForModel('text-embedding-3-small', { kind: 'embed' }), 'https://api.openai.com/v1');
  assert.strictEqual(inferBaseUrlForModel('google/gemini-3.8-flash'), 'https://openrouter.ai/api/v1');
  assert.strictEqual(inferBaseUrlForModel('anthropic/claude-sonnet-5-5'), 'https://openrouter.ai/api/v1');
  assert.strictEqual(inferBaseUrlForModel('jev-latest', { kind: 'action' }), 'https://api.typesafe.ai');
  assert.strictEqual(inferBaseUrlForModel('gemma4:latest'), 'http://localhost:11434');
  assert.strictEqual(inferBaseUrlForModel('qwen3-vl:latest'), 'http://localhost:11434');
  assert.strictEqual(inferBaseUrlForModel('bge-m3', { kind: 'embed' }), 'http://localhost:11434');
  assert.strictEqual(inferBaseUrlForModel(''), null);

  assert.strictEqual(shouldAutoFillBaseUrl('', 'https://generativelanguage.googleapis.com'), true);
  assert.strictEqual(shouldAutoFillBaseUrl('http://localhost:11434', 'https://api.openai.com/v1'), true);
  assert.strictEqual(shouldAutoFillBaseUrl('https://custom.internal/v1', 'https://api.openai.com/v1'), false);
  assert.strictEqual(shouldAutoFillBaseUrl('http://localhost:1234/v1', 'http://localhost:11434'), false);

  console.log('settings_modal_test: 4 passed');
})();
