import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const embedGo = fs.readFileSync(path.join(root, 'frontend/embed.go'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');
const terminalPaneJs = fs.readFileSync(path.join(root, 'frontend/js/terminal_pane.js'), 'utf8');

let passed = 0;
function check(name, fn) {
  fn();
  console.log('PASS:', name);
  passed++;
}

check('index.html exposes agent pane DOM hooks without eager xterm loading', () => {
  for (const id of [
    'id="btn-agent-side"',
    'id="btn-secondary-agent"',
    'id="btn-pty-link-to-left"',
    'id="btn-pty-done-next"',
    'id="btn-pty-sleep"',
    'id="btn-pty-relay"',
    'id="btn-pty-mermaid-preview"',
    'id="btn-pty-copy-to-left"',
    'id="btn-pty-summarize-to-left"',
    'id="secondary-agent-pane"',
    'id="agent-tab-context-menu"',
    'id="agent-ctx-rename"',
    'id="agent-ctx-reveal-explorer"',
    'id="pty-loop-badge"',
    'id="btn-pty-loop-stop"',
    'id="ctx-harness-template"',
    'id="ctx-harness-start"',
    'id="ctx-harness-stop"',
    'id="ctx-session-dispatch"',
    'id="ctx-session-continue-existing"',
    'id="ctx-session-continue-new"',
    'id="ctx-session-review"',
    'id="agent-ctx-loop-start"',
    'id="agent-ctx-loop-stop"',
    'id="agent-ctx-review"',
    'src="js/terminal_pane.js'
  ]) {
    assert.ok(indexHtml.includes(id), `index.html missing ${id}`);
  }
  assert.ok(!indexHtml.includes('vendor/xterm/xterm.js'), 'index.html must not eagerly load xterm.js');
  assert.ok(!indexHtml.includes('vendor/xterm/xterm.css'), 'index.html must not eagerly load xterm.css');
});

check('embed.go embeds terminal_pane.js and vendor assets', () => {
  assert.ok(embedGo.includes('//go:embed js/terminal_pane.js'), 'embed.go missing terminal_pane.js');
  assert.ok(embedGo.includes('vendor/'), 'embed.go missing vendor assets');
});

check('app.js delegates agent pane & workspace harness bridge cleanly without bloating app.js', () => {
  for (const sym of [
    'ensureAgentController',
    'openAgentPane',
    'toggleAgentPane',
    'showAgentMermaidOverlay',
    'isTerminalElement',
    'renderRightTabs',
    'syncTheme',
    'agentTabContextMenu',
    'createWorkspaceBridge',
    'trimIdleMemory',
    'handleLoopStateChanged',
    'handleEditorClick'
  ]) {
    assert.ok(appJs.includes(sym), `app.js missing ${sym}`);
  }
  assert.ok(!appJs.includes('function syncHarnessLoopToNote('), 'harness loop note sync should live in terminal_pane.js');
  assert.ok(!appJs.includes('function parseSelectedHarnessBlock('), 'harness parser glue should live in terminal_pane.js');
});

check('terminal_pane.js exports session, harness loop, memory-trim, and workspace bridge APIs without win.prompt', () => {
  for (const sym of [
    'beginRenameSession',
    'getSessionById',
    'openOrReviveById',
    'relayToSession',
    'sleepSession',
    'closeOtherSessions',
    'parseHarnessBlock',
    'applyHarnessMetadataUpdate',
    'buildMakerPrompt',
    'buildCheckerPrompt',
    'parseLoopSignal',
    'startLoop',
    'stopLoop',
    'updateLoopInstructions',
    'syncHarnessLoopToNote',
    'handleLoopStateChanged',
    'createWorkspaceBridge',
    'trimIdleMemory',
    'ctx-harness-template',
    'ctx-session-review',
    'btnCancel'
  ]) {
    assert.ok(terminalPaneJs.includes(sym), `terminal_pane.js missing ${sym}`);
  }
  assert.ok(!terminalPaneJs.includes('win.prompt'), 'terminal_pane.js must not rely on blocked win.prompt');
  assert.ok(!appJs.includes('window.prompt(others.map'), 'app.js must not rely on blocked window.prompt for relay');
});

console.log(`\n${passed} passed, 0 failed`);
