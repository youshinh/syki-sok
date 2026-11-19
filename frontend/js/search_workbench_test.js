const assert = require('assert');
const SykiSearchWorkbench = require('./search_workbench.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('PASS:', name);
}

function makeDeps() {
  const events = [];
  return {
    events,
    deps: {
      t: (k) => k,
      getConfig: () => ({ semantic: { enabled: false }, general: {} }),
      escapeHtml: (s) => String(s),
      showMessage: (msg) => events.push({ type: 'msg', msg }),
      oneLineFailure: (e) => String(e),
      backendErrorCode: () => '',
      getActiveEditor: () => null,
      getActiveTab: () => null,
      getSearchSeed: () => '',
      insertTextWithUndo: () => {},
      onEditorInput: () => {},
      findTabByPath: () => null,
      createTab: (title, content, path) => ({ id: 't1', title, content, path }),
      selectTab: (id) => events.push({ type: 'select', id }),
      showTab: () => {},
      renderTabs: () => {},
      saveSessionDebounced: () => {},
      gotoLineNumber: () => {},
      flashEditorLine: () => {},
      openAiModelsSettings: () => {},
      rememberCloudConsent: () => {},
      onDeepDialogChange: (open) => events.push({ type: 'deep', open }),
      dom: {}
    }
  };
}

test('create returns SearchWorkbench interface without app.js', () => {
  const { deps } = makeDeps();
  const wb = SykiSearchWorkbench.create(deps);
  assert.strictEqual(typeof wb.open, 'function');
  assert.strictEqual(typeof wb.close, 'function');
  assert.strictEqual(typeof wb.setMode, 'function');
  assert.strictEqual(typeof wb.openForRpc, 'function');
  assert.strictEqual(wb.isDeepDialogOpen(), false);
});

test('open and close are safe when modal DOM is absent', () => {
  const { deps } = makeDeps();
  const wb = SykiSearchWorkbench.create(deps);
  wb.open();
  wb.close();
  assert.strictEqual(wb.openForRpc(), null);
  assert.strictEqual(wb.isDeepDialogOpen(), false);
});

test('openForRpc rejects meaning mode when semantic search is off', () => {
  const { deps } = makeDeps();
  const wb = SykiSearchWorkbench.create(deps);
  let called = null;
  const errSentinel = new Error('invalid_params_sentinel');
  assert.throws(() => {
    wb.openForRpc({ mode: 'meaning', query: 'bamboo' }, (kind, msg) => {
      called = { kind, msg };
      throw errSentinel;
    });
  }, errSentinel);
  assert.strictEqual(called.kind, 'invalid_params');
  assert.match(called.msg, /Semantic search/i);
});

test('openForRpc opens panel, fills query, and triggers exact search', () => {
  const { deps } = makeDeps();
  const calls = [];
  const modal = {
    hidden: true,
    addEventListener() {},
    classList: {
      remove(c) { if (c === 'hidden') modal.hidden = false; },
      add(c) { if (c === 'hidden') modal.hidden = true; },
      contains(c) { return c === 'hidden' ? modal.hidden : false; }
    }
  };
  const input = { value: '', addEventListener() {}, focus() {}, select() {} };
  const results = { innerHTML: '', insertAdjacentHTML() {}, querySelectorAll() { return []; } };
  deps.dom = Object.assign({}, deps.dom || {}, {
    scrapsSearchModal: modal,
    scrapsSearchInput: input,
    scrapsSearchResults: results
  });
  const prevWin = global.window;
  const prevDoc = global.document;
  global.document = { getElementById() { return null; } };
  let doneSearch;
  const searchDone = new Promise((r) => { doneSearch = r; });
  global.window = Object.assign({}, prevWin || {}, {
    backend: {
      searchScraps(q, limit, filter) {
        calls.push({ q, limit, filter });
        const p = Promise.resolve([]);
        p.then(() => queueMicrotask(doneSearch));
        return p;
      }
    }
  });
  const wb = SykiSearchWorkbench.create(deps);
  const mode = wb.openForRpc({ query: 'bamboo' });
  assert.strictEqual(mode, 'exact');
  assert.strictEqual(modal.hidden, false);
  assert.strictEqual(input.value, 'bamboo');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].q, 'bamboo');
  searchDone.then(() => {
    if (prevWin === undefined) delete global.window;
    else global.window = prevWin;
    if (prevDoc === undefined) delete global.document;
    else global.document = prevDoc;
  });
});

console.log(`${passed} search_workbench unit tests passed.`);
