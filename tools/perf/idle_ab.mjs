#!/usr/bin/env node
// idle_ab: what does the IDLE app do, and does a style change make it do more? Two ways to look, both inside ONE running test app (so the
// processes, the profile, the PC's drift and the caret's blink are shared by every variant), the variants being a <style> element that the
// page gets over CDP, one after the other, in turns (the order is reversed in every other round).
//
//   --mode cpu    (default) the CPU time of the app and its WebView2 processes (proc_mem.ps1) over a window of --secs per variant: what
//                 v2_perf.mjs measures as "idle CPU", but with the variants taking turns in one process. Counts in 15.6 ms ticks, so one
//                 window of 30 s at 1% is 300 ms +-5%, and the PC's own scatter is about +-0.3 points: needs many windows to see 0.2.
//   --mode trace  a Chromium trace (cc, blink, viz, gpu) of --secs per variant: the milliseconds of work per second of the renderer and of
//                 the GPU process (every task minus the waits for the vsync), and the events that make it up. Three orders of magnitude
//                 finer than the CPU counters (the scatter is 0.1 ms/s = 0.01 points), which is what settled the P3 question.
//
//   node tools/perf/idle_ab.mjs --mode trace --secs 15 --rounds 4 --tabs 3 --variants "opacity=|alpha=.tab-item::before{opacity:1 !important;background:rgb(var(--accent-rgb) / var(--tab-o)) !important}|no strip=#tab-index-left{display:none}"
//   node tools/perf/idle_ab.mjs --mode cpu --pid <pid> --profile <the WebView2 data folder> --secs 30 --rounds 5 --variants "..."
//
// The app is one you started yourself (E2E/launch.ps1, port 9335; take E2E/app.lock first and give it back); nothing here starts or stops
// a process. --e2e <dir> is the E2E folder (cdp.mjs); the default is $V2_E2E. The page gets the animations on (prefers-reduced-motion: no-preference)
// and --tabs notes. Each window is checked for the page keeping the focus (without it the caret does not blink and the numbers drop): a
// window without it is left out and said so. Read-only for the app; the <style> element is removed at the end.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; };
const MODE = arg('mode', 'cpu');
const E2E = arg('e2e', process.env.V2_E2E || '');
if (!E2E) { console.error('give --e2e <the E2E folder with cdp.mjs> or set V2_E2E'); process.exit(2); }
if (!['cpu', 'trace'].includes(MODE)) { console.error('--mode is cpu or trace'); process.exit(2); }
const SECS = Number(arg('secs', MODE === 'cpu' ? '30' : '15'));
const ROUNDS = Number(arg('rounds', '3'));
const SETTLE = Number(arg('settle', '3'));
const TABS = Number(arg('tabs', '3'));
const variants = arg('variants', 'normal=').split('|').map((v) => { const i = v.indexOf('='); return { name: v.slice(0, i), css: v.slice(i + 1) }; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { connect } = await import(pathToFileURL(path.join(E2E, 'cdp.mjs')).href);

// ---- cpu mode: process CPU time ---------------------------------------------------------------------------------------------------------------
function snap() {
  const r = spawnSync('powershell', ['-NoProfile', '-File', path.join(HERE, 'proc_mem.ps1'), '-AppPid', arg('pid'), '-Profile', arg('profile')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('proc_mem.ps1 failed: ' + r.stderr);
  return JSON.parse(r.stdout);
}
function cpuDelta(a, b) {
  const prev = new Map(a.processes.map((p) => [p.pid, p]));
  const out = { total: 0, gpu: 0, renderer: 0, browser: 0 };
  for (const p of b.processes) {
    const q = prev.get(p.pid);
    if (!q) continue;
    const ms = p.cpuMs - q.cpuMs;
    out.total += ms;
    if (p.role === 'gpu' || p.role === 'renderer' || p.role === 'browser') out[p.role] += ms;
  }
  const span = b.at - a.at;
  for (const k of Object.keys(out)) out[k] = (100 * out[k]) / span;
  return out;
}

// ---- trace mode: the work of the renderer and the GPU process ----------------------------------------------------------------------------------
async function traceWindow(page, events) {
  events.length = 0;
  await page.send('Tracing.start', { categories: 'cc,blink,devtools.timeline,toplevel,viz,gpu', transferMode: 'ReportEvents' });
  await sleep(SECS * 1000);
  const done = new Promise((res) => { const h = (m) => { if (JSON.parse(m.data).method === 'Tracing.tracingComplete') { page.ws.removeEventListener('message', h); res(); } }; page.ws.addEventListener('message', h); });
  await page.send('Tracing.end');
  await done;
  const run = {}, sleeping = {}, role = {};
  let frames = 0;
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    if (e.name === 'ThreadControllerImpl::RunTask') run[e.pid] = (run[e.pid] || 0) + e.dur;
    else if (e.name === 'WaitForVSync Sleep') sleeping[e.pid] = (sleeping[e.pid] || 0) + e.dur;
    else if (e.name === 'ProxyMain::BeginMainFrame') { role[e.pid] = 'renderer'; frames++; }
    else if (e.name === 'DirectRenderer::DrawFrame') role[e.pid] = 'gpu';
  }
  const work = { renderer: 0, gpu: 0, other: 0, frames: frames / SECS };
  for (const pid of Object.keys(run)) work[role[pid] || 'other'] += (run[pid] - (sleeping[pid] || 0)) / 1000 / SECS; // ms of work per second
  return work;
}

const page = await connect();
const events = [];
page.ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Tracing.dataCollected') for (const e of d.params.value) events.push(e); });
const setCss = (css) => page.ev(`(function () { var s = document.getElementById('ab-style'); if (!s) { s = document.createElement('style'); s.id = 'ab-style'; document.head.appendChild(s); } s.textContent = ${JSON.stringify(css)}; var e = document.getElementById('editor'); if (document.activeElement !== e) e.focus(); return 1; })()`);
try {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  console.error('tabs on the strip:', await page.ev(`(async function () { var have = function () { return document.querySelectorAll('#tabs-list > *').length; }; for (var i = have(); i < ${TABS}; i++) window.__mdMemoRPC.openTab({ title: 'Note ' + (i + 1), content: 'Note ' + (i + 1) + '\\n\\nsome text', background: true }); await new Promise(function (r) { setTimeout(r, 800); }); return have(); })()`));
  const results = new Map(variants.map((v) => [v.name, []]));
  for (let round = 0; round < ROUNDS; round++) {
    for (const v of (round % 2 ? variants.slice().reverse() : variants)) {
      await setCss(v.css);
      await sleep(SETTLE * 1000);
      const focusBefore = await page.ev('document.hasFocus()');
      let row;
      if (MODE === 'cpu') {
        const a = snap();
        await sleep(SECS * 1000);
        row = cpuDelta(a, snap());
      } else {
        row = await traceWindow(page, events);
      }
      row.focus = focusBefore && await page.ev('document.hasFocus()');
      results.get(v.name).push(row);
      console.error(`round ${round + 1} ${v.name.padEnd(14)} ` + Object.entries(row).map(([k, x]) => k + ' ' + (typeof x === 'number' ? x.toFixed(2) : x)).join('  '));
    }
  }
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const unit = MODE === 'cpu' ? '% of one logical processor' : 'ms of work per second';
  console.log(`\n${MODE}: ${TABS} tabs, windows of ${SECS} s, ${ROUNDS} rounds, ${unit}`);
  for (const [name, all] of results) {
    const rows = all.filter((r) => r.focus);
    if (rows.length !== all.length) console.log(`${name}: ${all.length - rows.length} window(s) without the page focus left out`);
    if (!rows.length) continue;
    const keys = MODE === 'cpu' ? ['total', 'gpu', 'renderer', 'browser'] : ['renderer', 'gpu', 'other', 'frames'];
    console.log(name.padEnd(14) + keys.map((k) => `${k} ${med(rows.map((r) => r[k])).toFixed(2)} [${rows.map((r) => r[k].toFixed(2)).join(' ')}]`).join('   '));
  }
} finally {
  await page.ev("(function () { var s = document.getElementById('ab-style'); if (s) s.remove(); return 1; })()");
  page.close();
}
