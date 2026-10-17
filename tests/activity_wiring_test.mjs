// The activity log, how app.js, the settings page and the two bridges use it: both switches off by default and only the value true turns them
// on, the requests of the Ask and Rewrite bars written down with where the model is, their answers (and a cancel) matched by request id,
// a stretch of writing closed before another note comes to the front, and the Go binds present on both platforms.
import assert from 'assert';
import fs from 'fs';

console.log('=== activity log wiring ===');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = read('frontend/js/app.js');
const html = read('frontend/index.html');
const i18n = read('frontend/js/i18n.js');
const bind = read('bind_common.go');
const win = read('window_windows.go');
const mac = read('window_darwin.go');

// ---- off unless true
assert.ok(/\n      activityApps: false, /.test(app) && /\n      activityEdits: false, /.test(app), 'both are off by default');
assert.ok(/A\.setEnabled\(!!\(config\.general && config\.general\.activityEdits === true\)\)/.test(app), 'only true turns the log of notes and requests on');
assert.ok(/config\.general\.activityApps = activityAppsSaveCheckbox\.checked && !activityAppsSaveCheckbox\.disabled/.test(app), 'the front app cannot be switched on where it is not supported');
assert.ok(/activityAppsCheckbox\.checked = !!\(config\.general && config\.general\.activityApps === true\)/.test(app) && /config\.general\.activityEdits = activityEditsSaveCheckbox\.checked/.test(app), 'read and written');
assert.ok(/function applyTelemetry\(\) \{\n    applyActivity\(\);/.test(app), 'applied where the rhythm log is: at start-up and after the settings are saved');
assert.ok(/window\.backend\.refreshActivity\) Promise\.resolve\(window\.backend\.refreshActivity\(\)\)\.catch/.test(app), 'the Go side is told, so it starts or stops looking at the front app');

// ---- the editors, and the note being written in
assert.ok(/targets: \[editorEl, editorSecondary\],\n\s*noteId:/.test(app), 'only the note editors (not the bars\' inputs)');
const ctx = /function activityNoteContext\(\) \{[\s\S]*?\n  \}\n/.exec(app);
assert.ok(ctx && /secondaryViewMode === 'editor' && activePane === 'secondary'/.test(ctx[0]), 'the editor with the focus decides which note');
assert.ok(/if \(window\.Activity\) window\.Activity\.flushEdit\(\); \/\/ the stretch of writing in the note that is leaving\n\s*activeTabId = tabId;/.test(app), 'closed before another note comes to the front');
assert.ok(/async function closeTab\(tabId, e\) \{\n    if \(window\.Activity\) window\.Activity\.flushEdit\(\);/.test(app), 'and before a tab is closed');
assert.ok(/noteLength: \(\) => \{[^}]*c\.editor\.value\.length/.test(app) && !/noteText|\.value\.slice|\.value\.substring/.test(/function applyActivity\(\) \{[\s\S]*?\n  \}\n/.exec(app)[0]), 'only the length of the note is handed over, never its text');

// ---- requests and answers
assert.ok(/const reqId = genReqId\('rewrite_'\);\n\s*activityAsk\(reqId, 'rewrite', instruction\);/.test(app), 'the Rewrite bar');
assert.ok(/const askReqId = startLlmTask\(\{/.test(app) && /if \(askReqId\) activityAsk\(askReqId, 'ask', instruction\);/.test(app), 'the Ask bar');
assert.ok(/errorText = redactLlmSecrets\(errorText\);\n\s*activityAnswer\(reqId, errorText \? 'error' : 'ok', String\(resultText \|\| ''\)\.length\);/.test(app), 'the answer, and only its length');
assert.ok(/updateLLMIndicator\(\);\n\s*activityAnswer\(reqId, 'cancel', 0\);/.test(app), 'a cancel');
assert.ok(/window\.Activity\.ask\(reqId, mode, d \? d\.kind : 'unknown', String\(instruction \|\| ''\)\)/.test(app), 'where the model is comes from the same place the Ask bar names it');
assert.ok(!/activityAsk\([^)]*(targetText|finalPrompt|promptPayload|editor\.value)/.test(app), 'the note text that went with a request is never passed on: only what was typed');

// ---- the settings page
for (const id of ['cfg-activity-edits', 'cfg-activity-apps', 'cfg-activity-info', 'btn-activity-open', 'btn-activity-clear']) assert.ok(html.includes('id="' + id + '"'), id);
assert.ok(!/id="cfg-activity-(edits|apps)"[^>]*checked/.test(html), 'not checked by default');
assert.ok(/<script src="js\/activity_log\.js\?v=[\d.]+"><\/script>/.test(html) && html.indexOf('js/activity_log.js') < html.indexOf('js/app.js'), 'loaded before app.js');
for (const key of ['activityEditsLabel', 'activityEditsHint', 'activityAppsLabel', 'activityAppsHint', 'activityClear', 'activityClearConfirm', 'activityCleared', 'activityInfo', 'activityInfoNone']) {
  assert.strictEqual((i18n.match(new RegExp('\n    ' + key + ': ', 'g')) || []).length, 2, key + ' is in both languages');
}
assert.ok(/activityEditsHint: "[^"]*Never the text of your notes[^"]*which keys[^"]*30 days[^"]*cloud model unless you approve/.test(i18n), 'the English text says what is not kept, for how long, and the cloud rule');
assert.ok(/activityEditsHint: "[^"]*ノートの文章[^"]*キー[^"]*30日[^"]*クラウド/.test(i18n), 'so does the Japanese');
assert.ok(/activityAppsHint: "[^"]*does not watch keys, the mouse, the screen or the clipboard/.test(i18n) && /activityAppsHint: "[^"]*キー、マウス、画面、クリップボードは見ません/.test(i18n), 'the front app: what it does not watch');
assert.ok(/await customConfirm\(t\('activityClearConfirm'\)/.test(app), 'deleting asks first');

// ---- the binds, on both platforms
for (const name of ['recordActivity', 'getActivityInfo', 'clearActivity', 'openActivityFolder', 'getActivityDigest', 'refreshActivity']) {
  const goName = name[0].toUpperCase() + name.slice(1);
  assert.ok(bind.includes('"backend_' + name + '", app.' + goName), name + ' is bound for both platforms');
  assert.ok(new RegExp(name + ': \\([^)]*\\) => window\\.backend_' + name + '\\(').test(win), name + ' is on the Windows bridge');
  assert.ok(new RegExp(name + ': \\([^)]*\\) => window\\.backend_' + name + '\\(').test(mac), name + ' is on the macOS bridge');
}
assert.ok(/getActivityDigest: \(hours, destination, approved\) => window\.backend_getActivityDigest\(hours \| 0, destination \|\| "", !!approved\)/.test(win), 'the digest takes where the model is and whether the request was approved');
console.log('activity log wiring tests passed');
