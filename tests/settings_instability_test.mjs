import assert from 'assert';
import fs from 'fs';

console.log("=== Testing Settings UI & Shortcut Stability ===");

const appJs = fs.readFileSync('frontend/js/app.js', 'utf8');
const settingsModalJs = fs.readFileSync('frontend/js/settings_modal.js', 'utf8');

// 1. Verify that activeRecordingAction has fail-safe check in keydown handler
assert.ok(
  /if\s*\(!settingsModal\s*\|\|\s*settingsModal\.classList\.contains\('hidden'\)\)/.test(appJs),
  "keydown handler MUST clear activeRecordingAction if settingsModal is hidden or missing"
);

// 2. Verify that switchSettingsTab clears activeRecordingAction when leaving shortcuts
assert.ok(
  /if\s*\(tabName\s*!==\s*'shortcuts'\s*&&\s*deps\.getRecordingAction/.test(settingsModalJs),
  "switchSettingsTab MUST clear activeRecordingAction when switching away from shortcuts tab"
);

// 3. Verify that settingsModal is displayed (un-hidden) BEFORE running heavy background IPCs
const openSettingsMatch = settingsModalJs.match(/function open\(\) \{([\s\S]*?)\n    \}/);
assert.ok(openSettingsMatch, "open function must exist in settings_modal.js");
const openBody = openSettingsMatch[1];

const unhideIdx = openBody.indexOf("settingsModal.classList.remove('hidden')");
assert.ok(unhideIdx > 0, "settingsModal.classList.remove('hidden') must be called in openSettings");

const speechLoadIdx = openBody.indexOf("window.SpeechSettings.load");
const shortcutsRenderIdx = openBody.indexOf("renderShortcutsTable(");

// SpeechSettings.load should either be deferred or called AFTER unhide
if (speechLoadIdx > 0) {
  assert.ok(speechLoadIdx > unhideIdx, "SpeechSettings.load must NOT block modal display (must be after unhide or deferred)");
}

// renderShortcutsTable should NOT be synchronously executed before unhide
if (shortcutsRenderIdx > 0) {
  assert.ok(shortcutsRenderIdx > unhideIdx, "renderShortcutsTable must NOT block modal display");
}

console.log("ALL STABILITY TESTS PASSED!");
