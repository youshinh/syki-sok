// Real-browser (Headless Edge via CDP) scale & soak verification suite for syki::sok.
// Never touches real config, notes, clipboard, or syki.exe (uses tools/explore/kit.mjs).
//
//   node tools/stress/run_stress.mjs
//   node tools/stress/run_stress.mjs --profiles p1,p2,p3,p4,p5 --soak-sec 20
//   node tools/stress/run_stress.mjs --profiles p4 --soak-sec 120 --out stress-report.json
import fs from 'node:fs';
import path from 'node:path';
import { startExplore, sleep } from '../explore/kit.mjs';
import { generateNote } from '../perf/gen_note.mjs';

const argv = process.argv.slice(2);
function option(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}

const PROFILES = new Set(
  option('--profiles', 'p1,p2,p3,p4,p5')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
const SOAK_SEC = Math.max(5, Number(option('--soak-sec', '15')) || 15);
const OUT_FILE = option('--out', '');

const mb = (bytes) => Number((bytes / (1024 * 1024)).toFixed(2));
const round1 = (n) => Number(Number(n).toFixed(1));
function p95(arr) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

const HEARTBEAT_INSTALL = `(function () {
  if (window.__stressHb) return;
  var hb = { max: 0, last: performance.now() };
  window.__stressHb = hb;
  window.__stressHbId = setInterval(function () {
    var now = performance.now();
    var gap = now - hb.last;
    if (gap > hb.max) hb.max = gap;
    hb.last = now;
  }, 10);
})()`;
const HEARTBEAT_RESET = 'window.__stressHb.max = 0; window.__stressHb.last = performance.now(); 1';
const HEARTBEAT_READ = 'Math.round(window.__stressHb.max)';

const log = (...a) => console.error('[stress]', ...a);

function withTimeout(promise, ms, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function samplePerf(s, { gc = true } = {}) {
  const cdp = s.page.cdp;
  if (gc) {
    try {
      await withTimeout(cdp.send('HeapProfiler.collectGarbage'), 10000, 'HeapProfiler.collectGarbage');
    } catch (e) {
      log(`WARN: ${e.message}`);
    }
  }
  const [{ metrics }, heap] = await withTimeout(
    Promise.all([cdp.send('Performance.getMetrics'), cdp.send('Runtime.getHeapUsage')]),
    10000,
    'Performance.getMetrics/getHeapUsage'
  );
  const map = {};
  for (const m of metrics) map[m.name] = m.value;
  return {
    nodes: Math.round(map.Nodes || 0),
    listeners: Math.round(map.JSEventListeners || 0),
    heapMb: mb(heap.usedSize || map.JSHeapUsedSize || 0),
    taskMs: round1((map.TaskDuration || 0) * 1000),
    layoutMs: round1((map.LayoutDuration || 0) * 1000),
    scriptMs: round1((map.ScriptDuration || 0) * 1000)
  };
}

async function waitTwoFrames(s) {
  await withTimeout(
    s.ev(`new Promise(function (r) {
      var done = false;
      var finish = function () { if (!done) { done = true; r(1); } };
      requestAnimationFrame(function () { requestAnimationFrame(finish); });
      setTimeout(finish, 80);
    })`),
    5000,
    'waitTwoFrames'
  );
}

async function measureTyping(s, count = 20) {
  await s.ev(`(function () {
    var ed = document.getElementById('editor');
    ed.focus();
    var mid = Math.floor(ed.value.length / 2);
    ed.setSelectionRange(mid, mid);
    return mid;
  })()`);
  const latencies = [];
  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    await s.key('x');
    await withTimeout(
      s.ev(`new Promise(function (r) {
        var done = false;
        var finish = function () { if (!done) { done = true; r(1); } };
        requestAnimationFrame(function () { setTimeout(finish, 0); });
        setTimeout(finish, 80);
      })`),
      5000,
      'measureTyping frame'
    );
    latencies.push(performance.now() - t0);
  }
  return {
    p95Ms: round1(p95(latencies)),
    maxMs: round1(Math.max(...latencies))
  };
}

async function lightState(s) {
  return withTimeout(
    s.ev(`(function () {
      var rpc = window.__sykiRPC;
      var rows = [];
      try { rows = rpc ? rpc.getTabs() : []; } catch (e) { rows = []; }
      var ind = document.getElementById('stat-llm-indicator');
      var pending = 0;
      if (ind && !ind.classList.contains('hidden')) {
        var txt = document.getElementById('stat-llm-text');
        var m = /(\\d+)/.exec(txt ? txt.textContent : '');
        pending = m ? parseInt(m[1], 10) : 1;
      }
      var open = function (id) {
        var e = document.getElementById(id);
        return !!e && !e.classList.contains('hidden');
      };
      return {
        tabCount: rows.length,
        pendingLlm: pending,
        panels: {
          ask: open('inline-prompt-bar'),
          search: open('find-replace-bar') || open('scraps-search-modal'),
          palette: open('quick-pick-modal'),
          settings: open('settings-modal')
        }
      };
    })()`),
    10000,
    'lightState'
  );
}

async function withSession(label, timeoutMs, fn) {
  log(`starting ${label} (timeout=${timeoutMs}ms)...`);
  const tStart = performance.now();
  const s = await withTimeout(
    startExplore({ lang: 'en', config: { general: { autoSave: false }, autocomplete: { enabled: false } } }),
    35000,
    `${label}: startExplore`
  );
  const cdpErrors = [];
  const cdp = s.page.cdp;
  const listen = (method, cb) => cdp.listeners.set(method, [...(cdp.listeners.get(method) || []), cb]);
  const isNoise = (text) => /favicon/i.test(text);
  listen('Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error') return;
    const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type))).join(' ');
    if (!isNoise(text)) cdpErrors.push(text);
  });
  listen('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    cdpErrors.push('Uncaught: ' + ((d.exception && d.exception.description) || d.text || 'exception'));
  });
  listen('Log.entryAdded', (p) => {
    const e = p.entry || {};
    const text = `${e.source || 'log'}: ${e.text || ''}`;
    if (e.level === 'error' && !isNoise(text)) cdpErrors.push(text);
  });

  let closeInfo = null;
  try {
    await withTimeout(cdp.send('Performance.enable'), 10000, `${label}: Performance.enable`);
    await withTimeout(s.ev(HEARTBEAT_INSTALL), 10000, `${label}: installHeartbeat`);
    const res = await withTimeout(fn(s, cdpErrors), timeoutMs, label);
    log(`finished ${label} in ${round1(performance.now() - tStart)}ms -> ${res.status}`);
    return res;
  } finally {
    try {
      closeInfo = await withTimeout(s.close(), 15000, `${label}: close`);
    } catch (e) {
      log(`WARN: ${label} close failed: ${e.message}`);
    }
    if (closeInfo && !closeInfo.processGone) {
      log(`WARN: ${label} Edge process did not exit cleanly`);
    }
  }
}

// ---------------------------------------------------------------------------
// P1: Many Tabs (40 tabs, 40 rapid switches, search modal & find bar)
// ---------------------------------------------------------------------------
async function runP1() {
  return withSession('P1 (many-tabs: 40)', 60000, async (s, cdpErrors) => {
    log('P1: creating 40 tabs...');
    await s.ev(HEARTBEAT_RESET);
    const tOpen0 = performance.now();
    const ids = await s.ev(`(function () {
      var out = [];
      for (var i = 0; i < 40; i++) {
        var r = window.__sykiRPC.openTab({
          title: 'tab-' + i + '.md',
          content: '# Note ' + i + '\\nLine 1 for tab ' + i + '\\nLine 2 steady content\\n',
          background: true
        });
        out.push(r.id);
      }
      return out;
    })()`);
    await waitTwoFrames(s);
    const open40Ms = round1(performance.now() - tOpen0);
    log(`P1: 40 tabs opened in ${open40Ms}ms, switching 40 times...`);

    const switchTimes = [];
    for (let i = 0; i < 40; i++) {
      const id = ids[i % ids.length];
      const t0 = performance.now();
      await s.ev(`window.__sykiRPC.switchTab(${JSON.stringify(id)})`);
      await waitTwoFrames(s);
      switchTimes.push(performance.now() - t0);
    }

    log('P1: testing search modal and find bar...');

    // Open & close scraps_search modal via RPC with query option and find bar
    await s.ev(`window.__sykiRPC.openPanel('scraps_search', { query: 'bamboo' })`);
    await waitTwoFrames(s);
    await sleep(250);
    await s.key('Escape');
    await s.key('f', { ctrl: true });
    await waitTwoFrames(s);
    await s.key('Escape');

    const maxFreezeMs = await s.ev(HEARTBEAT_READ);
    const perf = await samplePerf(s);
    const st = await lightState(s);
    const ok = cdpErrors.length === 0 && st.tabCount >= 40;

    return {
      profile: 'P1 (many-tabs: 40)',
      status: ok ? 'PASS' : 'FAIL',
      openMs: open40Ms,
      switchP95Ms: round1(p95(switchTimes)),
      switchMaxMs: round1(Math.max(...switchTimes)),
      typingP95Ms: '-',
      previewMs: '-',
      maxFreezeMs,
      heapGcMb: perf.heapMb,
      nodes: perf.nodes,
      listeners: perf.listeners,
      errors: cdpErrors.length,
      detail: `tabs=${st.tabCount}`
    };
  });
}

// ---------------------------------------------------------------------------
// P2: Pathological Notes (80k-line realistic note & 300k-char single-line note)
// ---------------------------------------------------------------------------
async function runP2Case(label, title, text, findQuery) {
  return withSession(label, 90000, async (s, cdpErrors) => {
    log(`${label}: loading payload (${text.length} chars)...`);
    await s.ev(`window.__bigPayload = ${JSON.stringify(text)}; 1`);
    await s.ev(HEARTBEAT_RESET);

    const t0 = performance.now();
    await s.ev(`window.__sykiRPC.openTab({ title: ${JSON.stringify(title)}, content: window.__bigPayload, background: false })`);
    await waitTwoFrames(s);
    const openMs = round1(performance.now() - t0);
    log(`${label}: opened in ${openMs}ms, measuring typing (20 keys)...`);

    const typing = await measureTyping(s, 20);
    log(`${label}: typing p95=${typing.p95Ms}ms, testing Find + Side Preview + Undo...`);

    // Find bar open + search query
    await s.key('f', { ctrl: true });
    await waitTwoFrames(s);
    await s.type(findQuery, { insert: true });
    await s.key('Enter');
    await waitTwoFrames(s);
    await s.key('Escape');

    // Side preview switch & back
    const tPrev0 = performance.now();
    await s.ev(`window.__sykiRPC.setUiState({ preview: 'side' })`);
    await waitTwoFrames(s);
    const previewMs = round1(performance.now() - tPrev0);
    await s.ev(`window.__sykiRPC.setUiState({ preview: 'off' })`);
    await waitTwoFrames(s);

    // Undo one edit
    await s.ev("document.getElementById('editor').focus()");
    await s.key('z', { ctrl: true });
    await waitTwoFrames(s);

    await s.ev('delete window.__bigPayload; 1');
    const maxFreezeMs = await s.ev(HEARTBEAT_READ);
    const perf = await samplePerf(s);
    const ok = cdpErrors.length === 0;

    return {
      profile: label,
      status: ok ? 'PASS' : 'FAIL',
      openMs,
      switchP95Ms: '-',
      switchMaxMs: '-',
      typingP95Ms: typing.p95Ms,
      previewMs,
      maxFreezeMs,
      heapGcMb: perf.heapMb,
      nodes: perf.nodes,
      listeners: perf.listeners,
      errors: cdpErrors.length,
      detail: `chars=${text.length}`
    };
  });
}

// ---------------------------------------------------------------------------
// P3: Heavy Session (20 tabs x 100KB = ~2MB, interleaved edits + session saves)
// ---------------------------------------------------------------------------
async function runP3() {
  return withSession('P3 (heavy-session: 20x100KB)', 60000, async (s, cdpErrors) => {
    log('P3: opening 20 x 100KB tabs...');
    const block100k = '# Heavy Tab\n' + '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n'.repeat(1540);
    await s.ev(`window.__heavyBlock = ${JSON.stringify(block100k)}; 1`);
    const ids = await s.ev(`(function () {
      var out = [];
      for (var i = 0; i < 20; i++) {
        var r = window.__sykiRPC.openTab({
          title: 'heavy-' + i + '.md',
          content: '# Heavy ' + i + '\\n' + window.__heavyBlock,
          background: i !== 0
        });
        out.push(r.id);
      }
      return out;
    })()`);
    await s.ev('delete window.__heavyBlock; 1');
    await waitTwoFrames(s);
    await s.ev(HEARTBEAT_RESET);
    log('P3: running 20 interleaved switch/edit/session-save rounds...');

    const switchTimes = [];
    for (let round = 0; round < 20; round++) {
      const id = ids[round % ids.length];
      const t0 = performance.now();
      await s.ev(`window.__sykiRPC.switchTab(${JSON.stringify(id)})`);
      await waitTwoFrames(s);
      switchTimes.push(performance.now() - t0);

      await s.ev("document.getElementById('editor').focus()");
      await s.key('a');
      if (round % 5 === 4) {
        await sleep(550); // allow 500ms sessionSaveDebounced timer to flush
      }
    }
    await sleep(600);

    const maxFreezeMs = await s.ev(HEARTBEAT_READ);
    const perf = await samplePerf(s);
    const st = await lightState(s);
    const ok = cdpErrors.length === 0 && st.tabCount >= 20;

    return {
      profile: 'P3 (heavy-session: 20x100KB)',
      status: ok ? 'PASS' : 'FAIL',
      openMs: '-',
      switchP95Ms: round1(p95(switchTimes)),
      switchMaxMs: round1(Math.max(...switchTimes)),
      typingP95Ms: '-',
      previewMs: '-',
      maxFreezeMs,
      heapGcMb: perf.heapMb,
      nodes: perf.nodes,
      listeners: perf.listeners,
      errors: cdpErrors.length,
      detail: `tabs=${st.tabCount}`
    };
  });
}

// ---------------------------------------------------------------------------
// P4: Concurrent Mixed Soak (tab switch, type, RPC append, AI ask, undo, preview, find)
// ---------------------------------------------------------------------------
async function runP4(soakSec) {
  return withSession(`P4 (soak ${soakSec}s)`, (soakSec + 30) * 1000, async (s, cdpErrors) => {
    log(`P4: opening 6 tabs (incl. 1200-line note) and running 3s warmup...`);
    const mediumNote = generateNote({ lines: 1200, seed: 20261119 });
    await s.ev(`window.__med = ${JSON.stringify(mediumNote)}; 1`);
    const ids = await s.ev(`(function () {
      var out = [];
      for (var i = 0; i < 6; i++) {
        var r = window.__sykiRPC.openTab({
          title: 'soak-' + i + '.md',
          content: '# Soak Tab ' + i + '\\nTarget line for AI ask\\n' + (i === 0 ? window.__med : 'steady note body\\n'.repeat(40)),
          background: i !== 0
        });
        out.push(r.id);
      }
      return out;
    })()`);
    await s.ev('delete window.__med; 1');

    async function doSoakStep(step) {
      // Ensure clean UI state before each operation
      const st0 = await lightState(s);
      if (st0.panels.ask || st0.panels.search || st0.panels.palette || st0.panels.settings) {
        await s.key('Escape');
      }
      const id = ids[step % ids.length];
      switch (step % 7) {
        case 0:
          await s.ev(`window.__sykiRPC.switchTab(${JSON.stringify(id)})`);
          break;
        case 1:
          await s.ev("document.getElementById('editor').focus()");
          await s.key('x');
          break;
        case 2:
          await s.ev(`window.__sykiRPC.appendBuffer('\\n[RPC_' + ${step} + ']', ${JSON.stringify(id)})`);
          break;
        case 3: {
          // AI ask alternating ok / fail
          const mode = step % 2 === 0 ? 'ok' : 'fail';
          await s.setLlm({ mode, delayMs: 80 });
          await s.ev(`(function () {
            var ed = document.getElementById('editor');
            ed.focus();
            var idx = ed.value.indexOf('Target line');
            if (idx >= 0) ed.setSelectionRange(idx, idx + 11);
          })()`);
          await s.key('l', { ctrl: true });
          await sleep(40);
          const askOpen = (await lightState(s)).panels.ask;
          if (askOpen) {
            await s.type(`soak ${step}`, { insert: true });
            await s.key('Enter');
          }
          break;
        }
        case 4:
          await s.ev("document.getElementById('editor').focus()");
          await s.key('z', { ctrl: true });
          break;
        case 5:
          await s.ev(`window.__sykiRPC.setUiState({ preview: ${step % 2 === 0 ? "'side'" : "'off'"} })`);
          break;
        case 6:
          await s.key('f', { ctrl: true });
          await sleep(30);
          await s.key('Escape');
          break;
      }
    }

    // 3s warmup before baseline sample
    const warmEnd = Date.now() + 3000;
    let step = 0;
    while (Date.now() < warmEnd) {
      await doSoakStep(step++);
      await sleep(80);
    }
    await s.waitFor('window.__explore.state().pendingLlm === 0', { timeout: 10000 });
    await s.ev(`window.__sykiRPC.setUiState({ preview: 'off' })`);
    await s.ev(HEARTBEAT_RESET);
    const baseline = await samplePerf(s, { gc: true });
    log(`P4: baseline heap=${baseline.heapMb}MB nodes=${baseline.nodes} listeners=${baseline.listeners}, running ${soakSec}s soak...`);

    const samples = [baseline];
    const soakEnd = Date.now() + soakSec * 1000;
    let nextSampleAt = Date.now() + 5000;
    while (Date.now() < soakEnd) {
      await doSoakStep(step++);
      if (Date.now() >= nextSampleAt) {
        const sp = await samplePerf(s, { gc: true });
        samples.push(sp);
        log(`P4: sample@${samples.length - 1} ops=${step} heap=${sp.heapMb}MB nodes=${sp.nodes} listeners=${sp.listeners}`);
        nextSampleAt = Date.now() + 5000;
      }
      await sleep(60);
    }

    await s.waitFor('window.__explore.state().pendingLlm === 0', { timeout: 15000 });
    await s.ev(`window.__sykiRPC.setUiState({ preview: 'off' })`);
    await waitTwoFrames(s);
    const final = await samplePerf(s, { gc: true });
    samples.push(final);

    const maxFreezeMs = await s.ev(HEARTBEAT_READ);
    const st = await lightState(s);

    const heapDelta = round1(final.heapMb - baseline.heapMb);
    const nodeDelta = final.nodes - baseline.nodes;
    const listenerDelta = final.listeners - baseline.listeners;

    const failed = cdpErrors.length > 0 || st.pendingLlm !== 0;
    const warned = !failed && (heapDelta > 25 || nodeDelta > 500 || listenerDelta > 50);

    return {
      profile: `P4 (soak ${soakSec}s, ${step} ops)`,
      status: failed ? 'FAIL' : (warned ? 'WARN' : 'PASS'),
      openMs: '-',
      switchP95Ms: '-',
      switchMaxMs: '-',
      typingP95Ms: '-',
      previewMs: '-',
      maxFreezeMs,
      heapGcMb: `${final.heapMb} (${heapDelta >= 0 ? '+' : ''}${heapDelta})`,
      nodes: `${final.nodes} (${nodeDelta >= 0 ? '+' : ''}${nodeDelta})`,
      listeners: `${final.listeners} (${listenerDelta >= 0 ? '+' : ''}${listenerDelta})`,
      errors: cdpErrors.length,
      detail: `pendingLlm=${st.pendingLlm}, samples=${samples.length}`
    };
  });
}

// ---------------------------------------------------------------------------
// P5: Settings modal tabs/Save/Cancel + Mobile Drop focus + Palette + Scraps arrivals
// ---------------------------------------------------------------------------
async function runP5() {
  return withSession('P5 (settings/modals/capture)', 90000, async (s, cdpErrors) => {
    const dirtyId = await s.ev(`(function () {
      var r = window.__sykiRPC.openTab({ title: 'dirty-guard.md', content: '# Unsaved\\nKeep this text\\n', background: false });
      var ed = document.getElementById('editor');
      ed.focus();
      ed.setSelectionRange(ed.value.length, ed.value.length);
      return r.id;
    })()`);
    await s.type(' UNSAVED_MARK', { insert: true });
    await waitTwoFrames(s);
    const expectedDirtyValue = await s.ev("document.getElementById('editor').value");

    const settingsTabBtns = ['tab-btn-model', 'tab-btn-agent', 'tab-btn-sync', 'tab-btn-shortcuts', 'tab-btn-general'];
    const scrapEvents = 4;
    let totalScrapEvents = 0;

    async function runOneCycle(i) {
      // 1. Settings modal open + 5 tab switches + Cancel (odd) / Save (even)
      await s.key(',', { ctrl: true });
      await s.waitFor("!document.getElementById('settings-modal').classList.contains('hidden')");
      const beforeAutoSave = await s.ev("document.getElementById('stat-autosave').getAttribute('aria-pressed')");

      for (const tabBtnId of settingsTabBtns) {
        await s.ev(`document.getElementById(${JSON.stringify(tabBtnId)}).click()`);
        await waitTwoFrames(s);
      }

      await s.ev("document.getElementById('cfg-autosave').click()");
      await waitTwoFrames(s);

      if (i % 2 === 1) {
        await s.ev("document.getElementById('btn-cancel-settings').click()");
        await s.waitFor("document.getElementById('settings-modal').classList.contains('hidden')");
        const afterCancelAutoSave = await s.ev("document.getElementById('stat-autosave').getAttribute('aria-pressed')");
        if (afterCancelAutoSave !== beforeAutoSave) {
          throw new Error(`P5 cycle ${i}: Cancel changed stat-autosave (${beforeAutoSave} -> ${afterCancelAutoSave})`);
        }
      } else {
        await s.ev("document.getElementById('btn-save-settings').click()");
        await s.waitFor("document.getElementById('settings-modal').classList.contains('hidden')");
        await waitTwoFrames(s);
        const expectedSaved = beforeAutoSave === 'true' ? 'false' : 'true';
        const afterSaveAutoSave = await s.ev("document.getElementById('stat-autosave').getAttribute('aria-pressed')");
        if (afterSaveAutoSave !== expectedSaved) {
          throw new Error(`P5 cycle ${i}: Save did not apply stat-autosave (expected ${expectedSaved}, got ${afterSaveAutoSave})`);
        }
      }

      // 2. Mobile Drop open + stray-key focus guard + Cancel
      await s.key('u', { ctrl: true, shift: true });
      await s.waitFor("!document.getElementById('mobile-drop-modal').classList.contains('hidden')");
      await s.key('x');
      await waitTwoFrames(s);
      await s.ev("document.getElementById('btn-mobile-drop-cancel').click()");
      await s.waitFor("document.getElementById('mobile-drop-modal').classList.contains('hidden')");

      // 3. Command Palette open + Escape
      await s.key('p', { ctrl: true, shift: true });
      await s.waitFor("!document.getElementById('quick-pick-modal').classList.contains('hidden')");
      await s.key('Escape');
      await s.waitFor("document.getElementById('quick-pick-modal').classList.contains('hidden')");

      // 4. Scraps search via RPC with query + Escape
      await s.ev("window.__sykiRPC.openPanel('scraps_search', { query: 'bamboo' })");
      await sleep(120);
      await s.key('Escape');
      await s.waitFor("document.getElementById('scraps-search-modal').classList.contains('hidden')");

      // Check editor buffer before background scrap events
      await s.ev(`window.__sykiRPC.switchTab(${JSON.stringify(dirtyId)})`);
      await waitTwoFrames(s);
      const midCheck = await s.ev("document.getElementById('editor').value");
      if (midCheck !== expectedDirtyValue) {
        throw new Error(`P5 cycle ${i}: dirty buffer altered or leaked key from Mobile Drop: ${JSON.stringify(midCheck)}`);
      }

      // 5. Simulate background Quick Capture / Inbox scrap arrivals
      for (let k = 0; k < scrapEvents; k++) {
        await s.ev("window.onScrapAppended({ filePath: '/scraps/2026-11-19.md', fileName: '2026-11-19.md', date: '2026-11-19' })");
        totalScrapEvents++;
      }
      await waitTwoFrames(s);
    }

    // 1 warmup cycle initializes lazy panels before baseline leak sampling (matches P4 warmup).
    await runOneCycle(0);
    await s.ev(`window.__sykiRPC.switchTab(${JSON.stringify(dirtyId)})`);
    await waitTwoFrames(s);

    const baseline = await samplePerf(s, { gc: true });
    await s.ev(HEARTBEAT_RESET);
    log(`P5: baseline (post-warmup) heap=${baseline.heapMb}MB nodes=${baseline.nodes} listeners=${baseline.listeners}, running 5 cycles...`);

    for (let i = 1; i <= 5; i++) {
      await runOneCycle(i);
    }

    await s.ev(`window.__sykiRPC.switchTab(${JSON.stringify(dirtyId)})`);
    await waitTwoFrames(s);

    const guardCheck = await s.ev(`(function () {
      var ed = document.getElementById('editor');
      var hidden = ['settings-modal', 'mobile-drop-modal', 'quick-pick-modal', 'scraps-search-modal']
        .every(function (id) {
          var el = document.getElementById(id);
          return !el || el.classList.contains('hidden');
        });
      return {
        value: ed ? ed.value : '',
        modalsHidden: hidden
      };
    })()`);

    const maxFreezeMs = await s.ev(HEARTBEAT_READ);
    const final = await samplePerf(s, { gc: true });
    const st = await lightState(s);

    const heapDelta = round1(final.heapMb - baseline.heapMb);
    const nodeDelta = final.nodes - baseline.nodes;
    const listenerDelta = final.listeners - baseline.listeners;

    const dirtyOk = guardCheck.value === expectedDirtyValue;
    const failed = cdpErrors.length > 0 || !dirtyOk || !guardCheck.modalsHidden;
    const warned = !failed && (heapDelta > 25 || nodeDelta > 500 || listenerDelta > 50);

    return {
      profile: 'P5 (settings/modals/capture)',
      status: failed ? 'FAIL' : (warned ? 'WARN' : 'PASS'),
      openMs: '-',
      switchP95Ms: '-',
      switchMaxMs: '-',
      typingP95Ms: '-',
      previewMs: '-',
      maxFreezeMs,
      heapGcMb: `${final.heapMb} (${heapDelta >= 0 ? '+' : ''}${heapDelta})`,
      nodes: `${final.nodes} (${nodeDelta >= 0 ? '+' : ''}${nodeDelta})`,
      listeners: `${final.listeners} (${listenerDelta >= 0 ? '+' : ''}${listenerDelta})`,
      errors: cdpErrors.length,
      detail: `warmup+cycles=5, scrapEvents=${totalScrapEvents}, dirtyOk=${dirtyOk}, modalsHidden=${guardCheck.modalsHidden}, tabs=${st.tabCount}`
    };
  });
}

async function runSafe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    log(`ERROR in ${label}: ${err.message}`);
    return {
      profile: label,
      status: 'FAIL',
      openMs: '-',
      switchP95Ms: '-',
      switchMaxMs: '-',
      typingP95Ms: '-',
      previewMs: '-',
      maxFreezeMs: '-',
      heapGcMb: '-',
      nodes: '-',
      listeners: '-',
      errors: 1,
      detail: err.message
    };
  }
}

async function main() {
  const results = [];
  if (PROFILES.has('p1')) results.push(await runSafe('P1 (many-tabs: 40)', runP1));
  if (PROFILES.has('p2')) {
    const note80k = generateNote({ lines: 80000, seed: 20261004 });
    results.push(await runSafe('P2a (80k-lines ~3MB)', () => runP2Case('P2a (80k-lines ~3MB)', 'huge-80k.md', note80k, 'method')));
    const giant300k = 'x'.repeat(300000) + ' TAIL_NEEDLE';
    results.push(await runSafe('P2b (300k single-line)', () => runP2Case('P2b (300k single-line)', 'giant-1line.md', giant300k, 'TAIL_NEEDLE')));
  }
  if (PROFILES.has('p3')) results.push(await runSafe('P3 (heavy-session: 20x100KB)', runP3));
  if (PROFILES.has('p4')) results.push(await runSafe(`P4 (soak ${SOAK_SEC}s)`, () => runP4(SOAK_SEC)));
  if (PROFILES.has('p5')) results.push(await runSafe('P5 (settings/modals/capture)', runP5));

  console.log('\n### Headless Edge Scale & Soak Summary');
  console.log('| Profile | Status | Open (ms) | Switch p95 (ms) | Typing p95 (ms) | Side Preview (ms) | Max Freeze (ms) | GC Heap (MB) | DOM Nodes | Listeners | Errors |');
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of results) {
    console.log(
      `| ${r.profile} | ${r.status} | ${r.openMs} | ${r.switchP95Ms} | ${r.typingP95Ms} | ${r.previewMs} | ${r.maxFreezeMs} | ${r.heapGcMb} | ${r.nodes} | ${r.listeners} | ${r.errors} |`
    );
  }

  if (OUT_FILE) {
    fs.mkdirSync(path.dirname(path.resolve(OUT_FILE)), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  }

  if (results.some((r) => r.status === 'FAIL')) {
    process.exit(1);
  }
}

await main();
