#!/usr/bin/env node
// v2_perf: a repeatable performance harness for the syki::sok test exes (startup, idle memory, an 80,000-line note: open / scroll / type).
// No npm packages (Node 24: global fetch and WebSocket). Windows only. Read tools/perf/README.md first.
//
//   node tools/perf/v2_perf.mjs --exe v2-base.exe [--runs 7] [--out result.json] [--compare tools/perf/baseline-v1.14.json]
//   node tools/perf/v2_perf.mjs --merge a.json b.json --out merged.json       (pool two invocations into one baseline file)
//   node tools/perf/v2_perf.mjs --diff baseline.json new.json                 (compare two result files; nothing is launched)
//
// Every run starts the exe from scratch (own data folder, own WebView2 profile copied from a primed seed), measures, and stops
// exactly that process id. The user's own syki.exe, config, notes and Ollama are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateNote, noteStats, DEFAULT_LINES, DEFAULT_SEED, GENERATOR_VERSION } from './gen_note.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_VERSION = 1;
const PORT = 9335; // the one debug port of the isolated exe (build.sh puts it there); only one app at a time, hence E2E/app.lock
const DEFAULT_E2E = process.env.V2_E2E || 'C:/Users/yoush/AppData/Local/Temp/claude/C--Users-yoush-Documents-md-memo/c56620cc-7e7e-498b-a7c7-c4a14c374db1/scratchpad/v2e2e';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usageError = (msg) => Object.assign(new Error(msg), { usage: true }); // a mistake in the command line: the message alone is printed, no stack
const log = (...a) => console.error('[v2_perf]', ...a);

// ---------------------------------------------------------------------------------------------------------------- options
function parseArgs(argv) {
  const o = { runs: 7, idleSec: 10, cpuIdleSec: 10, quietPct: 10, quietWaitSec: 45, maxRetries: 8, settleSec: 3, steps: 'startup,memory,open,scroll,typing', lockTimeoutMin: 30, format: 'both', keys: 50, wheelSec: 4, motion: 'system', barsState: 'natural', tabs: 0 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw usageError('missing value for ' + a); return argv[++i]; };
    switch (a) {
      case '--exe': o.exe = next(); break;
      case '--runs': o.runs = Number(next()); break;
      case '--out': o.out = next(); break;
      case '--compare': o.compare = next(); break;
      case '--merge': o.merge = []; while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o.merge.push(argv[++i]); break;
      case '--diff': o.diff = [next(), next()]; break;
      case '--e2e': o.e2e = next(); break;
      case '--work': o.work = next(); break;
      case '--note': o.note = next(); break;
      case '--label': o.label = next(); break;
      case '--steps': o.steps = next(); break;
      case '--idle-sec': o.idleSec = Number(next()); break;
      case '--settle-sec': o.settleSec = Number(next()); break;
      case '--cpu-idle-sec': o.cpuIdleSec = Number(next()); break;
      case '--quiet-pct': o.quietPct = Number(next()); break;
      case '--quiet-wait-sec': o.quietWaitSec = Number(next()); break;
      case '--max-retries': o.maxRetries = Number(next()); break;
      case '--trace-scroll': o.traceScroll = next(); break; // diagnosis: a Chromium trace of the scroll phase, one file per run
      case '--keys': o.keys = Number(next()); break;
      case '--wheel-sec': o.wheelSec = Number(next()); break;
      case '--lock-timeout-min': o.lockTimeoutMin = Number(next()); break;
      case '--format': o.format = next(); break; // md | json | both
      case '--config-patch': o.configPatch = next(); break;   // JSON text or @file.json, deep-merged over the app config written for every run
      case '--browser-args': o.browserArgs = next(); break;   // extra Chromium flags for the WebView2 processes (see the README for how each one gets there)
      case '--motion': o.motion = next(); break;              // system | no-preference | reduce
      case '--bars-state': o.barsState = next(); break;       // natural | shown | faded (scroll step only)
      case '--tabs': o.tabs = Number(next()); break;          // open notes until this many tabs are on the strip (0 = leave the app as it starts)
      case '--help': case '-h': o.help = true; break;
      default: rest.push(a);
    }
  }
  if (rest.length) throw usageError('unknown arguments: ' + rest.join(' '));
  // everything below is checked before anything is launched
  if (!['system', 'no-preference', 'reduce'].includes(o.motion)) throw usageError(`--motion must be system, no-preference or reduce (got "${o.motion}")`);
  if (!(Number.isInteger(o.tabs) && o.tabs >= 0 && o.tabs <= 400)) throw usageError(`--tabs must be a whole number from 0 to 400 (got "${o.tabs}")`);
  if (!['natural', 'shown', 'faded'].includes(o.barsState)) throw usageError(`--bars-state must be natural, shown or faded (got "${o.barsState}")`);
  if (o.configPatch != null) o.configPatchParsed = loadConfigPatch(o.configPatch);
  if (o.browserArgs != null) o.browserArgTokens = parseBrowserArgs(o.browserArgs);
  return o;
}

// ---- --config-patch: a JSON object deep-merged over the app config
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function deepMerge(base, patch) { // objects are merged key by key, anything else (arrays included) replaces
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (UNSAFE_KEYS.has(k)) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}
function loadConfigPatch(spec) {
  let text = String(spec);
  if (text.startsWith('@')) {
    const f = text.slice(1);
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { throw usageError(`--config-patch: cannot read ${f}: ${e.message}`); }
  }
  text = text.replace(/^﻿/, '');
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw usageError(`--config-patch is not valid JSON (${e.message}): ${text.slice(0, 160)}`); }
  if (!isPlainObject(obj)) throw usageError('--config-patch must be a JSON object, for example {"appearance":{"bars":"glass","autoHide":false}}');
  const bad = (o, p = '') => Object.entries(o).some(([k, v]) => UNSAFE_KEYS.has(k) || (isPlainObject(v) && bad(v, p + k + '.')));
  if (bad(obj)) throw usageError('--config-patch: the keys __proto__, constructor and prototype are not allowed');
  // the harness owns where the test app keeps its notes: a patch must never point it at real notes
  if (isPlainObject(obj.scraps) && 'scrapDir' in obj.scraps) throw usageError('--config-patch: scraps.scrapDir belongs to the harness (a private folder) and cannot be patched');
  return { text: JSON.stringify(obj), obj };
}

// ---- --browser-args: "--flag --name=value ..." (whitespace separated, no spaces inside a value)
const RESERVED_FLAGS = new Set(['--remote-debugging-port', '--remote-debugging-pipe', '--remote-debugging-address', '--remote-allow-origins', '--user-data-dir', '--webview-exe-name', '--embedded-browser-webview']);
function parseBrowserArgs(spec) {
  const tokens = String(spec).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw usageError('--browser-args is empty');
  for (const t of tokens) {
    if (!/^--[A-Za-z0-9][A-Za-z0-9-]*(=\S*)?$/.test(t)) throw usageError(`--browser-args: "${t}" is not a Chromium flag (write --name or --name=value; whitespace separates flags)`);
    if (RESERVED_FLAGS.has(t.split('=')[0])) throw usageError(`--browser-args: ${t.split('=')[0]} is used by the harness itself and cannot be changed`);
  }
  return tokens;
}
// Flags that reach the app through the profile (Local State) instead of the command line, because the app overwrites
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS with its own list when it starts (window_windows.go) and the harness cannot append to it from outside.
// --disable-gpu is done with the pref hardware_acceleration_mode.enabled = false ("use graphics acceleration when available" off), which ends in the same
// place inside Chromium (GpuDataManager.DisableHardwareAcceleration: software compositing, the GPU process stays and runs a software backend) but does not leave the
// literal switch on the command lines. What it does leave (seen on this PC, WebView2 154): the renderer gets --disable-gpu-compositing and the GPU process
// --use-gl=angle --use-angle=d3d11-warp-webgl (WARP, Microsoft's software rasterizer). That is the proof the harness looks for, and records (run.browserArgs).
const PROFILE_PREF_FLAGS = new Set(['--disable-gpu']);
const PROFILE_PREF_EVIDENCE = { '--disable-gpu': ['--disable-gpu', '--disable-gpu-compositing'] };

const HELP = `usage:
  node tools/perf/v2_perf.mjs --exe <v2-name.exe | path> [--runs 7] [--out result.json] [--compare baseline.json] [--label text]
  node tools/perf/v2_perf.mjs --merge a.json b.json [...] --out merged.json
  node tools/perf/v2_perf.mjs --diff baseline.json new.json
options: --e2e <dir> (default $V2_E2E or the session's v2e2e)  --work <dir> (default <e2e>/../v2perf)  --note <file> (default: generated 80,000 lines)
         --steps startup,memory,open,scroll,typing  --idle-sec 10  --settle-sec 3  --keys 50  --wheel-sec 4  --lock-timeout-min 30  --format md|json|both
         --steps open,views   (opt-in: the four displays of the 80,000-line note - side / preview scroll, divider drags; see README)
         --steps open,panels  (opt-in: floating panels over the 80,000-line note - open time of five panels, the wheel with three of them open; see README)
conditions: --config-patch '{"appearance":{"bars":"glass","autoHide":false}}' | @file.json   (deep-merged over the app config of every run)
            --browser-args "--disable-gpu"      (extra Chromium flags; --disable-gpu works with every exe, other flags need MDM_E2E_BROWSER_ARGS support in the exe's overlay)
            --motion system|no-preference|reduce   (system = do nothing; the others emulate prefers-reduced-motion)
            --bars-state natural|shown|faded    (scroll step: natural = leave it to the app; shown = auto-hide off, bars visible; faded = bars faded before the wheel)
            --tabs N                            (open small notes until N tabs are on the tab strip, before anything is measured; 0 = the app as it starts)
progress goes to stderr; stdout holds the Markdown table and the JSON.`;

// ----------------------------------------------------------------------------------------------------------------- stats
const sortedNum = (a) => a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
function quantile(sorted, q) { // nearest rank
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}
const median = (a) => { const s = sortedNum(a); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const mb = (bytes) => bytes / 1048576;

// ------------------------------------------------------------------------------------------------------------ processes
function runPs(file, args = [], timeout = 90000) {
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 32 << 20 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`${path.basename(file)} failed: ${err.message}\n${stderr}`));
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`${path.basename(file)} printed no JSON: ${stdout.slice(0, 300)}`)); }
      });
  });
}
const procMem = (appPid, profile, withCmd = false) => runPs(path.join(HERE, 'proc_mem.ps1'), ['-AppPid', String(appPid || 0), '-Profile', profile, ...(withCmd ? ['-WithCmd'] : [])]);
const sysLoad = (seconds = 1, info = false) => runPs(path.join(HERE, 'sys_load.ps1'), ['-Seconds', String(seconds), ...(info ? ['-Info'] : [])]);

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

function memMetrics(prefix, snap) {
  const rows = snap.processes || [];
  const sum = (f, pick) => rows.filter(pick).reduce((s, r) => s + f(r), 0);
  const ws = (r) => r.ws, pws = (r) => Math.max(0, r.pws), priv = (r) => Math.max(0, r.privateBytes);
  const role = (...names) => (r) => names.includes(r.role);
  const all = () => true;
  const m = {};
  m[`${prefix}.processes`] = rows.length;
  m[`${prefix}.total_ws_mb`] = mb(sum(ws, all));
  m[`${prefix}.total_pws_mb`] = mb(sum(pws, all));
  m[`${prefix}.total_commit_mb`] = mb(sum(priv, all));
  m[`${prefix}.app_ws_mb`] = mb(sum(ws, role('app')));
  m[`${prefix}.browser_ws_mb`] = mb(sum(ws, role('browser')));
  m[`${prefix}.renderer_ws_mb`] = mb(sum(ws, role('renderer')));
  m[`${prefix}.renderer_pws_mb`] = mb(sum(pws, role('renderer')));
  m[`${prefix}.gpu_ws_mb`] = mb(sum(ws, role('gpu')));
  m[`${prefix}.utility_ws_mb`] = mb(sum(ws, role('utility', 'utility-network', 'utility-storage')));
  m[`${prefix}.crashpad_ws_mb`] = mb(sum(ws, role('crashpad')));
  // private working set per process type (the GPU process is the one a translucent bar can change)
  const type = (t) => (r) => typeOf(r) === t;
  m[`${prefix}.gpu_pws_mb`] = mb(sum(pws, type('gpu-process')));
  m[`${prefix}.browser_pws_mb`] = mb(sum(pws, type('browser')));
  m[`${prefix}.utility_pws_mb`] = mb(sum(pws, type('utility')));
  m[`${prefix}.app_pws_mb`] = mb(sum(pws, type('app')));
  m[`${prefix}.crashpad_pws_mb`] = mb(sum(pws, type('crashpad-handler')));
  return m;
}

// The Chromium process type of a row of proc_mem.ps1. Results made before `type` existed carry only `role`.
function typeOf(r) {
  if (r.type) return r.type;
  switch (r.role) {
    case 'gpu': return 'gpu-process';
    case 'crashpad': return 'crashpad-handler';
    case 'utility-network': case 'utility-storage': return 'utility';
    default: return r.role || 'other';
  }
}

// Working set / private working set / commit / CPU time per process type, for the JSON (run.memByType).
function memByType(snap) {
  const out = {};
  for (const r of snap.processes || []) {
    const t = typeOf(r);
    const e = out[t] || (out[t] = { n: 0, ws_mb: 0, pws_mb: 0, commit_mb: 0, cpu_ms: 0 });
    e.n++; e.ws_mb += mb(r.ws); e.pws_mb += mb(Math.max(0, r.pws)); e.commit_mb += mb(Math.max(0, r.privateBytes)); e.cpu_ms += r.cpuMs;
  }
  for (const e of Object.values(out)) for (const k of Object.keys(e)) e[k] = round(e[k], k === 'n' ? 0 : 1);
  return out;
}

// CPU time used between two snapshots of proc_mem.ps1, summed per process type. A process that appeared in between counts with all
// of its CPU time (it all happened inside the window); one that went away is lost (counted in `gone`).
const CPU_TYPES = ['gpu-process', 'renderer', 'browser', 'utility', 'app']; // always reported, 0 when absent
function cpuDelta(a, b) {
  const prev = new Map(a.processes.map((p) => [p.pid, p]));
  const ms = {}; for (const t of CPU_TYPES) ms[t] = 0;
  let total = 0, added = 0;
  for (const p of b.processes) {
    const q = prev.get(p.pid);
    if (!q) added++;
    const d = Math.max(0, q ? p.cpuMs - q.cpuMs : p.cpuMs);
    const t = typeOf(p);
    ms[t] = (ms[t] || 0) + d; total += d;
  }
  const nowIds = new Set(b.processes.map((p) => p.pid));
  const gone = a.processes.filter((p) => !nowIds.has(p.pid)).length;
  const windowMs = b.at - a.at;
  const pct = {}; for (const [t, v] of Object.entries(ms)) pct[t] = windowMs > 0 ? (100 * v) / windowMs : NaN; // % of one logical processor
  return { ms, total, windowMs, pct, pctTotal: windowMs > 0 ? (100 * total) / windowMs : NaN, added, gone };
}
// flat metric keys (they go through summarize / the tables / --compare): <step>.cpu_ms_by_type.<type>, <step>.cpu_pct_by_type.<type>, <step>.cpu_ms_total, <step>.cpu_pct_total
function putCpu(m, step, d) {
  for (const [t, v] of Object.entries(d.ms)) { m[`${step}.cpu_ms_by_type.${t}`] = v; m[`${step}.cpu_pct_by_type.${t}`] = d.pct[t]; }
  m[`${step}.cpu_ms_total`] = d.total;
  m[`${step}.cpu_pct_total`] = d.pctTotal;
  m[`${step}.cpu_window_ms`] = d.windowMs;
}
// the same numbers for reading in the JSON, rounded
function cpuRecord(d) {
  const r1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v, 1)]));
  return { cpu_ms_by_type: r1(d.ms), cpu_ms_total: round(d.total, 1), cpu_pct_by_type: r1(d.pct), cpu_pct_total: round(d.pctTotal, 2), cpu_window_ms: d.windowMs, cpu_processes: { added: d.added, gone: d.gone } };
}

// --browser-args proof: which process types carry each requested flag on their command line, and the GPU process' own backend flags
const GPU_FLAG_RE = /--(?:use-gl|use-angle|use-gpu-in-tests|use-vulkan|disable-gpu[\w-]*|enable-gpu[\w-]*|in-process-gpu|disable-software-rasterizer)(?:=\S+)?/g;
function analyseCmds(snap, tokens) {
  const procs = (snap.processes || []).filter((p) => typeOf(p) !== 'app');
  const seen = {}; // token -> ["renderer:--disable-gpu-compositing", ...]
  for (const t of tokens) {
    const names = PROFILE_PREF_FLAGS.has(t) ? PROFILE_PREF_EVIDENCE[t] : [t.split('=')[0]]; // a flag set through the profile is proven by what it leaves behind
    const hits = [];
    for (const n of names) {
      const re = new RegExp('(?:^|\\s)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:=\\S*)?(?=\\s|$)');
      for (const p of procs) if (re.test(p.cmd || '')) hits.push(`${typeOf(p)}:${n}`);
    }
    seen[t] = [...new Set(hits)];
  }
  const gpu = procs.find((p) => typeOf(p) === 'gpu-process');
  const rend = procs.find((p) => typeOf(p) === 'renderer');
  return { seen, gpuFlags: gpu ? (gpu.cmd || '').match(GPU_FLAG_RE) || [] : null, rendererFlags: rend ? (rend.cmd || '').match(GPU_FLAG_RE) || [] : null };
}

// ------------------------------------------------------------------------------------------------------------------ CDP
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.closed = false; this.listeners = new Map();
    ws.addEventListener('message', (m) => {
      const d = JSON.parse(m.data);
      if (d.method && this.listeners.has(d.method)) this.listeners.get(d.method).forEach((f) => f(d.params));
      if (d.id && this.pending.has(d.id)) { const p = this.pending.get(d.id); this.pending.delete(d.id); clearTimeout(p.timer); p.resolve(d); }
    });
    ws.addEventListener('close', () => { this.closed = true; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP socket closed')); } this.pending.clear(); });
  }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('CDP websocket error')), { once: true }); });
    return new CDP(ws);
  }
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(fn); }
  send(method, params = {}, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('CDP socket closed'));
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout (${timeoutMs} ms): ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)), reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expression, timeoutMs = 60000) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('page exception: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text || '?').toString().slice(0, 500));
    }
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { /* already closed */ } }
}

async function metricsOf(cdp) {
  const r = await cdp.send('Performance.getMetrics');
  const m = {};
  for (const x of r.metrics) m[x.name] = x.value;
  return m;
}

// ----------------------------------------------------------------------------------------------------- in-page snippets
const READY_EXPR = `(function () {
  try {
    var n = performance.getEntriesByType('navigation')[0];
    if (document.readyState !== 'complete' || !window.backend || !n || !(n.loadEventEnd > 0)) return null;
    var fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { timeOrigin: performance.timeOrigin, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp: fcp ? fcp.startTime : null,
      vis: document.visibilityState, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, scripts: performance.getEntriesByType('resource').length };
  } catch (e) { return null; }
})()`;

// --tabs N: small notes (no path, so none is a duplicate of another) until the strip holds N tabs; resolves to how many there are once the strip is drawn
const openTabsExpr = (n) => `(async function () {
  var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
  var have = function () { return document.querySelectorAll('#tabs-list > *').length; };
  for (var i = have(); i < ${n}; i++) window.__sykiRPC.openTab({ title: 'Note ' + (i + 1), content: 'Note ' + (i + 1) + '\\n\\nsome text', background: true });
  for (var k = 0; k < 40 && have() < ${n}; k++) await raf();
  await raf(); await raf();
  return have();
})()`;

const APP_READY_EXPR = `!!(window.__sykiRPC && document.getElementById('editor') && document.querySelectorAll('#tabs-list > *').length > 0)`;

// Frame cadence of an idle page: the display's refresh rate (and proof that frames are produced at all: a hidden window gets none).
const IDLE_FRAMES_EXPR = `new Promise(function (res) { var ts = []; function f(t) { ts.push(t); if (ts.length < 40) requestAnimationFrame(f); else res(ts); } requestAnimationFrame(f); })`;

const openExpr = (file, title) => `(async function () {
  var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
  var ed = document.getElementById('editor');
  var t0 = performance.now();
  var res = await window.backend.readFileByPath(${JSON.stringify(file)});
  var t1 = performance.now();
  var info = window.__sykiRPC.openTab({ title: res.title || ${JSON.stringify(title)}, path: res.path || ${JSON.stringify(file)}, content: res.content, encoding: res.encoding });
  var t2 = performance.now();
  await raf(); await raf();
  var t3 = performance.now();
  return { readMs: t1 - t0, openTabMs: t2 - t1, frameMs: t3 - t2, totalMs: t3 - t0, chars: ed.value.length, newlines: (ed.value.match(/\\n/g) || []).length,
    scrollHeight: ed.scrollHeight, clientHeight: ed.clientHeight, clientWidth: ed.clientWidth, encoding: res.encoding, existing: !!info.existing };
})()`;

const SCROLL_PREP_EXPR = `(async function () {
  var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
  var ed = document.getElementById('editor');
  ed.scrollTop = Math.floor((ed.scrollHeight - ed.clientHeight) / 2);
  await raf(); await raf();
  var b = ed.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), scrollTop: ed.scrollTop, scrollHeight: ed.scrollHeight, clientHeight: ed.clientHeight, vis: document.visibilityState };
})()`;

const SCROLL_START_EXPR = `(function () {
  var R = window.__scrollRec = { ts: new Float64Array(20000), n: 0, on: true, t0: performance.now() };
  function loop(t) { if (!R.on) return; if (R.n < R.ts.length) R.ts[R.n++] = t; requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  // what a slow frame was doing (Long Animation Frames, Chromium 123+): kept only for frames over 50 ms, for the report
  R.loaf = [];
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) {
        if (e.duration > 50 && R.loaf.length < 6) R.loaf.push({ at: Math.round(e.startTime - R.t0), ms: Math.round(e.duration), block: Math.round(e.blockingDuration || 0), renderStart: Math.round(e.renderStart - e.startTime),
          styleLayout: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0), scripts: (e.scripts || []).slice(0, 3).map(function (x) { return (x.invoker || '') + ' ' + Math.round(x.duration) + 'ms ' + (x.sourceFunctionName || '') + ' ' + String(x.sourceURL || '').split('/').pop(); }) });
      });
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch (e) { R.loafError = String(e); }
  return document.getElementById('editor').scrollTop;
})()`;

const SCROLL_STOP_EXPR = `(function () {
  var R = window.__scrollRec; R.on = false;
  return { ts: Array.from(R.ts.subarray(0, R.n)), scrollTop: document.getElementById('editor').scrollTop, t0: R.t0, loaf: R.loaf, loafError: R.loafError || null };
})()`;

const TYPING_PREP_EXPR = `(async function () {
  var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
  var ed = document.getElementById('editor');
  var v = ed.value, line = Math.floor(v.split('\\n').length / 2), pos = 0;
  for (var i = 0; i < line; i++) pos = v.indexOf('\\n', pos) + 1;
  pos += 4; // a few characters into the middle line
  ed.blur(); ed.setSelectionRange(pos, pos); ed.focus();
  await raf(); await raf();
  var T = window.__typing = { lat: [], delay: [], fallback: 0, cbs: [] };
  window.addEventListener('keydown', function (e) {
    if (!e.key || e.key.length !== 1) return;
    var now = performance.now(), start = e.timeStamp;
    if (!(start > 0) || Math.abs(now - start) > 5000) { start = now; T.fallback++; }
    T.delay.push(now - start);
    requestAnimationFrame(function () {
      var ch = new MessageChannel();
      ch.port1.onmessage = function () {
        ch.port1.close();
        T.lat.push(performance.now() - start);
        for (var i = T.cbs.length - 1; i >= 0; i--) if (T.lat.length >= T.cbs[i][0]) { T.cbs[i][1](); T.cbs.splice(i, 1); }
      };
      ch.port2.postMessage(0);
    });
  }, true);
  T.wait = function (n) { return new Promise(function (res) { if (T.lat.length >= n) res(); else T.cbs.push([n, res]); }); };
  return { pos: pos, line: line, chars: v.length, active: document.activeElement === ed, caret: ed.selectionStart, scrollTop: ed.scrollTop, scrollHeight: ed.scrollHeight };
})()`;

const TYPING_DONE_EXPR = `(function () {
  var ed = document.getElementById('editor'), T = window.__typing;
  return { lat: T.lat, delay: T.delay, fallback: T.fallback, chars: ed.value.length, caret: ed.selectionStart, active: document.activeElement === ed };
})()`;

// What the header / status bar look like right now (body.chrome-faded is the auto-hide state, js/chrome_overlay.js; --bar-a and data-bars
// are the translucency of css/chrome.css). Written into scroll.bars at the start and at the end of the wheel, so a result file proves it.
const BARS_STATE_EXPR = `(function () {
  var b = document.body, h = document.getElementById('header'), s = document.getElementById('status-bar');
  var hs = h ? getComputedStyle(h) : null, ss = s ? getComputedStyle(s) : null, bs = getComputedStyle(b);
  var co = window.ChromeOverlay && window.ChromeOverlay.current;
  function nn(v) { return v === undefined || v === null || v === '' ? null : v; }
  return { chromeFaded: b.classList.contains('chrome-faded'), headerOpacity: hs ? hs.opacity : null, statusOpacity: ss ? ss.opacity : null,
    backdropFilter: hs ? nn(hs.backdropFilter || hs.webkitBackdropFilter) : null, barA: nn(hs ? hs.getPropertyValue('--bar-a').trim() : ''), dataBars: nn(b.dataset ? b.dataset.bars : null),
    overlay: !!window.ChromeOverlay, controller: !!co, autoHide: co && co.isEnabled ? co.isEnabled() : null, away: co && co.isAway ? co.isAway() : null };
})()`;

// --bars-state shown | faded, for the scroll step only. Returns what the controller was before (to put it back afterwards).
// stage 'all' does everything at once; faded is done in two stages ('prepare', then 'away') with the pointer noted in between (see setupBars).
const barsSetupExpr = (mode, stage) => `(function () {
  var co = window.ChromeOverlay && window.ChromeOverlay.current;
  var mode = ${JSON.stringify(mode)}, stage = ${JSON.stringify(stage || 'all')};
  var r = { overlay: !!window.ChromeOverlay, controller: !!(co && typeof co.configure === 'function') };
  if (!r.controller) return r;
  if (stage !== 'away') r.was = { enabled: co.isEnabled ? co.isEnabled() : null, away: co.isAway ? co.isAway() : null };
  if (mode === 'shown') { co.configure({ autoHide: false }); co.show(); }
  else if (stage === 'away') { co.away(); }
  else { co.configure({ autoHide: true }); if (stage === 'all') co.away(); }
  r.now = { enabled: co.isEnabled ? co.isEnabled() : null, away: co.isAway ? co.isAway() : null };
  return r;
})()`;

// After the scroll: autoHide back to what it was; if it was on, the bars end faded, as they do after a natural scroll (so the typing step starts alike in every mode).
const barsRestoreExpr = (enabled) => `(function () {
  var co = window.ChromeOverlay && window.ChromeOverlay.current;
  if (!co) return false;
  co.configure({ autoHide: ${enabled ? 'true' : 'false'} });
  ${enabled ? 'co.away();' : 'co.show();'}
  return true;
})()`;

const MOTION_QUERY = `matchMedia('(prefers-reduced-motion: reduce)').matches`;

// ---- the `views` step (P4): the four displays of the 80,000-line note. The same frame recorder as the scroll step, but for any element, and a
// recorder per scene (window.__sceneRec), so the scenes can share one page without touching what the scroll step uses.
const viewPrepExpr = (id) => `(async function () {
  var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
  var el = document.getElementById(${JSON.stringify(id)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  if (cs.display === 'none') return null;
  el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
  await raf(); await raf();
  var b = el.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height), scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, vis: document.visibilityState };
})()`;

const sceneStartExpr = (id) => `(function () {
  var R = window.__sceneRec = { ts: new Float64Array(20000), n: 0, on: true, t0: performance.now(), el: document.getElementById(${JSON.stringify(id)}) };
  function loop(t) { if (!R.on) return; if (R.n < R.ts.length) R.ts[R.n++] = t; requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  return R.el ? R.el.scrollTop : null;
})()`;

const sceneStopExpr = `(function () {
  var R = window.__sceneRec; R.on = false;
  return { ts: Array.from(R.ts.subarray(0, R.n)), scrollTop: R.el ? R.el.scrollTop : null, t0: R.t0 };
})()`;

// where the split resizer is (its centre), and how far a drag may swing without reaching the 15% / 85% clamp
const resizerPointExpr = `(function () {
  var r = document.getElementById('pane-resizer');
  if (!r || getComputedStyle(r).display === 'none') return null;
  var b = r.getBoundingClientRect(), ws = document.getElementById('workspace').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), ratio: (b.left - ws.left) / ws.width, amp: Math.round(ws.width * 0.2), vis: document.visibilityState };
})()`;

// the display the app is in, from the DOM: the answer is checked after every switch so a scene cannot be measured in the wrong view
const viewStateExpr = `(function () {
  function shown(id) { var e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; }
  return { editor: shown('editor-pane'), preview: shown('preview-pane'), secondary: shown('secondary-pane'), secondaryEditor: shown('secondary-editor-pane'),
    secondaryPreview: shown('secondary-preview-pane'), resizer: shown('pane-resizer'), dataView: document.body.dataset ? (document.body.dataset.view || null) : null };
})()`;

// -------------------------------------------------------------------------------------------------------- the harness
class Harness {
  constructor(o) {
    this.o = o;
    this.e2e = path.resolve(o.e2e || DEFAULT_E2E);
    this.work = path.resolve(o.work || path.join(path.dirname(this.e2e), 'v2perf'));
    this.root = path.join(this.work, 'env');         // APPDATA / LOCALAPPDATA / the WebView2 folder of the test app live here
    this.lockDir = path.join(this.e2e, 'app.lock');
    this.haveLock = false;
    this.app = null;                                  // { child, pid, exited }
    this.steps = new Set(o.steps.split(',').map((s) => s.trim()).filter(Boolean));
    this.browserArgs = o.browserArgTokens || [];                                          // as asked
    this.envBrowserArgs = this.browserArgs.filter((t) => !PROFILE_PREF_FLAGS.has(t));    // the ones that have to travel in MDM_E2E_BROWSER_ARGS
  }

  // ---- exe
  resolveExe() {
    let p = this.o.exe;
    if (!p) throw new Error('--exe is required');
    if (!path.isAbsolute(p)) p = path.join(this.e2e, p);
    if (!fs.existsSync(p)) throw new Error('exe not found: ' + p);
    const name = path.basename(p);
    if (!/^v2-.+\.exe$/i.test(name)) throw new Error(`the exe must be named v2-*.exe (stop.ps1 refuses to stop anything else): ${name}`);
    const buf = fs.readFileSync(p);
    const st = fs.statSync(p);
    this.exe = { path: p, name, bytes: st.size, mtime: st.mtime.toISOString(), sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  }

  // ---- note
  prepareNote() {
    fs.mkdirSync(this.work, { recursive: true });
    if (this.o.note) {
      const text = fs.readFileSync(this.o.note, 'utf8');
      this.notePath = path.resolve(this.o.note);
      this.noteInfo = { file: this.notePath, custom: true, ...noteStats(text) };
      return;
    }
    const file = path.join(this.work, 'perf-80k.md');
    const text = generateNote({ lines: DEFAULT_LINES, seed: DEFAULT_SEED }); // 0.2 s: always regenerate, so the file is never stale
    fs.writeFileSync(file, text, 'utf8');
    this.notePath = file;
    this.noteInfo = { file, generator: GENERATOR_VERSION, seed: DEFAULT_SEED, ...noteStats(text) };
  }

  // ---- the E2E lock (mkdir is atomic): one isolated app at a time, because there is one debug port
  async acquireLock() {
    const t0 = Date.now(); let said = 0;
    for (;;) {
      try { fs.mkdirSync(this.lockDir); this.haveLock = true; return; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (Date.now() - t0 > this.o.lockTimeoutMin * 60000) throw new Error(`E2E/app.lock is still held after ${this.o.lockTimeoutMin} min (${this.lockDir}); remove it by hand only if its owner is gone`);
        if (Date.now() - said > 20000) { log('waiting for E2E/app.lock (another agent is using the isolated app)...'); said = Date.now(); }
        await sleep(1500);
      }
    }
  }
  releaseLock() {
    if (!this.haveLock) return;
    try { fs.rmdirSync(this.lockDir); } catch (e) { /* already gone */ }
    this.haveLock = false;
  }

  // ---- state of the isolated app: a private copy of what launch.ps1 sets up (so the 80,000-line note never reaches the shared E2E profile)
  configJson() {
    const notesDir = path.join(this.root, 'notes').replace(/\\/g, '/');
    // Only what the measurement needs to be hermetic: no Ollama calls while typing (ghost text), no IME-switching calls, no update check,
    // no git sync. Everything else is the app's default (cursor aura, auto save, session restore stay ON, as for a user).
    const cfg = {
      scraps: { scrapDir: notesDir, gitSyncEnabled: false },
      general: { language: 'ja', welcomeShown: true, aiChoiceMade: true, checkUpdates: false, imeGuardian: false, imeGuardianRetype: false, imeGuardianReverse: false },
      autocomplete: { enabled: false },
      semantic: { enabled: false },
      inbox: { enabled: false },
      discordBridge: { enabled: false },
    };
    // --config-patch (deep merge): used by the priming start and by every measured run, because both come through here
    return this.o.configPatchParsed ? deepMerge(cfg, this.o.configPatchParsed.obj) : cfg;
  }
  async rmRetry(p) {
    for (let i = 0; i < 40; i++) {
      try { fs.rmSync(p, { recursive: true, force: true }); return; } catch (e) { if (i === 39) throw e; await sleep(500); }
    }
  }
  async prepareEnv(useSeed) {
    await this.rmRetry(path.join(this.root, 'appdata'));
    await this.rmRetry(path.join(this.root, 'wv'));
    await this.rmRetry(path.join(this.root, 'run'));
    fs.mkdirSync(path.join(this.root, 'appdata', 'syki'), { recursive: true });
    fs.mkdirSync(path.join(this.root, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(this.root, 'run'), { recursive: true });
    fs.writeFileSync(path.join(this.root, 'appdata', 'syki', 'config.json'), JSON.stringify(this.configJson(), null, 2));
    if (useSeed) fs.cpSync(path.join(this.root, 'wv-seed'), path.join(this.root, 'wv'), { recursive: true });
    this.applyProfilePrefs();
    this.runNote = path.join(this.root, 'run', 'perf-80k.md'); // a copy per run: auto save may write to it while typing
    fs.copyFileSync(this.notePath, this.runNote);
  }
  // --browser-args that live in the profile: --disable-gpu = "Local State" pref hardware_acceleration_mode.enabled = false. The priming start gets it too
  // (the seed is made in this very invocation with the same flags, so a profile made with other GPU flags is never reused), and every copy of the seed is patched again.
  applyProfilePrefs() {
    if (!this.browserArgs.some((t) => PROFILE_PREF_FLAGS.has(t))) return;
    const f = path.join(this.root, 'wv', 'EBWebView', 'Local State');
    let st = {};
    try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* the first start creates the file */ }
    st.hardware_acceleration_mode = { ...(isPlainObject(st.hardware_acceleration_mode) ? st.hardware_acceleration_mode : {}), enabled: false };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(st));
  }
  get profileDir() { return path.join(this.root, 'wv'); }
  get envVars() {
    const env = { ...process.env, APPDATA: path.join(this.root, 'appdata'), LOCALAPPDATA: path.join(this.root, 'appdata'), MDM_E2E_WEBVIEW: this.root };
    // MDM_E2E_BROWSER_ARGS is read by exes whose E2E overlay appends it to the WebView2 arguments (the app itself overwrites WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, so that
    // variable cannot carry anything in). Without --browser-args the variable is removed, so a stray value of the caller's shell can never reach the app.
    if (this.envBrowserArgs.length) env.MDM_E2E_BROWSER_ARGS = this.envBrowserArgs.join(' '); else delete env.MDM_E2E_BROWSER_ARGS;
    return env;
  }

  // ---- --browser-args proof. Throws when a requested flag is on no process of the profile: the measurement would not be what its label says.
  async verifyBrowserArgs(run, snap) {
    const a = analyseCmds(snap, this.browserArgs);
    run.browserArgs = { requested: this.browserArgs, seenOn: a.seen, gpuProcessFlags: a.gpuFlags, rendererFlags: a.rendererFlags };
    const missing = this.browserArgs.filter((t) => !a.seen[t].length);
    if (missing.length) {
      const have = (snap.processes || []).map((p) => `${typeOf(p)}${p.cmd ? '' : '(no command line)'}`).join(', ') || 'none';
      throw new Error(`--browser-args ${missing.join(' ')} did not reach any msedgewebview2 process of the test profile (processes found: ${have}). --disable-gpu is set through the profile and works with every exe; any other flag only works with an exe whose E2E overlay appends MDM_E2E_BROWSER_ARGS to WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS (the app overwrites that variable itself): see tools/perf/README.md`);
    }
  }

  // the last things every successful run does: the motion emulation must still be in force, and the flags must have been proven at least once
  async endChecks(cdp, run, app) {
    if (this.o.motion !== 'system') await this.checkMotion(cdp, run, 'at the end of the run');
    if (this.browserArgs.length && !run.browserArgs) await this.verifyBrowserArgs(run, await procMem(app.pid, this.profileDir, true));
  }

  // ---- --motion: emulate prefers-reduced-motion (the PC reports "reduce", and the app then switches its transitions off)
  async applyMotion(cdp, run) {
    const mode = this.o.motion;
    if (mode === 'system') return;
    run.motion = { requested: mode, systemReduce: await cdp.ev(MOTION_QUERY, 10000), reapplied: 0 };
    const apply = () => cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: mode }] }, 10000);
    await apply();
    await this.checkMotion(cdp, run, 'right after it was set');
    // a navigation or reload of the page (the harness does none, the app should not) is followed by setting it again
    await cdp.send('Page.enable', {}, 10000);
    cdp.on('Page.frameNavigated', (p) => {
      if (!(p && p.frame && !p.frame.parentId)) return;
      run.motion.reapplied++;
      (run.motion.navigations || (run.motion.navigations = [])).push({ url: String(p.frame.url).slice(0, 80), atMs: this.app ? Date.now() - this.app.t0 : null });
      apply().catch(() => {});
    });
  }
  async checkMotion(cdp, run, when) {
    if (this.o.motion === 'system') return;
    const want = this.o.motion === 'reduce';
    const got = await cdp.ev(MOTION_QUERY, 10000);
    if (got !== want) throw new Error(`--motion ${this.o.motion}: matchMedia('(prefers-reduced-motion: reduce)').matches is ${got} ${when}, expected ${want}: the emulation did not take effect`);
    run.motion.effective = got;
    run.motion.checked = (run.motion.checked || 0) + 1;
  }

  // ---- --bars-state shown | faded (scroll step only); natural does nothing. The state is checked, so a result cannot be mislabelled.
  async setupBars(cdp, run, point) {
    const mode = this.o.barsState;
    const info = { mode };
    if (mode === 'natural') return info;
    const r = await cdp.ev(barsSetupExpr(mode, mode === 'faded' ? 'prepare' : 'all'), 10000);
    if (!r.controller) {
      info.unsupported = true; // an old exe (v2-base.exe): no ChromeOverlay controller, measured as natural
      log(`bars-state ${mode}: this exe has no ChromeOverlay controller, measuring as natural`);
      return info;
    }
    info.was = r.was; info.now = r.now;
    if (mode === 'faded') {
      // The overlay brings the bars back at the first pointer move it sees if it has never seen the pointer while they were shown (js/chrome_overlay.js, onPointerMove), and the
      // browser makes small moves of its own after a scroll. So the pointer is put where the wheel will turn BEFORE the bars go away (one move, while they are still shown), and
      // never again: the later moves of the browser stay inside the dead zone around that spot.
      if (point) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, modifiers: 0, pointerType: 'mouse' }, 10000);
        info.pointerNotedAt = { x: point.x, y: point.y };
        await sleep(50);
      }
      info.now = (await cdp.ev(barsSetupExpr(mode, 'away'), 10000)).now;
    }
    await sleep(400); // the 0.2 s fade (either way) has finished before the recorder and the wheel start
    return info;
  }
  checkBars(info, state, when) {
    if (info.mode === 'natural' || info.unsupported) return;
    const wantFaded = info.mode === 'faded';
    const op = state.headerOpacity == null ? null : parseFloat(state.headerOpacity);
    if (state.chromeFaded !== wantFaded || (op != null && Math.abs(op - (wantFaded ? 0 : 1)) > 0.01)) {
      throw new Error(`--bars-state ${info.mode}: ${when} body.chrome-faded is ${state.chromeFaded} and #header opacity is ${state.headerOpacity} (the pointer moved, or something else showed or hid the bars): the scroll would not be measured in the state its label says`);
    }
  }

  // ---- start / stop
  async portFree() {
    for (let i = 0; i < 40; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1000) }); } catch (e) { return; }
      await sleep(500);
    }
    throw new Error(`port ${PORT} is answering although this harness holds the lock: someone left an isolated app running (not stopped here: it is not ours)`);
  }
  startApp() {
    const t0 = Date.now();
    const child = spawn(this.exe.path, ['e2e_nonexistent_note.md'], { env: this.envVars, stdio: 'ignore', windowsHide: false });
    const app = { child, pid: child.pid, exited: false, t0 };
    child.on('exit', () => { app.exited = true; });
    child.on('error', (e) => { app.exited = true; app.error = e; });
    this.app = app;
    return app;
  }
  async stopApp() {
    const app = this.app;
    if (!app) return;
    if (app.pid && pidAlive(app.pid)) {
      const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.e2e, 'stop.ps1'), '-ProcId', String(app.pid)], { encoding: 'utf8', windowsHide: true });
      log('stop:', (r.stdout || '').trim());
      for (let i = 0; i < 40 && pidAlive(app.pid); i++) await sleep(100);
      if (pidAlive(app.pid)) throw new Error(`pid ${app.pid} is still running after stop.ps1`);
    }
    // its WebView2 processes leave on their own when the host is gone; they are not ours to kill, so wait for them
    for (let i = 0; i < 60; i++) {
      const s = await procMem(0, this.profileDir);
      if (!s.processes.length) { this.app = null; return; }
      await sleep(500);
    }
    throw new Error('msedgewebview2 processes of the test profile are still running 30 s after the app was stopped (not killed: they are not the pid started here)');
  }
  // synchronous, for process exit / Ctrl+C
  emergencyCleanup() {
    try {
      const app = this.app;
      if (app && app.pid && pidAlive(app.pid)) spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.e2e, 'stop.ps1'), '-ProcId', String(app.pid)], { windowsHide: true });
    } catch (e) { /* best effort */ }
    this.releaseLock();
    this.releaseWorkLock();
  }

  async connect(app) {
    const deadline = Date.now() + 40000;
    for (;;) {
      if (app.exited) throw new Error('the app exited while starting' + (app.error ? ': ' + app.error.message : ''));
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1000) })).json();
        const page = list.find((p) => p.type === 'page' && p.url && p.url.startsWith('http://127.0.0.1'));
        if (page) return await CDP.open(page.webSocketDebuggerUrl);
      } catch (e) { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('no page on the debug port after 40 s');
      await sleep(10);
    }
  }

  // ---- the `views` step (P4): the four displays with the 80,000-line note. Opt-in (--steps ...,views); runs after the typing so nothing
  // above changes. Each scene is recorded like the scroll step (frame intervals of an in-page requestAnimationFrame loop, the main-thread
  // deltas of Performance.getMetrics, and the CPU time of every process before and after), under its own metric prefix:
  //   view_side.switch_ms / view_preview.switch_ms  the time of the switch itself (render of the note beside it / instead of it: the known slow one)
  //   side_scroll      the wheel over the side preview (the paper); side_editor_scroll  the wheel over the editor beside it (the preview follows)
  //   side_drag        the divider dragged to and fro for 2 s while the side preview is shown; pair_drag  the same with two editors
  //   preview_scroll   the wheel over the preview alone
  async viewScenes(cdp, run, app, m) {
    const o = this.o;
    const views = run.views = { scenes: [] };
    const setView = async (spec, label) => {
      const t0 = performance.now();
      const st = await cdp.ev(`window.__sykiRPC.setUiState(${JSON.stringify(spec)}).then(function (s) { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(s); }); }); }); })`, 180000);
      const ms = performance.now() - t0;
      await sleep(o.settleSec * 1000);
      const dom = await cdp.ev(viewStateExpr, 10000);
      views.scenes.push({ label, spec, switchMs: round(ms, 0), state: st, dom });
      return { ms, dom };
    };
    const expect = (cond, what) => { if (!cond) throw new Error(`views: ${what}`); };
    const frames = async (name, point, driver) => {
      await this.checkMotion(cdp, run, 'before the ' + name + ' scene');
      const tCpuA = Date.now();
      const cpuA = await procMem(app.pid, this.profileDir);
      await sleep(Math.max(300, 1000 - (Date.now() - tCpuA)));
      const s0 = await metricsOf(cdp);
      const startTop = await cdp.ev(sceneStartExpr(point.id), 10000);
      const t0 = Date.now();
      await driver();
      const tEnd = Date.now();
      await sleep(300); // the smooth-scroll tail
      const rec = await cdp.ev(sceneStopExpr, 30000);
      const s1 = await metricsOf(cdp);
      const cpuB = await procMem(app.pid, this.profileDir); // after the recorder stopped: it does not disturb the frame timings
      const ts = rec.ts, iv = [];
      for (let i = 1; i < ts.length; i++) iv.push(ts[i] - ts[i - 1]);
      const sorted = sortedNum(iv);
      m[`${name}.frames`] = iv.length;
      m[`${name}.p50_ms`] = quantile(sorted, 0.5);
      m[`${name}.p95_ms`] = quantile(sorted, 0.95);
      m[`${name}.max_ms`] = sorted[sorted.length - 1];
      m[`${name}.late`] = iv.filter((x) => x > 1.5 * run.idleFrameMs).length;
      m[`${name}.over50`] = iv.filter((x) => x > 50).length;
      m[`${name}.task_ms`] = (s1.TaskDuration - s0.TaskDuration) * 1000;
      m[`${name}.script_ms`] = (s1.ScriptDuration - s0.ScriptDuration) * 1000;
      m[`${name}.layout_ms`] = (s1.LayoutDuration - s0.LayoutDuration) * 1000;
      m[`${name}.style_ms`] = (s1.RecalcStyleDuration - s0.RecalcStyleDuration) * 1000;
      m[`${name}.layouts`] = s1.LayoutCount - s0.LayoutCount;
      const cpu = cpuDelta(cpuA, cpuB);
      putCpu(m, name, cpu);
      const slow = []; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 50) slow.push({ frame: i, atMs: Math.round(ts[i] - rec.t0), ms: round(ts[i] - ts[i - 1], 1) });
      views[name] = { sentMs: tEnd - t0, startTop, endTop: rec.scrollTop, slowFrames: slow, ...cpuRecord(cpu) };
      return { startTop, endTop: rec.scrollTop };
    };
    // the wheel: 100 px every 33 ms for wheelSec at the centre of an element
    const wheel = async (name, id) => {
      const prep = await cdp.ev(viewPrepExpr(id), 30000);
      expect(prep && prep.vis === 'visible', `#${id} is not on screen for the ${name} scene`);
      prep.id = id;
      const notch = 100, everyMs = 33, events = Math.round((o.wheelSec * 1000) / everyMs);
      const r = await frames(name, prep, async () => {
        const t0 = Date.now(), acks = [];
        for (let k = 0; k < events; k++) {
          const wait = t0 + k * everyMs - Date.now();
          if (wait > 0) await sleep(wait);
          acks.push(cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: prep.x, y: prep.y, deltaX: 0, deltaY: notch, modifiers: 0, pointerType: 'mouse' }, 60000));
        }
        await Promise.all(acks);
      });
      views[name].element = id; views[name].rect = { w: prep.w, h: prep.h }; views[name].events = events;
      expect(r.endTop - r.startTop > notch * events * 0.2, `#${id} barely scrolled in the ${name} scene (${r.endTop - r.startTop} px for ${events * notch} px of wheel)`);
      await sleep(500);
    };
    // the divider: press on it, swing it +-20% of the window's width once a second for dragSec, release
    const drag = async (name, sec) => {
      const pt = await cdp.ev(resizerPointExpr, 10000);
      expect(pt && pt.vis === 'visible', `the divider is not on screen for the ${name} scene`);
      const everyMs = 16, n = Math.round((sec * 1000) / everyMs);
      let ratio0 = null;
      await frames(name, { id: 'editor' }, async () => {
        const ev = (type, x, buttons, extra) => cdp.send('Input.dispatchMouseEvent', { type, x, y: pt.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, pointerType: 'mouse', ...extra }, 60000);
        await ev('mouseMoved', pt.x, 0);
        await ev('mousePressed', pt.x, 1, { clickCount: 1 });
        const t0 = Date.now(), acks = [];
        for (let k = 1; k <= n; k++) {
          const wait = t0 + k * everyMs - Date.now();
          if (wait > 0) await sleep(wait);
          acks.push(ev('mouseMoved', Math.round(pt.x + pt.amp * Math.sin((2 * Math.PI * k * everyMs) / 1000)), 1));
        }
        await Promise.all(acks);
        await ev('mouseReleased', pt.x, 0, { clickCount: 1 });
      });
      views[name].divider = { x: pt.x, width: pt.w, amplitudePx: pt.amp, moves: n, ratioBefore: round(pt.ratio, 3) };
      await sleep(500);
    };
    const memAfter = async (prefix) => {
      const snap = await procMem(app.pid, this.profileDir);
      Object.assign(m, memMetrics(prefix, snap));
    };

    // ---- the note beside its preview (the right page is the paper)
    let r = await setView({ preview: 'side' }, 'side');
    m['view_side.switch_ms'] = r.ms;
    expect(r.dom.secondary && r.dom.secondaryPreview && r.dom.editor && r.dom.resizer, 'the side preview is not on screen (editor + divider + preview expected)');
    await memAfter('mem_side');
    await wheel('side_scroll', 'secondary-preview-pane');
    await wheel('side_editor_scroll', 'editor');
    await drag('side_drag', 2);
    // ---- the preview alone
    r = await setView({ preview: 'full' }, 'preview');
    m['view_preview.switch_ms'] = r.ms;
    expect(r.dom.preview && !r.dom.editor && !r.dom.secondary, 'the preview alone is not on screen');
    await memAfter('mem_preview');
    await wheel('preview_scroll', 'preview-pane');
    // ---- two editors
    await setView({ preview: 'off' }, 'back to one page');
    r = await setView({ split: true }, 'pair');
    expect(r.dom.secondary && r.dom.secondaryEditor && r.dom.editor && r.dom.resizer, 'the two editors are not on screen');
    await drag('pair_drag', 2);
    await setView({ split: false }, 'back to one page');
    views.finalDom = await cdp.ev(viewStateExpr, 10000);
    expect(views.finalDom.editor && !views.finalDom.secondary && !views.finalDom.preview, 'the app did not return to one page');
  }

  // ---- the `panels` step (P5): the 80,000-line note with a floating panel open. Opt-in (--steps ...,panels); runs after the typing and the views so
  // nothing above changes. Each panel is opened with its real shortcut (a keydown with the modifiers the app listens for), then:
  //   panel_<name>.open_ms        from the keydown event to the second frame after the panel is on screen (the first frame it is painted in)
  //   panel_<name>_scroll.*       the wheel over the editor (100 px every 33 ms, --wheel-sec) WITH THE PANEL OPEN: the same recorder as the scroll step.
  //                               Only for the panels that leave the page under them scrollable (ask, command, Quick Actions); the palette and the search
  //                               are modal, a scrim lies over the editor, so for them only the open time is measured.
  // What it is for: a panel's face (a shadow, pseudo-elements, a scrim) must not make the scroll of a huge note slower or open late. Use the same --motion
  // for what you compare (--motion no-preference: the fade-in runs).
  async panelScenes(cdp, run, app, m) {
    const o = this.o;
    const panels = run.panels = { scenes: [] };
    const CTRL = 2, SHIFT = 8;
    const shownJs = (id) => `(function () { var e = document.getElementById('${id}'); return !!e && !e.classList.contains('hidden'); })()`;
    const PANELS = [
      { name: 'ask', key: ['l', 'KeyL', 76, CTRL], shown: shownJs('inline-prompt-bar'), scroll: true },
      { name: 'cli', key: ['e', 'KeyE', 69, CTRL], shown: shownJs('cli-filter-bar'), scroll: true },
      { name: 'jev', key: ['j', 'KeyJ', 74, CTRL], shown: `(function () { var e = document.getElementById('jev-action-panel'); return !!e && !e.classList.contains('hidden') && document.querySelectorAll('.jev-slot-card').length > 0; })()`, scroll: true,
        before: `window.backend.jevPredict = function () { return Promise.resolve({ candidates: [ { command: 'wc -l', action_type: 'sh', label: 'count', confidence: 0.9 }, { command: 'date', action_type: 'sh', label: 'date', confidence: 0.5 } ] }); }; 1` },
      { name: 'palette', key: ['p', 'KeyP', 80, CTRL | SHIFT], shown: shownJs('quick-pick-modal'), scroll: false },
      { name: 'search', key: ['f', 'KeyF', 70, CTRL | SHIFT], shown: shownJs('scraps-search-modal'), scroll: false }
    ];
    const press = async (k, code, vk, modifiers) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers }, 30000);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }, 30000);
    };
    const expect = (cond, what) => { if (!cond) throw new Error(`panels: ${what}`); };
    // the same frame recorder and CPU accounting as the `views` scenes (one wheel burst over `id`)
    const wheelOver = async (name, id) => {
      const prep = await cdp.ev(viewPrepExpr(id), 30000);
      expect(prep && prep.vis === 'visible', `#${id} is not on screen for the ${name} scene`);
      await this.checkMotion(cdp, run, 'before the ' + name + ' scene');
      const tCpuA = Date.now();
      const cpuA = await procMem(app.pid, this.profileDir);
      await sleep(Math.max(300, 1000 - (Date.now() - tCpuA)));
      const s0 = await metricsOf(cdp);
      const startTop = await cdp.ev(sceneStartExpr(id), 10000);
      const notch = 100, everyMs = 33, events = Math.round((o.wheelSec * 1000) / everyMs);
      const t0 = Date.now(), acks = [];
      for (let k = 0; k < events; k++) {
        const wait = t0 + k * everyMs - Date.now();
        if (wait > 0) await sleep(wait);
        acks.push(cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: prep.x, y: prep.y, deltaX: 0, deltaY: notch, modifiers: 0, pointerType: 'mouse' }, 60000));
      }
      await Promise.all(acks);
      const tEnd = Date.now();
      await sleep(300); // the smooth-scroll tail
      const rec = await cdp.ev(sceneStopExpr, 30000);
      const s1 = await metricsOf(cdp);
      const cpuB = await procMem(app.pid, this.profileDir);
      const ts = rec.ts, iv = [];
      for (let i = 1; i < ts.length; i++) iv.push(ts[i] - ts[i - 1]);
      const sorted = sortedNum(iv);
      m[`${name}.frames`] = iv.length;
      m[`${name}.p50_ms`] = quantile(sorted, 0.5);
      m[`${name}.p95_ms`] = quantile(sorted, 0.95);
      m[`${name}.max_ms`] = sorted[sorted.length - 1];
      m[`${name}.late`] = iv.filter((x) => x > 1.5 * run.idleFrameMs).length;
      m[`${name}.over50`] = iv.filter((x) => x > 50).length;
      m[`${name}.task_ms`] = (s1.TaskDuration - s0.TaskDuration) * 1000;
      m[`${name}.script_ms`] = (s1.ScriptDuration - s0.ScriptDuration) * 1000;
      m[`${name}.layout_ms`] = (s1.LayoutDuration - s0.LayoutDuration) * 1000;
      m[`${name}.style_ms`] = (s1.RecalcStyleDuration - s0.RecalcStyleDuration) * 1000;
      m[`${name}.layouts`] = s1.LayoutCount - s0.LayoutCount;
      const cpu = cpuDelta(cpuA, cpuB);
      putCpu(m, name, cpu);
      const slow = []; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 50) slow.push({ frame: i, atMs: Math.round(ts[i] - rec.t0), ms: round(ts[i] - ts[i - 1], 1) });
      panels[name] = { sentMs: tEnd - t0, startTop, endTop: rec.scrollTop, events, slowFrames: slow, ...cpuRecord(cpu) };
      expect(rec.scrollTop - startTop > notch * events * 0.2, `#${id} barely scrolled in the ${name} scene (${rec.scrollTop - startTop} px for ${events * notch} px of wheel)`);
      await sleep(500);
    };

    // the caret in the middle of the note, as the typing step leaves it: a panel opens about a line in the middle of a huge note
    await cdp.ev(`(function () { var e = document.getElementById('editor'); e.focus(); var i = Math.floor(e.value.length / 2); var n = e.value.indexOf('\\n', i); e.setSelectionRange(n < 0 ? i : n, n < 0 ? i : n); return 1; })()`, 30000);
    for (const p of PANELS) {
      if (p.before) await cdp.ev(p.before, 10000);
      await cdp.ev(`window.__panelKeyT = 0; document.addEventListener('keydown', function h(e) { window.__panelKeyT = e.timeStamp; document.removeEventListener('keydown', h, true); }, true); 1`, 10000);
      await press(...p.key);
      const opened = await cdp.ev(`(async function () {
        var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
        var t0 = window.__panelKeyT;
        for (var i = 0; i < 300 && !(${p.shown}); i++) await raf();
        if (!(${p.shown})) return { ok: false };
        await raf(); await raf();
        return { ok: true, ms: performance.now() - t0 };
      })()`, 30000);
      expect(opened && opened.ok, `the ${p.name} panel did not open with its shortcut`);
      m[`panel_${p.name}.open_ms`] = opened.ms;
      panels.scenes.push({ name: p.name, openMs: round(opened.ms, 1) });
      await sleep(o.settleSec * 1000);
      if (p.scroll) await wheelOver(`panel_${p.name}_scroll`, 'editor');
      await press('Escape', 'Escape', 27, 0);
      await sleep(400); // the 0.2 s fade-out
      const closed = await cdp.ev(`!(${p.shown})`, 10000);
      expect(closed, `the ${p.name} panel did not close with Escape`);
      await cdp.ev(`(function () { var e = document.getElementById('editor'); e.focus(); return 1; })()`, 10000);
      await sleep(300);
    }
  }

  // ---- one run: start, measure, stop
  async oneRun(index, { prime = false } = {}) {
    const o = this.o, S = this.steps;
    const run = { index, ok: false, m: {} };
    const m = run.m;
    await this.acquireLock();
    let cdp = null;
    const watchdog = setTimeout(() => { log('watchdog: run took more than 5 min, stopping the app'); this.emergencyCleanup(); }, 5 * 60000);
    try {
      await this.prepareEnv(!prime);
      await this.portFree();
      if (!prime) {
        // let the PC calm down first (other agents run builds and screenshot tools); a run that starts in a busy moment is marked, not hidden
        let ld = await sysLoad(1);
        const tq = Date.now();
        while (ld.systemCpuPct > o.quietPct && Date.now() - tq < o.quietWaitSec * 1000) { await sleep(1000); ld = await sysLoad(1); }
        run.loadBefore = ld;
        run.quietWaitMs = Date.now() - tq;
        run.busyStart = ld.systemCpuPct > o.quietPct;
      }
      const app = this.startApp();
      cdp = await this.connect(app);
      if (!prime) await this.applyMotion(cdp, run); // --motion: right after the session is attached, while the page is still loading
      // ---- startup
      let ready = null;
      for (;;) {
        if (app.exited) throw new Error('the app exited while starting');
        ready = await cdp.ev(READY_EXPR, 10000);
        if (ready) break;
        if (Date.now() - app.t0 > 40000) throw new Error('page not ready after 40 s');
        await sleep(10);
      }
      const cdpReadyAt = Date.now();
      const base = ready.timeOrigin - app.t0;       // process start -> navigation start (Go + WebView2 creation), same wall clock on both sides
      m['startup.nav_ms'] = base;
      m['startup.dcl_ms'] = base + ready.dcl;
      m['startup.fcp_ms'] = ready.fcp == null ? NaN : base + ready.fcp;
      m['startup.ready_ms'] = base + ready.load;    // readyState complete + window.backend: the contract's "operable"
      m['startup.page_ms'] = ready.load;            // navigation start -> ready: the page's own share
      m['startup.seen_ms'] = cdpReadyAt - app.t0;   // when this harness first saw it ready (polled every ~10 ms)
      run.page = { vis: ready.vis, w: ready.w, h: ready.h, dpr: ready.dpr, resources: ready.scripts };
      // the app trims its memory 5 s after the window loses focus (blur) or hides: log those events, a run that saw one is explained by them
      run.page.hasFocus = await cdp.ev(`(function () { window.__fe = []; ['blur', 'focus'].forEach(function (t) { window.addEventListener(t, function () { window.__fe.push([t, Math.round(performance.now())]); }); }); document.addEventListener('visibilitychange', function () { window.__fe.push(['visibility:' + document.visibilityState, Math.round(performance.now())]); }); return document.hasFocus(); })()`, 10000);
      // wait for the app's own init (tab bar drawn) so every run starts the other steps from the same state
      for (let i = 0; i < 200; i++) { if (await cdp.ev(APP_READY_EXPR, 10000)) break; await sleep(50); }
      m['startup.app_ready_ms'] = Date.now() - app.t0;
      if (o.tabs > 0) run.tabs = await cdp.ev(openTabsExpr(o.tabs), 60000); // --tabs: the strip's length is a condition of the idle numbers
      if (o.motion === 'system') run.page.reducedMotion = await cdp.ev(MOTION_QUERY, 10000); // what this PC reports (recorded, nothing changed)
      if (prime) {
        // --browser-args are proven on the priming start, so a flag that does not reach the processes stops the invocation before the first measured run
        if (this.browserArgs.length) await this.verifyBrowserArgs(run, await procMem(app.pid, this.profileDir, true));
        await sleep(3000); run.ok = true; return run;
      }

      if (ready.vis !== 'visible') throw new Error('the page is not visible (document.visibilityState = ' + ready.vis + '): rAF is throttled, nothing can be measured');
      const frames = await cdp.ev(IDLE_FRAMES_EXPR, 10000);
      const iv = []; for (let i = 1; i < frames.length; i++) iv.push(frames[i] - frames[i - 1]);
      run.idleFrameMs = median(iv);
      if (!(run.idleFrameMs < 60)) throw new Error('idle rAF interval ' + run.idleFrameMs + ' ms: frames are throttled (window hidden or minimized?)');

      // ---- idle memory: 10 s after ready (a CPU/load sample in the middle)
      if (S.has('memory') || S.has('open') || S.has('scroll') || S.has('typing') || S.has('views') || S.has('panels')) {
        const waitMs = Math.max(0, o.idleSec * 1000 - (Date.now() - cdpReadyAt));
        const half = Math.min(waitMs, Math.max(0, waitMs - 3500));
        await sleep(half);
        if (waitMs - half > 2500) run.loadIdle = await sysLoad(1);
        await sleep(Math.max(0, o.idleSec * 1000 - (Date.now() - cdpReadyAt)));
        const snap = await procMem(app.pid, this.profileDir, true); // with the command lines: GPU backend flags, and the proof of --browser-args
        const idleCmds = analyseCmds(snap, []);
        run.gpuProcessFlags = idleCmds.gpuFlags; run.rendererGpuFlags = idleCmds.rendererFlags;
        if (this.browserArgs.length) await this.verifyBrowserArgs(run, snap);
        for (const p of snap.processes) delete p.cmd;
        Object.assign(m, memMetrics('mem_idle', snap));
        run.procsIdle = snap.processes;
        run.memByType = { idle: memByType(snap) };
        // CPU: all the time the processes have used since the launch (the cost of starting), then how much they use while nothing happens
        m['cpu.start_total_ms'] = snap.processes.reduce((s, p) => s + p.cpuMs, 0);
        m['cpu.start_gpu_ms'] = snap.processes.filter((p) => typeOf(p) === 'gpu-process').reduce((s, p) => s + p.cpuMs, 0);
        await sleep(o.cpuIdleSec * 1000);
        const snapB = await procMem(app.pid, this.profileDir);
        const prev = new Map(snap.processes.map((p) => [p.pid, p]));
        const idleCpu = (pick) => {
          let ms = 0;
          for (const p of snapB.processes) { const a = prev.get(p.pid); if (a && pick(p)) ms += p.cpuMs - a.cpuMs; }
          return (100 * ms) / (snapB.at - snap.at); // % of one logical processor
        };
        m['cpu.idle_total_pct'] = idleCpu(() => true);
        m['cpu.idle_renderer_pct'] = idleCpu((p) => p.role === 'renderer');
        m['cpu.idle_gpu_pct'] = idleCpu((p) => p.role === 'gpu');
        await cdp.send('Performance.enable');
        const heap = await cdp.send('Runtime.getHeapUsage');
        m['mem_idle.js_heap_mb'] = mb(heap.usedSize);
        const pm = await metricsOf(cdp);
        m['mem_idle.dom_nodes'] = pm.Nodes;
      }
      if (!S.has('open') && !S.has('scroll') && !S.has('typing') && !S.has('views') && !S.has('panels')) { await this.endChecks(cdp, run, app); run.ok = true; return run; }

      // ---- open the 80,000-line note
      const pm0 = await metricsOf(cdp);
      const op = await cdp.ev(openExpr(this.runNote.replace(/\\/g, '/'), 'perf-80k.md'), 120000);
      await sleep(o.settleSec * 1000);
      const pm1 = await metricsOf(cdp);
      if (op.existing) throw new Error('the note was already open');
      if (op.chars !== this.noteInfo.chars) throw new Error(`the editor holds ${op.chars} chars, the note has ${this.noteInfo.chars}`);
      m['open.total_ms'] = op.totalMs; m['open.read_ms'] = op.readMs; m['open.tab_ms'] = op.openTabMs; m['open.frame_ms'] = op.frameMs;
      m['open.task_ms'] = (pm1.TaskDuration - pm0.TaskDuration) * 1000;
      m['open.script_ms'] = (pm1.ScriptDuration - pm0.ScriptDuration) * 1000;
      m['open.layout_ms'] = (pm1.LayoutDuration - pm0.LayoutDuration) * 1000;
      m['open.style_ms'] = (pm1.RecalcStyleDuration - pm0.RecalcStyleDuration) * 1000;
      run.open = { scrollHeight: op.scrollHeight, clientHeight: op.clientHeight, clientWidth: op.clientWidth, encoding: op.encoding, newlines: op.newlines };
      const snap2 = await procMem(app.pid, this.profileDir);
      Object.assign(m, memMetrics('mem_open', snap2));
      run.procsOpen = snap2.processes;
      (run.memByType || (run.memByType = {})).open = memByType(snap2);
      const heap2 = await cdp.send('Runtime.getHeapUsage');
      m['mem_open.js_heap_mb'] = mb(heap2.usedSize);
      m['mem_open.dom_nodes'] = pm1.Nodes;
      // V8's memory reducer runs one major GC ("reduce memory" mode) some 10 to 30 s after the open and its finalisation blocks the main thread for ~400 ms (Oilpan epilogue with
      // 150,000 DOM nodes, found with --trace-scroll). Left alone it lands in a random place of the scroll or typing test, so it is done here, on purpose,
      // before them, and timed as a metric of its own (open.gc_ms: the length of the pause the person would see once).
      const tgc = performance.now();
      await cdp.send('HeapProfiler.collectGarbage', {}, 120000);
      m['open.gc_ms'] = performance.now() - tgc;
      const heap3 = await cdp.send('Runtime.getHeapUsage');
      m['mem_open.js_heap_gc_mb'] = mb(heap3.usedSize);

      // ---- scroll
      if (S.has('scroll')) {
        const prep = await cdp.ev(SCROLL_PREP_EXPR, 30000);
        if (prep.vis !== 'visible') throw new Error('the page is not visible before scrolling');
        await this.checkMotion(cdp, run, 'before the scroll');
        const bars = await this.setupBars(cdp, run, prep);      // --bars-state: 400 ms of waiting for the fade when it changed anything
        const barsStart = await cdp.ev(BARS_STATE_EXPR, 10000);
        this.checkBars(bars, barsStart, 'at the start of the scroll');
        // CPU time of every process (one PowerShell read) just before the first wheel event: before the frame recorder starts, with a settle after it
        const tCpuA = Date.now();
        const cpuA = await procMem(app.pid, this.profileDir);
        await sleep(Math.max(300, 1000 - (Date.now() - tCpuA))); // (the 1 s this step always waited after the preparation, and at least 300 ms after the PowerShell call)
        const s0 = await metricsOf(cdp);
        let trace = null;
        if (o.traceScroll) { trace = []; cdp.on('Tracing.dataCollected', (p) => { for (const e of p.value) trace.push(e); }); await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8,blink,cc,toplevel' }); }
        const startTop = await cdp.ev(SCROLL_START_EXPR, 10000);
        const t0 = Date.now();
        const notch = 100, everyMs = 33, events = Math.round((o.wheelSec * 1000) / everyMs);
        const acks = [];
        for (let k = 0; k < events; k++) {
          const wait = t0 + k * everyMs - Date.now();
          if (wait > 0) await sleep(wait);
          acks.push(cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: prep.x, y: prep.y, deltaX: 0, deltaY: notch, modifiers: 0, pointerType: 'mouse' }, 60000));
        }
        await Promise.all(acks);
        const tEnd = Date.now();
        await sleep(300); // the smooth-scroll tail
        const rec = await cdp.ev(SCROLL_STOP_EXPR, 30000);
        const s1 = await metricsOf(cdp);
        const barsEnd = await cdp.ev(BARS_STATE_EXPR, 10000);
        const cpuB = await procMem(app.pid, this.profileDir); // after the frame recorder has stopped: it does not disturb the frame timings
        if (bars.was && typeof bars.was.enabled === 'boolean') await cdp.ev(barsRestoreExpr(bars.was.enabled), 10000);
        if (trace) {
          const done = new Promise((res) => cdp.on('Tracing.tracingComplete', res));
          await cdp.send('Tracing.end');
          await done;
          const file = o.traceScroll.replace(/(\.json)?$/, `-run${index}.json`);
          fs.writeFileSync(file, JSON.stringify(trace));
          const slow = trace.filter((e) => e.ph === 'X' && e.dur > 80000).sort((a, b) => b.dur - a.dur).slice(0, 12);
          log(`trace of the scroll written to ${file}; events over 80 ms:`);
          for (const e of slow) log(`  ${Math.round(e.dur / 1000)} ms ${e.name} (pid ${e.pid} tid ${e.tid}) ${JSON.stringify(e.args && (e.args.data || e.args)).slice(0, 200)}`);
        }
        const ts = rec.ts;
        const intervals = []; for (let i = 1; i < ts.length; i++) intervals.push(ts[i] - ts[i - 1]);
        const sorted = sortedNum(intervals);
        m['scroll.frames'] = intervals.length;
        m['scroll.p50_ms'] = quantile(sorted, 0.5);
        m['scroll.p95_ms'] = quantile(sorted, 0.95);
        m['scroll.max_ms'] = sorted[sorted.length - 1];
        m['scroll.over17'] = intervals.filter((x) => x > 17).length;
        m['scroll.late'] = intervals.filter((x) => x > 1.5 * run.idleFrameMs).length; // a skipped vsync: the contract's 17 ms is below this display's own frame period
        m['scroll.over50'] = intervals.filter((x) => x > 50).length;
        m['scroll.task_ms'] = (s1.TaskDuration - s0.TaskDuration) * 1000;
        m['scroll.script_ms'] = (s1.ScriptDuration - s0.ScriptDuration) * 1000;
        m['scroll.layout_ms'] = (s1.LayoutDuration - s0.LayoutDuration) * 1000;
        m['scroll.style_ms'] = (s1.RecalcStyleDuration - s0.RecalcStyleDuration) * 1000;
        m['scroll.layouts'] = s1.LayoutCount - s0.LayoutCount;
        m['scroll.style_recalcs'] = s1.RecalcStyleCount - s0.RecalcStyleCount;
        const slow = []; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 50) slow.push({ frame: i, atMs: Math.round(ts[i] - rec.t0), ms: round(ts[i] - ts[i - 1], 1) });
        run.focusEvents = await cdp.ev('({ now: Math.round(performance.now()), hasFocus: document.hasFocus(), events: window.__fe })', 10000);
        const cpuS = cpuDelta(cpuA, cpuB);
        putCpu(m, 'scroll', cpuS);
        run.scroll = { events, notchPx: notch, everyMs, sentMs: tEnd - t0, scrolledPx: rec.scrollTop - startTop, startTop, endTop: rec.scrollTop, slowFrames: slow, longAnimationFrames: rec.loaf, loafError: rec.loafError,
          ...cpuRecord(cpuS), bars: { ...bars, start: barsStart, end: barsEnd } };
        this.checkBars(bars, barsEnd, 'at the end of the scroll');
        if (!(rec.scrollTop - startTop > notch * events * 0.2)) throw new Error(`the note barely scrolled (${rec.scrollTop - startTop} px for ${events * notch} px of wheel)`);
        await sleep(500);
      }

      // ---- typing in the middle of the note
      if (S.has('typing')) {
        const prep = await cdp.ev(TYPING_PREP_EXPR, 60000);
        if (!prep.active) throw new Error('the editor did not take the focus');
        const tCpuT = Date.now();
        const cpuT0 = await procMem(app.pid, this.profileDir); // CPU time of every process before the first key
        await sleep(Math.max(300, 1500 - (Date.now() - tCpuT)));
        const k0 = await metricsOf(cdp);
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        const gapMs = 150;
        for (let i = 0; i < o.keys; i++) {
          const ch = letters[i % letters.length];
          const code = 'Key' + ch.toUpperCase();
          const vk = ch.toUpperCase().charCodeAt(0);
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, 30000);
          await cdp.ev(`window.__typing.wait(${i + 1})`, 30000);
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, 30000);
          await sleep(gapMs);
        }
        const k1 = await metricsOf(cdp);
        const done = await cdp.ev(TYPING_DONE_EXPR, 30000);
        const cpuT1 = await procMem(app.pid, this.profileDir);  // after the last key, the same way
        const cpuTy = cpuDelta(cpuT0, cpuT1);
        putCpu(m, 'typing', cpuTy);
        if (done.chars !== prep.chars + o.keys) throw new Error(`typed ${o.keys} characters but the note grew by ${done.chars - prep.chars}`);
        const lat = sortedNum(done.lat);
        m['typing.p50_ms'] = quantile(lat, 0.5);
        m['typing.p95_ms'] = quantile(lat, 0.95);
        m['typing.max_ms'] = lat[lat.length - 1];
        m['typing.mean_ms'] = lat.reduce((s, x) => s + x, 0) / lat.length;
        m['typing.queue_p95_ms'] = quantile(sortedNum(done.delay), 0.95);
        m['typing.task_ms_per_key'] = ((k1.TaskDuration - k0.TaskDuration) * 1000) / o.keys;
        m['typing.layout_ms_per_key'] = ((k1.LayoutDuration - k0.LayoutDuration) * 1000) / o.keys;
        run.typing = { keys: o.keys, gapMs, fallbackTimestamps: done.fallback, latMs: done.lat.map((x) => round(x, 1)), queueMs: done.delay.map((x) => round(x, 1)), line: prep.line, ...cpuRecord(cpuTy) };
      }
      if (S.has('views')) await this.viewScenes(cdp, run, app, m);
      if (S.has('panels')) await this.panelScenes(cdp, run, app, m);
      await this.endChecks(cdp, run, app);
      run.ok = true;
      return run;
    } catch (e) {
      run.error = String((e && e.stack) || e).split('\n').slice(0, 4).join(' | ');
      log(`run ${index} FAILED: ${run.error}`);
      return run;
    } finally {
      clearTimeout(watchdog);
      if (run.ok && !prime) { try { run.loadEnd = await sysLoad(1); } catch (e) { /* the sample is a bonus */ } } // the app is idle again: a third look at what else the PC is doing
      if (cdp) cdp.close();
      try { await this.stopApp(); } catch (e) { run.cleanupError = String(e.message || e); log('cleanup problem: ' + run.cleanupError); }
      this.releaseLock();
    }
  }

  // ---- the whole invocation
  // one invocation at a time per work folder (two would clobber the same private data folder)
  acquireWorkLock() {
    fs.mkdirSync(this.work, { recursive: true });
    const f = path.join(this.work, 'invocation.lock');
    if (fs.existsSync(f)) {
      const pid = Number(fs.readFileSync(f, 'utf8').trim());
      if (pid && pidAlive(pid)) throw new Error(`another v2_perf invocation (pid ${pid}) is using ${this.work}`);
    }
    fs.writeFileSync(f, String(process.pid));
    this.workLock = f;
  }
  releaseWorkLock() {
    if (!this.workLock) return;
    try { fs.rmSync(this.workLock, { force: true }); } catch (e) { /* gone */ }
    this.workLock = null;
  }

  async execute() {
    const o = this.o;
    this.acquireWorkLock();
    this.resolveExe();
    this.prepareNote();
    log(`exe ${this.exe.name} (${(this.exe.bytes / 1048576).toFixed(1)} MB, sha256 ${this.exe.sha256.slice(0, 12)}); note ${this.noteInfo.lines} lines, ${this.noteInfo.chars} chars; ${o.runs} runs; work ${this.work}`);
    const startedAt = new Date();
    const machine = await sysLoad(1, true);
    // prime: one start with an empty profile, then keep that profile as the seed every measured run begins from (a warm profile, the same for every run)
    log('priming the WebView2 profile (not measured)...');
    await this.rmRetry(path.join(this.root, 'wv-seed'));
    const prime = await this.oneRun(0, { prime: true });
    if (!prime.ok) throw new Error('the priming start failed: ' + prime.error);
    fs.cpSync(path.join(this.root, 'wv'), path.join(this.root, 'wv-seed'), { recursive: true });
    const runs = [], discarded = [];
    let failStreak = 0;
    while (runs.length < o.runs) {
      const i = runs.length + 1;
      log(`run ${i}/${o.runs}${discarded.length ? ` (${discarded.length} discarded so far)` : ''}...`);
      const r = await this.oneRun(i);
      // A run is only comparable when the PC was quiet: system CPU at the three looks (before the start, while idle, after the typing)
      const loads = [r.loadBefore, r.loadIdle, r.loadEnd].filter(Boolean).map((l) => l.systemCpuPct);
      r.hostCpuMax = loads.length ? Math.max(...loads) : null;
      r.noisy = r.ok && r.hostCpuMax != null && r.hostCpuMax > o.quietPct;
      const sum = ['startup.ready_ms', 'mem_idle.total_ws_mb', 'open.total_ms', 'scroll.p95_ms', 'typing.p50_ms'].map((k) => (r.m[k] != null ? `${k.split('.')[1]}=${round(r.m[k], 1)}` : null)).filter(Boolean).join(' ');
      log(`run ${i} ${r.ok ? 'ok' : 'FAILED'}${r.noisy ? ` (PC busy: system CPU ${r.hostCpuMax}% at one look)` : ''} ${sum}`);
      if (r.noisy && discarded.length < o.maxRetries) { discarded.push(r); log('discarded, repeating this run'); continue; }
      runs.push(r);
      failStreak = r.ok ? 0 : failStreak + 1;
      if (failStreak >= 3) { log('three failures in a row: giving up'); break; }
      if (r.cleanupError) { log('cannot continue safely after a cleanup problem'); break; }
    }
    const loadAfter = await sysLoad(1);
    return {
      tool: 'v2_perf', version: TOOL_VERSION, label: o.label || '', startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      exe: this.exe, note: this.noteInfo, options: { runs: o.runs, idleSec: o.idleSec, cpuIdleSec: o.cpuIdleSec, quietPct: o.quietPct, quietWaitSec: o.quietWaitSec, maxRetries: o.maxRetries, settleSec: o.settleSec, steps: [...this.steps], keys: o.keys, wheelSec: o.wheelSec },
      conditions: { machine: machine.machine, node: process.version, hostLoadBefore: { systemCpuPct: machine.systemCpuPct, top: machine.top }, hostLoadAfter: { systemCpuPct: loadAfter.systemCpuPct, top: loadAfter.top },
        appConfig: this.configJson(), appNotes: 'APPDATA and LOCALAPPDATA point at a private folder; a fresh copy of a primed WebView2 profile for every run; the test exe is started with a file name that does not exist',
        // what this invocation changed on purpose (null / system / natural = nothing)
        configPatch: o.configPatchParsed ? o.configPatchParsed.text : null,
        browserArgs: o.browserArgTokens ? o.browserArgTokens.join(' ') : null,
        browserArgsVia: o.browserArgTokens ? Object.fromEntries(o.browserArgTokens.map((t) => [t, PROFILE_PREF_FLAGS.has(t) ? 'profile pref (Local State hardware_acceleration_mode.enabled=false)' : 'MDM_E2E_BROWSER_ARGS (needs overlay support)'])) : null,
        motion: o.motion, barsState: o.barsState, tabs: o.tabs },
      runs, discarded, failures: runs.filter((r) => !r.ok).length,
      summary: summarize(runs),
    };
  }
}

// ------------------------------------------------------------------------------------------------------------- metrics table
// CPU time per process type over a step (scroll / typing): milliseconds and % of one logical processor. The ms rows have a 100 ms minimum step because
// hand measurements of the GPU process' CPU time were +-100 ms apart from one identical run to the next (the OS counts it in 15.6 ms ticks, and the
// window is a PowerShell round trip long on each side); the % rows carry the same 100 ms spread over the window of that step.
const CPU_TYPE_LABEL = { 'gpu-process': 'GPU process', renderer: 'renderer (the page)', browser: 'WebView2 browser process', utility: 'utility (network, storage)', app: 'app (Go)' };
function cpuRows(step, area, what, minPct) {
  const rows = [[`${step}.cpu_ms_total`, area, `CPU time of the app + its WebView2 processes, ${what}`, 'ms', true, 100]];
  for (const t of CPU_TYPES) rows.push([`${step}.cpu_ms_by_type.${t}`, area, `... ${CPU_TYPE_LABEL[t]}`, 'ms', true, 100]);
  rows.push([`${step}.cpu_pct_total`, area, '... all, as % of one logical processor over that window', '%', true, minPct]);
  for (const t of CPU_TYPES) rows.push([`${step}.cpu_pct_by_type.${t}`, area, `... ${CPU_TYPE_LABEL[t]}, % of one logical processor`, '%', true, minPct]);
  return rows;
}

// The rows of one scene of the `views` step (frame intervals, main-thread busy time, CPU time of the page and of the GPU process).
function sceneRows(name, area) {
  return [
    [`${name}.p50_ms`, area, 'Frame interval p50 (requestAnimationFrame)', 'ms', true, 1],
    [`${name}.p95_ms`, area, 'Frame interval p95', 'ms', true, 2],
    [`${name}.max_ms`, area, 'Frame interval max', 'ms', true, 10],
    [`${name}.late`, area, 'Late frames: longer than 1.5 x the idle frame interval (a skipped vsync)', '', true, 3],
    [`${name}.over50`, area, 'Frames longer than 50 ms', '', true, 2],
    [`${name}.frames`, area, 'Frames produced', '', false, 10],
    [`${name}.task_ms`, area, 'Main-thread busy time (Performance.getMetrics delta)', 'ms', true, 20],
    [`${name}.layout_ms`, area, '... of which layout', 'ms', true, 10],
    [`${name}.style_ms`, area, '... of which style recalculation', 'ms', true, 5],
    [`${name}.layouts`, area, 'Layouts', '', true, 5],
    [`${name}.cpu_ms_total`, area, 'CPU time of the app + its WebView2 processes during the scene', 'ms', true, 100],
    [`${name}.cpu_ms_by_type.renderer`, area, '... renderer (the page)', 'ms', true, 100],
    [`${name}.cpu_ms_by_type.gpu-process`, area, '... GPU process', 'ms', true, 100],
  ];
}

// name -> [area, label, unit, lowerIsBetter, minimum change worth mentioning]
const METRICS = [
  ['startup.ready_ms', 'Startup', 'Process start to ready (readyState complete + window.backend)', 'ms', true, 20],
  ['startup.nav_ms', 'Startup', '... of which: process start to the page navigation (Go + WebView2 creation)', 'ms', true, 20],
  ['startup.page_ms', 'Startup', '... of which: navigation to ready (the page itself)', 'ms', true, 15],
  ['startup.fcp_ms', 'Startup', 'First contentful paint (from process start)', 'ms', true, 20],
  ['startup.dcl_ms', 'Startup', 'DOMContentLoaded (from process start)', 'ms', true, 20],
  ['startup.app_ready_ms', 'Startup', 'App initialised (tab bar drawn, from process start)', 'ms', true, 20],
  ['mem_idle.total_ws_mb', 'Memory, idle 10 s after ready', 'Working set, app + its WebView2 processes', 'MB', true, 5],
  ['mem_idle.total_pws_mb', 'Memory, idle 10 s after ready', 'Private working set, same processes', 'MB', true, 5],
  ['mem_idle.total_commit_mb', 'Memory, idle 10 s after ready', 'Private bytes (committed), same processes', 'MB', true, 5],
  ['mem_idle.app_ws_mb', 'Memory, idle 10 s after ready', '... app (Go) working set', 'MB', true, 2],
  ['mem_idle.browser_ws_mb', 'Memory, idle 10 s after ready', '... WebView2 browser process', 'MB', true, 3],
  ['mem_idle.renderer_ws_mb', 'Memory, idle 10 s after ready', '... renderer (the page)', 'MB', true, 3],
  ['mem_idle.renderer_pws_mb', 'Memory, idle 10 s after ready', '... renderer private working set', 'MB', true, 3],
  ['mem_idle.gpu_ws_mb', 'Memory, idle 10 s after ready', '... GPU process', 'MB', true, 3],
  ['mem_idle.utility_ws_mb', 'Memory, idle 10 s after ready', '... utility (network, storage)', 'MB', true, 3],
  ['mem_idle.crashpad_ws_mb', 'Memory, idle 10 s after ready', '... crashpad handler', 'MB', true, 2],
  ['mem_idle.gpu_pws_mb', 'Memory, idle 10 s after ready', 'GPU process, private working set (where a translucent bar\'s intermediate surfaces would show)', 'MB', true, 3],
  ['mem_idle.browser_pws_mb', 'Memory, idle 10 s after ready', '... WebView2 browser process, private working set', 'MB', true, 3],
  ['mem_idle.utility_pws_mb', 'Memory, idle 10 s after ready', '... utility (network, storage), private working set', 'MB', true, 3],
  ['mem_idle.app_pws_mb', 'Memory, idle 10 s after ready', '... app (Go), private working set', 'MB', true, 2],
  ['mem_idle.crashpad_pws_mb', 'Memory, idle 10 s after ready', '... crashpad handler, private working set', 'MB', true, 2],
  ['mem_idle.processes', 'Memory, idle 10 s after ready', 'Process count', '', true, 1],
  ['mem_idle.js_heap_mb', 'Memory, idle 10 s after ready', 'JS heap in use (renderer)', 'MB', true, 1],
  ['mem_idle.dom_nodes', 'Memory, idle 10 s after ready', 'DOM nodes', '', true, 50],
  ['cpu.start_total_ms', 'CPU time (app + its WebView2 processes)', 'CPU time used from the launch until 10 s after ready (the cost of starting, all processes)', 'ms', true, 100],
  ['cpu.start_gpu_ms', 'CPU time (app + its WebView2 processes)', '... of which the GPU process', 'ms', true, 100],
  ['cpu.idle_total_pct', 'CPU time (app + its WebView2 processes)', 'Idle CPU over 10 s, nothing happening (% of one logical processor; the OS counts CPU time in 15.6 ms ticks)', '%', true, 0.3],
  ['cpu.idle_renderer_pct', 'CPU time (app + its WebView2 processes)', '... renderer', '%', true, 0.2],
  ['cpu.idle_gpu_pct', 'CPU time (app + its WebView2 processes)', '... GPU process', '%', true, 0.2],
  ['open.total_ms', '80,000-line note: open', 'Read the file + open the tab + first two frames', 'ms', true, 100],
  ['open.read_ms', '80,000-line note: open', '... backend.readFileByPath (Go read + decode + transfer)', 'ms', true, 30],
  ['open.tab_ms', '80,000-line note: open', '... openTab (synchronous JS: tab, textarea value, gutter, status bar)', 'ms', true, 30],
  ['open.frame_ms', '80,000-line note: open', '... until the second frame after it (layout + paint)', 'ms', true, 50],
  ['open.task_ms', '80,000-line note: open', 'Main-thread busy time, from the open until 3 s later', 'ms', true, 100],
  ['open.script_ms', '80,000-line note: open', '... of which script', 'ms', true, 50],
  ['open.layout_ms', '80,000-line note: open', '... of which layout', 'ms', true, 50],
  ['open.style_ms', '80,000-line note: open', '... of which style recalculation', 'ms', true, 20],
  ['open.gc_ms', '80,000-line note: open', 'A full garbage collection with the note open (V8 does one by itself 10-30 s after the open; the page stops this long)', 'ms', true, 50],
  ['mem_open.total_ws_mb', '80,000-line note: memory 3 s after opening', 'Working set, app + its WebView2 processes', 'MB', true, 10],
  ['mem_open.total_pws_mb', '80,000-line note: memory 3 s after opening', 'Private working set, same processes', 'MB', true, 10],
  ['mem_open.total_commit_mb', '80,000-line note: memory 3 s after opening', 'Private bytes (committed), same processes', 'MB', true, 10],
  ['mem_open.app_ws_mb', '80,000-line note: memory 3 s after opening', '... app (Go) working set', 'MB', true, 5],
  ['mem_open.browser_ws_mb', '80,000-line note: memory 3 s after opening', '... WebView2 browser process', 'MB', true, 5],
  ['mem_open.renderer_ws_mb', '80,000-line note: memory 3 s after opening', '... renderer (the page)', 'MB', true, 10],
  ['mem_open.renderer_pws_mb', '80,000-line note: memory 3 s after opening', '... renderer private working set', 'MB', true, 10],
  ['mem_open.gpu_ws_mb', '80,000-line note: memory 3 s after opening', '... GPU process', 'MB', true, 5],
  ['mem_open.gpu_pws_mb', '80,000-line note: memory 3 s after opening', '... GPU process, private working set', 'MB', true, 5],
  ['mem_open.browser_pws_mb', '80,000-line note: memory 3 s after opening', '... WebView2 browser process, private working set', 'MB', true, 5],
  ['mem_open.utility_pws_mb', '80,000-line note: memory 3 s after opening', '... utility (network, storage), private working set', 'MB', true, 5],
  ['mem_open.app_pws_mb', '80,000-line note: memory 3 s after opening', '... app (Go), private working set', 'MB', true, 5],
  ['mem_open.crashpad_pws_mb', '80,000-line note: memory 3 s after opening', '... crashpad handler, private working set', 'MB', true, 2],
  ['mem_open.js_heap_mb', '80,000-line note: memory 3 s after opening', 'JS heap in use (renderer)', 'MB', true, 5],
  ['mem_open.js_heap_gc_mb', '80,000-line note: memory 3 s after opening', 'JS heap in use after that full GC (what is really retained)', 'MB', true, 2],
  ['mem_open.dom_nodes', '80,000-line note: memory 3 s after opening', 'DOM nodes', '', true, 100],
  ['scroll.p50_ms', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'Frame interval p50 (requestAnimationFrame)', 'ms', true, 1],
  ['scroll.p95_ms', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'Frame interval p95', 'ms', true, 2],
  ['scroll.max_ms', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'Frame interval max', 'ms', true, 10],
  ['scroll.over17', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'Frames longer than 17 ms (as agreed; every frame when the display frame period is above 17 ms)', '', true, 5],
  ['scroll.late', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'Late frames: longer than 1.5 x the idle frame interval (a skipped vsync)', '', true, 3],
  ['scroll.over50', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'Frames longer than 50 ms', '', true, 2],
  ['scroll.frames', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'Frames produced', '', false, 10],
  ['scroll.task_ms', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'Main-thread busy time (Performance.getMetrics delta)', 'ms', true, 20],
  ['scroll.script_ms', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', '... of which script', 'ms', true, 10],
  ['scroll.layout_ms', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', '... of which layout', 'ms', true, 10],
  ['scroll.style_ms', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', '... of which style recalculation', 'ms', true, 5],
  ['scroll.layouts', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'Layouts', '', true, 5],
  ...cpuRows('scroll', '80,000-line note: scrolling (wheel, 100 px every 33 ms, 4 s)', 'from just before the first wheel event to just after the frame recorder stopped (about 5 s)', 2),
  ['typing.p50_ms', '80,000-line note: typing 50 keys in the middle', 'Key press to the end of the next frame, p50', 'ms', true, 8],
  ['typing.p95_ms', '80,000-line note: typing 50 keys in the middle', '... p95', 'ms', true, 10],
  ['typing.max_ms', '80,000-line note: typing 50 keys in the middle', '... max', 'ms', true, 20],
  ['typing.mean_ms', '80,000-line note: typing 50 keys in the middle', '... mean', 'ms', true, 8],
  ['typing.queue_p95_ms', '80,000-line note: typing 50 keys in the middle', 'Key press to the key handler (main thread busy), p95', 'ms', true, 10],
  ['typing.task_ms_per_key', '80,000-line note: typing 50 keys in the middle', 'Main-thread busy time per key', 'ms', true, 8],
  ['typing.layout_ms_per_key', '80,000-line note: typing 50 keys in the middle', '... of which layout', 'ms', true, 5],
  ...cpuRows('typing', '80,000-line note: typing 50 keys in the middle', 'over the whole typing step (before the first key to after the last one, about 16 s)', 0.7),
  // ---- the `views` step (opt-in): the four displays
  ['view_side.switch_ms', 'Displays: switching with the 80,000-line note (setUiState to the second frame after it)', 'Editor -> note beside its preview', 'ms', true, 200],
  ['view_preview.switch_ms', 'Displays: switching with the 80,000-line note (setUiState to the second frame after it)', 'Side preview -> preview alone', 'ms', true, 200],
  ['mem_side.total_ws_mb', 'Displays: memory 3 s after the switch', 'Note beside its preview: working set, app + its WebView2 processes', 'MB', true, 15],
  ['mem_side.renderer_ws_mb', 'Displays: memory 3 s after the switch', '... renderer', 'MB', true, 15],
  ['mem_side.gpu_ws_mb', 'Displays: memory 3 s after the switch', '... GPU process', 'MB', true, 8],
  ['mem_preview.total_ws_mb', 'Displays: memory 3 s after the switch', 'Preview alone: working set, app + its WebView2 processes', 'MB', true, 15],
  ['mem_preview.renderer_ws_mb', 'Displays: memory 3 s after the switch', '... renderer', 'MB', true, 15],
  ['mem_preview.gpu_ws_mb', 'Displays: memory 3 s after the switch', '... GPU process', 'MB', true, 8],
  ...sceneRows('side_scroll', 'Displays: wheel over the side preview (the right page), 100 px every 33 ms, 4 s'),
  ...sceneRows('side_editor_scroll', 'Displays: wheel over the editor beside the preview (the preview follows), 4 s'),
  ...sceneRows('side_drag', 'Displays: dragging the divider to and fro for 2 s, editor + side preview'),
  ...sceneRows('preview_scroll', 'Displays: wheel over the preview alone, 100 px every 33 ms, 4 s'),
  ...sceneRows('pair_drag', 'Displays: dragging the divider to and fro for 2 s, two editors'),
  // ---- the `panels` step (opt-in): floating panels over the 80,000-line note
  ['panel_ask.open_ms', 'Panels: opening with the 80,000-line note (keydown to the second frame after the panel is on screen)', 'Ask / rewrite bar (Ctrl+L)', 'ms', true, 15],
  ['panel_cli.open_ms', 'Panels: opening with the 80,000-line note (keydown to the second frame after the panel is on screen)', 'Command bar (Ctrl+E)', 'ms', true, 15],
  ['panel_jev.open_ms', 'Panels: opening with the 80,000-line note (keydown to the second frame after the panel is on screen)', 'Quick Actions panel (Ctrl+J, with canned candidates)', 'ms', true, 15],
  ['panel_palette.open_ms', 'Panels: opening with the 80,000-line note (keydown to the second frame after the panel is on screen)', 'Command palette (Ctrl+Shift+P, a scrim over the whole window)', 'ms', true, 15],
  ['panel_search.open_ms', 'Panels: opening with the 80,000-line note (keydown to the second frame after the panel is on screen)', 'Notes search (Ctrl+Shift+F, a scrim over the whole window)', 'ms', true, 15],
  ...sceneRows('panel_ask_scroll', 'Panels: wheel over the editor with the ask bar open, 100 px every 33 ms, 4 s'),
  ...sceneRows('panel_cli_scroll', 'Panels: wheel over the editor with the command bar open, 4 s'),
  ...sceneRows('panel_jev_scroll', 'Panels: wheel over the editor with the Quick Actions panel open, 4 s'),
];
const METRIC_INDEX = new Map(METRICS.map((x) => [x[0], x]));

function summarize(runs) {
  const ok = runs.filter((r) => r.ok);
  const out = {};
  const names = new Set();
  for (const r of ok) for (const k of Object.keys(r.m)) names.add(k);
  for (const k of names) {
    const vals = ok.map((r) => r.m[k]).filter((x) => Number.isFinite(x));
    if (!vals.length) continue;
    const s = sortedNum(vals);
    const meta = METRIC_INDEX.get(k);
    out[k] = { unit: meta ? meta[3] : '', lowerIsBetter: meta ? meta[4] : true, n: s.length, median: median(s), min: s[0], max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length, values: vals };
  }
  return out;
}

const fmt = (x, unit) => {
  if (x == null || !Number.isFinite(x)) return 'n/a';
  const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
  return Number(x.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d }) + (unit ? ' ' + unit : '');
};

function markdownTable(res) {
  const L = [];
  const e = res.exe;
  L.push(`### v2_perf: ${e.name}${res.label ? ' (' + res.label + ')' : ''}`);
  L.push('');
  L.push(`- ${res.startedAt} - ${res.finishedAt}; ${res.runs.filter((r) => r.ok).length} of ${res.runs.length} runs ok${res.invocations ? ` (pooled from ${res.invocations.length} invocations)` : ''}; exe ${(e.bytes / 1048576).toFixed(1)} MB, sha256 ${e.sha256.slice(0, 16)}`);
  const n = res.note;
  L.push(`- Note: ${n.lines.toLocaleString('en-US')} lines, ${n.chars.toLocaleString('en-US')} characters, ${(n.bytes / 1048576).toFixed(1)} MB, sha256 ${n.sha256.slice(0, 16)}${n.generator ? ` (generator ${n.generator}, seed ${n.seed})` : ''}`);
  const c = res.conditions;
  if (c && c.machine) L.push(`- Machine: ${c.machine.model}, ${c.machine.cpu}, ${c.machine.ramGB} GB RAM, ${c.machine.os}; power: ${c.machine.battery}; ${c.machine.powerPlan}`);
  if (c && c.configPatch) L.push(`- Config patch: \`${c.configPatch}\``);
  if (c && c.tabs) L.push(`- Tabs: ${c.tabs} on the strip before the measurement (${res.runs.map((r) => r.tabs).filter((x) => x != null).join(', ')} counted)`);
  if (c && c.browserArgs) L.push(`- Browser args: \`${c.browserArgs}\` (via ${Object.values(c.browserArgsVia || {}).filter((v, i, a) => a.indexOf(v) === i).join('; ')})`);
  if (c && c.motion && c.motion !== 'system') L.push(`- Motion: prefers-reduced-motion emulated as \`${c.motion}\` (this PC's own setting: ${res.runs.map((r) => r.motion && r.motion.systemReduce).filter((x) => x != null).some(Boolean) ? 'reduce' : 'no reduce'})`);
  if (c && c.barsState && c.barsState !== 'natural') {
    const un = res.runs.some((r) => r.scroll && r.scroll.bars && r.scroll.bars.unsupported);
    L.push(`- Bars state (scroll step): \`${c.barsState}\`${un ? ' - NOT SUPPORTED by this exe (no ChromeOverlay): measured as natural' : ''}`);
  }
  const gpuf = [...new Set(res.runs.map((r) => r.gpuProcessFlags && r.gpuProcessFlags.join(' ')).filter((x) => x != null))];
  if (gpuf.length) L.push(`- GPU process backend flags: ${gpuf.map((x) => '`' + (x || '(none: default hardware path)') + '`').join(', ')}`);
  const idleFrames = res.runs.map((r) => r.idleFrameMs).filter(Number.isFinite);
  const pre = res.runs.map((r) => r.loadBefore && r.loadBefore.systemCpuPct).filter(Number.isFinite);
  if (idleFrames.length) L.push(`- Idle frame interval ${fmt(median(idleFrames), 'ms')} (display refresh); system CPU before each run: median ${fmt(median(pre), '%')}, max ${fmt(Math.max(...pre), '%')}`);
  const q = res.options.quietPct == null ? 10 : res.options.quietPct;
  const nd = (res.discarded || []).length, nn = res.runs.filter((r) => r.noisy).length;
  if (nd) L.push(`- ${nd} run(s) were discarded and repeated because the PC was busy (system CPU over ${q}% at one of three looks: before the start, while idle, after the typing); they are listed under \`discarded\` in the JSON`);
  if (nn) L.push(`- ${nn} kept run(s) were taken while the PC was busy anyway (the retry limit was reached): marked \`noisy\` in the JSON`);
  L.push('');
  let area = '';
  for (const [k, a, label, unit] of METRICS) {
    const s = res.summary[k];
    if (!s) continue;
    if (a !== area) {
      if (area) L.push('');
      L.push(`**${a}**`, '', '| Metric | Median | Min | Max | Spread (max-min)/median |' + (res.invocations ? ' Invocation medians | Between invocations |' : ''), '|---|---:|---:|---:|---:|' + (res.invocations ? '---:|---:|' : ''));
      area = a;
    }
    const spread = s.median ? ((s.max - s.min) / Math.abs(s.median)) * 100 : 0;
    let extra = '';
    if (res.invocations) {
      const meds = res.invocations.map((v) => v.summary && v.summary[k] && v.summary[k].median);
      const bt = res.between && res.between[k];
      extra = ` ${meds.map((x) => fmt(x)).join(' / ')} | ${bt ? bt.differencePct.toFixed(1) + '%' : 'n/a'} |`;
    }
    L.push(`| ${label} | ${fmt(s.median, unit)} | ${fmt(s.min, unit)} | ${fmt(s.max, unit)} | ${spread.toFixed(0)}% |${extra}`);
  }
  return L.join('\n');
}

// -------------------------------------------------------------------------------------------------------------- compare
function verdict(meta, b, n) {
  const lower = meta ? meta[4] : true, minAbs = meta ? meta[5] : 0;
  const d = n.median - b.median;
  const outsideHigh = n.median > b.max, outsideLow = n.median < b.min;
  if (Math.abs(d) < minAbs || (!outsideHigh && !outsideLow)) return 'within baseline range';
  const worse = lower ? outsideHigh : outsideLow;
  return worse ? 'WORSE' : 'better';
}
function compareTable(base, cur, baseName, curName) {
  const L = [];
  L.push(`### Compare: ${curName} against ${baseName}`, '');
  L.push('A change counts only when the new median is outside the baseline\'s min-max range and larger than the metric\'s minimum step. The spread of the baseline is its run-to-run noise.', '');
  // what the two were measured with: a difference here is a condition, not a regression (results made before these options existed count as system / natural / nothing)
  const cond = (r) => { const c = (r && r.conditions) || {}; return { 'config patch': c.configPatch || '(none)', 'browser args': c.browserArgs || '(none)', motion: c.motion || 'system', 'bars state': c.barsState || 'natural', tabs: String(c.tabs || 0) }; };
  const cb = cond(base), cc = cond(cur);
  const diffs = Object.keys(cb).filter((k) => cb[k] !== cc[k]).map((k) => `${k}: ${cb[k]} -> ${cc[k]}`);
  if (diffs.length) L.push(`**The two were not measured under the same conditions** (${diffs.join('; ')}): the differences below include that.`, '');
  let area = '';
  let worse = 0, better = 0;
  const onlyNew = [];
  for (const [k, a, label, unit] of METRICS) {
    const b = base.summary[k], n = cur.summary[k];
    if (n && !b) onlyNew.push(k);
    if (!b || !n) continue;
    const meta = METRIC_INDEX.get(k);
    if (a !== area) {
      if (area) L.push('');
      L.push(`**${a}**`, '', '| Metric | Baseline median (min-max) | New median (min-max) | Change | Verdict |', '|---|---:|---:|---:|---|');
      area = a;
    }
    const d = n.median - b.median, pct = b.median ? (d / Math.abs(b.median)) * 100 : 0;
    const v = verdict(meta, b, n);
    if (v === 'WORSE') worse++; if (v === 'better') better++;
    L.push(`| ${label} | ${fmt(b.median, unit)} (${fmt(b.min)}-${fmt(b.max)}) | ${fmt(n.median, unit)} (${fmt(n.min)}-${fmt(n.max)}) | ${d >= 0 ? '+' : ''}${fmt(d, unit)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%) | ${v} |`);
  }
  L.push('', `${worse} metric(s) worse, ${better} better, the rest within the baseline's range.`);
  if (onlyNew.length) L.push('', `${onlyNew.length} metric(s) of the new result have no counterpart in the baseline (measured by a newer harness: CPU time by process type, private working set by type) and are not compared: ${onlyNew.slice(0, 6).join(', ')}${onlyNew.length > 6 ? ', ...' : ''}.`);
  return L.join('\n');
}

// ------------------------------------------------------------------------------------------------------------------ merge
function mergeResults(files) {
  const parts = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const runs = parts.flatMap((p) => p.runs || []);
  const summary = summarize(runs);
  const between = {};
  for (const k of Object.keys(summary)) {
    const meds = parts.map((p) => p.summary && p.summary[k] && p.summary[k].median).filter(Number.isFinite);
    if (meds.length > 1) between[k] = { medians: meds, differencePct: ((Math.max(...meds) - Math.min(...meds)) / Math.abs(median(meds) || 1)) * 100 };
  }
  return {
    tool: 'v2_perf', version: TOOL_VERSION, merged: true, label: parts.map((p) => p.label).filter(Boolean).join(' + '),
    startedAt: parts[0].startedAt, finishedAt: parts[parts.length - 1].finishedAt,
    exe: parts[0].exe, note: parts[0].note, options: parts[0].options, conditions: parts[0].conditions,
    invocations: parts.map((p) => ({ startedAt: p.startedAt, finishedAt: p.finishedAt, exe: p.exe, conditions: p.conditions, runsOk: (p.runs || []).filter((r) => r.ok).length, summary: p.summary })),
    runs, discarded: parts.flatMap((p) => p.discarded || []), failures: runs.filter((r) => !r.ok).length, summary, between,
  };
}

// --------------------------------------------------------------------------------------------------------------------- main
function emit(res, o, extra) {
  const md = markdownTable(res) + (extra ? '\n\n' + extra : '');
  if (o.format === 'md' || o.format === 'both') console.log(md);
  if (o.format === 'both') console.log('\n```json');
  if (o.format === 'json' || o.format === 'both') console.log(JSON.stringify(res, null, 1));
  if (o.format === 'both') console.log('```');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  if (o.merge) {
    if (o.merge.length < 2 || !o.out) throw new Error('--merge needs two or more result files and --out');
    const merged = mergeResults(o.merge);
    fs.writeFileSync(o.out, JSON.stringify(merged, null, 1));
    log(`merged ${o.merge.length} files (${merged.runs.length} runs) into ${o.out}`);
    emit(merged, { ...o, format: 'md' });
    return;
  }
  if (o.diff) {
    const [a, b] = o.diff.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    console.log(compareTable(a, b, path.basename(o.diff[0]), path.basename(o.diff[1])));
    return;
  }
  const h = new Harness(o);
  const onSignal = () => { log('interrupted: stopping the app'); h.emergencyCleanup(); process.exit(130); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  process.on('exit', () => h.emergencyCleanup());
  let res;
  try { res = await h.execute(); } finally { h.emergencyCleanup(); }
  if (o.out) { fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true }); fs.writeFileSync(o.out, JSON.stringify(res, null, 1)); log('wrote ' + o.out); }
  let extra = '';
  if (o.compare) extra = compareTable(JSON.parse(fs.readFileSync(o.compare, 'utf8')), res, path.basename(o.compare), res.exe.name);
  emit(res, o, extra);
  if (res.failures) { log(`${res.failures} run(s) failed`); process.exitCode = 1; }
}

// V2_PERF_NO_MAIN=1 lets another script import the pieces below (tests of the in-page snippets and of the option parsing) without starting a run.
export { DEFAULT_E2E, Harness, CDP, BARS_STATE_EXPR, barsSetupExpr, barsRestoreExpr, MOTION_QUERY, deepMerge, loadConfigPatch, parseBrowserArgs, parseArgs, cpuDelta, analyseCmds, typeOf, summarize, METRICS };
if (!process.env.V2_PERF_NO_MAIN) main().catch((e) => { console.error('[v2_perf] ERROR: ' + (e && e.usage ? e.message : (e && e.stack) || e)); process.exitCode = 2; });
