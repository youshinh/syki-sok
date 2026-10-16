// Realtime voice input with the on-device Whisper: the recording is MP4 first (Windows decodes it itself), the cloud keeps webm (no
// conversion, the fastest to send), the second stage and a spoken rewrite are cloud-only, the wait is longer, and each profile's own
// model and engine reach the request.
import assert from 'assert';
import fs from 'fs';
import { createRequire } from 'module';

console.log('=== realtime local tests ===');
const require = createRequire(import.meta.url);
require('../frontend/js/voice_profiles.js');
const VI = require('../frontend/js/voice_input.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// The format: cloud = webm first as before; on-device = MP4 first, then the others.
const all = new Set(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2']);
assert.strictEqual(VI.chooseMimeType((t) => all.has(t)), 'audio/webm;codecs=opus', 'the cloud still gets webm/opus');
assert.strictEqual(VI.chooseMimeType((t) => all.has(t), false), 'audio/webm;codecs=opus');
assert.strictEqual(VI.chooseMimeType((t) => all.has(t), true), 'audio/mp4;codecs=mp4a.40.2', 'the on-device engine gets MP4/AAC first');
assert.strictEqual(VI.chooseMimeType((t) => t === 'audio/mp4', true), 'audio/mp4');
assert.strictEqual(VI.chooseMimeType((t) => t.startsWith('audio/webm'), true), 'audio/webm;codecs=opus', 'a browser without MP4 recording falls back to webm');
assert.strictEqual(VI.chooseMimeType(() => false, true), '');

// Each profile's engine, model and Whisper model reach the request.
const config = {
  voice: {
    model: 'old', apiStyle: 'auto',
    realtime: { engine: 'whisper-local', model: 'rt', whisper: { model: 'small-q5_1' } },
    batch: { engine: 'gemini', model: 'bt', apiStyle: 'generateContent' },
  },
};
const rt = VI.resolveVoiceConfig(config);
assert.strictEqual(rt.engine, 'whisper-local', 'realtime is the default profile');
assert.strictEqual(rt.model, 'rt');
assert.strictEqual(rt.whisper.model, 'small-q5_1');
const bt = VI.resolveVoiceConfig(config, { profile: 'batch' });
assert.strictEqual(bt.engine, 'gemini');
assert.strictEqual(bt.model, 'bt');
assert.strictEqual(bt.apiStyle, 'generateContent');
const sent = JSON.parse(VI.requestConfigJSON(rt, null));
assert.strictEqual(sent.engine, 'whisper-local');
assert.strictEqual(sent.whisper.model, 'small-q5_1');
assert.strictEqual(sent.model, 'rt');
assert.strictEqual(JSON.parse(VI.configJSON(config, { profile: 'batch' })).engine, 'gemini', 'configJSON takes the profile');
assert.strictEqual(JSON.parse(VI.configJSON({})).engine, 'gemini', 'a config with nothing in it is Gemini');

// The wait: the on-device engine loads the model for each recording and takes its turn.
assert.ok(VI.watchdogMs({ engine: 'whisper-local', timeout: 30, refine: { timeoutSec: 5 } }, { refine: true }) >= 300 * 1000, 'the on-device engine waits at least 5 minutes');
assert.ok(VI.watchdogMs({ engine: 'gemini', timeout: 30, refine: { timeoutSec: 5 } }, { refine: true }) < 100 * 1000, 'the cloud wait is unchanged');

// start(): the second stage and a spoken rewrite are cloud-only.
const src = read('frontend/js/voice_input.js');
assert.ok(/const refineOn = cfgNow\.refine\.enabled && !localEngine && !\(opts && opts\.raw\);/.test(src), 'no second stage with the on-device engine');
assert.ok(/localEngine && cfgNow\.refine\.enabled && !\(opts && opts\.raw\) && editor\.selectionEnd > editor\.selectionStart/.test(src), 'a selection cannot be spoken over with the on-device engine');
assert.ok(/chooseMimeType\([^\n]*, localEngine\)/.test(src), 'the recording format follows the engine');
const i18n = read('frontend/js/i18n.js');
assert.strictEqual((i18n.match(/\n    voiceEditNeedsCloud: /g) || []).length, 2, 'the message is in both languages');
assert.strictEqual((src.match(/voiceEditNeedsCloud:/g) || []).length, 2, 'and in both of the built-in tables');
console.log('realtime local tests passed');
