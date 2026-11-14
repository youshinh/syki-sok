const assert = require('assert');
const NoteHash = require('./note_hash.js');
global.NoteHash = NoteHash;
const SykiRpcBridge = require('./rpc_bridge.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('PASS:', name);
}

function makeFakePort(initialText = 'hello\nworld') {
  const tab = { id: 't1', title: 'test.md', path: '/tmp/test.md', isDirty: false, cursorPos: 3 };
  let text = initialText;
  return {
    tab,
    resolveTab: (id) => {
      if (id && id !== tab.id) SykiRpcBridge.rpcFail('not_found', 'no such tab: ' + id);
      return tab;
    },
    getTab: (id) => (id === tab.id ? tab : null),
    getTabText: () => text,
    writeTabText: (_t, content, mode) => {
      if (mode === 'set') text = content;
      else if (mode === 'append') text += content;
      tab.isDirty = true;
    },
    editorForTab: () => null,
    getTabs: () => [tab],
    getViewState: () => ({ activeTabId: tab.id, isSplitMode: false, secondaryTabId: null }),
    selectTab: () => {},
    getNoteDir: () => '/tmp',
    getTabIdForEditor: () => tab.id,
    createTab: () => tab,
    findTabByPath: () => null,
    adoptDiskText: () => {},
    showTab: () => {},
    rememberDiskText: () => {},
    closeTab: () => {},
    closeTabForRpc: async () => ({ closed: true }),
    commitSaveForTab: () => ({ tab_id: tab.id }),
    toggleSplit: async () => true,
    getSelection: () => ({ tabId: tab.id, text: '', start: 0, end: 0, hasSelection: false }),
    replaceSelection: () => ({ replaced: true, start: 0, end: 0, reason: '' }),
    setCursorForTab: (t, txt, a, b, _opts, lineColFn) => {
      t.cursorPos = a;
      const lc = lineColFn(txt, a);
      return { tabId: t.id, start: a, end: b, line: lc.line, col: lc.col };
    },
    rpcUiState: () => ({ activeTabId: tab.id }),
    setUiStateForRpc: async () => ({ activeTabId: tab.id }),
    printPdfForRpc: async () => ({ path: '/tmp/out.pdf' }),
    openPanelForRpc: () => ({ opened: true })
  };
}

test('getBuffer returns buffer metadata without app.js', () => {
  const rpc = SykiRpcBridge.create(makeFakePort('a\nb\nc'));
  const buf = rpc.getBuffer();
  assert.strictEqual(buf.tabId, 't1');
  assert.strictEqual(buf.lineCount, 3);
  assert.strictEqual(buf.isActive, true);
});

test('writeText enforces expectedHash conflict lock', () => {
  const rpc = SykiRpcBridge.create(makeFakePort('abc'));
  assert.throws(() => rpc.writeText({ mode: 'set', content: 'xyz', expectedHash: 'deadbeef' }), (err) => err.rpcKind === 'conflict');
  const res = rpc.writeText({ mode: 'set', content: 'xyz', expectedHash: NoteHash.hash16('abc') });
  assert.strictEqual(res.hash, NoteHash.hash16('xyz'));
});

test('getCursor and setCursor compute 1-based line and col', () => {
  const rpc = SykiRpcBridge.create(makeFakePort('hello\nworld'));
  const c0 = rpc.getCursor('t1');
  assert.deepStrictEqual({ line: c0.line, col: c0.col }, { line: 1, col: 4 });
  const c1 = rpc.setCursor('t1', 8, 11);
  assert.strictEqual(c1.line, 2);
  assert.strictEqual(c1.col, 3);
});

console.log(`${passed} rpc_bridge unit tests passed.`);
