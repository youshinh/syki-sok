// The microphone button of the ask / rewrite / command bars (frontend/js/bar_voice.js): the pause detector, and the whole flow with a fake
// microphone, recorder and backend. What it must do: put the text into the box and send nothing, stop by itself after a pause that
// follows speech, throw everything away on Esc (even an answer on its way), let the microphone go however it ends, keep the CLI mode out.
import assert from 'assert';
import fs from 'fs';
import { createRequire } from 'module';

console.log('=== bar voice tests ===');
const require = createRequire(import.meta.url);
require('../frontend/js/voice_profiles.js');
const VI = require('../frontend/js/voice_input.js');
const BV = require('../frontend/js/bar_voice.js');

// ---- the pause detector -----------------------------------------------------------------------------------------------
{
  const run = (frames, o) => {
    const st = BV.createListenState(o);
    let t = 1000;
    for (const [rms, ms] of frames) {
      for (let i = 0; i < ms / 100; i++) {
        const why = BV.listenUpdate(st, rms, t);
        if (why) return { why, at: t - 1000 };
        t += 100;
      }
    }
    return { why: '', at: t - 1000 };
  };
  assert.strictEqual(run([[0.2, 1000], [0, 3000]]).why, 'silence', 'a pause after talking stops it');
  assert.ok(Math.abs(run([[0.2, 1000], [0, 3000]]).at - 2500) <= 200, 'about 1.5 s after the last sound');
  assert.strictEqual(run([[0, 5000], [0.2, 500], [0, 400]]).why, '', 'silence before the first word is not counted as a pause');
  assert.strictEqual(run([[0, 7000]]).why, 'nospeech', 'nothing said for 6 s: it gives up');
  assert.strictEqual(run([[0.2, 100], [0, 7000]]).why, 'nospeech', 'a click is not the first word');
  assert.strictEqual(run([[0.2, 61000]]).why, 'max', 'the longest recording is 60 s');
  assert.strictEqual(run([[0.2, 500], [0, 800], [0.2, 500], [0, 800]]).why, '', 'a short breath between words does not stop it');
  assert.strictEqual(run([[0.2, 500], [0, 2100]], { silenceSec: 2.5 }).why, '', 'the pause is the setting');
  assert.strictEqual(run([[0.2, 500], [0, 2800]], { silenceSec: 2.5 }).why, 'silence');
}

// ---- fakes --------------------------------------------------------------------------------------------------------------
function el(tag) {
  const cls = new Set();
  const listeners = {};
  const e = {
    tag, children: [], parentNode: null, attrs: {}, listeners, value: '', textContent: '', innerHTML: '', title: '', disabled: false, type: '',
    selectionStart: 0, selectionEnd: 0,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
    set className(v) { cls.clear(); String(v).split(' ').filter(Boolean).forEach((c) => cls.add(c)); },
    get className() { return [...cls].join(' '); },
    setAttribute(k, v) { e.attrs[k] = v; },
    addEventListener(type, fn, capture) { (listeners[type] = listeners[type] || []).push({ fn, capture: !!capture }); },
    insertBefore(node, ref) { node.parentNode = e; const i = ref ? e.children.indexOf(ref) : -1; if (i >= 0) e.children.splice(i, 0, node); else e.children.push(node); return node; },
    setSelectionRange(a, b) { e.selectionStart = a; e.selectionEnd = b; },
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach((l) => l.fn(ev)); return true; },
    focus() { fake.doc.activeElement = e; },
  };
  return e;
}
const fake = { doc: null };
function fire(target, type, ev) {
  const e = Object.assign({ type, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; } }, ev);
  for (const l of (target.listeners[type] || []).filter((x) => x.capture).concat((target.listeners[type] || []).filter((x) => !x.capture))) {
    if (e.stopped) break;
    l.fn(e);
  }
  return e;
}

function setup(opts) {
  const o = Object.assign({ engine: 'gemini', systemAudio: false, editorRecording: false, mic: 'ok', barSilenceSec: 1.5 }, opts || {});
  const doc = { activeElement: null, createElement: el };
  fake.doc = doc;
  const state = { tracksStopped: 0, mics: 0, recorders: [], transcribeCalls: [], timers: [], intervals: [], rms: 0, ctxClosed: 0, now: 1000 };
  const input = el('input');
  const row = el('div');
  const bar = el('div');
  bar.insertBefore(row, null);
  const send = el('button');
  row.insertBefore(send, null);
  class FakeRecorder {
    constructor(stream, o2) { this.stream = stream; this.mimeType = (o2 && o2.mimeType) || ''; this.state = 'inactive'; state.recorders.push(this); }
    static isTypeSupported(t) { return t === 'audio/webm;codecs=opus' || t === 'audio/mp4;codecs=mp4a.40.2'; }
    start() { this.state = 'recording'; setTimeout(() => this.ondataavailable && this.ondataavailable({ data: { size: 4, tag: 'chunk' } }), 0); }
    stop() { this.state = 'inactive'; setTimeout(() => this.onstop && this.onstop(), 1); }
  }
  class FakeAudioContext {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, getFloatTimeDomainData(buf) { buf.fill(state.rms); } }; }
    close() { state.ctxClosed++; }
  }
  const stream = { getTracks: () => [{ stop() { state.tracksStopped++; } }] };
  const nav = {
    mediaDevices: {
      getUserMedia: () => {
        state.mics++;
        if (o.mic === 'denied') return Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
        if (o.mic === 'pending') return new Promise((res) => { state.grant = () => res(stream); });
        return Promise.resolve(stream);
      },
    },
  };
  const backend = {
    transcribeAudioAsync: (reqId, b64, mime, cfgJSON) => { state.transcribeCalls.push({ reqId, b64, mime, cfg: JSON.parse(cfgJSON) }); return Promise.resolve(); },
  };
  const config = {
    general: { barVoice: true },
    voice: { barSilenceSec: o.barSilenceSec, includeSystemAudio: o.systemAudio, realtime: { engine: o.engine, model: 'rt-model' }, refine: { enabled: true } },
  };
  const available = { cmd: true };
  const bv = BV.create({
    document: doc, window: { navigator: nav, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, FileReader: null, Event: class { constructor(type) { this.type = type; } } },
    navigator: nav, VoiceInput: { isRecording: () => o.editorRecording, helpers: {
      resolveVoiceConfig: VI.resolveVoiceConfig, requestConfigJSON: VI.requestConfigJSON, chooseMimeType: VI.chooseMimeType,
      micErrorKey: VI.micErrorKey, watchdogMs: VI.watchdogMs, RMS_THRESHOLD: VI.RMS_THRESHOLD } },
    getConfig: () => config, getBackend: () => backend, t: (k, p) => k + (p ? JSON.stringify(p) : ''),
    MediaRecorder: FakeRecorder, AudioContext: FakeAudioContext, Blob: class { constructor(parts, opt) { this.parts = parts; this.type = opt.type; } },
    blobToBase64: async (blob) => 'B64:' + blob.type + ':' + blob.parts.length,
    setTimeout, clearTimeout,
    setInterval: (fn) => { state.intervals.push(fn); return state.intervals.length; },
    clearInterval: (id) => { state.intervals[id - 1] = null; },
    now: () => state.now,
  });
  let typed = 0;
  bv.attach('ask', { input, row, send, onText: () => { typed++; } });
  bv.attach('cmd', { input: el('input'), row, send, available: () => available.cmd });
  const tick = (rms, ms) => { // let `ms` of the given loudness pass: the sampler runs every 100 ms
    state.rms = rms;
    for (let i = 0; i < ms / 100; i++) {
      state.now += 100;
      state.intervals.forEach((fn) => fn && fn());
    }
  };
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 15));
  return { bv, state, input, row, send, doc, config, tick, settle, typed: () => typed, available, backend, o };
}

const btnOf = (s) => s.row.children.find((c) => c.className.includes('bar-voice-btn'));
const statusOf = (s) => s.row.parentNode.children.filter((c) => c.className.includes('bar-voice-status'))[0];

// ---- the whole flow ---------------------------------------------------------------------------------------------------
{
  const s = setup();
  assert.ok(btnOf(s), 'the microphone button is put in the bar, before Run');
  assert.ok(s.row.children.indexOf(btnOf(s)) < s.row.children.indexOf(s.send), 'before the Run button');
  assert.ok(!btnOf(s).classList.contains('hidden'), 'and it shows');

  s.bv.toggle('ask');
  await s.settle();
  assert.strictEqual(s.bv.phase('ask'), 'listening');
  assert.ok(btnOf(s).classList.contains('is-recording'), 'the button turns into the stop button');
  assert.strictEqual(btnOf(s).attrs['aria-pressed'], 'true');
  assert.strictEqual(s.state.recorders[0].mimeType, 'audio/webm;codecs=opus', 'the cloud: webm, as before');

  s.tick(0.2, 1200); // talking
  assert.strictEqual(s.bv.phase('ask'), 'listening', 'still talking');
  s.tick(0, 2000); // a pause
  await s.settle(30);
  assert.strictEqual(s.state.tracksStopped, 1, 'the microphone is let go as soon as it stops');
  assert.strictEqual(s.state.ctxClosed, 1, 'and the analyser');
  assert.strictEqual(s.state.transcribeCalls.length, 1, 'it was sent for transcription once');
  const call = s.state.transcribeCalls[0];
  assert.ok(call.reqId.startsWith('bar_ask_'), 'a request of a bar');
  assert.strictEqual(call.mime, 'audio/webm;codecs=opus');
  assert.strictEqual(call.cfg.noCache, true, 'nothing is kept on disk');
  assert.ok(!call.cfg.refine, 'no second stage');
  assert.strictEqual(call.cfg.engine, 'gemini');
  assert.strictEqual(call.cfg.model, 'rt-model', 'the realtime profile');
  assert.strictEqual(s.bv.phase('ask'), 'writing');

  s.input.value = '';
  assert.strictEqual(s.bv.handleResult(call.reqId, 'こんにちは', ''), true);
  assert.strictEqual(s.input.value, 'こんにちは', 'the text is in the box');
  assert.strictEqual(s.bv.phase('ask'), 'idle');
  assert.ok(s.typed() === 1, 'the bar counts it as typed (it does not fade away)');
  assert.strictEqual(s.state.transcribeCalls.length, 1, 'and nothing was sent anywhere: sending is Enter');
  assert.strictEqual(btnOf(s).attrs['aria-pressed'], 'false');
  assert.ok(statusOf(s).textContent.startsWith('barVoiceDone'), 'it says it is in the box');
}

// text already in the box: after it, with a space
{
  const s = setup();
  s.input.value = '次の文章を';
  s.bv.insertText(s.input, '英語にして');
  assert.strictEqual(s.input.value, '次の文章を 英語にして');
  assert.strictEqual(s.input.selectionStart, s.input.value.length, 'the caret ends after it');
  s.input.value = 'translate ';
  s.bv.insertText(s.input, 'this');
  assert.strictEqual(s.input.value, 'translate this', 'no second space');
}

// the button stops it, and Enter while it listens stops it instead of sending
{
  const s = setup();
  s.bv.toggle('ask');
  await s.settle();
  s.tick(0.2, 500);
  const enter = fire(s.input, 'keydown', { key: 'Enter' });
  assert.ok(enter.defaultPrevented && enter.stopped, 'Enter does not reach the bar\'s own handler (nothing is sent)');
  await s.settle(30);
  assert.strictEqual(s.bv.phase('ask'), 'writing', 'Enter stopped the recording');
  const enter2 = fire(s.input, 'keydown', { key: 'Enter' });
  assert.ok(enter2.stopped, 'while it writes, Enter waits too');
  const click = fire(s.send, 'click', {});
  assert.ok(click.stopped, 'and so does Run');
  s.bv.cancel('ask');
  const enter3 = fire(s.input, 'keydown', { key: 'Enter' });
  assert.ok(!enter3.stopped, 'with nothing recording, Enter is the bar\'s again');
}

// Esc: a recording is thrown away; so is an answer on its way
{
  const s = setup();
  s.bv.toggle('ask');
  await s.settle();
  s.tick(0.2, 500);
  assert.strictEqual(s.bv.cancel('ask'), true);
  await s.settle(30);
  assert.strictEqual(s.state.tracksStopped, 1, 'the microphone is let go');
  assert.strictEqual(s.state.transcribeCalls.length, 0, 'nothing was sent');
  assert.strictEqual(s.bv.phase('ask'), 'idle');
  assert.strictEqual(s.bv.busy(), false);

  const s2 = setup();
  s2.bv.toggle('ask');
  await s2.settle();
  s2.tick(0.2, 1200);
  s2.tick(0, 2000);
  await s2.settle(30);
  const id = s2.state.transcribeCalls[0].reqId;
  s2.input.value = 'typed meanwhile';
  s2.bv.cancel('ask');
  assert.strictEqual(s2.bv.handleResult(id, 'late words', ''), true, 'the late answer is recognised as a bar\'s...');
  assert.strictEqual(s2.input.value, 'typed meanwhile', '...and thrown away');
  assert.strictEqual(s2.bv.handleResult('voice_xyz', 'x', ''), false, 'an answer of the note\'s dictation is not a bar\'s');
}

// an old answer arriving while a NEW recording is on: it is not the new one's, and does not end it
{
  const s = setup();
  s.bv.toggle('ask');
  await s.settle();
  s.tick(0.2, 1200);
  s.tick(0, 2000);
  await s.settle(30);
  const oldId = s.state.transcribeCalls[0].reqId;
  s.bv.cancel('ask'); // Esc, then the bar is opened again and the microphone pressed
  s.bv.toggle('ask');
  await s.settle();
  assert.strictEqual(s.bv.phase('ask'), 'listening');
  s.input.value = '';
  assert.strictEqual(s.bv.handleResult(oldId, 'words of the first one', ''), true);
  assert.strictEqual(s.input.value, '', 'the old answer is not put in the box');
  assert.strictEqual(s.bv.phase('ask'), 'listening', 'and the new recording goes on');
  s.bv.cancel('ask');
}

// nothing said: no request, a plain note
{
  const s = setup();
  s.bv.toggle('ask');
  await s.settle();
  s.tick(0, 7000);
  await s.settle(30);
  assert.strictEqual(s.state.transcribeCalls.length, 0, 'nothing is sent when nothing was said');
  assert.strictEqual(s.state.tracksStopped, 1);
  assert.ok(statusOf(s).textContent.startsWith('barVoiceNoSpeech'));
  assert.strictEqual(s.bv.phase('ask'), 'idle');
}

// a failure: the box is as it was, and the reason is in the bar
{
  const s = setup();
  s.input.value = 'keep me';
  s.bv.toggle('ask');
  await s.settle();
  s.tick(0.2, 500);
  s.bv.toggle('ask'); // the stop button
  await s.settle(30);
  const id = s.state.transcribeCalls[0].reqId;
  s.bv.handleResult(id, '', 'network down');
  assert.strictEqual(s.input.value, 'keep me');
  assert.ok(statusOf(s).textContent.includes('network down') && statusOf(s).classList.contains('is-error'));
  assert.strictEqual(s.bv.phase('ask'), 'idle');
  s.bv.toggle('ask'); // and it can be tried again
  await s.settle();
  assert.strictEqual(s.bv.phase('ask'), 'listening');
  s.bv.cancel('ask');
}

// the microphone itself
{
  const denied = setup({ mic: 'denied' });
  denied.bv.toggle('ask');
  await denied.settle();
  assert.strictEqual(denied.bv.phase('ask'), 'idle');
  assert.ok(statusOf(denied).textContent.startsWith('voiceMicBlocked'), 'a refused microphone says so in the bar');
  assert.strictEqual(denied.bv.busy(), false);

  const pending = setup({ mic: 'pending' });
  pending.bv.toggle('ask');
  await pending.settle();
  assert.strictEqual(pending.bv.phase('ask'), 'starting');
  pending.bv.cancel('ask'); // Esc while the permission prompt is up
  pending.state.grant();
  await pending.settle();
  assert.strictEqual(pending.state.tracksStopped, 1, 'a microphone granted after Esc is let go at once');
  assert.strictEqual(pending.state.recorders.length, 0, 'and nothing is recorded');
}

// the one microphone: the note's dictation and another bar
{
  const s = setup({ editorRecording: true });
  s.bv.toggle('ask');
  await s.settle();
  assert.strictEqual(s.state.mics, 0, 'the microphone is not asked for while the note\'s dictation has it');
  assert.ok(statusOf(s).textContent.startsWith('barVoiceEditorBusy'));
  const t = setup();
  t.bv.toggle('ask');
  await t.settle();
  t.bv.toggle('cmd');
  await t.settle();
  assert.strictEqual(t.state.mics, 1, 'a second bar cannot take it');
  assert.strictEqual(t.bv.busy('cmd'), false);
  assert.strictEqual(t.bv.busy('ask'), true);
  t.bv.cancel();
}

// the CLI mode (a command needs exact input) has no button, and a recording is thrown away when the mode changes
{
  const s = setup();
  const cmdBtn = s.row.children.filter((c) => c.className.includes('bar-voice-btn'))[1];
  s.available.cmd = false;
  s.bv.refresh();
  assert.ok(cmdBtn.classList.contains('hidden'), 'no microphone in the CLI mode');
  s.bv.toggle('cmd');
  await s.settle();
  assert.strictEqual(s.state.mics, 0, 'and nothing starts there');
  s.available.cmd = true;
  s.bv.refresh();
  assert.ok(!cmdBtn.classList.contains('hidden'), 'it is there in the AI mode');
}

// the on-device engine: MP4, and the request says so; the PC\'s sound setting changes nothing; the setting can turn the button off
{
  const s = setup({ engine: 'whisper-local', systemAudio: true });
  s.bv.toggle('ask');
  await s.settle();
  assert.strictEqual(s.state.recorders[0].mimeType, 'audio/mp4;codecs=mp4a.40.2', 'Windows decodes MP4 itself');
  s.tick(0.2, 500);
  s.bv.toggle('ask');
  await s.settle(30);
  assert.strictEqual(s.state.transcribeCalls[0].cfg.engine, 'whisper-local');
  assert.strictEqual(s.state.transcribeCalls[0].mime, 'audio/mp4;codecs=mp4a.40.2');
  assert.strictEqual(s.state.mics, 1, 'always the microphone alone (the meeting path is never taken)');
  s.bv.cancel();

  const off = setup();
  off.config.general.barVoice = false;
  off.bv.refresh();
  assert.ok(btnOf(off).classList.contains('hidden'), 'the setting turns the button off');
  off.bv.toggle('ask');
  await off.settle();
  assert.strictEqual(off.state.mics, 0);
}

// the pause is the setting
{
  const s = setup({ barSilenceSec: 3 });
  s.bv.toggle('ask');
  await s.settle();
  s.tick(0.2, 500);
  s.tick(0, 2500);
  assert.strictEqual(s.bv.phase('ask'), 'listening', 'a 3 s setting is not over after 2.5 s of pause');
  s.tick(0, 1000);
  await s.settle(30);
  assert.strictEqual(s.bv.phase('ask'), 'writing');
  s.bv.cancel();
}

// ---- the wiring in the page --------------------------------------------------------------------------------------------
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
const voiceSrc = fs.readFileSync(new URL('../frontend/js/voice_input.js', import.meta.url), 'utf8');
assert.ok(/js\/bar_voice\.js/.test(html) && html.indexOf('js/bar_voice.js') > html.indexOf('js/voice_input.js') && html.indexOf('js/bar_voice.js') < html.indexOf('js/app.js'), 'loaded after voice_input.js and before app.js');
assert.ok(/barVoice\.attach\('ask'/.test(app) && /barVoice\.attach\('cmd'/.test(app), 'both bars get the button');
assert.ok(/available: \(\) => isAiCliMode/.test(app), 'the command bar only in its AI mode');
assert.ok(/window\.__barVoiceHandle = /.test(app) && /global\.__barVoiceHandle\(reqId, text, err\)\) return;/.test(voiceSrc), 'the answers of a bar go to the bar');
assert.ok(/global\.__barVoiceBusy\(\)/.test(voiceSrc), 'the note\'s dictation checks for the bar\'s recording');
assert.ok(/if \(barVoice\) barVoice\.cancel\('ask'\)/.test(app) && /if \(barVoice\) barVoice\.cancel\('cmd'\)/.test(app), 'closing a bar throws the recording away');
assert.ok(/if \(!isAiCliMode\) barVoice\.cancel\('cmd'\)/.test(app), 'and so does switching to the CLI mode');
assert.ok(/barVoice\.toggle\(barId\)/.test(app), 'the voice shortcut works the bar\'s microphone when a bar is open');
assert.ok(/config\.general\.barVoice = !!saveBarVoiceEl\.checked/.test(app) && /config\.voice\.barSilenceSec = clampNumber\(saveBarSilenceEl\.value, 1, 5, 1\.5\)/.test(app), 'the settings are saved');
const i18n = fs.readFileSync(new URL('../frontend/js/i18n.js', import.meta.url), 'utf8');
for (const key of ['voiceBarBusy', 'barVoiceStart', 'barVoiceStop', 'barVoiceStarting', 'barVoiceListening', 'barVoiceWriting', 'barVoiceDone', 'barVoiceNoSpeech', 'barVoiceFailed', 'barVoiceTimeout', 'barVoiceEditorBusy', 'barVoiceLabel', 'barVoiceHint', 'barVoiceSilenceLabel']) {
  assert.strictEqual((i18n.match(new RegExp('\n    ' + key + ': ', 'g')) || []).length, 2, key + ' is in both languages');
}
console.log('bar voice tests passed');
