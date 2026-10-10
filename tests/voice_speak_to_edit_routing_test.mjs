// Text selected + a spoken instruction ("change it to English") must edit the selection even when "also record the playback sound" is on: that setting turns
// every recording into a meeting, which leaves the selection alone and only writes after it (found in a note: the instruction was inserted as plain text).
import assert from 'assert';
import fs from 'fs';

console.log('=== voice speak-to-edit routing tests ===');
const src = fs.readFileSync(new URL('../frontend/js/voice_input.js', import.meta.url), 'utf8');
const i18n = fs.readFileSync(new URL('../frontend/js/i18n.js', import.meta.url), 'utf8');

const startAt = src.indexOf('async function start(opts)');
assert.ok(startAt > 0, 'start() exists');
const start = src.slice(startAt, src.indexOf('const editor = bridge.getActiveEditor', startAt));
assert.ok(/const speaksToEdit = !!\(pickedEditor && typeof pickedEditor\.selectionStart === 'number' &&\s*pickedEditor\.selectionEnd > pickedEditor\.selectionStart && voiceNow\.refine\.enabled && !\(opts && opts\.raw\)\);/.test(start),
  'a selection, with the second stage on and not raw, is spoken to edit');
assert.ok(/voiceNow\.systemAudio && !speaksToEdit\) \{\s*await startMeeting\(bridge\);/.test(start), 'only a recording that does not speak to edit becomes a meeting');
assert.strictEqual((i18n.match(/With text selected, what you say is an instruction|文字を選択しているときは、話した内容がその文字への指示/g) || []).length, 2, 'the setting says so in both languages');
console.log('voice speak-to-edit routing tests passed');
