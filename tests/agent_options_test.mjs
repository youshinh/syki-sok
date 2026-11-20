import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

console.log('=== Testing Dynamic Agent Selection Population Logic ===');

const appJs = fs.readFileSync('frontend/js/app.js', 'utf8');

// Verify that populateAgentSelectOptions is defined in app.js
assert.ok(appJs.includes('function populateAgentSelectOptions(slotCfg)'), 'populateAgentSelectOptions function must exist');

// Mock DOM elements
class MockElement {
  constructor(id) {
    this.id = id;
    this.options = [];
    this.value = '';
    this.selectedIndex = 0;
    this.innerHTML = '';
    this.disabled = false;
  }
  appendChild(child) {
    this.options.push(child);
    if (this.options.length === 1) {
      this.value = child.value;
      this.selectedIndex = 0;
    }
  }
}

class MockOption {
  constructor() {
    this.value = '';
    this.textContent = '';
  }
}

global.document = {
  getElementById: (id) => {
    if (id === 'cfg-default-agent') return defaultAgentEl;
    return null;
  },
  createElement: (tag) => {
    if (tag === 'option') return new MockOption();
    return new MockElement(tag);
  }
};

const defaultAgentEl = new MockElement('cfg-default-agent');
global.config = { default_agent: 'agy' };

// Extract and test populateAgentSelectOptions
const fnMatch = appJs.match(/function populateAgentSelectOptions\(slotCfg\) \{[\s\S]*?\n  \}/);
if (!fnMatch) {
  throw new Error('Could not find populateAgentSelectOptions in app.js');
}

const populateAgentSelectOptions = new Function('slotCfg', 'config', 'document', `
  ${fnMatch[0]}
  return populateAgentSelectOptions(slotCfg);
`);

// Test with mock SlotConfig from agents.yaml
const mockSlotConfig = {
  version: 2,
  default_agent: "agy",
  agents: {
    "claude-code": {
      command: "claude",
      args: ["--file", "{file}", "--prompt", "{instruction}"],
      description: "Claude Code (高知能・CLI操作・Web調査)"
    },
    "agy": {
      command: "agy",
      args: ["exec", "--file", "{file}"],
      description: "Google Antigravity 2.0 (自律型AIペアエンジニア)"
    },
    "custom-agent": {
      command: "my-custom-cli",
      args: ["run", "{instruction}"],
      description: "My Custom Agent"
    },
    "plain": {
      command: "plain-cli",
      args: ["{instruction}"]
    }
  }
};

populateAgentSelectOptions(mockSlotConfig, global.config, global.document);

assert.strictEqual(defaultAgentEl.options.length, 4, 'Should have 4 options populated');
assert.strictEqual(defaultAgentEl.options[0].value, 'claude-code');
assert.strictEqual(defaultAgentEl.options[1].value, 'agy');
assert.strictEqual(defaultAgentEl.options[2].value, 'custom-agent');
assert.ok(defaultAgentEl.options[1].textContent.includes('Google Antigravity 2.0'));
// The option label is "key - description": the key is what agents.yaml and {{ @key }} use, the description says what the
// agent is. The full command line (e.g. agy's --dangerously-skip-permissions default) is long enough on its own to make
// every option in the dropdown equally unreadable, so it must not be appended here. It remains visible in agents.yaml and,
// when relevant, in the auto-approve warning.
assert.ok(!defaultAgentEl.options[2].textContent.includes('my-custom-cli'), 'option label must not include the raw command');
assert.strictEqual(defaultAgentEl.options[0].textContent, 'claude-code - Claude Code (高知能・CLI操作・Web調査)');
assert.strictEqual(defaultAgentEl.options[1].textContent, 'agy - Google Antigravity 2.0 (自律型AIペアエンジニア)');
assert.strictEqual(defaultAgentEl.options[2].textContent, 'custom-agent - My Custom Agent');
assert.strictEqual(defaultAgentEl.options[3].textContent, 'plain', 'no description: just the key');
assert.strictEqual(defaultAgentEl.value, 'agy', 'default_agent "agy" must be selected');
assert.strictEqual(defaultAgentEl.disabled, false);

console.log('PASS: Dynamic agent options populated correctly with custom agents.');

// A disabled agent is not listed (the Go side leaves it out; an entry that still says enabled: false is skipped too), and a
// default_agent that is not offered leaves the first option selected.
{
  const cfg = {
    default_agent: 'agy',
    disabled_agents: ['agy', 'hermes'],
    agents: {
      'claude-code': { command: 'claude', description: 'Claude Code' },
      agy: { command: 'agy', description: 'Antigravity', enabled: false },
      codex: { command: 'codex', description: 'Codex' }
    }
  };
  const el = new MockElement('cfg-default-agent');
  const doc = { getElementById: (id) => (id === 'cfg-default-agent' ? el : null), createElement: () => new MockOption() };
  new Function('slotCfg', 'config', 'document', `${fnMatch[0]}; return populateAgentSelectOptions(slotCfg);`)(cfg, { default_agent: 'agy' }, doc);
  assert.deepStrictEqual(el.options.map((o) => o.value), ['claude-code', 'codex'], 'agy (enabled: false) and hermes (not present) are not offered');
  assert.strictEqual(el.value, 'claude-code', 'the disabled default is not selected: the first offered agent is');
  assert.ok(!el.options.some((o) => /Antigravity|hermes/i.test(o.textContent)));
  console.log('PASS: A disabled agent is not offered in the dropdown.');
}

// Every agent disabled: one placeholder, nothing to pick, and the saved default is left alone (the select is empty)
{
  const el = new MockElement('cfg-default-agent');
  const doc = { getElementById: (id) => (id === 'cfg-default-agent' ? el : null), createElement: () => new MockOption() };
  const cfg = { default_agent: '', disabled_agents: ['agy', 'claude-code'], agents: {} };
  const conf = { default_agent: 'claude-code' };
  new Function('slotCfg', 'config', 'document', `${fnMatch[0]}; return populateAgentSelectOptions(slotCfg);`)(cfg, conf, doc);
  assert.strictEqual(el.options.length, 1);
  assert.strictEqual(el.options[0].value, '');
  assert.strictEqual(el.disabled, true, 'nothing to choose');
  assert.strictEqual(conf.default_agent, 'claude-code', 'the configured default is not changed by an empty list');
  // and back to normal when agents are enabled again (the mock's innerHTML = '' does not clear options as a real select does)
  el.options = [];
  new Function('slotCfg', 'config', 'document', `${fnMatch[0]}; return populateAgentSelectOptions(slotCfg);`)({ default_agent: 'codex', agents: { codex: { command: 'codex' } } }, conf, doc);
  assert.strictEqual(el.disabled, false);
  assert.deepStrictEqual(el.options.map((o) => o.value), ['codex']);
  console.log('PASS: With every agent disabled the dropdown offers none.');
}

// The line under the select that names the disabled agents (Settings > Agent): only when there are any, in both languages
{
  const noteMatch = appJs.match(/function renderAgentDisabledNote\(slotCfg\) \{[\s\S]*?\n  \}/);
  assert.ok(noteMatch, 'renderAgentDisabledNote must exist in app.js');
  const i18n = {};
  vm.createContext(i18n);
  vm.runInContext(fs.readFileSync('frontend/js/i18n.js', 'utf8') + '; this.I18N = I18N;', i18n);
  const tFor = (lang) => (key, params) => String(i18n.I18N[lang][key]).replace(/\{(\w+)\}/g, (m, name) => (params && name in params ? params[name] : m));
  const makeNote = () => {
    const classes = new Set(['hidden']);
    return {
      textContent: '',
      classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) }
    };
  };
  const run = (cfg, lang) => {
    const note = makeNote();
    const doc = { getElementById: (id) => (id === 'agent-disabled-note' ? note : null) };
    new Function('slotCfg', 't', 'document', `${noteMatch[0]}; return renderAgentDisabledNote(slotCfg);`)(cfg, tFor(lang), doc);
    return note;
  };

  let note = run({ disabled_agents: ['agy', 'hermes'] }, 'en');
  assert.strictEqual(note.textContent, 'Disabled in agents.yaml: agy, hermes');
  assert.strictEqual(note.classList.contains('hidden'), false);
  note = run({ disabled_agents: ['agy', 'hermes'] }, 'ja');
  assert.strictEqual(note.textContent, 'agents.yaml で無効: agy, hermes');
  for (const cfg of [{}, { disabled_agents: [] }, { disabled_agents: ['', 5, null] }, null]) {
    note = run(cfg, 'en');
    assert.strictEqual(note.classList.contains('hidden'), true, 'no note without disabled agents: ' + JSON.stringify(cfg));
    assert.strictEqual(note.textContent, '');
  }
  assert.ok(fs.readFileSync('frontend/index.html', 'utf8').includes('id="agent-disabled-note"'), 'the line exists in the Settings page');
  assert.ok(appJs.includes('renderAgentDisabledNote(slotCfg);\n          renderAgentIssues(slotCfg);') || /renderAgentDisabledNote\(slotCfg\);\s*renderAgentIssues\(slotCfg\);/.test(appJs), 'it is rendered with the list');
  console.log('PASS: The Settings line names the disabled agents (en / ja), only when there are any.');
}

// Checkboxes in Settings > Agent toggle agent_panel_disabled_presets for the Agent Panel only (never touching SlotAgent / agents.yaml / #cfg-default-agent)
{
  const normMatch = appJs.match(/function normalizeAgentPanelDisabledPresets\(list\) \{[\s\S]*?\n  \}/);
  const visMatch = appJs.match(/function renderAgentVisibilityList\(\) \{[\s\S]*?\n  \}/);
  assert.ok(normMatch, 'normalizeAgentPanelDisabledPresets must exist in app.js');
  assert.ok(visMatch, 'renderAgentVisibilityList must exist in app.js');
  const container = { innerHTML: '', children: [], appendChild(ch) { this.children.push(ch); } };
  const selectEl = new MockElement('cfg-default-agent');
  Object.defineProperty(selectEl, 'innerHTML', {
    get() { return ''; },
    set(v) { if (v === '') this.options = []; }
  });
  const makeNode = (tag) => {
    const listeners = {};
    return {
      tagName: tag.toUpperCase(),
      style: {},
      dataset: {},
      children: [],
      type: '',
      checked: false,
      disabled: false,
      setAttribute(k, v) { if (k === 'data-preset') this.dataset.preset = v; },
      appendChild(ch) { this.children.push(ch); },
      addEventListener(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
      trigger(evt) { (listeners[evt] || []).forEach((fn) => fn()); }
    };
  };
  const doc = {
    getElementById: (id) => (id === 'agent-visibility-list' ? container : id === 'cfg-default-agent' ? selectEl : null),
    createElement: (tag) => (tag === 'option' ? new MockOption() : makeNode(tag)),
    createTextNode: (txt) => ({ textContent: txt })
  };
  const conf = { default_agent: 'claude-code', disabled_agents: ['hermes'], agent_panel_disabled_presets: [] };
  const slotUpdates = [];
  const backendUpdates = [];
  let launcherRefreshes = 0;
  const win = {
    TerminalPane: {
      DEFAULT_PRESETS: [
        { id: 'cc', label: 'Claude Code', short: 'cc' },
        { id: 'codex', label: 'Codex', short: 'codex' },
        { id: 'agy', label: 'Agy', short: 'agy' },
        { id: 'shell', label: 'Shell', short: 'shell' }
      ],
      normalizeDisabledPresets: (list) => {
        const s = new Set();
        for (const item of (list || [])) {
          const v = String(item || '').trim().toLowerCase();
          if (v === 'cc' || v === 'claude' || v === 'claude-code') s.add('cc');
          else if (v === 'codex' || v === 'agy' || v === 'shell') s.add(v);
        }
        return s;
      }
    },
    backend: { updateActiveAgentsConfigDisabledAgents: async (dir, list) => { backendUpdates.push({ dir, list }); } },
    SlotAgent: { updateConfig: (cfg) => { slotUpdates.push(cfg); } }
  };
  const slotCfg = {
    default_agent: 'claude-code',
    disabled_agents: [],
    agents: {
      'claude-code': { command: 'claude', description: 'Claude Code' },
      hermes: { command: 'ollama', description: 'Hermes 3' },
      codex: { command: 'codex', description: 'Codex' },
      agy: { command: 'agy', description: 'Antigravity' }
    }
  };
  const runVis = new Function(
    'config', 'document', 'window', 'refreshAgentLauncherIfOpen',
    `${normMatch[0]}\n${visMatch[0]}\nreturn renderAgentVisibilityList();`
  );
  runVis(conf, doc, win, () => { launcherRefreshes++; });
  assert.strictEqual(container.children.length, 4, 'renders checkboxes for all 4 Agent Panel presets (Claude Code, Codex, Agy, Shell)');
  assert.deepStrictEqual(
    container.children.map((lbl) => lbl.children[1].textContent),
    ['Claude Code', 'Codex', 'Agy', 'Shell']
  );

  // Uncheck Codex and Shell
  for (const label of container.children) {
    const text = label.children[1].textContent;
    if (text === 'Codex' || text === 'Shell') {
      label.children[0].checked = false;
      label.children[0].trigger('change');
    }
  }
  assert.deepStrictEqual(conf.agent_panel_disabled_presets, ['codex', 'shell']);
  assert.strictEqual(launcherRefreshes, 2);
  // Note command invocation settings & backend agents.yaml must remain untouched
  assert.deepStrictEqual(conf.disabled_agents, ['hermes']);
  assert.strictEqual(backendUpdates.length, 0);
  assert.strictEqual(slotUpdates.length, 0);

  // populateAgentSelectOptions ignores both config.disabled_agents and config.agent_panel_disabled_presets
  conf.disabled_agents = ['codex', 'agy'];
  new Function('slotCfg', 'config', 'document', `${fnMatch[0]}; return populateAgentSelectOptions(slotCfg);`)(slotCfg, conf, doc);
  assert.deepStrictEqual(selectEl.options.map((o) => o.value), ['claude-code', 'hermes', 'codex', 'agy']);
  console.log('PASS: Settings > Agent visibility checkboxes control Agent Panel presets only without touching SlotAgent or agents.yaml.');
}
