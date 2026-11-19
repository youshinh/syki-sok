// Combined stateful lifecycle fuzzer for syki::sok frontend (app.js + DiskSync + SykiRpcBridge).
// Exercises interleaved tab open/switch/close, typing edits, background RPC appends, gated slow saves
// (ok / fail / conflict), autosave & session-save timers, external scrap-appended notifications, and AI asks.
//
//   node tests/stability_lifecycle_fuzz_test.mjs
//   node tests/stability_lifecycle_fuzz_test.mjs --count 400 --steps 20
//   node tests/stability_lifecycle_fuzz_test.mjs --seed 20261119 --trace
//   node tests/stability_lifecycle_fuzz_test.mjs --ops "openTab(0,0) typeEdit(0,0) startSave(0,0) typeEdit(1,0) resolveSaveOk(0,0)"
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const argv = process.argv.slice(2);
const argValue = (name, dflt) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : Number(argv[i + 1]);
};
const SEQUENCES = argValue('--count', 100);
const STEPS = argValue('--steps', 16);
const ONE_SEED = argv.includes('--seed') ? argValue('--seed') : null;
const BASE_SEED = argValue('--base', 20261119);
const VERBOSE = argv.includes('--trace') || ONE_SEED !== null || argv.includes('--ops');
const seedFor = (i) => (BASE_SEED + i * 7919) >>> 0;

function parseOps(text) {
  return String(text).split(/\s+/).filter(Boolean).map((s) => {
    const m = /^(\w+)\((\d+),(\d+)\)$/.exec(s);
    if (!m) throw new Error('bad op syntax: ' + s);
    return { op: m[1], a: Number(m[2]), b: Number(m[3]) };
  });
}
const EXPLICIT_OPS = argv.includes('--ops') ? parseOps(argv[argv.indexOf('--ops') + 1]) : null;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const read = (p) => fs.readFileSync(path.resolve(p), 'utf-8').replace(/\r\n/g, '\n');
const SCRIPT_FILES = [
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
  'frontend/js/app.js'
];
const SCRIPTS = SCRIPT_FILES.map((file) => new vm.Script(read(file), { filename: file }));

const HIDDEN_AT_START = [
  'find-replace-bar', 'goto-line-modal', 'settings-modal', 'quick-pick-modal', 'inline-prompt-bar',
  'cli-filter-bar', 'cli-filter-preview', 'stat-llm-indicator', 'mobile-drop-modal', 'confirm-modal',
  'context-menu', 'scraps-search-modal', 'stat-selection', 'secondary-pane', 'pane-resizer',
  'preview-pane', 'inline-prompt-error', 'inline-prompt-setup'
];

async function flush() {
  for (let i = 0; i < 16; i++) await new Promise((resolve) => setImmediate(resolve));
}

function gate() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let currentErrors = null;
process.on('unhandledRejection', (reason) => {
  if (currentErrors) {
    currentErrors.push('unhandledRejection: ' + (reason && reason.stack ? reason.stack.split('\n')[0] : String(reason)));
  }
});

async function createEnv() {
  const elements = new Map();
  const windowListeners = {};
  const store = new Map();
  const undoStack = [];
  const diskFiles = new Map();
  const pendingSaves = [];
  const llmCalls = [];
  const savedSessions = [];
  const errors = [];
  let documentMock = null;

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

  function pressAtWindow(init) {
    const e = makeEvent('keydown', Object.assign({ target: documentMock.activeElement || documentMock.body }, init));
    const run = (capture) => {
      (windowListeners.keydown || []).filter((l) => l.capture === capture).slice().forEach((l) => l.fn(e));
      return e.propagationStopped;
    };
    if (run(true)) return e;
    run(false);
    return e;
  }

  function mockElement(id, tagName = 'div') {
    const classes = new Set(HIDDEN_AT_START.includes(id) ? ['hidden'] : []);
    const attrs = {};
    let innerHTML = '';
    let textContent = '';
    const el = {
      id, tagName: tagName.toUpperCase(), dataset: {}, style: {}, children: [], checked: false, disabled: false, value: '',
      title: '', placeholder: '', selectionStart: 0, selectionEnd: 0, selectionDirection: 'none', scrollTop: 0, scrollLeft: 0,
      scrollHeight: 1000, clientHeight: 500, offsetHeight: 500, offsetWidth: 500, onclick: null, _listeners: {},
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
      focus: () => { documentMock.activeElement = el; dispatchOn(el, 'focus', {}); },
      blur: () => { if (documentMock.activeElement === el) documentMock.activeElement = documentMock.body; },
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
      contains: () => false
    };
    if (id === 'editor') {
      let text = '';
      Object.defineProperty(el, 'value', {
        configurable: true,
        enumerable: true,
        get: () => text,
        set: (v) => { text = String(v); undoStack.length = 0; }
      });
      el._setValueKeepingHistory = (v) => { text = String(v); };
    }
    return el;
  }

  documentMock = {
    getElementById: (id) => {
      let el = elements.get(id);
      if (!el) {
        el = mockElement(id, (id === 'editor' || id === 'editor-secondary') ? 'textarea' : 'div');
        elements.set(id, el);
      }
      return el;
    },
    querySelector: (sel) => (sel.startsWith('#') ? documentMock.getElementById(sel.slice(1)) : null),
    querySelectorAll: () => [],
    createElement: (tag) => mockElement('', tag),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener: () => {},
    removeEventListener: () => {},
    execCommand: (cmd, _, text) => {
      if (cmd !== 'insertText') return false;
      const ed = elements.get('editor');
      const start = ed.selectionStart;
      const end = ed.selectionEnd;
      undoStack.push({ before: ed.value, start, end, inserted: text });
      ed._setValueKeepingHistory(ed.value.substring(0, start) + text + ed.value.substring(end));
      ed.selectionStart = ed.selectionEnd = start + text.length;
      return true;
    },
    activeElement: null,
    hasFocus: () => true,
    hidden: false,
    documentElement: { lang: 'en' }
  };
  documentMock.body = mockElement('body');
  documentMock.activeElement = documentMock.getElementById('editor');

  // Hold timers >= 100ms (autosave 1500, session save 500, scan 300, watchdog 180000) so fuzzer controls firing.
  const heldTimers = new Map();
  let timerSeq = 0;
  const setTimeoutMock = (fn, ms) => {
    const id = ++timerSeq;
    if (typeof ms === 'number' && ms >= 100) {
      heldTimers.set(id, { fn, ms });
      return id;
    }
    fn();
    return id;
  };

  let clockSkew = 0;
  class ClockedDate extends Date {
    static now() { return super.now() + clockSkew; }
  }

  const backend = {
    getConfig: async () => '',
    saveConfig: async () => {},
    getSession: async () => null,
    saveSession: async (json) => { savedSessions.push(json); },
    getStartupFile: async () => null,
    trimMemory: async () => {},
    watchActiveFile: () => {},
    unwatchActiveFile: () => {},
    scanFolderFiles: async () => [],
    closeWindow: () => {},
    readFileByPath: async (p) => {
      if (!diskFiles.has(p)) throw new Error('not found: ' + p);
      return { path: p, content: diskFiles.get(p), encoding: 'UTF-8' };
    },
    saveFile: (p, content, enc) => {
      const g = gate();
      const entry = { path: p, content, enc, checked: false, expectSig: '', gate: g, resolved: false };
      pendingSaves.push(entry);
      return g.promise;
    },
    saveFileChecked: (p, content, enc, expectSig) => {
      const g = gate();
      const entry = { path: p, content, enc, checked: true, expectSig, gate: g, resolved: false };
      pendingSaves.push(entry);
      return g.promise;
    },
    saveFileAs: async () => null,
    queryLLMAsync: (reqId, prompt, cfgJson) => {
      llmCalls.push({ reqId, prompt, cfg: JSON.parse(cfgJson), answered: false });
    }
  };

  const windowMock = {
    document: documentMock,
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
    TaskManager: {
      addTask: (o) => o,
      updateTask: () => {}
    }
  };
  documentMock.defaultView = windowMock;

  const logArgs = (args) => Array.from(args).map((a) => (a && a.stack ? a.stack.split('\n')[0] : String(a))).join(' ');
  const context = {
    window: windowMock,
    document: documentMock,
    localStorage: windowMock.localStorage,
    navigator: windowMock.navigator,
    setTimeout: setTimeoutMock,
    clearTimeout: windowMock.clearTimeout,
    requestAnimationFrame: windowMock.requestAnimationFrame,
    Date: ClockedDate,
    URL,
    Event: class { constructor(type, init) { Object.assign(this, { type, defaultPrevented: false }, init || {}); } },
    console: {
      log() {},
      warn() {},
      error: (...a) => errors.push('console.error: ' + logArgs(a))
    }
  };
  vm.createContext(context);
  currentErrors = errors;
  for (const script of SCRIPTS) {
    script.runInContext(context);
    await flush();
  }

  const el = (id) => documentMock.getElementById(id);
  const rpc = windowMock.__sykiRPC;
  const bridge = windowMock.SykiBridge;
  const diskSync = windowMock.DiskSync;

  return {
    window: windowMock,
    rpc,
    bridge,
    diskSync,
    editor: el('editor'),
    el,
    diskFiles,
    pendingSaves,
    llmCalls,
    savedSessions,
    errors,
    press: pressAtWindow,
    fire(id, evt, init) {
      return dispatchOn(el(id), evt, init);
    },
    type(text) {
      const ed = el('editor');
      ed.value = text;
      ed.selectionStart = ed.selectionEnd = text.length;
      dispatchOn(ed, 'input', {});
    },
    fireTimers(ms) {
      for (const [id, t] of Array.from(heldTimers)) {
        if (t.ms === ms) {
          heldTimers.delete(id);
          t.fn();
        }
      }
    },
    heldCount(ms) {
      return Array.from(heldTimers.values()).filter((t) => t.ms === ms).length;
    },
    tabs: () => rpc.getTabs().map((t) => ({ ...t })),
    activeTab: () => {
      const list = rpc.getTabs();
      return list.find((t) => t.isActive) || null;
    },
    tabContent: (tabId) => bridge.getTabText(tabId),
    modalOpen: () => !el('confirm-modal').classList.contains('hidden'),
    flush
  };
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

function countOccurrences(haystack, needle) {
  let n = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    n++;
    pos += needle.length;
  }
  return n;
}

const OP_NAMES = [
  'openTab',
  'switchTab',
  'typeEdit',
  'rpcAppend',
  'startSave',
  'resolveSaveOk',
  'resolveSaveFail',
  'resolveSaveConflict',
  'scrapAppendNotify',
  'fireAutosave',
  'fireSessionSave',
  'askAI',
  'resolveAIOk',
  'resolveAIFail',
  'closeCleanTab'
];

function newSession(env) {
  return {
    env,
    seq: 0,
    nextPathIdx: 0,
    tabStates: new Map(), // tabId -> { baseLine, tokens: Set<string>, editSeq: number }
    openSaveGates: [],    // { entry, tabId, path, sent, startEditSeq, editedAfterStart }
    dirtyDuringSaveFailed: false,
    scrapOverwriteFailed: false,
    trace: [],
    failures: [],
    fail(id, detail) {
      this.failures.push({ id, detail });
    }
  };
}

function ensureTabState(S, tab) {
  if (!S.tabStates.has(tab.id)) {
    const baseLine = tab.content ? tab.content.split('\n')[0] : '';
    S.tabStates.set(tab.id, { baseLine, tokens: new Set(), editSeq: 0 });
  }
  return S.tabStates.get(tab.id);
}

function syncSaveEditFlags(S) {
  for (const sg of S.openSaveGates) {
    if (sg.entry.resolved) continue;
    const st = S.tabStates.get(sg.tabId);
    if (st && st.editSeq > sg.startEditSeq) sg.editedAfterStart = true;
    const cur = S.env.tabContent(sg.tabId);
    if (cur !== null && cur !== sg.sent) sg.editedAfterStart = true;
  }
}

function captureNewSaves(S) {
  for (const entry of S.env.pendingSaves) {
    if (entry._tracked) continue;
    entry._tracked = true;
    const tab = S.env.tabs().find((t) => normPath(t.path) === normPath(entry.path));
    const tabId = tab ? tab.id : '';
    const st = tabId ? S.tabStates.get(tabId) : null;
    S.openSaveGates.push({
      entry,
      tabId,
      path: entry.path,
      diskWritten: entry.content,
      sent: tabId ? S.env.tabContent(tabId) : entry.content,
      startEditSeq: st ? st.editSeq : 0,
      editedAfterStart: false
    });
  }
}

function settleModalIfOpen(env) {
  if (env.modalOpen() && typeof env.el('confirm-modal-cancel').onclick === 'function') {
    env.el('confirm-modal-cancel').onclick();
    return true;
  }
  return false;
}

const pick = (list, n) => list[n % list.length];

async function runOp(S, op) {
  const { env } = S;
  const openSaves = () => S.openSaveGates.filter((g) => !g.entry.resolved);
  const openLLMs = () => env.llmCalls.filter((c) => !c.answered);

  switch (op.op) {
    case 'openTab': {
      const existing = env.tabs().filter((t) => t.path);
      if (existing.length >= 7) return false;
      if (env.modalOpen()) return false;
      const idx = ++S.nextPathIdx;
      const p = `C:\\fuzz\\note_${idx}.md`;
      const baseLine = `[BASE:${idx}] line`;
      const content = `${baseLine}\n`;
      env.diskFiles.set(p, content);
      const res = env.rpc.openTab({ title: `note_${idx}.md`, path: p, content });
      await env.flush();
      const tab = env.tabs().find((t) => t.id === res.id);
      if (tab) {
        const st = ensureTabState(S, tab);
        st.baseLine = baseLine;
        st.tokens.add(baseLine);
      }
      return true;
    }

    case 'switchTab': {
      if (env.modalOpen()) return false;
      const tabs = env.tabs();
      if (tabs.length < 2) return false;
      const target = pick(tabs, op.a);
      if (target.isActive) return false;
      env.rpc.switchTab(target.id);
      await env.flush();
      return true;
    }

    case 'typeEdit': {
      if (env.modalOpen()) return false;
      const active = env.activeTab();
      if (!active) return false;
      const st = ensureTabState(S, active);
      const tok = `[U:${++S.seq}]`;
      const cur = env.editor.value;
      const sep = cur === '' || cur.endsWith('\n') ? '' : '\n';
      env.type(cur + sep + tok + '\n');
      st.tokens.add(tok);
      st.editSeq++;
      syncSaveEditFlags(S);
      await env.flush();
      return true;
    }

    case 'rpcAppend': {
      const tabs = env.tabs();
      if (!tabs.length) return false;
      const target = pick(tabs, op.a);
      const st = ensureTabState(S, target);
      const tok = `[R:${++S.seq}]`;
      const cur = env.tabContent(target.id) || '';
      const sep = cur === '' || cur.endsWith('\n') ? '' : '\n';
      env.rpc.appendBuffer(sep + tok + '\n', target.id);
      st.tokens.add(tok);
      st.editSeq++;
      syncSaveEditFlags(S);
      await env.flush();
      return true;
    }

    case 'startSave': {
      if (env.modalOpen()) return false;
      const active = env.activeTab();
      if (!active || !active.path) return false;
      const before = env.pendingSaves.length;
      env.press({ key: 's', code: 'KeyS', ctrlKey: true });
      await env.flush();
      captureNewSaves(S);
      return env.pendingSaves.length > before;
    }

    case 'resolveSaveOk': {
      const list = openSaves();
      if (!list.length) return false;
      const sg = pick(list, op.a);
      syncSaveEditFlags(S);
      sg.entry.resolved = true;
      env.diskFiles.set(sg.path, sg.diskWritten);
      sg.entry.gate.resolve({
        path: sg.path,
        title: sg.path.split('\\').pop(),
        success: true,
        sig: env.diskSync.sum(sg.diskWritten)
      });
      await env.flush();
      captureNewSaves(S);
      const tabNow = env.tabs().find((t) => t.id === sg.tabId);
      if (tabNow && sg.editedAfterStart && !tabNow.isModified) {
        S.dirtyDuringSaveFailed = true;
        S.fail('dirty_during_save', `tab ${sg.tabId} edited during in-flight save became clean`);
      }
      return true;
    }

    case 'resolveSaveFail': {
      const list = openSaves();
      if (!list.length) return false;
      const sg = pick(list, op.a);
      sg.entry.resolved = true;
      sg.entry.gate.reject(new Error('disk full'));
      await env.flush();
      captureNewSaves(S);
      return true;
    }

    case 'resolveSaveConflict': {
      const list = openSaves().filter((g) => g.entry.checked);
      if (!list.length) return false;
      const sg = pick(list, op.a);
      sg.entry.resolved = true;
      sg.entry.gate.resolve({
        path: sg.path,
        title: sg.path.split('\\').pop(),
        success: false,
        conflict: true
      });
      await env.flush();
      // If manual Ctrl+S opened conflict modal, dismiss safely with Cancel to preserve unsaved text.
      if (settleModalIfOpen(env)) await env.flush();
      return true;
    }

    case 'scrapAppendNotify': {
      if (env.modalOpen()) return false;
      const fileTabs = env.tabs().filter((t) => t.path);
      if (!fileTabs.length) return false;
      const target = pick(fileTabs, op.a);
      const st = ensureTabState(S, target);
      const wasModified = target.isModified;
      const contentBefore = env.tabContent(target.id);
      const saveBusy = openSaves().some((g) => normPath(g.path) === normPath(target.path));
      const tok = `[S:${++S.seq}]`;
      const prevDisk = env.diskFiles.get(target.path) || '';
      const sep = prevDisk === '' || prevDisk.endsWith('\n') ? '' : '\n';
      env.diskFiles.set(target.path, prevDisk + sep + tok + '\n');

      await env.window.onScrapAppended({
        filePath: target.path,
        fileName: target.title,
        command: 'pipe'
      });
      await env.flush();

      const afterTab = env.tabs().find((t) => t.id === target.id);
      const contentAfter = env.tabContent(target.id);
      if (wasModified) {
        if (!afterTab || !afterTab.isModified || contentAfter !== contentBefore) {
          S.scrapOverwriteFailed = true;
          S.fail('unsaved_protected_from_scrap', `dirty tab ${target.id} was modified or marked clean by onScrapAppended`);
        }
      } else if (!saveBusy && afterTab) {
        st.tokens.add(tok);
      }
      return true;
    }

    case 'fireAutosave': {
      if (env.heldCount(1500) === 0) return false;
      env.fireTimers(1500);
      await env.flush();
      captureNewSaves(S);
      return true;
    }

    case 'fireSessionSave': {
      if (env.heldCount(500) === 0) return false;
      env.fireTimers(500);
      await env.flush();
      return true;
    }

    case 'askAI': {
      if (env.modalOpen()) return false;
      const active = env.activeTab();
      if (!active) return false;
      const st = ensureTabState(S, active);
      if (!st.baseLine) return false;
      const text = env.editor.value;
      const pos = text.indexOf(st.baseLine);
      if (pos === -1) return false;
      if (!env.el('inline-prompt-bar').classList.contains('hidden')) {
        env.press({ key: 'Escape', code: 'Escape', keyCode: 27 });
        await env.flush();
      }
      env.editor.selectionStart = pos;
      env.editor.selectionEnd = pos + st.baseLine.length;
      env.window.document.activeElement = env.editor;
      const before = env.llmCalls.length;
      env.press({ key: 'l', code: 'KeyL', ctrlKey: true });
      if (env.el('inline-prompt-bar').classList.contains('hidden')) return false;
      env.el('inline-prompt-input').value = `q${++S.seq}`;
      env.fire('inline-prompt-input', 'keydown', { key: 'Enter', keyCode: 13 });
      await env.flush();
      if (env.llmCalls.length > before) {
        const call = env.llmCalls[env.llmCalls.length - 1];
        call._tabId = active.id;
        call._tok = `[AI:${S.seq}]`;
        return true;
      }
      return false;
    }

    case 'resolveAIOk': {
      const list = openLLMs();
      if (!list.length) return false;
      const call = pick(list, op.a);
      call.answered = true;
      const stillOpen = env.tabs().some((t) => t.id === call._tabId);
      env.window.__onLLMResult(call.reqId, call._tok, '');
      if (stillOpen && S.tabStates.has(call._tabId)) {
        const st = S.tabStates.get(call._tabId);
        st.tokens.add(call._tok);
        st.editSeq++;
        syncSaveEditFlags(S);
      }
      await env.flush();
      return true;
    }

    case 'resolveAIFail': {
      const list = openLLMs();
      if (!list.length) return false;
      const call = pick(list, op.a);
      call.answered = true;
      env.window.__onLLMResult(call.reqId, '', 'simulated network failure');
      await env.flush();
      return true;
    }

    case 'closeCleanTab': {
      if (env.modalOpen()) return false;
      const tabs = env.tabs();
      if (tabs.length < 2) return false;
      const busyPaths = new Set(openSaves().map((g) => normPath(g.path)));
      const busyAI = new Set(openLLMs().map((c) => c._tabId));
      const clean = tabs.filter((t) => !t.isModified && !busyPaths.has(normPath(t.path)) && !busyAI.has(t.id));
      if (!clean.length) return false;
      const target = pick(clean, op.a);
      env.rpc.closeTab(target.id);
      await env.flush();
      S.tabStates.delete(target.id);
      return true;
    }

    default:
      throw new Error('unknown op: ' + op.op);
  }
}

function checkStepInvariants(S, phase) {
  const { env } = S;
  if (env.errors.length > 0) {
    S.fail('no_error', `${phase}: ${env.errors.join('; ')}`);
  }

  const tabs = env.tabs();
  const seenPaths = new Set();
  for (const t of tabs) {
    if (t.path) {
      const np = normPath(t.path);
      if (seenPaths.has(np)) {
        S.fail('unique_paths', `${phase}: duplicate open path ${t.path}`);
      }
      seenPaths.add(np);
    }
  }

  const active = tabs.find((t) => t.isActive);
  if (active) {
    const buf = env.tabContent(active.id);
    if (env.editor.value !== buf) {
      S.fail('editor_sync', `${phase}: editor.value (${env.editor.value.length}) != tab (${buf.length}) on ${active.id}`);
    }
  }

  for (const jsonStr of env.savedSessions) {
    try {
      JSON.parse(jsonStr);
    } catch (e) {
      S.fail('valid_session_json', `${phase}: invalid JSON sent to saveSession: ${e.message}`);
      break;
    }
  }
}

async function quiesceAndCheck(S) {
  const { env } = S;
  settleModalIfOpen(env);
  await env.flush();

  // Settle all pending LLM requests
  for (const call of env.llmCalls) {
    if (!call.answered) {
      call.answered = true;
      const stillOpen = env.tabs().some((t) => t.id === call._tabId);
      env.window.__onLLMResult(call.reqId, call._tok, '');
      if (stillOpen && S.tabStates.has(call._tabId)) {
        S.tabStates.get(call._tabId).tokens.add(call._tok);
      }
      await env.flush();
    }
  }

  // Drain all pending saves (including chained queued saves triggered while draining)
  let guard = 0;
  while (guard++ < 50) {
    captureNewSaves(S);
    const pending = S.openSaveGates.filter((g) => !g.entry.resolved);
    if (!pending.length) break;
    for (const sg of pending) {
      sg.entry.resolved = true;
      env.diskFiles.set(sg.path, sg.diskWritten);
      sg.entry.gate.resolve({
        path: sg.path,
        title: sg.path.split('\\').pop(),
        success: true,
        sig: env.diskSync.sum(sg.diskWritten)
      });
    }
    await env.flush();
    settleModalIfOpen(env);
  }

  // Fire remaining session save timer to verify final session JSON
  env.fireTimers(500);
  await env.flush();

  checkStepInvariants(S, 'quiesce');

  for (const tab of env.tabs()) {
    const text = env.tabContent(tab.id) || '';
    if (/\[AI (?:Generating|Correcting)|\[LLM error/.test(text)) {
      S.fail('applied_tokens_intact', `quiesce: leftover AI placeholder in tab ${tab.id}`);
    }
    const st = S.tabStates.get(tab.id);
    if (st) {
      for (const tok of st.tokens) {
        const count = countOccurrences(text, tok);
        if (count !== 1) {
          S.fail('applied_tokens_intact', `quiesce: token ${tok} count=${count} (want 1) in tab ${tab.id}`);
        }
      }
    }
  }
}

async function runSequence(opsOrSeed, stepsCount) {
  const env = await createEnv();
  const S = newSession(env);

  if (Array.isArray(opsOrSeed)) {
    for (const op of opsOrSeed) {
      const did = await runOp(S, op);
      if (VERBOSE) console.log(`  op ${op.op}(${op.a},${op.b}) -> ${did}`);
      checkStepInvariants(S, `${op.op}(${op.a},${op.b})`);
      if (S.failures.length) break;
    }
  } else {
    const rnd = mulberry32(opsOrSeed);
    // Start with 1 real file tab so ops immediately have a rich target
    await runOp(S, { op: 'openTab', a: 0, b: 0 });
    S.trace.push({ op: 'openTab', a: 0, b: 0 });
    for (let stepIdx = 0; stepIdx < stepsCount; stepIdx++) {
      let did = false;
      for (let tries = 0; tries < 10 && !did; tries++) {
        const op = {
          op: OP_NAMES[Math.floor(rnd() * OP_NAMES.length)],
          a: Math.floor(rnd() * 1000),
          b: Math.floor(rnd() * 1000)
        };
        did = await runOp(S, op);
        if (did) S.trace.push(op);
      }
      checkStepInvariants(S, `step ${stepIdx}`);
      if (S.failures.length) break;
    }
  }

  await quiesceAndCheck(S);
  return S;
}

async function shrinkOps(ops, targetId) {
  let cur = ops.slice();
  let changed = true;
  while (changed && cur.length > 1) {
    changed = false;
    for (let i = cur.length - 1; i >= 0; i--) {
      const candidate = cur.slice(0, i).concat(cur.slice(i + 1));
      const res = await runSequence(candidate, 0);
      if (res.failures.some((f) => f.id === targetId)) {
        cur = candidate;
        changed = true;
        break;
      }
    }
  }
  return cur;
}

const fmtOps = (ops) => ops.map((o) => `${o.op}(${o.a},${o.b})`).join(' ');

async function main() {
  if (EXPLICIT_OPS) {
    const res = await runSequence(EXPLICIT_OPS, 0);
    if (res.failures.length) {
      console.error('FAIL explicit ops:', res.failures);
      process.exit(1);
    }
    console.log(`PASS explicit ops (${EXPLICIT_OPS.length} steps)`);
    return;
  }

  if (ONE_SEED !== null) {
    const res = await runSequence(ONE_SEED, STEPS);
    if (res.failures.length) {
      const minOps = await shrinkOps(res.trace, res.failures[0].id);
      console.error(`FAIL seed=${ONE_SEED}: ${res.failures[0].id}: ${res.failures[0].detail}`);
      console.error(`Replay: node tests/stability_lifecycle_fuzz_test.mjs --ops "${fmtOps(minOps)}"`);
      process.exit(1);
    }
    console.log(`PASS seed=${ONE_SEED} (${res.trace.length} executed steps)`);
    return;
  }

  let totalOps = 0;
  for (let i = 0; i < SEQUENCES; i++) {
    const seed = seedFor(i);
    const res = await runSequence(seed, STEPS);
    totalOps += res.trace.length;
    if (res.failures.length) {
      const first = res.failures[0];
      const minOps = await shrinkOps(res.trace, first.id);
      console.error(`FAIL seq=${i} seed=${seed}: [${first.id}] ${first.detail}`);
      console.error(`Minimal ops: --ops "${fmtOps(minOps)}"`);
      process.exit(1);
    }
  }
  console.log(`PASS: ${SEQUENCES} sequences x ${STEPS} steps (${totalOps} ops executed), all invariants held.`);
}

await main();
