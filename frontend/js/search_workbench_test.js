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
  assert.strictEqual(wb.isDeepDialogOpen(), false);
});

test('open and close are safe when modal DOM is absent', () => {
  const { deps } = makeDeps();
  const wb = SykiSearchWorkbench.create(deps);
  wb.open();
  wb.close();
  assert.strictEqual(wb.isDeepDialogOpen(), false);
});

console.log(`${passed} search_workbench unit tests passed.`);
