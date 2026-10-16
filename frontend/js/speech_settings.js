// syki::sok settings: the speech engine of the two profiles - realtime and batch (js/voice_profiles.js) - and the on-device Whisper they can use:
// the engine choice of each, its Whisper model (download / remove, or a custom file or URL), and what the two share: the Whisper
// program (one download) and the advanced options.
// It talks to window.backend only; app.js calls init() once and load()/save() around the Settings dialog.
//
// Element ids: what belongs to one profile ends in -rt (realtime) or -bt (batch); the rest is shared.
(function (global) {
  'use strict';

  const LOCAL_ENGINE = 'whisper-local';
  const MODEL_CUSTOM_PATH = 'custom-path';
  const MODEL_CUSTOM_URL = 'custom-url';
  // key: the name in config.voice and in VoiceProfiles; sfx: the end of the element ids.
  const PROFILES = [{ key: 'realtime', sfx: '-rt' }, { key: 'batch', sfx: '-bt' }];
  const SHARED_ADVANCED = ['language', 'threads', 'prompt', 'cloudFallback'];

  // 1024-based, like Explorer, so a size matches what the file shows on disk.
  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB';
    if (n >= 1024 ** 2) return Math.round(n / 1024 ** 2) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function percent(done, total) {
    return total > 0 ? Math.max(0, Math.min(100, Math.floor((done * 100) / total))) : 0;
  }

  // A profile's whisper block, with every field present and typed.
  function normalizeWhisper(w) {
    const src = w || {};
    const threads = parseInt(src.threads, 10);
    return {
      model: typeof src.model === 'string' ? src.model : '',
      modelPath: typeof src.modelPath === 'string' ? src.modelPath : '',
      customUrl: typeof src.customUrl === 'string' ? src.customUrl : '',
      customSha256: typeof src.customSha256 === 'string' ? src.customSha256 : '',
      language: typeof src.language === 'string' ? src.language : '',
      threads: Number.isFinite(threads) && threads > 0 ? threads : 0,
      prompt: typeof src.prompt === 'string' ? src.prompt : '',
      cloudFallback: !!src.cloudFallback
    };
  }

  function normalizeEngine(e) {
    return e === LOCAL_ENGINE ? LOCAL_ENGINE : 'gemini';
  }

  // The engine and Whisper block of a profile as config.voice stores them (the same resolution as the backend's: js/voice_profiles.js).
  function profileOfConfig(voice, key) {
    const VP = global.VoiceProfiles;
    if (VP && typeof VP.resolve === 'function') {
      const r = VP.resolve(voice, key);
      return { engine: normalizeEngine(r.engine), whisper: normalizeWhisper(r.whisper) };
    }
    return { engine: key === 'batch' ? normalizeEngine(voice && voice.engine) : 'gemini', whisper: normalizeWhisper(voice && voice.whisper) };
  }

  let t = (key) => key;
  let backend = null;
  let doc = null;
  const lastStatus = { realtime: null, batch: null };
  let refreshTimer = null;
  let bound = false;
  // The saved model id of each profile, used until its <select> has been filled from the backend's catalog (and kept when there is no
  // backend at all, so saving never wipes it).
  const savedModel = { realtime: '', batch: '' };
  const installs = { runtime: null, 'model-rt': null, 'model-bt': null };

  const $ = (id) => (doc ? doc.getElementById(id) : null);
  const setHidden = (el, hidden) => { if (el) el.classList.toggle('hidden', !!hidden); };
  const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const sfxOf = (key) => (PROFILES.find((p) => p.key === key) || PROFILES[0]).sfx;
  const keyOfSfx = (sfx) => (PROFILES.find((p) => p.sfx === sfx) || PROFILES[0]).key;

  function hasBackend() {
    return !!(backend && typeof backend.getSpeechStatus === 'function');
  }

  function modelValue(key) {
    const sel = $('cfg-speech-model' + sfxOf(key));
    return sel && sel.options && sel.options.length > 0 ? sel.value : savedModel[key];
  }

  // What the settings screen shows for one profile, in the shape config.voice stores it. The advanced options are shared: both profiles
  // carry the same.
  function readUI(key) {
    const sfx = sfxOf(key);
    const get = (id) => { const el = $(id); return el ? el.value : ''; };
    const checked = (id) => { const el = $(id); return !!(el && el.checked); };
    return {
      engine: normalizeEngine(get('cfg-speech-engine' + sfx)),
      whisper: normalizeWhisper({
        model: modelValue(key),
        modelPath: get('cfg-speech-model-path' + sfx).trim(),
        customUrl: get('cfg-speech-model-url' + sfx).trim(),
        customSha256: get('cfg-speech-model-sha' + sfx).trim(),
        language: get('cfg-speech-language').trim(),
        threads: get('cfg-speech-threads'),
        prompt: get('cfg-speech-prompt').trim(),
        cloudFallback: checked('cfg-speech-cloud-fallback')
      })
    };
  }

  function configJSON(key) {
    return JSON.stringify(readUI(key));
  }

  function load(config) {
    const voice = (config && config.voice) || {};
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    PROFILES.forEach((p) => {
      const prof = profileOfConfig(voice, p.key);
      const w = prof.whisper;
      set('cfg-speech-engine' + p.sfx, prof.engine);
      set('cfg-speech-model-path' + p.sfx, w.modelPath);
      set('cfg-speech-model-url' + p.sfx, w.customUrl);
      set('cfg-speech-model-sha' + p.sfx, w.customSha256);
      savedModel[p.key] = w.model;
      const sel = $('cfg-speech-model' + p.sfx);
      if (sel && sel.options && sel.options.length > 0) {
        const known = Array.from(sel.options).some((o) => o.value === w.model);
        const dflt = lastStatus[p.key] && lastStatus[p.key].defaultModel;
        sel.value = known ? w.model : (dflt || sel.value);
      }
    });
    // the advanced options are shared; the batch profile's block is where a config saved before the profiles kept them
    const shared = profileOfConfig(voice, 'batch').whisper;
    set('cfg-speech-language', shared.language);
    set('cfg-speech-threads', String(shared.threads));
    set('cfg-speech-prompt', shared.prompt);
    const cf = $('cfg-speech-cloud-fallback');
    if (cf) cf.checked = shared.cloudFallback;
    refresh();
  }

  // Puts each profile's engine and Whisper block into config.voice.realtime / .batch (keeping the model and API style that
  // app.js has already put there), then writes the profiles the one way (VoiceProfiles.writeProfiles).
  function save(config) {
    if (!config) return;
    if (!config.voice) config.voice = {};
    const next = {};
    PROFILES.forEach((p) => {
      const ui = readUI(p.key);
      const old = config.voice[p.key] && typeof config.voice[p.key] === 'object' ? config.voice[p.key] : {};
      next[p.key] = Object.assign({}, old, { engine: ui.engine, whisper: ui.whisper });
    });
    const VP = global.VoiceProfiles;
    if (VP && typeof VP.writeProfiles === 'function') {
      VP.writeProfiles(config.voice, next);
    } else {
      config.voice.realtime = next.realtime;
      config.voice.batch = next.batch;
    }
  }

  function refresh() {
    updatePanelVisibility();
    if (!hasBackend()) return Promise.resolve();
    return Promise.all(PROFILES.map((p) => {
      let raw;
      try {
        raw = backend.getSpeechStatus(configJSON(p.key));
      } catch (e) {
        return Promise.resolve();
      }
      return Promise.resolve(raw).then((json) => {
        try { lastStatus[p.key] = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { /* keep the last */ }
      }).catch(() => {});
    })).then(render);
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 350);
  }

  function engineOf(key) {
    return normalizeEngine(($('cfg-speech-engine' + sfxOf(key)) || {}).value);
  }

  function updatePanelVisibility() {
    const backendThere = hasBackend();
    const anyLocal = PROFILES.some((p) => engineOf(p.key) === LOCAL_ENGINE);
    PROFILES.forEach((p) => {
      setHidden($('speech-whisper' + p.sfx), engineOf(p.key) !== LOCAL_ENGINE);
      // Gemini's model is the cloud's; it stays when Whisper may fall back to it
      const fallback = !!($('cfg-speech-cloud-fallback') || {}).checked;
      setHidden($('voice-gemini' + p.sfx), engineOf(p.key) === LOCAL_ENGINE && !fallback);
    });
    // the engine choice itself needs the backend; the Whisper program and the options show once a profile uses it
    PROFILES.forEach((p) => setHidden($('speech-engine-choice' + p.sfx), !backendThere));
    setHidden($('speech-engine-block'), !backendThere || !anyLocal);
  }

  function findPart(status, id) {
    if (!status) return null;
    const all = (status.models || []).slice();
    if (status.custom) all.push(status.custom);
    return all.find((m) => m.part && m.part.id === id) || null;
  }

  function fillModelSelect(key, status) {
    const sel = $('cfg-speech-model' + sfxOf(key));
    if (!sel || !doc) return;
    const wanted = sel.options.length === 0 ? savedModel[key] : sel.value;
    while (sel.options.length > 0) sel.remove(0);
    const add = (value, label) => {
      const o = doc.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    };
    (status.models || []).forEach((m) => add(m.part.id, m.part.title + ' (' + formatSize(m.part.size) + ')'));
    add(MODEL_CUSTOM_PATH, t('speechModelCustomPath'));
    add(MODEL_CUSTOM_URL, t('speechModelCustomUrl'));
    const known = Array.from(sel.options).some((o) => o.value === wanted);
    sel.value = known ? wanted : (status.defaultModel || '');
  }

  // idSuffix: '' for the shared program row, '-rt' / '-bt' for a model row; prefix: 'runtime' | 'model'.
  function renderRow(prefix, idSuffix, entry, downloading, supported) {
    const statusEl = $('speech-' + prefix + '-status' + idSuffix);
    const installBtn = $('btn-speech-' + prefix + '-install' + idSuffix);
    const removeBtn = $('btn-speech-' + prefix + '-remove' + idSuffix);
    const cancelBtn = $('btn-speech-' + prefix + '-cancel' + idSuffix);
    const progress = $('speech-' + prefix + '-progress' + idSuffix);
    const installed = !!(entry && entry.status && entry.status.installed);
    if (statusEl && !downloading) {
      if (!entry) statusEl.textContent = '';
      else if (installed) statusEl.textContent = t('speechInstalled') + ' (' + formatSize(entry.status.size) + ')';
      else statusEl.textContent = t('speechNotInstalled') + (entry.part.size ? ' (' + formatSize(entry.part.size) + ')' : '');
    }
    setHidden(installBtn, downloading || installed || !entry || !supported);
    setHidden(removeBtn, downloading || !installed);
    setHidden(cancelBtn, !downloading);
    setHidden(progress, !downloading);
  }

  function render() {
    updatePanelVisibility();
    const any = lastStatus.realtime || lastStatus.batch;
    if (!any) return;
    const supported = !!any.supported;
    setHidden($('speech-unsupported'), supported);
    // where the on-device engine does not exist (macOS), it cannot be chosen
    PROFILES.forEach((p) => {
      const sel = $('cfg-speech-engine' + p.sfx);
      if (sel && sel.options) Array.from(sel.options).forEach((o) => { if (o.value === LOCAL_ENGINE) o.disabled = !supported; });
    });

    renderRow('runtime', '', any.runtime, installs.runtime !== null, supported);
    setText('speech-storage-dir', any.storageDir || '');

    PROFILES.forEach((p) => {
      const status = lastStatus[p.key];
      if (!status) return;
      fillModelSelect(p.key, status);
      const modelId = ($('cfg-speech-model' + p.sfx) || {}).value;
      const isPath = modelId === MODEL_CUSTOM_PATH;
      const isUrl = modelId === MODEL_CUSTOM_URL;
      setHidden($('speech-custom-path' + p.sfx), !isPath);
      setHidden($('speech-custom-url' + p.sfx), !isUrl);
      setHidden($('speech-model-actions' + p.sfx), isPath);
      const entry = isPath ? null : (isUrl ? status.custom : findPart(status, modelId));
      renderRow('model', p.sfx, entry, installs['model' + p.sfx] !== null, supported);
      setText('speech-model-note' + p.sfx, entry && entry.part.note ? entry.part.note : '');
      if (isUrl && !status.custom) setText('speech-model-status' + p.sfx, '');

      // what this profile needs is said for this profile only, and only when it uses Whisper
      const local = status.local || {};
      let hint = '';
      if (engineOf(p.key) === LOCAL_ENGINE) {
        hint = local.ready ? t('speechReady') : (local.reason || '');
        if (local.modelWarning) hint += (hint ? ' ' : '') + local.modelWarning;
      }
      setText('speech-ready-hint' + p.sfx, hint);
    });
  }

  function newReqId(which) {
    return 'speech_' + which + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // slot: 'runtime', 'model-rt' or 'model-bt'.
  function startInstall(slot) {
    if (!hasBackend() || typeof backend.installSpeechPartAsync !== 'function' || installs[slot]) return;
    const isModel = slot !== 'runtime';
    const key = isModel ? keyOfSfx(slot.slice('model'.length)) : 'realtime';
    const reqId = newReqId(slot);
    installs[slot] = reqId;
    setText('speech-ready-hint' + (isModel ? sfxOf(key) : sfxOf('realtime')), '');
    setText('speech-' + (isModel ? 'model-status' + sfxOf(key) : 'runtime-status'), t('speechDownloading', { done: formatSize(0), total: '…' }));
    render();
    try {
      const p = backend.installSpeechPartAsync(reqId, isModel ? 'model' : 'runtime', configJSON(key));
      if (p && typeof p.catch === 'function') p.catch((e) => finishInstall(reqId, 'error', String((e && e.message) || e)));
    } catch (e) {
      finishInstall(reqId, 'error', String((e && e.message) || e));
    }
  }

  function slotForReq(reqId) {
    return Object.keys(installs).find((k) => installs[k] === reqId) || null;
  }

  // Where a message about a slot goes: a model's own hint, or the realtime hint for the shared program.
  function hintIdFor(slot) {
    return 'speech-ready-hint' + (slot === 'runtime' ? sfxOf('realtime') : slot.slice('model'.length));
  }

  function finishInstall(reqId, state, message) {
    const slot = slotForReq(reqId);
    if (!slot) return;
    installs[slot] = null;
    if (state === 'error') setText(hintIdFor(slot), t('speechInstallFailed', { error: message || '' }));
    else if (state === 'canceled') setText(hintIdFor(slot), t('speechCanceled'));
    refresh();
  }

  // Called by the Go backend: window.__onSpeechInstall(reqId, state, done, total, message).
  function onInstallEvent(reqId, state, done, total, message) {
    const slot = slotForReq(reqId);
    if (!slot) return;
    if (state === 'progress') {
      const bar = $(slot === 'runtime' ? 'speech-runtime-progress' : 'speech-model-progress' + slot.slice('model'.length));
      if (bar) bar.value = percent(done, total);
      setText(slot === 'runtime' ? 'speech-runtime-status' : 'speech-model-status' + slot.slice('model'.length),
        t('speechDownloading', { done: formatSize(done), total: total ? formatSize(total) : '…' }));
      return;
    }
    finishInstall(reqId, state, message);
  }

  function cancelInstall(slot) {
    const reqId = installs[slot];
    if (reqId && backend && typeof backend.cancelSpeechInstall === 'function') backend.cancelSpeechInstall(reqId);
  }

  // A model is shared by name: removing it in one profile must not take away what the other still uses.
  function modelUsedByOther(key) {
    const other = key === 'realtime' ? 'batch' : 'realtime';
    if (engineOf(other) !== LOCAL_ENGINE) return false;
    const mine = modelValue(key);
    return !!mine && mine !== MODEL_CUSTOM_PATH && mine === modelValue(other);
  }

  function removePart(slot) {
    if (!hasBackend() || typeof backend.removeSpeechPart !== 'function') return;
    const isModel = slot !== 'runtime';
    const key = isModel ? keyOfSfx(slot.slice('model'.length)) : 'realtime';
    if (isModel && modelUsedByOther(key)) {
      setText(hintIdFor(slot), t('speechModelInUse'));
      return;
    }
    Promise.resolve(backend.removeSpeechPart(isModel ? 'model' : 'runtime', configJSON(key))).then((err) => {
      if (err) setText(hintIdFor(slot), String(err));
      refresh();
    }).catch(() => refresh());
  }

  function validateChosenPath(key) {
    const sfx = sfxOf(key);
    const path = (($('cfg-speech-model-path' + sfx) || {}).value || '').trim();
    const out = $('speech-model-path-result' + sfx);
    if (!out) return;
    if (!path || !backend || typeof backend.validateWhisperModelFile !== 'function') { out.textContent = ''; return; }
    Promise.resolve(backend.validateWhisperModelFile(path)).then((raw) => {
      let res = {};
      try { res = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch (e) { /* leave empty */ }
      out.textContent = res.ok ? t('speechModelOk') : (res.error || '');
      refresh();
    }).catch(() => {});
  }

  function browseModelFile(key) {
    if (!backend || typeof backend.pickFilePath !== 'function') return;
    Promise.resolve(backend.pickFilePath(t('speechModelPathLabel'))).then((picked) => {
      if (!picked) return;
      const input = $('cfg-speech-model-path' + sfxOf(key));
      if (input) input.value = picked;
      validateChosenPath(key);
    }).catch(() => { /* cancelled */ });
  }

  function bind() {
    const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
    PROFILES.forEach((p) => {
      on('cfg-speech-engine' + p.sfx, 'change', refresh);
      on('cfg-speech-model' + p.sfx, 'change', refresh);
      ['cfg-speech-model-url', 'cfg-speech-model-sha'].forEach((id) => on(id + p.sfx, 'input', scheduleRefresh));
      on('cfg-speech-model-path' + p.sfx, 'change', () => validateChosenPath(p.key));
      on('btn-speech-model-browse' + p.sfx, 'click', () => browseModelFile(p.key));
      on('btn-speech-model-install' + p.sfx, 'click', () => startInstall('model' + p.sfx));
      on('btn-speech-model-cancel' + p.sfx, 'click', () => cancelInstall('model' + p.sfx));
      on('btn-speech-model-remove' + p.sfx, 'click', () => removePart('model' + p.sfx));
    });
    ['cfg-speech-language', 'cfg-speech-threads'].forEach((id) => on(id, 'input', scheduleRefresh));
    on('cfg-speech-cloud-fallback', 'change', updatePanelVisibility);
    on('btn-speech-runtime-install', 'click', () => startInstall('runtime'));
    on('btn-speech-runtime-cancel', 'click', () => cancelInstall('runtime'));
    on('btn-speech-runtime-remove', 'click', () => removePart('runtime'));
  }

  // opts: { t: (key, params) => string, backend: window.backend, doc: document }
  function init(opts) {
    const o = opts || {};
    if (typeof o.t === 'function') t = o.t;
    backend = o.backend || global.backend || null;
    doc = o.doc || (typeof document !== 'undefined' ? document : null);
    global.__onSpeechInstall = onInstallEvent;
    if (!bound) {
      bind();
      bound = true;
    }
    updatePanelVisibility();
  }

  const api = { init, load, save, refresh, onInstallEvent, formatSize, percent, normalizeWhisper, normalizeEngine, PROFILES, SHARED_ADVANCED };
  global.SpeechSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
