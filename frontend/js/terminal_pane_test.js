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

check('extractLastMermaidBlock extracts unfenced TUI mermaid blocks and normalizes unicode arrows', () => {
  const tuiOutput = [
    '  Diagram exceeds terminal width (186 > 95 cols)',
    '  Displayed as code block. Widen terminal to view inline.',
    '',
    '  flowchart TD',
    '      A["メモ・アイデアの発生"] ──> B{"すぐ対応できる？<br>(2分以内)"}',
    '      B ── "はい" ──> C["その場で実行して完了"]',
    '      E ──> I["実行・完了"]',
    '',
    '  特定の業務やシステムのフロー図を作成したい場合は、対象を教えていただければ書き直します。'
  ].join('\n');
  const got = TP.extractLastMermaidBlock(tuiOutput);
  assert.strictEqual(got, [
    'flowchart TD',
    '    A["メモ・アイデアの発生"] --> B{"すぐ対応できる？<br>(2分以内)"}',
    '    B -- "はい" --> C["その場で実行して完了"]',
    '    E --> I["実行・完了"]'
  ].join('\n'));
});

check('extractMermaidBlocks extracts multiple unfenced diagrams in order', () => {
  const multi = [
    'gantt',
    '    title 開発スケジュール',
    '    section 設計',
    '    仕様確定 :a1, 2026-11-16, 3d',
    '',
    'stateDiagram-v2',
    '    [*] ──> 下書き',
    '    下書き ──> レビュー中 : 提出',
    '',
    'erDiagram',
    '    USER ||──o{ ORDER : places',
    '    ORDER ||──|{ ITEM : contains'
  ].join('\n');
  const blocks = TP.extractMermaidBlocks(multi);
  assert.strictEqual(blocks.length, 3);
  assert.ok(blocks[0].startsWith('gantt\n'));
  assert.ok(blocks[1].includes('[*] --> 下書き'));
  assert.ok(blocks[2].includes('USER ||--o{ ORDER : places'));
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
    await renameInput.onkeydown({ key: 'Enter', isComposing: true, stopPropagation() {}, preventDefault() {} });
    await renameInput.onkeydown({ key: 'Enter', keyCode: 229, stopPropagation() {}, preventDefault() {} });
    assert.strictEqual(ctrl.getSessionById(s1.id).label, 'alpha');
    assert.deepStrictEqual(renamedCalls, []);
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

    // Regression: available preset discovery without Claude Code (codex + agy only)
    assert.strictEqual(TP.pickCrossModelPreset('agy', ['codex', 'agy', 'shell']), 'codex');
    assert.strictEqual(TP.pickCrossModelPreset('codex', ['codex', 'agy', 'shell']), 'agy');
    assert.strictEqual(TP.pickCrossModelPreset('agy', ['agy', 'shell']), 'agy');

    {
      const env2 = makeMockEnv();
      const startedPresets = [];
      const ctrl2 = TP.createController({
        doc: env2.doc,
        win: env2.win,
        submitDelayMs: 0,
        startupReadyDelayMs: 0,
        getDefaultAgent: () => 'agy',
        backend: {
          ptyAvailablePresets: async () => JSON.stringify(['codex', 'agy', 'shell']),
          ptyPrepareWorktree: async (dir) => JSON.stringify({ ok: true, worktreePath: dir, isWorktree: false }),
          ptyDetectGate: async () => 'npm test',
          ptyStartWithOptions: async (_eid, preset, dir) => {
            startedPresets.push(preset);
            return JSON.stringify({ id: preset + '-1', preset, dir });
          },
          ptyWrite: async () => {},
          ptyResize: async () => {}
        }
      });
      const resolved = await ctrl2.resolvePreferredAgentPreset();
      assert.strictEqual(resolved, 'agy', 'must auto-select agy when claude is not installed');
      const loop2 = await ctrl2.startLoop({ heading: '## [ ] Agy task', title: 'Agy task', criteria: [] }, {
        workDir: '/repo',
        container: env2.root
      });
      assert.strictEqual(loop2.makerPreset, 'agy');
      assert.strictEqual(loop2.checkerPreset, 'codex');
      assert.strictEqual(startedPresets[0], 'agy');
    }

    // Regression: renderRightTabs must not assign to getter-only HTMLElement.dataset
    {
      const envGetter = makeMockEnv();
      const origCreate = envGetter.doc.createElement;
      envGetter.doc.createElement = (tag) => {
        const el = origCreate(tag);
        const ds = {};
        Object.defineProperty(el, 'dataset', { get: () => ds });
        return el;
      };
      const ctrlG = TP.createController({
        doc: envGetter.doc,
        win: envGetter.win,
        submitDelayMs: 0,
        startupReadyDelayMs: 0,
        backend: {
          ptyStartWithOptions: async (_e, preset, dir) => JSON.stringify({ id: 'agy-g1', preset, dir }),
          ptyWrite: async () => {},
          ptyResize: async () => {}
        }
      });
      await ctrlG.openPane(envGetter.root, { skipLauncher: true });
      await ctrlG.startSession('agy', '/repo', { preserveFocus: true });
      const tabList = envGetter.doc.createElement('ul');
      ctrlG.renderRightTabs(tabList);
      assert.strictEqual(tabList.children[0].dataset.agentSessionId, 'agy-g1');
    }

    passed++;
    console.log('PASS: zero-copy bridge selection, idle right-click fast-bail, non-loop PTY bypass, and trimIdleMemory cleanup');
  }

  // Test: interactive CLI idle prompt-return auto-nudges once and transitions on second idle
  {
    const envIdle = makeMockEnv();
    const writesIdle = [];
    let spawnSeq = 0;
    const ctrlIdle = TP.createController({
      win: envIdle.win,
      doc: envIdle.doc,
      startupReadyDelayMs: 0,
      submitDelayMs: 0,
      verdictDebounceMs: 0,
      idleTurnMs: 25,
      getDefaultAgent: () => 'agy',
      backend: {
        ptyAvailablePresets: async () => JSON.stringify(['agy', 'codex']),
        ptyPrepareWorktree: async (dir) => JSON.stringify({ ok: true, worktreePath: dir, isWorktree: false }),
        ptyDetectGate: async () => 'echo ok',
        ptyStartWithOptions: async (_eid, preset, dir) => JSON.stringify({ id: `${preset}-idle-${++spawnSeq}`, preset, dir }),
        ptyWrite: async (id, b64) => {
          writesIdle.push({ id, text: Buffer.from(b64, 'base64').toString('utf8') });
        },
        ptyResize: async () => {},
        ptyClose: async () => {}
      }
    });
    await ctrlIdle.openPane(envIdle.root, { skipLauncher: true });
    const loop = await ctrlIdle.startLoop({
      heading: '## [ ] Idle fallback test',
      title: 'Idle fallback test',
      criteria: []
    }, {
      workDir: '/repo',
      container: envIdle.root,
      maxRounds: 2
    });
    assert.strictEqual(loop.phase, 'maker');
    const makerId = loop.makerSessionId;
    const writesBeforeNudge = writesIdle.length;

    const filler = '確認結果: 作業ツリーはクリーンでテストもすべて通過しています。実装すべき具体的なタスク内容をご指示ください。\n';
    envIdle.win.__onPtyData(makerId, Buffer.from(filler + '> Auto mode: edits & safe commands auto-approved\n? for shortcuts\n', 'utf8').toString('base64'));
    await new Promise((r) => setTimeout(r, 60));

    // 1st idle: auto-nudged once, still in maker phase
    let snap = ctrlIdle.getLoopsMeta()[0];
    assert.strictEqual(snap.phase, 'maker');
    assert.ok(writesIdle.length > writesBeforeNudge, 'expected auto-nudge write on first idle');
    assert.ok(writesIdle.slice(writesBeforeNudge).some((w) => w.id === makerId && w.text.includes('まだ終了マーカーがありません')));

    // 2nd idle without STAGE_DONE: READY -> proceeds to checker
    envIdle.win.__onPtyData(makerId, Buffer.from(filler + '? for shortcuts\n', 'utf8').toString('base64'));
    await new Promise((r) => setTimeout(r, 60));
    snap = ctrlIdle.getLoopsMeta()[0];
    assert.strictEqual(snap.phase, 'checker');
    assert.ok(snap.checkerSessionId, 'expected checker session started on second idle');

    // Checker finishes with VERDICT: PASS
    envIdle.win.__onPtyData(snap.checkerSessionId, Buffer.from('VERDICT: PASS\n', 'utf8').toString('base64'));
    await new Promise((r) => setTimeout(r, 20));
    snap = ctrlIdle.getLoopsMeta()[0];
    assert.strictEqual(snap.phase, 'done');

    passed++;
    console.log('PASS: interactive CLI idle prompt-return auto-nudges once and proceeds to checker');
  }

  // Test: starting loop from plain line or - [ ] bullet promotes it in-place with progress tracking
  {
    const envProm = makeMockEnv();
    let bridgeRef = null;
    const ctrlProm = TP.createController({
      doc: envProm.doc,
      win: envProm.win,
      startupReadyDelayMs: 0,
      submitDelayMs: 0,
      getDefaultAgent: () => 'agy',
      onLoopStateChanged: (loop) => {
        if (bridgeRef) bridgeRef.handleLoopStateChanged(loop);
      },
      backend: {
        ptyAvailablePresets: async () => JSON.stringify(['agy', 'codex']),
        ptyPrepareWorktree: async (dir) => JSON.stringify({ ok: true, worktreePath: dir, isWorktree: false }),
        ptyDetectGate: async () => 'npm test',
        ptyStartWithOptions: async (_e, preset, dir) => JSON.stringify({ id: `${preset}-p1`, preset, dir }),
        ptyWrite: async () => {},
        ptyResize: async () => {}
      }
    });
    const ctxHandlers = {};
    const makeBtn = (id) => ({
      id,
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(ev, fn) { ctxHandlers[id + ':' + ev] = fn; }
    });
    const startBtn = makeBtn('ctx-harness-start');
    const promDoc = {
      getElementById: (id) => (id === 'ctx-harness-start' ? startBtn : null),
      addEventListener() {}
    };
    let noteText = '# Notes\n- [ ] fix bug\nbottom line';
    const tabObj = { id: 't-prom', path: '', content: noteText };
    const promEd = {
      get value() { return noteText; },
      set value(v) { noteText = v; },
      selectionStart: noteText.indexOf('fix bug'),
      selectionEnd: noteText.indexOf('fix bug'),
      scrollTop: 0,
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    };
    bridgeRef = TP.createWorkspaceBridge({
      doc: promDoc,
      win: envProm.win,
      editorEl: promEd,
      secondaryAgentPane: envProm.root,
      getController: () => ctrlProm,
      ensureController: () => ctrlProm,
      getActiveTab: () => tabObj,
      getTab: (id) => (id === 't-prom' ? tabObj : null),
      getTabs: () => [tabObj],
      getActiveTabId: () => 't-prom',
      getLanguage: () => 'ja',
      onTabTextReplaced: (tab, res) => { tab.content = res.text; }
    });
    await startBtn.onclick();
    assert.ok(noteText.includes('## [ ] fix bug'), 'expected in-place ## [ ] heading promotion');
    assert.ok(noteText.includes('- 進捗: 1/3 Maker実行中 (agy)'), 'expected live progress tracking line');
    assert.strictEqual((noteText.match(/fix bug/g) || []).length, 1, 'must not duplicate task block');
    assert.ok(noteText.indexOf('## [ ] fix bug') < noteText.indexOf('bottom line'), 'must replace in-place, not append to bottom');

    passed++;
    console.log('PASS: plain/bullet task promotes in-place to tracked harness block on loop start');
  }

  // Test: irregular scenarios (duplicate titles, working indicator guard, checker crash, IME defer, prompt cap)
  {
    // 1. Duplicate title: prefer unchecked block over completed block
    const dupNote = '## [x] Same Task\n- 進捗: PASS\n---\n\n## [ ] Same Task\n- 進捗: 未着手\n---';
    const updated = TP.applyHarnessMetadataUpdate(dupNote, { title: 'Same Task' }, {
      statusText: '1/3 Maker実行中 (agy)',
      makerId: 'agy-dup'
    });
    assert.ok(updated.text.startsWith('## [x] Same Task\n- 進捗: PASS'), 'completed block must remain untouched');
    assert.ok(updated.text.includes('## [ ] Same Task\n- ゲート(検証): 自動\n- 体制: 実装[#agy-dup]'), 'unchecked block must be updated');

    // 2. Prompt length cap for Codex safety
    const longPrompt = TP.buildCheckerPrompt(
      { title: 'Long Task', criteria: ['c1', 'c2'] },
      'npm test',
      'line\n'.repeat(500),
      1,
      3
    );
    assert.ok(longPrompt.length <= 920, 'checker prompt must stay compact (got ' + longPrompt.length + ')');

    // 3. Working indicator guard + Checker non-zero exit + IME defer
    const envIrr = makeMockEnv();
    const writesIrr = [];
    let isComposing = true;
    let spawnIrr = 0;
    let bridgeIrr = null;
    const ctrlIrr = TP.createController({
      doc: envIrr.doc,
      win: envIrr.win,
      startupReadyDelayMs: 0,
      submitDelayMs: 0,
      idleTurnMs: 25,
      getDefaultAgent: () => 'agy',
      onLoopStateChanged: (loop) => {
        if (bridgeIrr) bridgeIrr.handleLoopStateChanged(loop);
      },
      backend: {
        ptyAvailablePresets: async () => JSON.stringify(['agy', 'codex']),
        ptyPrepareWorktree: async (dir) => JSON.stringify({ ok: true, worktreePath: dir, isWorktree: false }),
        ptyDetectGate: async () => 'npm test',
        ptyStartWithOptions: async (_e, preset, dir) => JSON.stringify({ id: `${preset}-irr-${++spawnIrr}`, preset, dir }),
        ptyWrite: async (id, b64) => {
          writesIrr.push({ id, text: Buffer.from(b64, 'base64').toString('utf8') });
        },
        ptyResize: async () => {}
      }
    });
    let irrNote = '## [ ] Irr Task\n- 進捗: 未着手\n---';
    const irrTab = { id: 't-irr', path: '', content: irrNote };
    const irrEd = {
      get value() { return irrNote; },
      set value(v) { irrNote = v; },
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      setSelectionRange() {}
    };
    bridgeIrr = TP.createWorkspaceBridge({
      doc: envIrr.doc,
      win: envIrr.win,
      editorEl: irrEd,
      secondaryAgentPane: envIrr.root,
      getController: () => ctrlIrr,
      ensureController: () => ctrlIrr,
      getActiveTab: () => irrTab,
      getTab: (id) => (id === 't-irr' ? irrTab : null),
      getTabs: () => [irrTab],
      getActiveTabId: () => 't-irr',
      getIsComposing: () => isComposing,
      onTabTextReplaced: (tab, res) => { tab.content = res.text; }
    });
    await ctrlIrr.openPane(envIrr.root, { skipLauncher: true });
    const loopIrr = await ctrlIrr.startLoop({ heading: '## [ ] Irr Task', title: 'Irr Task', criteria: [] }, {
      workDir: '/repo',
      noteTabId: 't-irr',
      container: envIrr.root
    });
    // During IME composition, note must not be mutated yet
    assert.ok(irrNote.includes('- 進捗: 未着手'), 'must defer note mutation while IME composing');
    isComposing = false;
    bridgeIrr.flushPendingLoopNoteSyncs();
    assert.ok(irrNote.includes('- 進捗: 1/3 Maker実行中 (agy)'), 'must flush deferred sync after IME commit');

    // Working indicator in tail must NOT trigger idle nudge
    const writesBeforeWork = writesIrr.length;
    envIrr.win.__onPtyData(loopIrr.makerSessionId, Buffer.from('x'.repeat(100) + '\nWorking...\n>\nesc to cancel\n', 'utf8').toString('base64'));
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(writesIrr.length, writesBeforeWork, 'Working.../esc to cancel must suppress idle nudge');

    // Maker completes -> Checker starts -> Checker crashes (exit 1) -> loop must fail cleanly without hanging
    envIrr.win.__onPtyData(loopIrr.makerSessionId, Buffer.from('\nSTAGE_DONE: READY\n', 'utf8').toString('base64'));
    await new Promise((r) => setTimeout(r, 20));
    const midSnap = ctrlIrr.getLoopsMeta()[0];
    assert.strictEqual(midSnap.phase, 'checker');
    envIrr.win.__onPtyExit(midSnap.checkerSessionId, 1, 'crash');
    const endSnap = ctrlIrr.getLoopsMeta()[0];
    assert.strictEqual(endSnap.phase, 'failed');
    assert.ok(endSnap.statusText.includes('exit 1'));
    assert.ok(irrNote.includes('Checker判定前に終了 (exit 1)'));

    passed++;
    console.log('PASS: irregular scenarios (duplicate title, prompt cap, working guard, IME defer, checker crash)');

    // 4. Cursor-positioning CSI sequences must preserve line breaks for VERDICT/STAGE_DONE detection
    const tuiOut = TP.stripAnsi('差分を確認し、テスト成功を確認しました。\x1b[20;1HVERDICT: PASS\x1b[21;1HWorked for 10s');
    const tuiSig = TP.parseLoopSignal(tuiOut);
    assert.ok(tuiSig && tuiSig.type === 'verdict' && tuiSig.verdict === 'PASS', 'expected VERDICT: PASS after cursor move');

    // 5. Impossible preset combo: only shell installed -> startLoop fails cleanly with message
    const envNoAi = makeMockEnv();
    const ctrlNoAi = TP.createController({
      doc: envNoAi.doc,
      win: envNoAi.win,
      backend: {
        ptyAvailablePresets: async () => JSON.stringify(['shell']),
        ptyStartWithOptions: async () => { throw new Error('must not spawn shell for loop'); }
      }
    });
    const noAiRes = await ctrlNoAi.startLoop({ title: 'Test', criteria: [] }, { workDir: '/repo' });
    assert.strictEqual(noAiRes.phase, 'failed');
    assert.ok(noAiRes.statusText.includes('AI エージェント'));

    passed++;
    console.log('PASS: TUI cursor-move verdict detection and no-AI-preset error guard');

    // 6. Default verdictDebounceMs waits past 350ms so streamed REASON lines are not truncated mid-sentence
    const envStream = makeMockEnv();
    let seqStream = 0;
    const streamBackend = {
      ptyAvailablePresets: async () => JSON.stringify(['cc', 'codex']),
      ptyPrepareWorktree: async (dir, id) => JSON.stringify({ ok: true, worktreePath: dir + '/.worktrees/' + id, isWorktree: true }),
      ptyDetectGate: async () => 'npm test',
      ptyStartWithOptions: async (explicitId, preset, dir, label) => {
        seqStream += 1;
        return JSON.stringify({ id: 'pty-stream-' + seqStream, preset, dir, label });
      },
      ptyWrite: async () => {},
      ptyResize: async () => {},
      ptyKill: async () => {}
    };
    const ctrlStream = TP.createController({ doc: envStream.doc, win: envStream.win, backend: streamBackend, submitDelayMs: 0 });
    const streamLoop = await ctrlStream.startLoop({ title: 'StreamReason', criteria: [] }, { workDir: '/repo', container: envStream.root });
    await new Promise((r) => setTimeout(r, 10));
    envStream.win.__onPtyData(streamLoop.makerSessionId, TP.encodeUtf8Base64('\nSTAGE_DONE: READY\n'));
    await new Promise((r) => setTimeout(r, 20));
    const midStream = ctrlStream.getLoopsMeta()[0];
    assert.strictEqual(midStream.phase, 'checker', 'expected checker phase, got ' + midStream.phase + ' status=' + midStream.statusText);
    const checkerIdStream = midStream.checkerSessionId;
    assert.ok(checkerIdStream, 'expected checkerSessionId');
    envStream.win.__onPtyData(checkerIdStream, TP.encodeUtf8Base64('\nVERDICT: FAIL\nREASON: TestFoo'));
    await new Promise((r) => setTimeout(r, 350));
    envStream.win.__onPtyData(checkerIdStream, TP.encodeUtf8Base64(' (app_slot.go) failed\n'));
    await new Promise((r) => setTimeout(r, 1550));
    const afterStream = ctrlStream.getLoopsMeta()[0];
    assert.strictEqual(afterStream.round, 2, 'expected round 2, got phase=' + afterStream.phase + ' status=' + afterStream.statusText);
    assert.strictEqual(afterStream.failedMemory[0], '[1回目NG] TestFoo (app_slot.go) failed');

    const makerPromptText = TP.buildMakerPrompt({ title: 'T', criteria: ['C'] }, 'go test ./...', 1, 3);
    assert.ok(makerPromptText.includes('-run 等で通るテストだけに絞って成功扱いにしない'));
    assert.ok(!/STAGE_DONE:\s*READY/i.test(makerPromptText), 'maker prompt must remain echo-safe');
    const checkerPromptText = TP.buildCheckerPrompt({ title: 'T', criteria: ['C'] }, 'go test ./...', 'out', 1, 3);
    assert.ok(checkerPromptText.includes('失敗したテスト名/ファイル名と原因の1行要約'));

    passed++;
    console.log('PASS: streamed REASON survives chunk delay and prompts enforce strict test reporting');
  }

  // Test: workspaceBridge listLoops / startHarnessLoop / stopHarnessLoop (RPC loop bridge)
  {
    const envRpc = makeMockEnv();
    let seqRpc = 0;
    const ctrlRpc = TP.createController({
      doc: envRpc.doc,
      win: envRpc.win,
      startupReadyDelayMs: 0,
      submitDelayMs: 0,
      backend: {
        ptyAvailablePresets: async () => JSON.stringify(['agy', 'codex']),
        ptyPrepareWorktree: async (dir) => JSON.stringify({ dir, isolated: false }),
        ptyDetectGate: async () => 'go test ./...',
        ptyStartWithOptions: async (_e, preset, dir) => JSON.stringify({ id: `${preset}-rpc-${++seqRpc}`, preset, dir }),
        ptyWrite: async () => {},
        ptyResize: async () => {}
      }
    });
    const noteRpc = '## [ ] RPC Loop Task\n- 条件・評価軸:\n  - keep tests green\n- 進捗: 未着手\n---';
    const tabRpc = { id: 'tab-rpc-1', path: '/repo/note.md', content: noteRpc };
    const bridgeRpc = TP.createWorkspaceBridge({
      doc: envRpc.doc,
      win: envRpc.win,
      editorEl: { value: '', selectionStart: 0, selectionEnd: 0 },
      secondaryAgentPane: envRpc.root,
      getController: () => ctrlRpc,
      ensureController: () => ctrlRpc,
      getActiveTab: () => null,
      getTab: (id) => (id === 'tab-rpc-1' ? tabRpc : null),
      getTabs: () => [tabRpc],
      getActiveTabId: () => 'other-tab',
      onTabTextReplaced: (tab, res) => { tab.content = res.text; }
    });
    assert.deepStrictEqual(bridgeRpc.listLoops(), []);
    const started = await bridgeRpc.startHarnessLoop({ tabId: 'tab-rpc-1', line: 1 });
    assert.strictEqual(started.title, 'RPC Loop Task');
    assert.strictEqual(started.phase, 'maker');
    assert.strictEqual(bridgeRpc.listLoops().length, 1);

    const stopRes = bridgeRpc.stopHarnessLoop(started.id, true);
    assert.strictEqual(stopRes.ok, true);
    assert.strictEqual(stopRes.stopped, true);
    assert.strictEqual(bridgeRpc.listLoops()[0].phase, 'stopped');

    let missingErr = null;
    try {
      await bridgeRpc.startHarnessLoop({ tabId: 'tab-missing' });
    } catch (e) {
      missingErr = e;
    }
    assert.ok(missingErr && missingErr.message.includes('no such tab'), 'expected no such tab error');

    passed++;
    console.log('PASS: workspaceBridge harness loop RPC methods (list/start/stop)');
  }

  // Test: terminal copy/paste keyboard shortcuts and context menu actions
  {
    const envCp = makeMockEnv();
    const copied = [];
    const ptyWrites = [];
    let clipboardText = 'hello pasted';
    let selText = 'selected terminal text';
    let keyHandler = null;

    const BaseTerm = envCp.win.Terminal;
    envCp.win.Terminal = function () {
      const t = new BaseTerm();
      t.hasSelection = () => !!selText;
      t.getSelection = () => selText;
      t.attachCustomKeyEventHandler = (fn) => { keyHandler = fn; };
      return t;
    };
    envCp.win.navigator = {
      clipboard: {
        writeText: async (txt) => { copied.push(txt); },
        readText: async () => clipboardText
      }
    };

    const menuItems = {};
    const makeMenuItem = () => {
      const cls = new Set();
      return {
        classList: {
          add: (c) => cls.add(c),
          remove: (c) => cls.delete(c),
          toggle: (c, force) => (force === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : (force ? cls.add(c) : cls.delete(c))),
          contains: (c) => cls.has(c)
        },
        onclick: null
      };
    };
    menuItems['agent-ctx-copy'] = makeMenuItem();
    menuItems['agent-ctx-paste'] = makeMenuItem();
    const origGetById = envCp.doc.getElementById;
    envCp.doc.getElementById = (id) => menuItems[id] || (typeof origGetById === 'function' ? origGetById(id) : null);

    const backend = {
      ptyStartWithOptions: async (id, preset, dir) => JSON.stringify({ id: id || 'cc-cp', title: 'cc', preset, dir }),
      ptyClose: async () => {},
      ptyRename: async () => {},
      ptyWrite: async (id, b64) => { ptyWrites.push([id, Buffer.from(b64, 'base64').toString('utf8')]); },
      ptyResize: async () => {}
    };

    const ctrlCp = TP.createController({
      doc: envCp.doc,
      win: envCp.win,
      backend,
      copyTextToClipboard: async (txt) => { copied.push(txt); return true; }
    });
    await ctrlCp.openPane(envCp.root);
    const sCp = await ctrlCp.startSession('cc', '/repo', { explicitId: 'cc-cp' });
    assert.strictEqual(typeof keyHandler, 'function');

    // Ctrl+C with selection copies and consumes key (does not send SIGINT)
    assert.strictEqual(keyHandler({ type: 'keydown', key: 'c', ctrlKey: true }), false);
    // Ctrl+C without selection passes through for SIGINT
    selText = '';
    assert.strictEqual(keyHandler({ type: 'keydown', key: 'c', ctrlKey: true }), true);
    // Ctrl+Shift+C with selection copies and consumes key
    selText = 'shift copied';
    assert.strictEqual(keyHandler({ type: 'keydown', key: 'C', ctrlKey: true, shiftKey: true }), false);
    // Ctrl+V and Ctrl+Shift+V paste via bracketedPaste
    assert.strictEqual(keyHandler({ type: 'keydown', key: 'v', ctrlKey: true, preventDefault() {} }), false);
    assert.strictEqual(keyHandler({ type: 'keydown', key: 'V', ctrlKey: true, shiftKey: true, preventDefault() {} }), false);
    await new Promise((r) => setTimeout(r, 10));

    assert.deepStrictEqual(copied, ['selected terminal text', 'shift copied']);
    assert.strictEqual(ptyWrites.length, 2);
    assert.strictEqual(ptyWrites[0][0], sCp.id);
    assert.strictEqual(ptyWrites[0][1], '\x1b[200~hello pasted\x1b[201~');

    // Context menu sync + copy/paste clicks
    const agentMenuEl = makeMenuItem();
    const bridgeCp = TP.createWorkspaceBridge({
      doc: envCp.doc,
      win: envCp.win,
      editorEl: { value: '', selectionStart: 0, selectionEnd: 0 },
      secondaryAgentPane: envCp.root,
      agentTabContextMenu: agentMenuEl,
      getController: () => ctrlCp,
      ensureController: () => ctrlCp,
      copyTextToClipboard: async (txt) => { copied.push(txt); return true; },
      hideAllContextMenus: () => {}
    });

    selText = '';
    bridgeCp.openAgentTabContextMenu({
      clientX: 10,
      clientY: 20,
      target: { closest: (sel) => (sel.includes('#secondary-agent-pane') ? envCp.root : null) }
    }, () => {});
    assert.strictEqual(menuItems['agent-ctx-copy'].classList.contains('disabled'), true);
    assert.strictEqual(menuItems['agent-ctx-paste'].classList.contains('disabled'), false);

    selText = 'ctx copied';
    bridgeCp.openAgentTabContextMenu({
      clientX: 10,
      clientY: 20,
      target: { closest: (sel) => (sel.includes('#secondary-agent-pane') ? envCp.root : null) }
    }, () => {});
    assert.strictEqual(menuItems['agent-ctx-copy'].classList.contains('disabled'), false);

    await menuItems['agent-ctx-copy'].onclick();
    clipboardText = 'ctx pasted';
    await menuItems['agent-ctx-paste'].onclick();
    assert.strictEqual(copied[copied.length - 1], 'ctx copied');
    assert.strictEqual(ptyWrites[ptyWrites.length - 1][1], '\x1b[200~ctx pasted\x1b[201~');

    passed++;
    console.log('PASS: agent pane copy/paste keyboard shortcuts and context menu actions');
  }

  console.log('\n' + passed + ' passed, 0 failed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
