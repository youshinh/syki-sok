// The profile resolution of the page (frontend/js/voice_profiles.js) gives the same as Go (pkg/llm/voice_profile_test.go): a config saved
// before the profiles existed gives each call site what it gets today.
import assert from 'assert';
import { createRequire } from 'module';

console.log('=== voice profiles tests ===');
const require = createRequire(import.meta.url);
const VP = require('../frontend/js/voice_profiles.js');

const lg = (voice, name) => { const r = VP.resolve(voice, name); return [r.engine, r.model, r.apiStyle, r.whisper.model || '', !!r.whisper.cloudFallback]; };

// legacy configs (the same three cases as the Go table)
assert.deepStrictEqual(lg({}, 'batch'), ['gemini', '', '', '', false]);
assert.deepStrictEqual(lg({}, 'realtime'), ['gemini', '', '', '', false]);
assert.deepStrictEqual(lg({ model: 'gemini-3.5-transcribe', apiStyle: 'auto' }, 'batch'), ['gemini', 'gemini-3.5-transcribe', 'auto', '', false]);
const legacyWhisper = { model: 'm1', apiStyle: 'interactions', engine: 'whisper-local', whisper: { model: 'small-q5_1', threads: 4, cloudFallback: true } };
assert.deepStrictEqual(lg(legacyWhisper, 'batch'), ['whisper-local', 'm1', 'interactions', 'small-q5_1', true], 'the hot folder and Discord keep the engine the person chose');
assert.deepStrictEqual(lg(legacyWhisper, 'realtime'), ['gemini', 'm1', 'interactions', 'small-q5_1', true], 'voice input stays Gemini, and starts from the same model');

// the new shape and partial blocks
const both = {
  apiKey: 'k', model: 'old', apiStyle: 'auto', engine: 'gemini',
  realtime: { engine: 'whisper-local', model: 'rt', whisper: { model: 'base' } },
  batch: { engine: 'gemini', model: 'bt', apiStyle: 'generateContent' },
};
assert.deepStrictEqual(lg(both, 'realtime'), ['whisper-local', 'rt', 'auto', 'base', false]);
assert.deepStrictEqual(lg(both, 'batch'), ['gemini', 'bt', 'generateContent', '', false]);
assert.deepStrictEqual(lg({ engine: 'whisper-local', batch: {}, realtime: {} }, 'batch')[0], 'whisper-local', 'an empty batch block keeps the legacy engine');
assert.deepStrictEqual(lg({ engine: 'whisper-local', batch: {}, realtime: {} }, 'realtime')[0], 'gemini');
assert.deepStrictEqual(lg(null, 'batch'), ['gemini', '', '', '', false], 'nothing at all');
assert.deepStrictEqual(lg({ engine: 'nonsense' }, 'batch')[0], 'gemini', 'an unknown engine is Gemini');

// writing: the profiles replace voice.engine / voice.whisper, voice.model follows the realtime profile
const saved = VP.writeProfiles(
  { model: 'old', apiStyle: 'auto', engine: 'whisper-local', whisper: { model: 'x' }, apiKey: 'k', refine: { enabled: true } },
  { realtime: { engine: 'gemini', model: 'rt', apiStyle: 'interactions', whisper: { model: 'a' } }, batch: { engine: 'whisper-local', model: 'bt', whisper: { model: 'b' } } });
assert.ok(!('engine' in saved) && !('whisper' in saved), 'the legacy engine and Whisper block are gone');
assert.equal(saved.apiKey, 'k');
assert.deepStrictEqual(saved.refine, { enabled: true }, 'shared settings are untouched');
assert.equal(saved.model, 'rt');
assert.equal(saved.apiStyle, 'interactions');
assert.deepStrictEqual(lg(saved, 'batch'), ['whisper-local', 'bt', 'auto', 'b', false], 'what was written reads back');
assert.deepStrictEqual(lg(saved, 'realtime'), ['gemini', 'rt', 'interactions', 'a', false]);
console.log('voice profiles tests passed');
