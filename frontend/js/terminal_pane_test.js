// Unit tests for terminal_pane.js (pure helpers and session controller without DOM/PTY).
const assert = require('assert');
const TP = require('./terminal_pane.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('PASS: ' + name);
}

check('bracketedPaste wraps text safely for multi-line pastes without auto-enter', () => {
  assert.strictEqual(TP.bracketedPaste('line1\nline2'), '\x1b[200~line1\nline2\x1b[201~');
  assert.strictEqual(TP.bracketedPaste(''), '\x1b[200~\x1b[201~');
});

check('UTF-8 base64 round-trips Japanese and emoji text losslessly', () => {
  const sample = '設計メモ 🚀 日本語テスト';
  const b64 = TP.encodeUtf8Base64(sample);
  const bytes = TP.decodeUtf8Base64ToBytes(b64);
  assert.strictEqual(Buffer.from(bytes).toString('utf8'), sample);
});

check('extractRecentOutput trims trailing blanks and caps lines', () => {
  const lines = ['old1', 'old2', 'keep1', 'keep2', '  ', ''];
  assert.strictEqual(TP.extractRecentOutput(lines, 2), 'keep1\nkeep2');
  assert.strictEqual(TP.extractRecentOutput(['', '   '], 10), '');
});

check('mergeRecentDirs deduplicates and keeps newest first', () => {
  const out = TP.mergeRecentDirs(['/a', '/b', '/c'], '/b');
  assert.deepStrictEqual(out, ['/b', '/a', '/c']);
});

check('isTerminalElement detects elements inside #secondary-agent-pane', () => {
  assert.strictEqual(TP.isTerminalElement({ closest: (sel) => sel === '#secondary-agent-pane' ? {} : null }), true);
  assert.strictEqual(TP.isTerminalElement({ closest: () => null }), false);
  assert.strictEqual(TP.isTerminalElement(null), false);
});

check('extractLastMermaidBlock returns the last mermaid fenced block', () => {
  const sample = [
    'some text',
    '```mermaid',
    'graph TD',
    '  A --> B',
    '```',
    'more text',
    '```mermaid',
    'sequenceDiagram',
    '  User->>Agent: Go',
    '```'
  ].join('\n');
  assert.strictEqual(TP.extractLastMermaidBlock(sample), 'sequenceDiagram\n  User->>Agent: Go');
  assert.strictEqual(TP.extractLastMermaidBlock('no diagram here'), '');
});

check('readXtermTheme falls back cleanly without DOM', () => {
  const t = TP.readXtermTheme(null, null);
  assert.deepStrictEqual(t, {});
});

check('parsePtyLink and note anchor formatters handle session identifiers and labels', () => {
  assert.strictEqual(TP.parsePtyLink('syki-pty://cc-1'), 'cc-1');
  assert.strictEqual(TP.parsePtyLink('https://example.com'), '');
  const s = { id: 'cc-1', label: 'auth-fix', dir: '/repo/syki-sok' };
  assert.strictEqual(TP.formatSessionBadge(s), '#cc-1 @auth-fix');
  assert.strictEqual(TP.formatNoteAnchor(s), '- [ ] [#cc-1 @auth-fix (syki-sok)](syki-pty://cc-1) ');
  const block = TP.formatDoneNextBlock(s, 'tests ok');
  assert.ok(block.includes('### [x] [#cc-1 @auth-fix](syki-pty://cc-1)'));
  assert.ok(block.includes('- [ ] Next:'));
  assert.ok(block.includes('tests ok'));
});

check('loading the module starts nothing and exposes TerminalPane', () => {
  assert.strictEqual(typeof TP.createController, 'function');
  assert.strictEqual(TP.DEFAULT_PRESETS.length, 4);
});

function makeMockEnv() {
  function makeEl(tag) {
    const el = {
      tagName: tag,
      className: '',
      children: [],
      parentElement: null,
      _attrs: {},
      setAttribute: (k, v) => { el._attrs[k] = v; },
      _classes: new Set(),
      classList: {
        add: (c) => el._classes.add(c),
        remove: (c) => el._classes.delete(c),
        toggle: (c, f) => (f === undefined ? (el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c)) : (f ? el._classes.add(c) : el._classes.delete(c))),
        contains: (c) => el._classes.has(c)
      },
      appendChild: (c) => { c.parentElement = el; el.children.push(c); return c; },
      removeChild: (c) => {
        const i = el.children.indexOf(c);
        if (i >= 0) el.children.splice(i, 1);
        c.parentElement = null;
      }
    };
    return el;
  }
  const doc = { createElement: (t) => makeEl(t), body: makeEl('body') };
  const disposed = [];
  function MockTerm() {
    this.cols = 80;
    this.rows = 24;
    this.loadAddon = () => {};
    this.open = () => {};
    this.onData = () => {};
    this.focus = () => {};
    this.write = () => {};
    this.dispose = () => disposed.push(this);
  }
  function MockFit() { this.fit = () => {}; }
  const win = { Terminal: MockTerm, FitAddon: MockFit };
  return { doc, win, root: makeEl('div'), disposed };
}

(async () => {
  {
    const env = makeMockEnv();
    const ctrl = TP.createController({
      doc: env.doc,
      win: env.win,
      backend: { ptyStart: async () => { throw new Error('spawn failed'); } }
    });
    await ctrl.openPane(env.root);
    let err = null;
    try { await ctrl.startSession('shell', '/tmp'); } catch (e) { err = e; }
    assert.ok(err && err.message === 'spawn failed');
    assert.strictEqual(env.disposed.length, 1);
    assert.strictEqual(env.root.children[0].children.length, 0);
    passed++;
    console.log('PASS: startSession disposes Terminal and removes wrap element when backend fails');
  }

  {
    const env = makeMockEnv();
    let count = 0;
    const backend = {
      ptyStartWithOptions: async (explicitId, preset, dir, label) => {
        count++;
        return JSON.stringify({ id: explicitId || 'cc-1', preset, dir, label, cliSessionId: 'u1' });
      },
      ptyHistory: async () => JSON.stringify([{ id: 'cc-1', preset: 'cc', dir: '/repo', label: 'fix', cliSessionId: 'u1', status: 'closed' }]),
      ptyWrite: async () => {},
      ptyResize: async () => {}
    };
    const ctrl = TP.createController({ doc: env.doc, win: env.win, backend });
    await ctrl.openPane(env.root);
    await ctrl.startSession('cc', '/repo', { label: 'fix' });
    env.win.__onPtyExit('cc-1', 0, '');
    assert.strictEqual(ctrl.hasRunningSession(), false);
    const revived = await ctrl.openOrReviveById('cc-1', env.root);
    assert.strictEqual(revived, true);
    assert.strictEqual(count, 2);
    assert.strictEqual(ctrl.getSessionsMeta().length, 1);
    assert.strictEqual(ctrl.getSessionsMeta()[0].label, 'fix');
    assert.strictEqual(env.disposed.length, 1);
    passed++;
    console.log('PASS: openOrReviveById replaces exited session cleanly without duplicate IDs');
  }

  {
    const env = makeMockEnv();
    const closedIds = [];
    const renamedCalls = [];
    const backend = {
      ptyStartWithOptions: async (explicitId, preset, dir, label) => JSON.stringify({
        id: explicitId || (preset + '-' + (closedIds.length + 1)),
        preset,
        dir,
        label
      }),
      ptyClose: async (id) => { closedIds.push(id); },
      ptyRename: async (id, label) => { renamedCalls.push([id, label]); },
      ptyWrite: async () => {},
      ptyResize: async () => {}
    };
    const ctrl = TP.createController({ doc: env.doc, win: env.win, backend });
    await ctrl.openPane(env.root);
    const s1 = await ctrl.startSession('cc', '/repo-a', { explicitId: 'cc-1', label: 'alpha' });
    const s2 = await ctrl.startSession('codex', '/repo-b', { explicitId: 'codex-2', label: 'beta' });
    assert.strictEqual(ctrl.getSessionById('missing'), null);
    assert.strictEqual(ctrl.getSessionById(s1.id).dir, '/repo-a');
    assert.strictEqual(ctrl.getSessionById(s2.id).label, 'beta');
    assert.strictEqual(ctrl.beginRenameSession(s1.id), true);
    const floatWrap = env.root.children.find((c) => c.className === 'agent-rename-floating');
    assert.ok(floatWrap, 'floating rename container mounted when tab strip querySelectorAll unavailable');
    const renameInput = floatWrap.children[0];
    renameInput.value = 'gamma';
    await renameInput.onkeydown({ key: 'Enter', stopPropagation() {}, preventDefault() {} });
    assert.strictEqual(ctrl.getSessionById(s1.id).label, 'gamma');
    assert.deepStrictEqual(renamedCalls, [['cc-1', 'gamma']]);
    await ctrl.closeOtherSessions(s2.id);
    assert.deepStrictEqual(closedIds, ['cc-1']);
    assert.strictEqual(ctrl.getSessionsMeta().length, 1);
    assert.strictEqual(ctrl.getSessionsMeta()[0].id, 'codex-2');
    passed++;
    console.log('PASS: getSessionById, beginRenameSession, and closeOtherSessions manage session lookup/rename/closure');
  }

  check('harness helpers parse strict boundaries, update metadata surgically, and build echo-safe prompts', () => {
    const tmpl = TP.formatHarnessTemplate('ja');
    assert.ok(tmpl.includes('## [ ] '));
    assert.ok(tmpl.includes('- 条件・評価軸:'));
    assert.ok(tmpl.trimEnd().endsWith('---'));

    assert.strictEqual(TP.pickCrossModelPreset('cc'), 'codex');
    assert.strictEqual(TP.pickCrossModelPreset('codex'), 'cc');
    assert.strictEqual(TP.pickCrossModelPreset('agy'), 'cc');

    const note = [
      '## [ ] ログインバグ修正',
      '- 条件・評価軸:',
      '  - 空文字のときエラーを返す',
      '  - 既存テストが通る',
      '---',
      'ここは loop に無関係な昼食メモ',
      '## 別件メモ',
      '- 牛乳を買う'
    ].join('\n');

    const cursorInsideTask = note.indexOf('空文字');
    const block = TP.parseHarnessBlock(note, cursorInsideTask);
    assert.strictEqual(block.kind, 'heading');
    assert.strictEqual(block.title, 'ログインバグ修正');
    assert.deepStrictEqual(block.criteria, ['空文字のときエラーを返す', '既存テストが通る']);

    // Echo-safety: prompts must not self-trigger signal parser.
    const makerPrompt = TP.buildMakerPrompt(block, 'go test ./...', 1, 3);
    assert.strictEqual(TP.parseLoopSignal(makerPrompt), null);
    const checkerPrompt = TP.buildCheckerPrompt(block, 'go test ./...', '', 1, 3);
    assert.strictEqual(TP.parseLoopSignal(checkerPrompt), null);

    // Surgical metadata update preserves notes below "---".
    const updated = TP.applyHarnessMetadataUpdate(note, { title: block.title }, {
      makerId: 'cc-1',
      checkerId: 'codex-1',
      isolated: true,
      round: 2,
      maxRounds: 3,
      failedMemory: ['[1回目NG] go test failed'],
      statusText: '2/3 Maker実行中',
      checked: false
    });
    assert.strictEqual(updated.found, true);
    assert.ok(updated.text.includes('ここは loop に無関係な昼食メモ'));
    assert.ok(updated.text.includes('## 別件メモ\n- 牛乳を買う'));
    assert.ok(updated.text.includes('- [1回目NG] go test failed'));
    assert.ok(updated.text.includes('- 進捗: 2/3 Maker実行中'));
    assert.ok(updated.text.includes('syki-pty://cc-1'));

    const finished = TP.applyHarnessMetadataUpdate(updated.text, { makerId: 'cc-1', title: block.title }, {
      statusText: 'PASS (2/3回目で承認済み)',
      checked: true
    });
    assert.ok(finished.text.startsWith('## [x] ログインバグ修正'));
    assert.ok(finished.text.includes('ここは loop に無関係な昼食メモ'));

    const missingReconstruct = TP.applyHarnessMetadataUpdate('Unrelated text\n', { title: 'Lost Task' }, {
      appendIfMissing: true,
      statusText: 'PASS',
      checked: true
    });
    assert.strictEqual(missingReconstruct.found, false);
    assert.strictEqual(missingReconstruct.appended, true);
    assert.ok(missingReconstruct.text.includes('## [x] Lost Task'));

    const cleanOut = TP.stripAnsi('\x1b[32mVERDICT: FAIL\x1b[0m\nREASON: missing nil check\n');
    assert.deepStrictEqual(TP.parseLoopSignal(cleanOut), {
      type: 'verdict',
      verdict: 'FAIL',
      reason: 'missing nil check'
    });
    assert.deepStrictEqual(TP.parseLoopSignal('\nSTAGE_DONE: READY\n'), { type: 'maker_done' });
  });

  {
    // Full Maker -> Checker FAIL -> Maker -> Checker PASS cycle with live instruction update & preserveFocus
    const env = makeMockEnv();
    let termFocusCalls = 0;
    const origTerm = env.win.Terminal;
    env.win.Terminal = function () {
      origTerm.call(this);
      this.focus = () => { termFocusCalls++; };
    };
    const writes = [];
    const loopEvents = [];
    let sessionSeq = 0;
    const backend = {
      ptyPrepareWorktree: async (dir, id) => JSON.stringify({ ok: true, worktreePath: dir + '/.worktrees/' + id, isWorktree: true }),
      ptyDetectGate: async () => 'npm test',
      ptyStartWithOptions: async (explicitId, preset, dir, label) => JSON.stringify({
        id: preset + '-' + (++sessionSeq),
        preset,
        dir,
        label
      }),
      ptyWrite: async (id, b64) => { writes.push({ id, text: TP.decodeUtf8Base64ToString(b64) }); },
      ptyResize: async () => {}
    };
    const ctrl = TP.createController({
      doc: env.doc,
      win: env.win,
      backend,
      submitDelayMs: 0,
      verdictDebounceMs: 0,
      onLoopStateChanged: (ev) => loopEvents.push(ev)
    });

    const loop = await ctrl.startLoop({
      heading: '## [ ] Fix Parser',
      title: 'Fix Parser',
      criteria: ['Handle empty string']
    }, {
      notePath: '/repo/notes/todo.md',
      noteTabId: 'tab-1',
      workDir: '/repo',
      container: env.root
    });

    assert.strictEqual(termFocusCalls, 0, 'loop must never steal focus from left editor');
    assert.strictEqual(loop.makerPreset, 'cc');
    assert.strictEqual(loop.checkerPreset, 'codex');
    assert.strictEqual(loop.workDir, '/repo/.worktrees/loop-1');
    assert.strictEqual(loop.gateCmd, 'npm test');
    assert.strictEqual(loop.round, 1);

    // Tab strip renders [1/3] badge cleanly
    const mockTabList = env.doc.createElement('div');
    ctrl.renderRightTabs(mockTabList);
    const badgeNode = mockTabList.children[0].children.find((c) => c.className === 'tab-loop-badge');
    assert.ok(badgeNode && badgeNode.textContent === '[1/3]');

    // Live edit criteria while round 1 runs
    ctrl.updateLoopInstructions(loop.id, { title: 'Fix Parser v2', criteria: ['Handle empty string', 'Handle UTF-8'] });

    // Maker completes round 1
    env.win.__onPtyData(loop.makerSessionId, TP.encodeUtf8Base64('\x1b[32mSTAGE_DONE: READY\x1b[0m\r\n'));
    await new Promise((r) => setTimeout(r, 10));

    const midLoop = ctrl.getLoopsMeta()[0];
    assert.strictEqual(midLoop.phase, 'checker');
    assert.ok(midLoop.checkerSessionId && midLoop.checkerSessionId !== midLoop.makerSessionId);

    // Checker fails round 1
    env.win.__onPtyData(midLoop.checkerSessionId, TP.encodeUtf8Base64('VERDICT: FAIL\r\nREASON: UTF-8 BOM failed\r\n'));
    await new Promise((r) => setTimeout(r, 10));

    const round2Loop = ctrl.getLoopsMeta()[0];
    assert.strictEqual(round2Loop.phase, 'maker');
    assert.strictEqual(round2Loop.round, 2);
    assert.deepStrictEqual(round2Loop.failedMemory, ['[1回目NG] UTF-8 BOM failed']);
    const round2Write = writes.filter((w) => w.id === round2Loop.makerSessionId && w.text.includes('[1回目NG] UTF-8 BOM failed'));
    assert.ok(round2Write.length >= 1 && round2Write[0].text.includes('Fix Parser v2'), 'round 2 Maker receives updated instruction and failure memory');

    // Round 2 succeeds
    env.win.__onPtyData(round2Loop.makerSessionId, TP.encodeUtf8Base64('\nSTAGE_DONE: READY\n'));
    await new Promise((r) => setTimeout(r, 10));
    env.win.__onPtyData(ctrl.getLoopsMeta()[0].checkerSessionId, TP.encodeUtf8Base64('\nVERDICT: PASS\n'));
    await new Promise((r) => setTimeout(r, 10));

    const finalLoop = ctrl.getLoopsMeta()[0];
    assert.strictEqual(finalLoop.phase, 'done');
    assert.strictEqual(finalLoop.checked, true);
    assert.strictEqual(termFocusCalls, 0);

    // Two-stage stopLoop test (safe stop + immediate ESC+Ctrl+C interrupt)
    const loop2 = await ctrl.startLoop({ heading: '## [ ] Task 2', title: 'Task 2', criteria: [] }, {
      workDir: '/repo',
      skipWorktree: true,
      container: env.root
    });
    assert.strictEqual(ctrl.stopLoop(loop2.id, false), true);
    assert.strictEqual(ctrl.getLoopForSession(loop2.makerSessionId).stopRequested, true);
    assert.strictEqual(ctrl.stopLoop(loop2.id, true), true);
    assert.strictEqual(ctrl.getLoopForSession(loop2.makerSessionId).phase, 'stopped');
    assert.ok(writes.some((w) => w.id === loop2.makerSessionId && w.text === '\x1b\x03'));

    // Idle memory release: stopping/finishing frees loop buffers and trimIdleMemory prunes finished loops
    ctrl.trimIdleMemory();
    assert.strictEqual(ctrl.getLoopsMeta().length, 0, 'trimIdleMemory prunes finished/stopped loops');

    passed++;
    console.log('PASS: harness loop state machine executes Maker/Checker rounds, failure memory, live updates, preserveFocus, and 2-stage stop');
  }

  {
    // Startup/idle low-memory & Go { dir, isolated } worktree compatibility + zero-copy workspace bridge
    const env = makeMockEnv();
    let seq = 0;
    const backend = {
      ptyPrepareWorktree: async (dir, id) => JSON.stringify({ dir: dir + '/.wt/' + id, isolated: true }),
      ptyDetectGate: async () => 'go test ./...',
      ptyStartWithOptions: async (explicitId, preset, dir, label) => JSON.stringify({ id: preset + '-' + (++seq), preset, dir, label }),
      ptyWrite: async () => {},
      ptyResize: async () => {}
    };
    const ctrl = TP.createController({ doc: env.doc, win: env.win, backend, submitDelayMs: 0, verdictDebounceMs: 0 });
    await ctrl.openPane(env.root, { skipLauncher: true });
    const plainSess = await ctrl.startSession('cc', '/repo', { preserveFocus: true });
    // Non-loop PTY output must bypass loop ANSI stripping / buffering
    env.win.__onPtyData(plainSess.id, TP.encodeUtf8Base64('ordinary terminal output without loop\r\n'));
    assert.strictEqual(ctrl.getLoopsMeta().length, 0);

    const loop = await ctrl.startLoop({ heading: '## [ ] Go Wt', title: 'Go Wt', criteria: ['pass'] }, {
      workDir: '/repo',
      container: env.root
    });
    assert.strictEqual(loop.workDir, '/repo/.wt/' + loop.id, 'accepts Go ptyWorktreeResult { dir, isolated } JSON');
    assert.strictEqual(loop.worktreePath, '/repo/.wt/' + loop.id);

    // Non-loop session output must not touch loop step buffers; loop stop releases them
    ctrl.stopLoop(loop.id, true);
    ctrl.trimIdleMemory();
    assert.strictEqual(ctrl.getLoopsMeta().length, 0);

    let valueReads = 0;
    let rawText = 'hello world\nsecond line';
    const mockEditor = {
      selectionStart: 7,
      selectionEnd: 7,
      scrollTop: 0,
      get value() {
        valueReads++;
        return rawText;
      },
      set value(v) {
        rawText = v;
      },
      focus() {},
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
      addEventListener() {}
    };
    const mockCtxStart = { classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); } } };
    const mockCtxStop = { classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); } } };
    const bridgeDoc = {
      getElementById(id) {
        if (id === 'ctx-harness-start') return mockCtxStart;
        if (id === 'ctx-harness-stop') return mockCtxStop;
        return null;
      },
      addEventListener() {}
    };
    const bridge = TP.createWorkspaceBridge({
      doc: bridgeDoc,
      win: env.win,
      editorEl: mockEditor,
      getController: () => ctrl,
      ensureController: () => ctrl,
      getActiveTab: () => ({ id: 'tab-1', path: '', content: rawText })
    });
    const selEmpty = bridge.captureEditorSelection();
    assert.strictEqual(selEmpty.text, '');
    bridge.syncHarnessContextMenuItems();
    assert.strictEqual(valueReads, 0, 'caret movement and idle right-click must NOT read editor.value');

    mockEditor.selectionStart = 0;
    mockEditor.selectionEnd = 5;
    const selRange = bridge.captureEditorSelection();
    assert.strictEqual(selRange.text, 'hello');
    assert.strictEqual(valueReads, 1);

    bridge.trimIdleMemory();
    mockEditor.selectionStart = 2;
    mockEditor.selectionEnd = 2;
    assert.strictEqual(bridge.getLeftNoteSelectionOrLine(), 'hello world');

    // Regression: Ctrl+Click on non-PTY link on the same line must not be intercepted
    const lineEditor = {
      value: '[#cc-1](syki-pty://cc-1) see src/app.js:10',
      selectionStart: 0
    };
    lineEditor.selectionStart = 2; // inside [#cc-1]
    assert.strictEqual(bridge.handleEditorClick(lineEditor, { ctrlKey: true }), true);
    lineEditor.selectionStart = lineEditor.value.indexOf('app.js'); // on src/app.js:10
    assert.strictEqual(bridge.handleEditorClick(lineEditor, { ctrlKey: true }), false);

    passed++;
    console.log('PASS: zero-copy bridge selection, idle right-click fast-bail, non-loop PTY bypass, and trimIdleMemory cleanup');
  }

  console.log('\n' + passed + ' passed, 0 failed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
