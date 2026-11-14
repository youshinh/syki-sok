// Unit tests for speech_settings.js: pure helpers and the config <-> form round trip of the two profiles (realtime -rt, batch -bt).
const assert = require('assert');

global.window = global;
require('./voice_profiles.js');
const S = require('./speech_settings.js');

function fakeEl(initial) {
  const classes = new Set();
  const el = Object.assign({
    value: '', checked: false, textContent: '', options: [],
    classList: {
      toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    addEventListener() {},
    appendChild(child) { el.options.push(child); },
    remove(idx) { el.options.splice(idx, 1); }
  }, initial || {});
  return el;
}

function fakeDoc(ids) {
  const els = {};
  ids.forEach((id) => { els[id] = fakeEl(); });
  return {
    els,
    getElementById: (id) => els[id] || null,
    createElement: (tag) => fakeEl({ tagName: tag.toUpperCase() })
  };
}

const PER_PROFILE = [
  'speech-engine-choice', 'voice-gemini', 'speech-whisper', 'cfg-speech-engine', 'cfg-speech-model', 'cfg-speech-model-path',
  'cfg-speech-model-url', 'cfg-speech-model-sha', 'cfg-speech-streaming'
];
const SHARED = ['speech-engine-block', 'cfg-speech-language', 'cfg-speech-threads', 'cfg-speech-prompt', 'cfg-speech-cloud-fallback', 'cfg-speech-diarize', 'cfg-speech-enhance', 'cfg-speech-timestamps'];
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
  model: '', modelPath: '', customUrl: '', customSha256: '', language: '', threads: 0, prompt: '', cloudFallback: false, streaming: false,
  diarize: false, enhance: false, timestamps: false
});
assert.strictEqual(S.normalizeWhisper({ threads: '6' }).threads, 6);
assert.strictEqual(S.normalizeWhisper({ threads: -3 }).threads, 0);
assert.strictEqual(S.normalizeWhisper({ threads: 'abc' }).threads, 0);
assert.strictEqual(S.normalizeWhisper({ cloudFallback: 1 }).cloudFallback, true);
assert.strictEqual(S.normalizeWhisper({ streaming: 1 }).streaming, true);
assert.strictEqual(S.normalizeWhisper({ diarize: 1 }).diarize, true);
assert.strictEqual(S.normalizeWhisper({ enhance: 1 }).enhance, true);
assert.strictEqual(S.normalizeWhisper({ timestamps: 1 }).timestamps, true);
assert.strictEqual(S.normalizeWhisper({ model: 5 }).model, '');

const LEGACY_WHISPER = {
  model: 'kotoba-v2.0-q5_0', modelPath: 'C:\\m\\x.bin', customUrl: 'https://h/x.bin', customSha256: 'ab12',
  language: 'ja', threads: 6, prompt: '田中, syki::sok', cloudFallback: true, streaming: false,
  diarize: false, enhance: false, timestamps: false
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
}

// Round-trip with both profiles already written: changes in the form reach the saved voice config.
{
  const doc = fakeDoc(FORM_IDS);
  S.init({ t: (k) => k, backend: null, doc });
  const config = {
    voice: {
      model: 'old', apiStyle: 'auto',
      realtime: { engine: 'gemini', model: 'rt', apiStyle: 'interactions', whisper: { model: 'small-q5_1', threads: 2 } },
      batch: { engine: 'whisper-local', model: 'bt', apiStyle: 'auto', whisper: { model: 'large-v3-turbo-q5_0', threads: 8 } }
    }
  };
  S.load(config);
  assert.strictEqual(doc.els['cfg-speech-engine-rt'].value, 'gemini');
  assert.strictEqual(doc.els['cfg-speech-engine-bt'].value, 'whisper-local');
  assert.strictEqual(doc.els['cfg-speech-threads'].value, '8', 'batch profile\'s threads show in the shared field');

  // Change the form and save.
  doc.els['cfg-speech-engine-rt'].value = 'whisper-local';
  doc.els['cfg-speech-threads'].value = '4';
  doc.els['cfg-speech-language'].value = 'en';
  doc.els['cfg-speech-cloud-fallback'].checked = true;

  const out = JSON.parse(JSON.stringify(config));
  S.save(out);
  assert.strictEqual(out.voice.realtime.engine, 'whisper-local');
  assert.strictEqual(out.voice.batch.engine, 'whisper-local');
  assert.strictEqual(out.voice.realtime.whisper.threads, 4);
  assert.strictEqual(out.voice.batch.whisper.threads, 4);
  assert.strictEqual(out.voice.realtime.whisper.language, 'en');
  assert.strictEqual(out.voice.batch.whisper.cloudFallback, true);
  assert.strictEqual(out.voice.realtime.whisper.cloudFallback, true);
}

// Blank threads becomes 0 (auto); invalid becomes 0.
{
  const doc = fakeDoc(FORM_IDS);
  S.init({ t: (k) => k, backend: null, doc });
  doc.els['cfg-speech-threads'].value = '';
  const out = {};
  S.save(out);
  assert.strictEqual(out.voice.realtime.whisper.threads, 0);
  assert.strictEqual(out.voice.batch.whisper.threads, 0);
}

// Empty config object is handled safely.
{
  const doc = fakeDoc(FORM_IDS);
  S.init({ t: (k) => k, backend: null, doc });
  S.load({});
  assert.strictEqual(doc.els['cfg-speech-engine-rt'].value, 'gemini');
  assert.strictEqual(doc.els['cfg-speech-engine-bt'].value, 'gemini');
  assert.strictEqual(doc.els['cfg-speech-threads'].value, '0');
  assert.strictEqual(doc.els['cfg-speech-cloud-fallback'].checked, false);
}


(async () => {
  // Test model select installed badge
  {
    const doc = fakeDoc(FORM_IDS);
    const sel = doc.els['cfg-speech-model-rt'];
    sel.options = [];
    sel.remove = (i) => sel.options.splice(i, 1);
    sel.appendChild = (opt) => sel.options.push(opt);

    const fakeStatus = {
      realtime: {
        defaultModel: 'm1',
        models: [
          { part: { id: 'm1', title: 'Model One', size: 1000 }, status: { installed: true, size: 1000 } },
          { part: { id: 'm2', title: 'Model Two', size: 2000 }, status: { installed: false, size: 0 } }
        ]
      }
    };
    const fakeBackend = {
      getSpeechStatus: () => JSON.stringify(fakeStatus.realtime)
    };
    S.init({ t: (k) => k === 'speechInstalledBadge' ? '[ダウンロード済]' : k, backend: fakeBackend, doc });
    await S.refresh();
    assert.ok(sel.options[0].textContent.includes('[ダウンロード済]'), 'installed model should have badge');
    assert.ok(!sel.options[1].textContent.includes('[ダウンロード済]'), 'uninstalled model should not have badge');
    console.log('badge test passed');
  }

  // Test addon rows render based on checkboxes
  {
    const ADDON_IDS = [
      'speech-addon-row-diarize', 'speech-addon-status-diarize', 'btn-speech-addon-install-diarize', 'btn-speech-addon-remove-diarize', 'btn-speech-addon-cancel-diarize', 'speech-addon-progress-diarize',
      'speech-addon-row-enhance', 'speech-addon-status-enhance', 'btn-speech-addon-install-enhance', 'btn-speech-addon-remove-enhance', 'btn-speech-addon-cancel-enhance', 'speech-addon-progress-enhance',
      'speech-addon-row-vad', 'speech-addon-status-vad', 'btn-speech-addon-install-vad', 'btn-speech-addon-remove-vad', 'btn-speech-addon-cancel-vad', 'speech-addon-progress-vad'
    ];
    const allIds = FORM_IDS.concat(ADDON_IDS).concat(['speech-unsupported', 'speech-storage-dir']);
    const doc = fakeDoc(allIds);
    const fakeStatus = {
      supported: true,
      addons: [
        { part: { id: 'nemotron-3-diarization', size: 106000000 }, status: { installed: true, size: 106000000 } },
        { part: { id: 're-use', size: 38000000 }, status: { installed: false, size: 0 } },
        { part: { id: 'silero-vad', size: 1200000 }, status: { installed: true, size: 1200000 } }
      ]
    };
    const fakeBackend = {
      getSpeechStatus: () => JSON.stringify(fakeStatus)
    };
    S.init({ t: (k) => k, backend: fakeBackend, doc });
    await S.refresh();

    assert.ok(doc.els['speech-addon-row-diarize'].classList.contains('hidden'), 'diarize row hidden initially');
    assert.ok(doc.els['speech-addon-row-enhance'].classList.contains('hidden'), 'enhance row hidden initially');
    assert.ok(doc.els['speech-addon-row-vad'].classList.contains('hidden'), 'vad row hidden initially');

    // Check diarize -> diarize and vad become visible
    doc.els['cfg-speech-diarize'].checked = true;
    await S.refresh();
    assert.ok(!doc.els['speech-addon-row-diarize'].classList.contains('hidden'), 'diarize row visible when checked');
    assert.ok(!doc.els['speech-addon-row-vad'].classList.contains('hidden'), 'vad row visible when diarize checked');
    assert.ok(doc.els['speech-addon-row-enhance'].classList.contains('hidden'), 'enhance still hidden');
    assert.ok(doc.els['speech-addon-status-diarize'].textContent.includes('speechInstalled'), 'diarize installed text');

    // Check enhance
    doc.els['cfg-speech-enhance'].checked = true;
    await S.refresh();
    assert.ok(!doc.els['speech-addon-row-enhance'].classList.contains('hidden'), 'enhance row visible');
    assert.ok(doc.els['speech-addon-status-enhance'].textContent.includes('speechNotInstalled'), 'enhance not installed text');
    console.log('addon render test passed');
  }

  // Install error must not be overwritten by refresh() -> render()
  {
    delete require.cache[require.resolve('./speech_settings.js')];
    const S2 = require('./speech_settings.js');
    const doc = fakeDoc(FORM_IDS.concat([
      'speech-ready-hint-rt', 'btn-speech-quick-runtime-rt', 'speech-runtime-status'
    ]));
    doc.els['speech-ready-hint-rt'].style = {};
    const listeners = {};
    doc.els['btn-speech-quick-runtime-rt'].addEventListener = (ev, fn) => { listeners[ev] = fn; };
    doc.els['cfg-speech-engine-rt'].value = 'whisper-local';
    let capturedReqId = null;
    const fakeStatus = {
      supported: true,
      realtime: {
        ready: false,
        runtimeInstalled: false,
        modelInstalled: true,
        reason: '実行ファイルがありません',
        runtime: { part: { id: 'speech-runtime-v0.10.1-darwin-arm64', size: 6087757 }, status: { installed: false, size: 0 } },
        model: { part: { id: 'haas-ja-v1.0-q8_0', size: 656381472 }, status: { installed: true, size: 656381472 } }
      },
      addons: []
    };
    const fakeBackend = {
      getSpeechStatus: () => JSON.stringify(fakeStatus),
      installSpeechPartAsync: (reqId) => {
        capturedReqId = reqId;
        return Promise.resolve();
      }
    };
    S2.init({ t: (k, p) => (p && p.error ? k + ':' + p.error : k), backend: fakeBackend, doc });
    assert.strictEqual(typeof listeners.click, 'function', 'quick runtime click bound');
    listeners.click();
    assert.ok(capturedReqId, 'installSpeechPartAsync called');
    S2.onInstallEvent(capturedReqId, 'error', 0, 0, 'size mismatch');
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(doc.els['speech-ready-hint-rt'].textContent, 'speechInstallFailed:size mismatch');
    console.log('install error persistence test passed');
  }

  console.log('speech_settings tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
