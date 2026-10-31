// syki: the microphone button of the ask / rewrite / command bars (the "fusen" the Ctrl+L, Ctrl+K and Ctrl+E bars are).
//
//   idle -(press)-> listening -(a pause, the button, or Enter)-> writing it down -> the text is in the box (nothing is sent)
//
// What it does and does not do:
//   - The text only goes into the box. Enter (or Run) sends it, as with typed text; nothing is sent by voice.
//   - A recording stops by itself 1.5 s (the setting) after the person stops talking; it never counts the silence before the first word,
//     and gives up when nothing is said for 6 s or at 60 s. The button stops it at once, and so does Enter while it listens.
//   - Esc closes the bar and throws everything away: the recording, and an answer that is still on its way (the request itself cannot
//     be aborted, so its answer is ignored). The audio is never written to disk (the request says noCache).
//   - The microphone is only ever the microphone, whatever "also record the sound this PC plays" says; and it is let go the moment the
//     recording stops, however it stops.
//   - It uses the realtime profile of the voice settings (js/voice_profiles.js): Gemini, or the on-device Whisper. There is no second
//     stage: what was said is what goes into the box.
//   - The button is not there in the command bar's CLI mode (a command needs exact input) or where the page cannot record.
//
//   BarVoice.createListenState(o) / BarVoice.listenUpdate(state, rms, nowMs)   the pure pause detector
//   BarVoice.create(deps).attach(id, bar)   .toggle(id) .cancel(id) .busy(id) .handleResult(reqId, text, err) .refresh()
(function (global) {
  'use strict';

  const SILENCE_SEC = 1.5;
  const NO_SPEECH_SEC = 6;
  const MAX_SEC = 60;
  const MIN_VOICED_MS = 200; // a click or a knock is not the first word
  const SAMPLE_MS = 100;
  const DONE_SHOWN_MS = 2500;

  // ---- the pure pause detector --------------------------------------------------------------------------------------------

  // o: { silenceSec, noSpeechSec, maxSec, rmsThreshold }
  function createListenState(o) {
    const x = o || {};
    const num = (v, d) => (typeof v === 'number' && v > 0 ? v : d);
    return {
      silenceMs: num(x.silenceSec, SILENCE_SEC) * 1000,
      noSpeechMs: num(x.noSpeechSec, NO_SPEECH_SEC) * 1000,
      maxMs: num(x.maxSec, MAX_SEC) * 1000,
      threshold: num(x.rmsThreshold, 0.015),
      startMs: null, lastMs: null, voicedMs: 0, lastVoiceMs: null, spoke: false
    };
  }

  // One sample of the microphone's loudness. '' = carry on; otherwise why it should stop: 'silence' (a pause after talking),
  // 'nospeech' (nothing was said), 'max' (the longest recording).
  function listenUpdate(state, rms, nowMs) {
    if (state.startMs === null) { state.startMs = nowMs; state.lastMs = nowMs; }
    const dt = Math.max(0, nowMs - state.lastMs);
    state.lastMs = nowMs;
    if (rms >= state.threshold) {
      state.voicedMs += dt || SAMPLE_MS;
      state.lastVoiceMs = nowMs;
      if (state.voicedMs >= MIN_VOICED_MS) state.spoke = true;
    }
    if (nowMs - state.startMs >= state.maxMs) return 'max';
    if (!state.spoke) return nowMs - state.startMs >= state.noSpeechMs ? 'nospeech' : '';
    // a pause is counted from the last sound, not from the last sample
    return nowMs - state.lastVoiceMs >= state.silenceMs ? 'silence' : '';
  }

  // ---- the button -------------------------------------------------------------------------------------------------------

  const MIC_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect>' +
    '<path d="M5 11a7 7 0 0 0 14 0"></path><line x1="12" y1="18" x2="12" y2="21"></line></svg>';
  const STOP_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
  const BUSY_ICON = '<svg class="bar-voice-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>';

  // deps: { document, window, navigator, getConfig, getBackend, t, VoiceInput (the helpers of js/voice_input.js), MediaRecorder,
  //         AudioContext, setTimeout, clearTimeout, setInterval, clearInterval, now, blobToBase64 }
  function create(deps) {
    const doc = deps.document;
    const win = deps.window || global;
    const nav = deps.navigator || (win && win.navigator);
    const t = deps.t || ((k) => k);
    const setT = deps.setTimeout || win.setTimeout.bind(win);
    const clearT = deps.clearTimeout || win.clearTimeout.bind(win);
    const setI = deps.setInterval || win.setInterval.bind(win);
    const clearI = deps.clearInterval || win.clearInterval.bind(win);
    const now = deps.now || Date.now;
    const helpers = () => (deps.VoiceInput && deps.VoiceInput.helpers) || (win.VoiceInput && win.VoiceInput.helpers) || null;

    const bars = {}; // id -> { input, row, send, available, onText, btn, status, statusTimer }
    let active = null; // the one recording / transcription there can be: { id, phase, ... }
    let seq = 0;

    function config() { return deps.getConfig ? (deps.getConfig() || {}) : {}; }
    function backend() { return deps.getBackend ? deps.getBackend() : (win.backend || null); }
    function enabled() {
      const g = config().general;
      return !(g && g.barVoice === false);
    }
    function canRecord() {
      const MR = deps.MediaRecorder || win.MediaRecorder;
      const b = backend();
      return !!(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function' && MR && b && typeof b.transcribeAudioAsync === 'function' && helpers());
    }

    function setStatus(bar, text, kind) {
      if (!bar.status) return;
      if (bar.statusTimer) { clearT(bar.statusTimer); bar.statusTimer = null; }
      bar.status.textContent = text || '';
      bar.status.classList.toggle('hidden', !text);
      bar.status.classList.toggle('is-error', kind === 'error');
    }

    function paint(id) {
      const bar = bars[id];
      if (!bar || !bar.btn) return;
      const phase = active && active.id === id ? active.phase : 'idle';
      const show = enabled() && canRecord() && (!bar.available || bar.available());
      bar.btn.classList.toggle('hidden', !show);
      bar.btn.classList.toggle('is-recording', phase === 'listening');
      bar.btn.classList.toggle('is-busy', phase === 'starting' || phase === 'writing');
      bar.btn.setAttribute('aria-pressed', phase === 'listening' ? 'true' : 'false');
      bar.btn.disabled = phase === 'writing' || phase === 'starting';
      const label = t(phase === 'listening' ? 'barVoiceStop' : 'barVoiceStart');
      bar.btn.title = label;
      bar.btn.setAttribute('aria-label', label);
      bar.btn.innerHTML = phase === 'listening' ? STOP_ICON : (phase === 'idle' ? MIC_ICON : BUSY_ICON);
    }

    function attach(id, spec) {
      const bar = Object.assign({ statusTimer: null }, spec);
      bars[id] = bar;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-icon bar-voice-btn hidden';
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggle(id); });
      if (bar.row) bar.row.insertBefore(btn, bar.send || null);
      bar.btn = btn;
      const status = doc.createElement('div');
      status.className = 'bar-voice-status hidden';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      if (bar.row && bar.row.parentNode) bar.row.parentNode.insertBefore(status, bar.row.nextSibling);
      bar.status = status;
      // While it listens, Enter does not send: what was said is not in the box yet. It stops the recording instead (the text then
      // comes, and the next Enter sends it). While it writes, Enter waits.
      if (bar.input) {
        bar.input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !active || active.id !== id) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          if (active.phase === 'listening') stop(id);
        }, true);
      }
      if (bar.send) {
        bar.send.addEventListener('click', (e) => {
          if (!active || active.id !== id) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          if (active.phase === 'listening') stop(id);
        }, true);
      }
      paint(id);
    }

    // ---- the recording ------------------------------------------------------------------------------------------------

    // The operation-rhythm log is told only that the microphone went on and off (js/telemetry.js): never the audio, never what was said.
    function logVoice(on) {
      
    }

    function releaseMic(a) {
      if (!a) return;
      if (a.stream) logVoice(false);
      if (a.interval) { clearI(a.interval); a.interval = null; }
      if (a.timer) { clearT(a.timer); a.timer = null; }
      try { if (a.audioCtx && typeof a.audioCtx.close === 'function') a.audioCtx.close(); } catch (e) { /* ignore */ }
      a.audioCtx = null;
      try { if (a.stream) a.stream.getTracks().forEach((tr) => tr.stop()); } catch (e) { /* ignore */ }
      a.stream = null;
    }

    function finish(id, text, kind) {
      const bar = bars[id];
      releaseMic(active); // the watchdog and the microphone, if anything is still held
      active = null;
      if (bar) {
        setStatus(bar, text, kind);
        paint(id);
      }
    }

    async function start(id) {
      const bar = bars[id];
      if (!bar) return;
      if (active) return; // the one microphone is taken (a recording of another bar, or this one writing)
      if (deps.VoiceInput && deps.VoiceInput.isRecording && deps.VoiceInput.isRecording()) {
        setStatus(bar, t('barVoiceEditorBusy'), 'error');
        return;
      }
      if (!enabled() || !canRecord() || (bar.available && !bar.available())) return;
      const h = helpers();
      const cfg = h.resolveVoiceConfig(config());
      const a = { id: id, phase: 'starting', cfg: cfg, chunks: [], discard: false, reqId: '' };
      active = a;
      setStatus(bar, t('barVoiceStarting'));
      paint(id);

      let stream;
      try {
        stream = await nav.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        if (active === a) finish(id, t(h.micErrorKey(e)), 'error');
        return;
      }
      if (active !== a || a.discard) { // cancelled while the permission prompt was up
        try { stream.getTracks().forEach((tr) => tr.stop()); } catch (e) { /* ignore */ }
        return;
      }
      a.stream = stream;

      const MR = deps.MediaRecorder || win.MediaRecorder;
      const mimeType = h.chooseMimeType(MR.isTypeSupported ? MR.isTypeSupported.bind(MR) : null, cfg.engine === 'whisper-local');
      let recorder;
      try {
        recorder = mimeType ? new MR(stream, { mimeType: mimeType }) : new MR(stream);
      } catch (e) {
        releaseMic(a);
        finish(id, t('voiceMicDenied'), 'error');
        return;
      }
      a.recorder = recorder;
      a.mime = recorder.mimeType || mimeType || 'audio/webm';
      recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) a.chunks.push(ev.data); };
      recorder.onstop = () => onRecorderStop(a);
      recorder.start();

      // the pause detector
      const Ctx = deps.AudioContext || win.AudioContext || win.webkitAudioContext;
      const silenceSec = Number(config().voice && config().voice.barSilenceSec);
      a.listen = createListenState({ silenceSec: silenceSec > 0 ? silenceSec : SILENCE_SEC, rmsThreshold: h.RMS_THRESHOLD });
      if (Ctx) {
        try {
          a.audioCtx = new Ctx();
          const source = a.audioCtx.createMediaStreamSource(stream);
          const analyser = a.audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const buf = new Float32Array(analyser.fftSize);
          a.interval = setI(() => {
            try {
              analyser.getFloatTimeDomainData(buf);
              let sum = 0;
              for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
              const why = listenUpdate(a.listen, Math.sqrt(sum / buf.length), now());
              if (why) stop(id, why);
            } catch (e) { /* best effort: the button and Enter still stop it */ }
          }, SAMPLE_MS);
        } catch (e) { /* no pause detection: the button and Enter stop it, and so does the longest recording */ }
      }
      // the longest recording, even where the pause detector could not start
      a.timer = setT(() => { if (active === a && a.phase === 'listening') stop(id, 'max'); }, MAX_SEC * 1000);
      a.phase = 'listening';
      logVoice(true);
      setStatus(bar, t('barVoiceListening'));
      paint(id);
    }

    // why: '' (the button / Enter), 'silence', 'max' send what was recorded; 'nospeech' throws it away (nothing was said).
    function stop(id, why) {
      const a = active;
      if (!a || a.id !== id || a.phase !== 'listening') return;
      a.phase = 'writing';
      a.why = why || '';
      const bar = bars[id];
      if (bar) { setStatus(bar, a.why === 'nospeech' ? '' : t('barVoiceWriting')); paint(id); }
      if (a.interval) { clearI(a.interval); a.interval = null; }
      try {
        if (a.recorder && a.recorder.state !== 'inactive') a.recorder.stop();
        else onRecorderStop(a);
      } catch (e) {
        onRecorderStop(a);
      }
    }

    async function onRecorderStop(a) {
      releaseMic(a); // the microphone is let go the moment the recording stops, however it stopped
      if (active !== a || a.discard) return;
      // Only "nothing was said" (or nothing recorded) throws the recording away. A recording the person stopped themselves is sent
      // even if the detector heard little: a soft voice must not lose its words.
      if (a.why === 'nospeech' || a.chunks.length === 0) {
        finish(a.id, t('barVoiceNoSpeech'), 'error');
        return;
      }
      let b64;
      try {
        const blob = new (deps.Blob || win.Blob)(a.chunks, { type: a.mime });
        b64 = await (deps.blobToBase64 ? deps.blobToBase64(blob) : blobToBase64(blob));
      } catch (e) {
        if (active === a) finish(a.id, t('barVoiceFailed', { error: String((e && e.message) || e) }), 'error');
        return;
      }
      if (active !== a || a.discard) return;
      const h = helpers();
      a.reqId = 'bar_' + a.id + '_' + (++seq);
      // No second stage and nothing kept on disk: the recording is the person's words for this one box.
      const req = Object.assign(JSON.parse(h.requestConfigJSON(a.cfg, null)), { noCache: true });
      a.timer = setT(() => {
        if (active === a && a.phase === 'writing') finish(a.id, t('barVoiceTimeout'), 'error');
      }, h.watchdogMs(a.cfg, null));
      try {
        const r = backend().transcribeAudioAsync(a.reqId, b64, a.mime, JSON.stringify(req));
        if (r && typeof r.catch === 'function') r.catch((e) => { if (active === a) finish(a.id, t('barVoiceFailed', { error: String((e && e.message) || e) }), 'error'); });
      } catch (e) {
        finish(a.id, t('barVoiceFailed', { error: String((e && e.message) || e) }), 'error');
      }
    }

    function blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new win.FileReader();
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.onload = () => {
          const s = String(reader.result || '');
          resolve(s.slice(s.indexOf(',') + 1));
        };
        reader.readAsDataURL(blob);
      });
    }

    function toggle(id) {
      if (!bars[id]) return;
      if (active && active.id === id) {
        if (active.phase === 'listening') stop(id);
        return; // starting / writing: it waits
      }
      start(id);
    }

    // Esc, the bar closing, the mode changing to CLI: everything about this bar's recording is thrown away.
    function cancel(id) {
      const a = active;
      if (!a || (id && a.id !== id)) return false;
      a.discard = true;
      active = null;
      try { if (a.recorder && a.recorder.state !== 'inactive') a.recorder.stop(); } catch (e) { /* ignore */ }
      releaseMic(a);
      const bar = bars[a.id];
      if (bar) { setStatus(bar, ''); paint(a.id); }
      return true;
    }

    function busy(id) { return !!(active && (!id || active.id === id)); }
    function phase(id) { return active && (!id || active.id === id) ? active.phase : 'idle'; }

    // The answer of the backend (window.__onVoiceResult calls this first). true = it was a bar's request (even one that is thrown away).
    function handleResult(reqId, text, err) {
      if (typeof reqId !== 'string' || reqId.indexOf('bar_') !== 0) return false;
      const a = active;
      if (!a || a.reqId !== reqId || a.discard) return true; // cancelled, or an old one: ignored
      if (err) { finish(a.id, t('barVoiceFailed', { error: String(err) }), 'error'); return true; }
      const bar = bars[a.id];
      const said = String(text || '').trim();
      if (!said) { finish(a.id, t('barVoiceNoSpeech'), 'error'); return true; }
      if (a.timer) { clearT(a.timer); a.timer = null; }
      if (bar && bar.input) insertText(bar.input, said);
      finish(a.id, '', '');
      if (bar) {
        setStatus(bar, t('barVoiceDone'));
        bar.statusTimer = setT(() => { bar.statusTimer = null; setStatus(bar, ''); }, DONE_SHOWN_MS);
        if (typeof bar.onText === 'function') bar.onText();
      }
      return true;
    }

    // At the caret, or after what is there with a space between; the caret ends after it. An input event, so that the bar sees typing.
    function insertText(input, said) {
      const v = String(input.value || '');
      let start = typeof input.selectionStart === 'number' ? input.selectionStart : v.length;
      let end = typeof input.selectionEnd === 'number' ? input.selectionEnd : v.length;
      const hasFocus = doc.activeElement === input;
      if (!hasFocus || (start === 0 && end === 0 && v.length > 0)) { start = v.length; end = v.length; } // not being typed in: after the text
      const before = v.slice(0, start);
      const after = v.slice(end);
      const lead = before && !/\s$/.test(before) ? ' ' : '';
      const tail = after && !/^\s/.test(after) ? ' ' : '';
      input.value = before + lead + said + tail + after;
      const caret = (before + lead + said).length;
      try { input.setSelectionRange(caret, caret); } catch (e) { /* ignore */ }
      try { input.dispatchEvent(new win.Event('input', { bubbles: true })); } catch (e) { /* ignore */ }
      try { input.focus(); } catch (e) { /* ignore */ }
    }

    function refresh() { Object.keys(bars).forEach(paint); }

    return { attach: attach, toggle: toggle, cancel: cancel, busy: busy, phase: phase, handleResult: handleResult, refresh: refresh, insertText: insertText };
  }

  const api = { create: create, createListenState: createListenState, listenUpdate: listenUpdate, SILENCE_SEC: SILENCE_SEC, NO_SPEECH_SEC: NO_SPEECH_SEC, MAX_SEC: MAX_SEC };
  global.BarVoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
