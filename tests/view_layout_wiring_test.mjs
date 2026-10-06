// v2 P4 S1-S2: app.js puts the display the window is in on <body data-view>, the divider between two pages is a separator that the keyboard
// moves, and the wheel works over the desk around a sheet of paper. app.js is run against a hand-made DOM (like tests/second_panel_test.mjs),
// once as it is, and then broken on purpose in a number of ways: every break must be noticed (the mutation check at the end).
//
//   * the four functions that change the state (togglePreview, openSplitEditor, openPreviewToSide, closeSecondaryPane) name the display, and so
//     does a restored session; the answer is exactly js/view_layout.js's viewOf;
//   * a DOM with no dataset on <body>, or without view_layout.js loaded, does not make anything throw (64 other tests run app.js on such mocks);
//   * the divider: Tab reaches it (tabindex, role="separator", aria-valuenow), the keys move it as ViewLayout says and nothing else does, a
//     key during IME composition or with a modifier is left alone, a drag measures the room the divider leaves, the double click resets;
//   * the wheel listener exists only while a sheet is on screen (preview, side), forwards only a wheel over the desk, and leaves an HTML page alone.
//
// Node only. Run: node tests/view_layout_wiring_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf-8').replace(/\r\n/g, '\n');
const i18nCode = read('frontend/js/i18n.js');
const noteTitleCode = read('frontend/js/note_title.js');
const tabStripCode = read('frontend/js/tab_strip.js');
const viewLayoutCode = read('frontend/js/view_layout.js');
const previewImagesCode = read('frontend/js/preview_images.js');
const appCode = read('frontend/js/app.js');
const html = read('frontend/index.html');

// ---- a hand-made DOM (the part of second_panel_test.mjs that app.js needs) ---------------------------------------------------------
function createDOM(opts) {
  const elements = new Map();
  const windowListeners = new Map();
  function createMockElement(id, tagName = 'div') {
    const classList = new Set();
    let innerHTML = '', textContent = '', value = '', title = '';
    const el = {
      id: id || '', tagName: tagName.toUpperCase(), dataset: {}, style: {},
      setAttribute(k, v) { (this._attrs = this._attrs || {})[k] = String(v); },
      getAttribute(k) { return this._attrs && k in this._attrs ? this._attrs[k] : null; },
      removeAttribute(k) { if (this._attrs) delete this._attrs[k]; },
      selectionStart: 0, selectionEnd: 0, scrollTop: 0, scrollHeight: 4000, clientHeight: 500, offsetHeight: 500, offsetWidth: 500, onclick: null, onload: null,
      classList: {
        add: (...cls) => cls.forEach((c) => classList.add(c)),
        remove: (...cls) => cls.forEach((c) => classList.delete(c)),
        toggle: (c, force) => { if (force !== undefined) { if (force) classList.add(c); else classList.delete(c); return force; } if (classList.has(c)) { classList.delete(c); return false; } classList.add(c); return true; },
        contains: (c) => classList.has(c)
      },
      get className() { return Array.from(classList).join(' '); },
      set className(v) { classList.clear(); if (v) v.split(/\s+/).filter(Boolean).forEach((c) => classList.add(c)); },
      get innerHTML() { return innerHTML; },
      set innerHTML(v) { innerHTML = v; textContent = v; if (v === '') { this.children = []; this.childNodes = []; } },
      get textContent() { return textContent || innerHTML || value; },
      set textContent(v) { textContent = v; innerHTML = v; },
      get value() { return value; }, set value(v) { value = v; },
      get title() { return title; }, set title(v) { title = v; },
      children: [], childNodes: [],
      appendChild(child) { this.children.push(child); child.parentElement = this; if (child.tagName === 'SCRIPT' || child.tagName === 'LINK') process.nextTick(() => { if (child.onload) child.onload(); }); return child; },
      removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentElement = null; return child; },
      after() {},
      closest(sel) { let cur = this; while (cur) { if (sel.startsWith('.') && cur.classList && cur.classList.contains(sel.slice(1))) return cur; if (sel.startsWith('#') && cur.id === sel.slice(1)) return cur; cur = cur.parentElement; } return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener(evt, handler) { if (!el._listeners) el._listeners = new Map(); if (!el._listeners.has(evt)) el._listeners.set(evt, []); el._listeners.get(evt).push(handler); },
      removeEventListener(evt, handler) { if (el._listeners && el._listeners.has(evt)) el._listeners.set(evt, el._listeners.get(evt).filter((h) => h !== handler)); },
      listenerCount(evt) { return el._listeners && el._listeners.has(evt) ? el._listeners.get(evt).length : 0; },
      trigger(evt, eventObj = {}) {
        if (!eventObj.target) eventObj.target = el;
        if (evt === 'click' && typeof el.onclick === 'function') el.onclick(eventObj);
        if (el._listeners && el._listeners.has(evt)) [...el._listeners.get(evt)].forEach((h) => h(eventObj));
      },
      focus() { documentMock.activeElement = el; el.trigger('focus'); },
      select() {},
      setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
      getBoundingClientRect() { return el._rect || { top: 0, left: 0, width: 500, height: 500, right: 500, bottom: 500 }; }
    };
    if (opts.noDataset && id === 'body') delete el.dataset; // a <body> that has no dataset (some of the 64 mocks)
    if (id) elements.set(id, el);
    return el;
  }
  const documentMock = {
    documentElement: createMockElement('html'), activeElement: null, hasFocus: () => true,
    getElementById: (id) => elements.get(id) || createMockElement(id),
    querySelector: (sel) => (sel.startsWith('#') ? elements.get(sel.slice(1)) || createMockElement(sel.slice(1)) : null),
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement(null, tag),
    body: createMockElement('body'), head: createMockElement('head'),
    addEventListener() {}, removeEventListener() {}
  };
  const windowMock = {
    document: documentMock,
    backend: { getLocale: async () => 'en', getPlatform: async () => 'windows', loadConfig: async () => '{}', saveConfig: async () => {}, loadSession: async () => '{}', saveSession: async () => {}, openExternal() {} },
    localStorage: { _data: { ...(opts.storage || {}) }, getItem: (k) => windowMock.localStorage._data[k] || null, setItem: (k, v) => { windowMock.localStorage._data[k] = String(v); }, removeItem: (k) => { delete windowMock.localStorage._data[k]; } },
    navigator: { platform: 'Win32', userAgent: 'Windows' },
    screen: { width: 1920, height: 1080 },
    addEventListener: (evt, handler) => { if (!windowListeners.has(evt)) windowListeners.set(evt, []); windowListeners.get(evt).push(handler); },
    removeEventListener: (evt, handler) => { if (windowListeners.has(evt)) windowListeners.set(evt, windowListeners.get(evt).filter((h) => h !== handler)); },
    trigger: (evt, eventObj = {}) => { if (windowListeners.has(evt)) [...windowListeners.get(evt)].forEach((h) => h(eventObj)); },
    setTimeout: (fn) => { process.nextTick(fn); return 1; }, clearTimeout() {},
    requestAnimationFrame: (fn) => { process.nextTick(fn); return 1; },
    markdownit: () => ({ render: (src) => `<p>${src}</p>` }),
    katex: { renderToString: (s) => `[KATEX:${s}]` },
    mermaid: { initialize() {}, render: async (id, code) => ({ svg: `<svg>${code}</svg>` }) },
    SlotAgent: { attachEditor() {} }
  };
  return { elements, windowMock, documentMock };
}

function run(source, opts = {}) {
  const { elements, windowMock, documentMock } = createDOM(opts);
  const context = vm.createContext({
    window: windowMock, document: documentMock, localStorage: windowMock.localStorage, navigator: windowMock.navigator, screen: windowMock.screen,
    setTimeout: windowMock.setTimeout, clearTimeout: windowMock.clearTimeout, requestAnimationFrame: windowMock.requestAnimationFrame,
    console, Date, Math, Promise, Array, Object, String, Number, RegExp, Map, Set, process
  });
  vm.runInContext(i18nCode, context);
  vm.runInContext(noteTitleCode, context);
  vm.runInContext(tabStripCode, context);
  vm.runInContext(previewImagesCode, context); // the preview installs its picture rule from here
  if (opts.viewLayout !== false) vm.runInContext(viewLayoutCode, context);
  vm.runInContext(source, context);
  return { elements, window: context.window, helper: context.window.__testHelper, body: documentMock.body };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const view = (env) => env.body.dataset && env.body.dataset.view;

// ---- everything that is checked about one copy of app.js: the list of what is wrong (empty when all is well) ---------------------------------------
async function problemsOf(source) {
  const p = [];
  const note = (cond, text) => { if (!cond) p.push(text); };
  const guard = async (name, fn) => { try { await fn(); } catch (e) { p.push(name + ' threw: ' + (e && e.message)); } };

  // the display follows the state, whichever function changed it
  await guard('the four displays', async () => {
    const env = run(source);
    const rpc = env.window.__mdMemoRPC;
    note(!!rpc && !!env.helper, 'the page exposes its test helper and its RPC');
    await env.helper.openSplitEditor(); await tick();
    note(view(env) === 'pair', 'openSplitEditor: two editors are "pair" (got ' + view(env) + ')');
    await env.helper.openPreviewToSide(); await tick();
    note(view(env) === 'side', 'openPreviewToSide: "side" (got ' + view(env) + ')');
    env.helper.closeSecondaryPane(); await tick();
    note(view(env) === 'page', 'closeSecondaryPane: back to one "page" (got ' + view(env) + ')');
    await rpc.setUiState({ preview: 'full' }); await tick();
    note(view(env) === 'preview', 'togglePreview (RPC preview full): "preview" (got ' + view(env) + ')');
    await rpc.setUiState({ preview: 'off' }); await tick();
    note(view(env) === 'page', 'togglePreview again: "page" (got ' + view(env) + ')');
    await env.helper.toggleSplitMode(); await tick();
    note(view(env) === 'pair', 'toggleSplitMode: "pair" (got ' + view(env) + ')');
    await rpc.setUiState({ preview: 'full' }); await tick();
    note(view(env) === 'preview', 'the full preview closes a split on its way in: "preview" (got ' + view(env) + ')');
    await env.helper.openSplitEditor(); await tick();
    note(view(env) === 'pair', 'a split closes the full preview: "pair" (got ' + view(env) + ')');
    await rpc.setUiState({ preview: 'full' }); await tick();
    await env.helper.openPreviewToSide(); await tick();
    note(view(env) === 'side', 'the side preview closes the full preview: "side" (got ' + view(env) + ')');
  });

  // a restored session shows the display it was closed in
  await guard('restoring a session', async () => {
    const tabs = [{ id: 'tab_1', title: 'Doc 1.md', content: '# Doc 1', path: '', isDirty: false }, { id: 'tab_2', title: 'Doc 2.md', content: '# Doc 2', path: '', isDirty: false }];
    const session = (extra) => ({ md_memo_session_v1: JSON.stringify({ activeTabId: 'tab_1', tabs, ...extra }) });
    let env = run(source, { storage: session({ isSplitMode: true, secondaryTabId: 'tab_2', secondaryViewMode: 'editor' }) }); await tick(); await tick();
    note(view(env) === 'pair', 'a session closed with two editors comes back as "pair" (got ' + view(env) + ')');
    env = run(source, { storage: session({ isSplitMode: true, secondaryTabId: 'tab_1', secondaryViewMode: 'preview' }) }); await tick(); await tick();
    note(view(env) === 'side', 'a session closed with the preview beside the editor comes back as "side" (got ' + view(env) + ')');
    env = run(source, { storage: session({ isSplitMode: false, isPreviewMode: true }) }); await tick(); await tick();
    note(view(env) === 'preview', 'a session closed in the preview comes back as "preview" (got ' + view(env) + ')');
    env = run(source, { storage: session({ isSplitMode: false }) }); await tick(); await tick();
    note(view(env) === undefined || view(env) === 'page', 'and one closed on one page stays one page (got ' + view(env) + ')');
  });

  // mocks that lack what the page has must not break anything
  await guard('a body with no dataset', async () => {
    const env = run(source, { noDataset: true });
    await env.helper.openSplitEditor(); await tick();
    env.helper.closeSecondaryPane(); await tick();
    await env.window.__mdMemoRPC.setUiState({ preview: 'full' }); await tick();
  });
  await guard('no view_layout.js loaded', async () => {
    const env = run(source, { viewLayout: false });
    await env.helper.openSplitEditor(); await tick();
    note(view(env) === undefined, 'with no ViewLayout the display is not named at all');
    const rz = env.elements.get('pane-resizer');
    const before = env.elements.get('editor-pane').style.flex;
    rz.trigger('keydown', { key: 'ArrowRight', preventDefault() {} });
    note(env.elements.get('editor-pane').style.flex === before || /%$/.test(env.elements.get('editor-pane').style.flex), 'the divider still has a flex basis without ViewLayout');
    env.helper.closeSecondaryPane(); await tick();
  });

  // the wheel over the desk: a wheel listener makes every wheel event go to the main thread (a hit test of the whole tree, 6 ms in a long note), so it is on
  // only while the pointer is over the desk, and the pointer is watched only in the two displays that have one
  await guard('the wheel over the desk', async () => {
    const env = run(source);
    const ws = env.elements.get('workspace'), sec = env.elements.get('secondary-pane'), rz = env.elements.get('pane-resizer');
    const previewPane = env.elements.get('preview-pane'), side = env.elements.get('secondary-preview-pane'), editor = env.elements.get('editor');
    const wheels = () => ws.listenerCount('wheel'), watchers = () => ws.listenerCount('pointerover');
    const fire = (target, extra) => ws.trigger('wheel', { target, deltaY: 120, deltaMode: 0, ctrlKey: false, defaultPrevented: false, ...extra });
    const over = (target) => ws.trigger('pointerover', { target });
    note(wheels() === 0 && watchers() === 0 && ws.listenerCount('pointerleave') === 0, 'on one page nothing listens: not to the wheel, not to the pointer');
    await env.window.__mdMemoRPC.setUiState({ preview: 'full' }); await tick();
    note(watchers() === 1 && ws.listenerCount('pointerleave') === 1, 'the preview alone watches where the pointer is (got ' + watchers() + ')');
    note(wheels() === 0, 'but has no wheel listener while the pointer is not over the desk (got ' + wheels() + ')');
    over(previewPane);
    note(wheels() === 0, 'a pointer over the sheet is no reason to listen to the wheel');
    over(ws);
    note(wheels() === 1, 'a pointer over the desk puts the wheel listener on (got ' + wheels() + ')');
    over(ws); over(ws);
    note(wheels() === 1, 'and a pointer that stays over the desk does not add it again (got ' + wheels() + ')');
    previewPane.scrollTop = 100; fire(ws);
    note(previewPane.scrollTop === 220, 'a wheel over the desk scrolls the sheet by its delta (got ' + previewPane.scrollTop + ')');
    previewPane.scrollTop = 100; fire(editor);
    note(previewPane.scrollTop === 100, 'a wheel whose target is anything else is left to the browser');
    previewPane.scrollTop = 100; fire(ws, { ctrlKey: true });
    note(previewPane.scrollTop === 100, 'Ctrl+wheel (zoom) is left alone');
    previewPane.scrollTop = 100; fire(ws, { deltaY: 3, deltaMode: 1 });
    note(previewPane.scrollTop === 148, 'a wheel counted in lines is 16px a line (got ' + previewPane.scrollTop + ')');
    previewPane.scrollTop = 100; fire(ws, { deltaY: 0 });
    note(previewPane.scrollTop === 100, 'a sideways wheel does nothing');
    previewPane.classList.add('html-mode'); previewPane.scrollTop = 100; fire(ws);
    note(previewPane.scrollTop === 100, 'an HTML page scrolls inside its frame: the desk does not push it');
    previewPane.classList.remove('html-mode');
    over(previewPane);
    note(wheels() === 0, 'a pointer that moves onto the sheet takes the wheel listener off (got ' + wheels() + ')');
    over(ws); ws.trigger('pointerleave', {});
    note(wheels() === 0, 'and so does a pointer that leaves the window (got ' + wheels() + ')');
    over(ws);
    await env.helper.openPreviewToSide(); await tick();
    note(watchers() === 1, 'from the preview alone to the side preview there is still just one pointer listener (got ' + watchers() + ')');
    over(sec);
    note(wheels() === 1, 'beside the editor the desk is the right page (got ' + wheels() + ')');
    side.scrollTop = 50; fire(sec);
    note(side.scrollTop === 170, 'a wheel over it scrolls the sheet beside the editor (got ' + side.scrollTop + ')');
    side.scrollTop = 50; over(rz); fire(rz);
    note(wheels() === 1 && side.scrollTop === 170, 'the divider\'s grip is desk too');
    side.scrollTop = 50; over(editor);
    note(wheels() === 0, 'the editor beside it keeps its own wheel: the listener goes off over it (got ' + wheels() + ')');
    side.scrollTop = 50; fire(editor);
    note(side.scrollTop === 50, 'and a wheel that is dispatched anyway is not the desk\'s');
    over(sec);
    await env.helper.openSplitEditor(); await tick();
    note(watchers() === 0 && wheels() === 0 && ws.listenerCount('pointerleave') === 0, 'two editors have no sheet: nothing listens, and the wheel listener that was on is off (got ' + watchers() + ', ' + wheels() + ')');
    await env.window.__mdMemoRPC.setUiState({ preview: 'full' }); await tick();
    over(ws);
    env.window.__mdMemoRPC.setUiState({ preview: 'off' }); await tick(); await tick();
    note(watchers() === 0 && wheels() === 0, 'leaving the preview takes both away (got ' + watchers() + ', ' + wheels() + ')');
  });

  // the divider
  await guard('the divider', async () => {
    const env = run(source);
    await env.helper.openSplitEditor(); await tick();
    const rz = env.elements.get('pane-resizer'), left = env.elements.get('editor-pane'), ws = env.elements.get('workspace');
    const key = (k, extra = {}) => { const ev = { key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, prevented: false, stopped: false, preventDefault() { ev.prevented = true; }, stopPropagation() { ev.stopped = true; }, ...extra }; rz.trigger('keydown', ev); return ev; };
    const basis = () => (left.style.flex.match(/\* ([0-9.]+)\)$/) || [])[1];
    const valuenow = () => rz.getAttribute('aria-valuenow');
    note(/^0 0 calc\(\(100% - var\(--split-w, 5px\)\) \* 0\.5000\)$/.test(left.style.flex), 'half and half is a calc of the room the divider leaves (got ' + left.style.flex + ')');
    note(valuenow() === '50', 'aria-valuenow says 50 (got ' + valuenow() + ')');
    let ev = key('ArrowRight');
    note(basis() === '0.5200' && valuenow() === '52' && ev.prevented, 'ArrowRight: two points to the right, the key is taken (got ' + basis() + ', ' + valuenow() + ')');
    ev = key('ArrowLeft', { shiftKey: true });
    note(basis() === '0.4200' && valuenow() === '42', 'Shift+ArrowLeft: ten points to the left (got ' + basis() + ')');
    key('Home'); note(basis() === '0.1500' && valuenow() === '15', 'Home: the narrowest left page (got ' + basis() + ')');
    key('End'); note(basis() === '0.8500' && valuenow() === '85', 'End: the widest (got ' + basis() + ')');
    key('ArrowRight', { shiftKey: true }); note(basis() === '0.8500', 'and no further (got ' + basis() + ')');
    ev = key('Enter'); note(basis() === '0.5000' && valuenow() === '50' && ev.prevented, 'Enter: half and half again (got ' + basis() + ')');
    ev = key('a'); note(!ev.prevented && basis() === '0.5000', 'any other key is not taken');
    ev = key('ArrowRight', { isComposing: true }); note(!ev.prevented && basis() === '0.5000', 'a key during IME composition is left alone');
    ev = key('ArrowRight', { ctrlKey: true }); note(!ev.prevented && basis() === '0.5000', 'a key with Ctrl is left alone');
    ev = key('ArrowRight', { altKey: true }); note(!ev.prevented && basis() === '0.5000', 'a key with Alt is left alone');
    ev = key('ArrowRight', { metaKey: true }); note(!ev.prevented && basis() === '0.5000', 'a key with Cmd is left alone');
    key('ArrowRight'); rz.trigger('dblclick'); note(basis() === '0.5000' && valuenow() === '50', 'the double click resets to half and half (got ' + basis() + ')');

    // a drag: the room is the window (1000px) minus the divider (24px); the left page was 488px
    ws._rect = { top: 0, left: 0, width: 1000, height: 700, right: 1000, bottom: 700 };
    rz._rect = { top: 0, left: 488, width: 24, height: 700, right: 512, bottom: 700 };
    left._rect = { top: 0, left: 0, width: 488, height: 700, right: 488, bottom: 700 };
    rz.trigger('pointerdown', { button: 0, clientX: 500, pointerId: 1 });
    env.window.trigger('pointermove', { clientX: 500 });
    note(basis() === '0.5000', 'a drag that has not moved is half and half (got ' + basis() + ')');
    env.window.trigger('pointermove', { clientX: 600 });
    note(basis() === '0.6025' && valuenow() === '60', 'dragged 100px: (488+100)/976 of the room, not of the window (got ' + basis() + ', ' + valuenow() + ')');
    env.window.trigger('pointermove', { clientX: -5000 });
    note(basis() === '0.1500', 'dragged out of the window: kept at 15% (got ' + basis() + ')');
    env.window.trigger('pointerup', {});
    env.window.trigger('pointermove', { clientX: 800 });
    note(basis() === '0.1500', 'after the button is up the divider does not follow the pointer');
    // a window with no room to share (the divider is as wide as the window): the drag changes nothing
    rz.trigger('dblclick');
    ws._rect = { top: 0, left: 0, width: 20, height: 700, right: 20, bottom: 700 };
    rz.trigger('pointerdown', { button: 0, clientX: 10, pointerId: 1 });
    env.window.trigger('pointermove', { clientX: 15 });
    env.window.trigger('pointerup', {});
    note(basis() === '0.5000', 'a drag in a window with no room to share leaves the ratio alone (got ' + basis() + ')');
    left._rect = rz._rect = ws._rect = null;
    env.helper.closeSecondaryPane(); await tick();
  });
  return p;
}

let failed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => console.log('PASS: ' + name), (e) => { failed++; console.log('FAIL: ' + name + '\n  ' + (e && e.message)); });
}

await check('app.js names the display, moves the divider and forwards the wheel as described', async () => {
  const problems = await problemsOf(appCode);
  assert.deepEqual(problems, []);
});

await check('the page: the script comes before app.js, <body> starts on "page", the divider is a separator Tab can reach', () => {
  assert.ok(html.indexOf('js/view_layout.js') > 0 && html.indexOf('js/view_layout.js') < html.indexOf('js/app.js'), 'view_layout.js is loaded before app.js');
  assert.match(html, /<body [^>]*data-view="page"/, 'the first paint is one page');
  const tag = html.match(/<div id="pane-resizer"[^>]*>/)[0];
  for (const a of ['role="separator"', 'aria-orientation="vertical"', 'tabindex="0"', 'aria-valuemin="15"', 'aria-valuemax="85"', 'aria-valuenow="50"', 'data-i18n-title="tipPaneResizer"']) assert.ok(tag.includes(a), 'the divider has ' + a);
  assert.match(html, /<div id="pane-resizer"[^>]* class="pane-resizer hidden"/, 'hidden until there are two pages');
  const ctx = vm.createContext({});
  vm.runInContext(i18nCode, ctx);
  const I18N = vm.runInContext('I18N', ctx);
  for (const lang of ['en', 'ja']) assert.ok(/Enter/.test(I18N[lang].tipPaneResizer), lang + ': the tip says the keyboard can do it (Enter resets)');
  assert.ok(!/[぀-ヿ一-鿿]/.test(I18N.en.tipPaneResizer), 'and the English has no Japanese');
});

await check('mutation check: broken copies of app.js are caught', async () => {
  const mutations = [
    ['togglePreview does not name the display (in)', "syncStripMode(); // the preview alone has no strip\n      applyViewMode();", "syncStripMode(); // the preview alone has no strip"],
    ['togglePreview does not name the display (out)', "      syncStripMode();\n      applyViewMode();\n      editorEl.focus();", "      syncStripMode();\n      editorEl.focus();"],
    ['openSplitEditor does not name the display', "      if (btnTogglePreview) btnTogglePreview.classList.remove('active');\n    }\n    applyViewMode();\n\n    activePane = 'secondary';", "      if (btnTogglePreview) btnTogglePreview.classList.remove('active');\n    }\n\n    activePane = 'secondary';"],
    ['openPreviewToSide does not name the display', "applyViewMode();\n\n    await ensureRendererLibraries();\n    activePane = 'primary';", "\n    await ensureRendererLibraries();\n    activePane = 'primary';"],
    ['closeSecondaryPane does not name the display', "applyViewMode();\n    activePane = 'primary';\n    updatePaneFocusClasses();", "activePane = 'primary';\n    updatePaneFocusClasses();"],
    ['the display is written even when it did not change', 'if (view === currentView) return view;', ''],
    ['the display is not written', 'if (document.body && document.body.dataset) document.body.dataset.view = view;', ''],
    ['the display is written without a guard', 'if (document.body && document.body.dataset) document.body.dataset.view = view;', 'document.body.dataset.view = view;'],
    ['the display ignores the split', 'viewOf({ isPreviewMode, isSplitMode, secondaryViewMode })', 'viewOf({ isPreviewMode, isSplitMode: false, secondaryViewMode })'],
    ['the wheel listener is never taken away', "else workspaceEl.removeEventListener('wheel', onDeskWheel);", ''],
    ['the wheel listener is on from the start of the display (the cost of a wheel listener is paid for every wheel event)', "workspaceEl.addEventListener('pointerover', onDeskPointerOver, { passive: true });", "workspaceEl.addEventListener('pointerover', onDeskPointerOver, { passive: true });\n      setDeskWheel(true);"],
    ['the pointer is watched on every display', "watchDesk(view === 'side' || view === 'preview');", 'watchDesk(true);'],
    ['the pointer watch is never taken away', "      workspaceEl.removeEventListener('pointerover', onDeskPointerOver);\n", ''],
    ['the pointer watch is added again at every change', 'if (on === deskWatch || !workspaceEl', 'if (!workspaceEl'],
    ['the wheel listener stays on when the pointer leaves the desk', 'setDeskWheel(isDesk(e.target));', 'if (isDesk(e.target)) setDeskWheel(true);'],
    ['the wheel listener stays on when the pointer leaves the window', "function onDeskPointerLeave() {\n    setDeskWheel(false);", "function onDeskPointerLeave() {\n    "],
    ['the wheel listener stays on when the display has no desk', "      workspaceEl.removeEventListener('pointerleave', onDeskPointerLeave);\n      setDeskWheel(false);", "      workspaceEl.removeEventListener('pointerleave', onDeskPointerLeave);"],
    ['the desk is only the workspace', 'return node === workspaceEl || node === secondaryPane || node === paneResizer;', 'return node === workspaceEl;'],
    ['the desk takes every wheel', 'if (e.ctrlKey || e.defaultPrevented || !e.deltaY || !isDesk(e.target)) return;', 'if (e.ctrlKey || e.defaultPrevented || !e.deltaY) return;'],
    ['the desk takes the zoom wheel', 'if (e.ctrlKey || e.defaultPrevented || !e.deltaY || !isDesk(e.target)) return;', 'if (e.defaultPrevented || !e.deltaY || !isDesk(e.target)) return;'],
    ['the desk pushes an HTML page', "if (!sheet || sheet.classList.contains('html-mode')) return;", 'if (!sheet) return;'],
    ['a wheel in lines counts as pixels', 'e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sheet.clientHeight : 1)', 'e.deltaY'],
    ['the desk scrolls the wrong sheet', 'const sheet = isPreviewMode ? previewPane : secondaryPreviewPane;', 'const sheet = secondaryPreviewPane;'],
    ['the drag counts the divider as room', 'VL.ratioAfterDrag(startLeftWidth, moveEv.clientX - startX, totalWidth, dividerWidth)', 'VL.ratioAfterDrag(startLeftWidth, moveEv.clientX - startX, totalWidth, 0)'],
    ['the drag measures the window, not the divider', 'const dividerWidth = paneResizer.getBoundingClientRect().width;', 'const dividerWidth = workspaceEl.getBoundingClientRect().width;'],
    ['the ratio is not a calc of the room', "VL ? `0 0 ${VL.basisOf(splitRatio, '--split-w')}`", 'VL ? `0 0 ${(splitRatio * 100).toFixed(2)}%`'],
    ['aria-valuenow is never told', "paneResizer.setAttribute('aria-valuenow', String(VL.percentOf(splitRatio)));", ''],
    ['the keys do not reach the divider', "paneResizer.addEventListener('keydown', (e) => {", "paneResizer.addEventListener('keydownx', (e) => {"],
    ['a key is not taken', '      e.preventDefault();\n      e.stopPropagation();\n      splitRatio = next;', '      splitRatio = next;'],
    ['IME composition moves the divider', 'if (!VL || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;', 'if (!VL || e.ctrlKey || e.altKey || e.metaKey) return;'],
    ['Ctrl+arrow moves the divider', 'if (!VL || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;', 'if (!VL || e.isComposing || e.altKey || e.metaKey) return;'],
    ['Shift is ignored', 'VL.ratioAfterKey(splitRatio, e.key, e.shiftKey)', 'VL.ratioAfterKey(splitRatio, e.key, false)'],
    ['the double click does not reset', "paneResizer.addEventListener('dblclick', () => {\n      splitRatio = 0.5;", "paneResizer.addEventListener('dblclick', () => {\n      splitRatio = splitRatio;"],
    ['a drag with no answer still moves the divider', 'if (ratio === null) return;', '']
  ];
  const bad = [];
  for (const [name, find, replace] of mutations) {
    if (!appCode.includes(find)) { bad.push('target missing (the mutation no longer applies): ' + name); continue; }
    const problems = await problemsOf(appCode.replace(find, replace));
    if (problems.length === 0) bad.push('SURVIVED: ' + name);
  }
  assert.deepEqual(bad, [], 'not caught:\n  ' + bad.join('\n  '));
  console.log('  all ' + mutations.length + ' mutations of app.js are caught');
});

if (failed) {
  console.log(failed + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nAll view layout wiring tests PASSED!');
