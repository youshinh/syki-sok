// syki: the two ways audio is transcribed - realtime and batch - each with its own engine (cloud Gemini or on-device Whisper) and models.
//
//   realtime  a short recording somebody is waiting for: voice input, the voice button of the ask / rewrite bars, an audio file dropped on the window
//   batch     a long or unattended one: the meeting recording, the hot folder, the Discord bridge, Mobile Drop
//
// The shared settings (key, base URL, prompt, language, vocabulary, the second stage) stay on config.voice; config.voice.realtime and
// config.voice.batch hold { engine, model, apiStyle, whisper }. This is the same resolution as llm.VoiceConfig.ForProfile in Go
// (pkg/llm/voice_profile.go; the two tests share their table of cases), so read it with that file:
//
//   A config saved before the profiles has one engine / model / Whisper block under voice, and that engine only ever governed the hot
//   folder and the Discord bridge (voice input and Mobile Drop always used Gemini). So
//     batch     an empty engine, model, API style or Whisper block falls back to voice.engine, voice.model, voice.apiStyle, voice.whisper
//     realtime  an empty engine is Gemini, an empty model / API style falls back to voice.model / voice.apiStyle, and a missing
//               Whisper block to voice.whisper
//
//   VoiceProfiles.resolve(voice, name)       -> { engine, model, apiStyle, whisper } for 'realtime' | 'batch'
//   VoiceProfiles.writeProfiles(voice, p)    stores { realtime, batch } on voice, and drops the keys the profiles replace
(function (global) {
  'use strict';

  const REALTIME = 'realtime';
  const BATCH = 'batch';
  const LOCAL_ENGINE = 'whisper-local';

  function str(v) { return typeof v === 'string' ? v : ''; }
  function firstNonEmpty() {
    for (let i = 0; i < arguments.length; i++) {
      const v = str(arguments[i]);
      if (v.trim() !== '') return v;
    }
    return '';
  }
  function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function normalizeEngine(e) { return e === LOCAL_ENGINE ? LOCAL_ENGINE : 'gemini'; }

  function resolve(voice, name) {
    const v = isObject(voice) ? voice : {};
    const batch = name === BATCH;
    const p = isObject(v[batch ? BATCH : REALTIME]) ? v[batch ? BATCH : REALTIME] : {};
    const engine = batch ? firstNonEmpty(p.engine, v.engine) : str(p.engine);
    return {
      engine: normalizeEngine(engine),
      model: firstNonEmpty(p.model, v.model),
      apiStyle: firstNonEmpty(p.apiStyle, v.apiStyle),
      whisper: isObject(p.whisper) ? p.whisper : (isObject(v.whisper) ? v.whisper : {})
    };
  }

  // p: { realtime: { engine, model, apiStyle, whisper }, batch: { ... } } as the settings screen shows them. The profiles replace
  // voice.engine and voice.whisper (left behind they would only mislead: the profile blocks win); voice.model and voice.apiStyle stay,
  // set to the realtime profile's, which is what a script or an older reader meant by "the voice model".
  function writeProfiles(voice, p) {
    const out = isObject(voice) ? voice : {};
    const clean = (x) => ({
      engine: normalizeEngine(x && x.engine),
      model: str(x && x.model),
      apiStyle: str(x && x.apiStyle) || 'auto',
      whisper: isObject(x && x.whisper) ? x.whisper : {}
    });
    out.realtime = clean(p && p.realtime);
    out.batch = clean(p && p.batch);
    delete out.engine;
    delete out.whisper;
    out.model = out.realtime.model || out.model;
    out.apiStyle = out.realtime.apiStyle || out.apiStyle;
    return out;
  }

  const api = { REALTIME: REALTIME, BATCH: BATCH, LOCAL_ENGINE: LOCAL_ENGINE, resolve: resolve, writeProfiles: writeProfiles, normalizeEngine: normalizeEngine };
  global.VoiceProfiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
