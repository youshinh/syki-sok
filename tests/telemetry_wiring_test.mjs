// The operation-rhythm log, how app.js, the settings page, the voice inputs and the two bridges use it: off by default, one switch in Settings,
// the command ids by what a command is (not by its shortcut), voice told only "started" and "stopped", and the Go binds the page calls exist
// on both platforms.
import assert from 'assert';
import fs from 'fs';

console.log('=== telemetry wiring ===');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = read('frontend/js/app.js');
const html = read('frontend/index.html');
const i18n = read('frontend/js/i18n.js');
const voice = read('frontend/js/voice_input.js');
const barVoice = read('frontend/js/bar_voice.js');
const css = read('frontend/css/style.css');
const bind = read('bind_common.go');
const win = read('window_windows.go');
const mac = read('window_darwin.go');

// ---- the setting: off unless it says true
assert.ok(/\n      telemetry: false, \/\/ the operation-rhythm log/.test(app), 'the default is off');
assert.ok(/T\.setEnabled\(!!\(config\.general && config\.general\.telemetry === true\)\)/.test(app), 'only the value true turns it on (a missing one, a string, anything else is off)');
assert.ok(/targets: \[editorEl, editorSecondary, inlinePromptInput, cliFilterInput\]/.test(app), 'only the editors and the inputs of the AI bars count key presses');
assert.ok(/send: \(json\) => \(window\.backend && window\.backend\.recordTelemetry \? window\.backend\.recordTelemetry\(json\) : null\)/.test(app), 'a summary goes to the Go side by the one bound function');
// applied at start-up (once the config is loaded) and after every save of the settings
assert.ok(/\n      applyTelemetry\(\);\n\n      \/\/ Check for app updates asynchronously/.test(app), 'applied at start-up');
assert.ok(/applyLanguage\(\);\n    \}\n    applyTelemetry\(\);\n/.test(app), 'and after the settings are saved');
assert.ok(/config\.general\.telemetry = telemetrySaveCheckbox\.checked/.test(app) && /telemetryCheckbox\.checked = !!\(config\.general && config\.general\.telemetry === true\)/.test(app), 'the checkbox is read and written');

// ---- the window's state, sampled when a window of the log ends (never from an input listener)
assert.ok(/windowSample: telemetryWindowSample/.test(app), 'the log is given the sampler');
const sampler = /function telemetryWindowSample\(\) \{[\s\S]*?\n  \}\n/.exec(app);
assert.ok(sampler, 'the sampler exists');
assert.ok(/is-fullscreen/.test(sampler[0]) && /zen-mode/.test(sampler[0]) && /isSplitMode \? 2 : \(isPreviewMode \? 1 : 0\)/.test(sampler[0]), 'full screen, Zen and the view');
assert.ok(/state = 3/.test(sampler[0]) && /state = 1/.test(sampler[0]) && /state = 2/.test(sampler[0]), 'full screen, maximized, snapped to a side');
assert.ok(!/return \{[^}]*(screenX|screenY|outerWidth|outerHeight|availWidth)/.test(sampler[0]), 'no position and no size leave the sampler: only small states');

// ---- the settings page
assert.ok(/<input type="checkbox" id="cfg-telemetry">/.test(html), 'the checkbox is not checked by default');
assert.ok(!/id="cfg-telemetry"[^>]*checked/.test(html), 'and has no "checked"');
for (const id of ['cfg-telemetry-info', 'btn-telemetry-open', 'btn-telemetry-clear']) assert.ok(html.includes('id="' + id + '"'), id);
assert.ok(/<script src="js\/telemetry\.js\?v=[\d.]+"><\/script>/.test(html) && html.indexOf('js/telemetry.js') < html.indexOf('js/app.js'), 'the script is loaded before app.js');
for (const key of ['telemetryLabel', 'telemetryHint', 'telemetryOpenFolder', 'telemetryClear', 'telemetryClearConfirm', 'telemetryCleared', 'telemetryInfo', 'telemetryInfoNone']) {
  assert.strictEqual((i18n.match(new RegExp('\n    ' + key + ': ', 'g')) || []).length, 2, key + ' is in both languages');
}
assert.ok(/telemetryHint: "[^"]*what you type[^"]*any audio[^"]*nothing is sent anywhere[^"]*30 days/.test(i18n), 'the English text says what is not kept, that nothing is sent and for how long it is kept');
assert.ok(/telemetryHint: "[^"]*入力した文章[^"]*音声[^"]*送信されず[^"]*30日/.test(i18n), 'so does the Japanese');
assert.ok(/await customConfirm\(t\('telemetryClearConfirm'\)/.test(app), 'deleting every log asks first');
assert.ok(/\.cfg-telemetry-info \{/.test(css) && /\.cfg-telemetry-actions \{/.test(css));

// ---- the commands: by what they are, at the place where the shortcut's action is taken
assert.ok(/const TELEMETRY_CMD = \{ quickActions: 1, ask: 2, commandBar: 3, rewrite: 6, other: 99 \};/.test(app), 'the ids');
assert.ok(/matchShortcut\(e, config\.shortcuts && config\.shortcuts\.inlinePrompt\)\) \{\n\s*e\.preventDefault\(\);\n\s*if \(!isDialogOpen\(\)\) \{ telemetryCommand\(TELEMETRY_CMD\.ask\); openInlinePromptBar\(\); \}/.test(app), 'the ask bar');
assert.ok(/if \(!isDialogOpen\(\)\) \{ telemetryCommand\(TELEMETRY_CMD\.rewrite\); openInlinePromptBar\(\{ mode: 'rewrite' \}\); \}/.test(app), 'the rewrite bar');
assert.strictEqual((app.match(/telemetryCommand\(TELEMETRY_CMD\.commandBar\)/g) || []).length, 3, 'the command bar (CLI, AI and the default shortcut)');
assert.ok(/telemetryCommand\(TELEMETRY_CMD\.quickActions\);\n\s*if \(window\.JevAction/.test(app), 'quick actions');
assert.ok(!/telemetryCommand\([^)]*\)[^\n]*\b(key|code|keyCode)\b/.test(app), 'a command is told by its id, never by a key');
// a shortcut that does nothing because a dialog is open is not a command
assert.ok(!/telemetryCommand\(TELEMETRY_CMD\.ask\);\s*\n\s*if \(!isDialogOpen/.test(app));

// ---- voice: started and stopped, nothing else
assert.ok(/function logVoice\(on\) \{\n\s*try \{ if \(global\.Telemetry\) global\.Telemetry\.voice\(on\); \} catch/.test(voice), 'the dictation tells the log');
assert.ok(/recorder\.start\(\);\n\s*logVoice\(true\);/.test(voice) && /function onRecorderStop\(\) \{\n\s*logVoice\(false\);/.test(voice), 'when the recording starts and when it stops');
assert.ok(/function logVoice\(on\) \{\n\s*try \{ if \(win\.Telemetry\) win\.Telemetry\.voice\(on\); \} catch/.test(barVoice), 'the bars\' microphone too');
assert.ok(/a\.phase = 'listening';\n\s*logVoice\(true\);/.test(barVoice) && /if \(!a\) return;\n\s*if \(a\.stream\) logVoice\(false\);/.test(barVoice), 'when it listens and when the microphone is let go');
assert.ok(!/Telemetry\.voice\([^)]*(chunks|blob|text|buffer|data)/.test(voice + barVoice), 'nothing of the recording is passed on');

// ---- the Go binds exist on both platforms, with the same names the page calls
for (const name of ['recordTelemetry', 'getTelemetryInfo', 'clearTelemetry', 'openTelemetryFolder']) {
  const goName = name[0].toUpperCase() + name.slice(1);
  assert.ok(bind.includes('"backend_' + name + '", app.' + goName), name + ' is bound for both platforms');
  assert.ok(new RegExp(name + ': \\([^)]*\\) => window\\.backend_' + name + '\\(').test(win), name + ' is on the Windows bridge');
  assert.ok(new RegExp(name + ': \\([^)]*\\) => window\\.backend_' + name + '\\(').test(mac), name + ' is on the macOS bridge');
}
console.log('telemetry wiring tests passed');
