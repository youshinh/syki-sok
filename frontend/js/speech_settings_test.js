// Unit tests for speech_settings.js: pure helpers and the config <-> form round trip of the two profiles (realtime -rt, batch -bt).
const assert = require('assert');

global.window = global;
require('./voice_profiles.js');
const S = require('./speech_settings.js');

function fakeEl(initial) {
  const classes = new Set();
  return Object.assign({
    value: '', checked: false, textContent: '', options: [],
    classList: {
      toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    addEventListener() {}
  }, initial || {});
}

function fakeDoc(ids) {
  const els = {};
  ids.forEach((id) => { els[id] = fakeEl(); });
  return { els, getElementById: (id) => els[id] || null };
}

const PER_PROFILE = [
  'speech-engine-choice', 'voice-gemini', 'speech-whisper', 'cfg-speech-engine', 'cfg-speech-model', 'cfg-speech-model-path',
  'cfg-speech-model-url', 'cfg-speech-model-sha'
];
const SHARED = ['speech-engine-block', 'cfg-speech-language', 'cfg-speech-threads', 'cfg-speech-prompt', 'cfg-speech-cloud-fallback'];
const FORM_IDS = SHARED.concat(...['-rt', '-bt'].map((sfx) => PER_PROFILE.map((id) => id + sfx)));

// formatSize / percent
assert.strictEqual(S.formatSize(0), '0 B');
assert.strictEqual(S.formatSize(2048), '2 KB');
assert.strictEqual(S.formatSize(8573270), '8 MB');
assert.strictEqual(S.formatSize(537819875), '513 MB');
assert.strictEqual(S.formatSize(1519521155), '1.4 GB');
assert.strictEqual(S.percent(50, 200), 25);
assert.strictEqual(S.percent(300, 200), 100);
assert.strictEqual(S.percent(5, 0), 0);
assert.strictEqual(S.percent(-5, 100), 0);

// normalizers
assert.strictEqual(S.normalizeEngine('whisper-local'), 'whisper-local');
assert.strictEqual(S.normalizeEngine('anything else'), 'gemini');
assert.strictEqual(S.normalizeEngine(undefined), 'gemini');
assert.deepStrictEqual(S.normalizeWhisper(undefined), {
  model: '', modelPath: '', customUrl: '', customSha256: '', language: '', threads: 0, prompt: '', cloudFallback: false
});
assert.strictEqual(S.normalizeWhisper({ threads: '6' }).threads, 6);
assert.strictEqual(S.normalizeWhisper({ threads: -3 }).threads, 0);
assert.strictEqual(S.normalizeWhisper({ threads: 'abc' }).threads, 0);
assert.strictEqual(S.normalizeWhisper({ cloudFallback: 1 }).cloudFallback, true);
assert.strictEqual(S.normalizeWhisper({ model: 5 }).model, '');

const LEGACY_WHISPER = {
  model: 'kotoba-v2.0-q5_0', modelPath: 'C:\\m\\x.bin', customUrl: 'https://h/x.bin', customSha256: 'ab12',
  language: 'ja', threads: 6, prompt: '田中, syki::sok', cloudFallback: true
};

// A config saved before the profiles existed: its engine and Whisper block belong to the batch profile (the hot folder and Discord used
// them); realtime is Gemini. Load shows that, and saving writes the two profiles and drops the old keys.
{
  const doc = fakeDoc(FORM_IDS);
  S.init({ t: (k) => k, backend: null, doc });
  const config = { voice: { model: 'gemini-3.5-transcribe', engine: 'whisper-local', whisper: LEGACY_WHISPER } };
  S.load(config);
  assert.strictEqual(doc.els['cfg-speech-engine-bt'].value, 'whisper-local', 'the old engine is the batch profile\'s');
  assert.strictEqual(doc.els['cfg-speech-engine-rt'].value, 'gemini', 'voice input stays Gemini');
  assert.strictEqual(doc.els['cfg-speech-threads'].value, '6');
  assert.strictEqual(doc.els['cfg-speech-cloud-fallback'].checked, true);
  assert.strictEqual(doc.els['cfg-speech-model-path-bt'].value, 'C:\\m\\x.bin');
  assert.ok(doc.els['speech-engine-block'].classList.contains('hidden'), 'no backend: the shared block is hidden');

  const out = { voice: { model: 'gemini-3.5-transcribe', apiKey: 'keep-me', engine: 'whisper-local', whisper: LEGACY_WHISPER } };
  S.save(out);
  assert.strictEqual(out.voice.apiKey, 'keep-me', 'other voice settings are untouched');
  assert.ok(!('engine' in out.voice) && !('whisper' in out.voice), 'the profiles replace voice.engine and voice.whisper');
  assert.strictEqual(out.voice.batch.engine, 'whisper-local');
  assert.strictEqual(out.voice.realtime.engine, 'gemini');
  // The <select> was never filled (no backend), so the saved model must survive rather than become ''.
  assert.deepStrictEqual(out.voice.batch.whisper, LEGACY_WHISPER);
  // the options are shared: both profiles carry them (the realtime profile starts from the same Whisper model)
  assert.strictEqual(out.voice.realtime.whisper.threads, 6);
  assert.strictEqual(out.voice.realtime.whisper.cloudFallback, true);
}

// the two profiles are independent once they exist
{
  const doc = fakeDoc(FORM_IDS);
  S.init({ t: (k) => k, backend: null, doc });
  const config = {
    voice: {
      model: 'old',
      realtime: { engine: 'whisper-local', model: 'rt', whisper: { model: 'small-q5_1' } },
      batch: { engine: 'gemini', model: 'bt', whisper: { model: 'kotoba-v2.0-q5_0' } }
    }
  };
  S.load(config);
  assert.strictEqual(doc.els['cfg-speech-engine-rt'].value, 'whisper-local');
  assert.strictEqual(doc.els['cfg-speech-engine-bt'].value, 'gemini');
  doc.els['cfg-speech-engine-bt'].value = 'whisper-local';
  const out = { voice: { realtime: { model: 'rt', apiStyle: 'interactions' }, batch: { model: 'bt' } } };
  S.save(out);
  assert.strictEqual(out.voice.realtime.engine, 'whisper-local');
  assert.strictEqual(out.voice.batch.engine, 'whisper-local', 'the change of one profile is saved');
  assert.strictEqual(out.voice.realtime.model, 'rt', 'the model and API style that app.js put there are kept');
  assert.strictEqual(out.voice.realtime.apiStyle, 'interactions');
  assert.strictEqual(out.voice.batch.model, 'bt');
  assert.strictEqual(out.voice.model, 'rt', 'voice.model follows the realtime profile');
  assert.strictEqual(out.voice.realtime.whisper.model, 'small-q5_1');
  assert.strictEqual(out.voice.batch.whisper.model, 'kotoba-v2.0-q5_0');
}

// defaults for a config that has never seen the feature
{
  const doc = fakeDoc(FORM_IDS);
  S.init({ t: (k) => k, backend: null, doc });
  S.load({});
  const out = {};
  S.save(out);
  assert.strictEqual(out.voice.realtime.engine, 'gemini');
  assert.strictEqual(out.voice.batch.engine, 'gemini');
  assert.strictEqual(out.voice.batch.whisper.threads, 0);
  assert.strictEqual(out.voice.batch.whisper.cloudFallback, false);
}

// where the on-device engine does not exist (macOS), it cannot be chosen in either profile
(async () => {
  const doc = fakeDoc(FORM_IDS);
  doc.createElement = () => fakeEl();
  // a <select> that keeps the options it is given (the model list is filled from the backend's catalog)
  ['-rt', '-bt'].forEach((sfx) => {
    const sel = doc.els['cfg-speech-model' + sfx];
    sel.appendChild = (o) => { sel.options.push(o); };
    sel.remove = (i) => { sel.options.splice(i, 1); };
  });
  ['-rt', '-bt'].forEach((sfx) => { doc.els['cfg-speech-engine' + sfx].options = [{ value: 'gemini', disabled: false }, { value: 'whisper-local', disabled: false }]; });
  const backend = { getSpeechStatus: () => JSON.stringify({ supported: false, runtime: null, models: [], local: {}, storageDir: '' }) };
  S.init({ t: (k) => k, backend, doc });
  S.load({});
  await S.refresh();
  ['-rt', '-bt'].forEach((sfx) => {
    const [cloud, local] = doc.els['cfg-speech-engine' + sfx].options;
    assert.strictEqual(local.disabled, true, 'Whisper cannot be chosen where it does not exist (' + sfx + ')');
    assert.strictEqual(cloud.disabled, false);
  });
  backend.getSpeechStatus = () => JSON.stringify({ supported: true, runtime: null, models: [], local: {}, storageDir: '' });
  await S.refresh();
  assert.strictEqual(doc.els['cfg-speech-engine-rt'].options[1].disabled, false, 'and it can where it does');
  console.log('speech_settings_test.js: unsupported-platform assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });

// the backend callback is a no-op for an unknown request id
S.onInstallEvent('nope', 'progress', 1, 2, '');

console.log('speech_settings_test.js: all assertions passed');
