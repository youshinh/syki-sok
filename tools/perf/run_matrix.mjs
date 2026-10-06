#!/usr/bin/env node
// run_matrix: the "same session, interleaved" comparison of several configurations of the v2 build (tools/perf/README.md, "run_matrix.mjs").
//
//   node tools/perf/run_matrix.mjs --matrix matrix.json --out <dir> [--rounds 2] [--runs 3] [--no-reverse-alternate]
//   node tools/perf/run_matrix.mjs --matrix matrix.json --out <dir> --report-only      (print the tables from the files already in <dir>; nothing is launched)
//
// For every round and every configuration of the matrix it runs `node tools/perf/v2_perf.mjs ...` as a child process (one at a time: there is one debug port and
// one E2E/app.lock), writing <dir>/<name>.r<round>.json (+ .md and .log). Round 1 runs the list as written, round 2 in reverse, round 3 as written...
// (--no-reverse-alternate: always as written), so a slow drift of the PC (thermal state, Defender, another agent) is spread over the configurations instead
// of piling up on the last ones. Then it prints ONE Markdown table (rows = metrics, columns = configurations, each cell = the median over all the runs of all
// the rounds, min-max after a slash) and a second one with the median of every round, so drift is visible. Nothing here touches the app: v2_perf.mjs does all of it.
//
// Matrix file: an array, or { "defaults": {...}, "configs": [...] }; a config is
//   { "name": "C-light", "exe": "v2-p2b.exe", "configPatch": {"appearance": {"bars": "light", "autoHide": true}}, "browserArgs": "", "barsState": "natural",
//     "motion": "no-preference", "steps": "scroll,typing", "runs": 3, "extraArgs": ["--keys", "30"] }          (all but name and exe are optional)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERF = path.join(HERE, 'v2_perf.mjs');
const log = (...a) => console.error('[run_matrix]', ...a);
const fail = (msg) => { console.error('[run_matrix] ERROR: ' + msg); process.exit(1); };

// v2_perf.mjs is imported for its option checker and its default E2E folder only; V2_PERF_NO_MAIN keeps it from starting a run, and it must not leak to the children.
process.env.V2_PERF_NO_MAIN = '1';
const perf = await import(new URL('./v2_perf.mjs', import.meta.url).href);
delete process.env.V2_PERF_NO_MAIN;

// ------------------------------------------------------------------------------------------------------------------------------ options
const HELP = `usage: node tools/perf/run_matrix.mjs --matrix <file.json> --out <dir> [--rounds 2] [--runs 3] [--steps s1,s2] [--no-reverse-alternate]
       [--e2e <dir>] [--work <dir>] [--note <file>] [--lock-timeout-min 30] [--only name1,name2] [--dry-run] [--report-only]
  --steps is the default for configurations that have no "steps" of their own (default: startup,memory,open,scroll,typing).
  The rest of an invocation of v2_perf.mjs (--idle-sec, --keys, ...) goes into a configuration's "extraArgs": ["--keys", "30"].`;
function parseArgs(argv) {
  const o = { rounds: 2, runs: 3, reverseAlternate: true, steps: 'startup,memory,open,scroll,typing' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) fail('missing value for ' + a); return argv[++i]; };
    switch (a) {
      case '--matrix': o.matrix = next(); break;
      case '--out': o.out = next(); break;
      case '--rounds': o.rounds = Number(next()); break;
      case '--runs': o.runs = Number(next()); break;
      case '--steps': o.steps = next(); break;
      case '--reverse-alternate': o.reverseAlternate = true; break;
      case '--no-reverse-alternate': o.reverseAlternate = false; break;
      case '--e2e': o.e2e = next(); break;
      case '--work': o.work = next(); break;
      case '--note': o.note = next(); break;
      case '--lock-timeout-min': o.lockTimeoutMin = next(); break;
      case '--only': o.only = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--dry-run': o.dryRun = true; break;
      case '--report-only': o.reportOnly = true; break;
      case '--help': case '-h': o.help = true; break;
      default: fail('unknown argument: ' + a + '\n' + HELP);
    }
  }
  return o;
}

// ------------------------------------------------------------------------------------------------------------------------------ the matrix
const CONFIG_KEYS = new Set(['name', 'exe', 'configPatch', 'browserArgs', 'barsState', 'motion', 'steps', 'runs', 'label', 'extraArgs']);
function loadMatrix(file, o) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { fail(`cannot read the matrix ${file}: ${e.message}`); }
  const defaults = Array.isArray(raw) ? {} : raw.defaults || {};
  const list = Array.isArray(raw) ? raw : raw.configs || raw.configurations;
  if (!Array.isArray(list) || !list.length) fail('the matrix has no configurations (an array, or { "configs": [...] })');
  const names = new Set();
  const e2e = path.resolve(o.e2e || process.env.V2_E2E || perf.DEFAULT_E2E);
  return list.map((c0, i) => {
    const c = { ...defaults, ...c0 };
    for (const k of Object.keys(c)) if (!CONFIG_KEYS.has(k)) fail(`configuration #${i + 1} (${c.name || '?'}): unknown key "${k}" (allowed: ${[...CONFIG_KEYS].join(', ')})`);
    if (typeof c.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(c.name)) fail(`configuration #${i + 1}: "name" must be letters, digits, . _ - (it becomes a file name): ${JSON.stringify(c.name)}`);
    if (names.has(c.name)) fail(`two configurations are called ${c.name}`);
    names.add(c.name);
    if (typeof c.exe !== 'string' || !c.exe) fail(`${c.name}: "exe" is required (a v2-*.exe in the E2E folder, or a full path)`);
    const exePath = path.isAbsolute(c.exe) ? c.exe : path.join(e2e, c.exe);
    if (!/^v2-.+\.exe$/i.test(path.basename(exePath))) fail(`${c.name}: the exe must be named v2-*.exe: ${c.exe}`);
    if (!fs.existsSync(exePath)) fail(`${c.name}: exe not found: ${exePath}`);
    return c;
  });
}

// the argv of one v2_perf.mjs invocation (after the script name)
function childArgs(c, round, o, outDir) {
  const base = path.join(outDir, `${c.name}.r${round}`);
  const a = ['--exe', c.exe, '--runs', String(c.runs != null ? c.runs : o.runs), '--steps', c.steps || o.steps, '--out', base + '.json', '--format', 'md', '--label', c.label || `${c.name} r${round}`];
  if (c.configPatch != null && !(typeof c.configPatch === 'object' && Object.keys(c.configPatch).length === 0) && c.configPatch !== '') {
    const text = typeof c.configPatch === 'string' ? c.configPatch : JSON.stringify(c.configPatch);
    const pf = path.join(outDir, `${c.name}.patch.json`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(pf, text); // a file, so no quoting problem on the command line, and a record of what was applied
    a.push('--config-patch', '@' + pf);
  }
  if (c.browserArgs) a.push('--browser-args', c.browserArgs);
  if (c.barsState) a.push('--bars-state', c.barsState);
  if (c.motion) a.push('--motion', c.motion);
  if (o.e2e) a.push('--e2e', o.e2e);
  if (o.work) a.push('--work', o.work);
  if (o.note) a.push('--note', o.note);
  if (o.lockTimeoutMin) a.push('--lock-timeout-min', o.lockTimeoutMin);
  if (Array.isArray(c.extraArgs)) a.push(...c.extraArgs.map(String));
  return a;
}

// ------------------------------------------------------------------------------------------------------------------------------ running
let current = null; // the child being waited for
let aborted = false;
function runChild(label, args, base) {
  return new Promise((resolve) => {
    const err = fs.createWriteStream(base + '.log');
    const out = fs.createWriteStream(base + '.md');
    const child = spawn(process.execPath, [PERF, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: process.env });
    current = child;
    const tail = [];
    let buf = '';
    child.stdout.on('data', (d) => out.write(d));
    child.stderr.on('data', (d) => {
      err.write(d);
      buf += d.toString('utf8');
      let k;
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k).replace(/\r$/, ''); buf = buf.slice(k + 1);
        tail.push(line); if (tail.length > 30) tail.shift();
        if (line.trim()) console.error(`[${label}] ${line.replace(/^\[v2_perf\] /, '')}`);
      }
    });
    child.on('close', (code, signal) => { current = null; out.end(); err.end(); resolve({ code, signal, tail }); });
    child.on('error', (e) => { current = null; resolve({ code: -1, signal: null, tail: [String(e)] }); });
  });
}
// Ctrl+C reaches the child too (same console): it stops its own app and exits; this only makes sure nothing new is started.
process.on('SIGINT', () => { if (!current) process.exit(130); aborted = true; log('interrupted: waiting for the running invocation to stop its app...'); });

// ------------------------------------------------------------------------------------------------------------------------------ stats and tables
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const sorted = (a) => a.filter(num).sort((x, y) => x - y);
const median = (a) => { const s = sorted(a); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const group = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 20 });
function fmt(x, kind) {
  if (!num(x)) return '-';
  if (kind === 'count') return group(Math.round(x * 10) / 10);
  const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
  return group(Number(x.toFixed(d)));
}
const cell = (vals, kind) => {
  const s = sorted(vals);
  if (!s.length) return '-';
  return `${fmt(median(s), kind)} / <small>${fmt(s[0], kind)}-${fmt(s[s.length - 1], kind)}</small>`;
};
const esc = (t) => String(t).replace(/\|/g, '\\|');

// [key in run.m, label, kind]
const METRICS = [
  ['startup.ready_ms', 'Startup: process start to ready (ms)', 'ms'],
  ['startup.fcp_ms', 'Startup: first contentful paint (ms)', 'ms'],
  ['mem_idle.total_pws_mb', 'Memory idle: private working set, all processes (MB)', 'ms'],
  ['mem_idle.gpu_pws_mb', 'Memory idle: GPU process private working set (MB)', 'ms'],
  ['cpu.idle_total_pct', 'Idle CPU, all processes (% of one logical processor)', 'ms'],
  ['cpu.idle_gpu_pct', 'Idle CPU, GPU process (% of one logical processor)', 'ms'],
  ['cpu.idle_renderer_pct', 'Idle CPU, renderer (% of one logical processor)', 'ms'],
  ['open.total_ms', 'Open the 80,000-line note (ms)', 'ms'],
  ['scroll.late', 'Scroll: late frames', 'count'],
  ['scroll.over50', 'Scroll: frames over 50 ms', 'count'],
  ['scroll.max_ms', 'Scroll: frame interval max (ms)', 'ms'],
  ['scroll.p95_ms', 'Scroll: frame interval p95 (ms)', 'ms'],
  ['scroll.task_ms', 'Scroll: main-thread busy time (ms)', 'ms'],
  ['scroll.cpu_ms_by_type.gpu-process', 'Scroll: CPU time, GPU process (ms)', 'ms'],
  ['scroll.cpu_ms_by_type.renderer', 'Scroll: CPU time, renderer (ms)', 'ms'],
  ['scroll.cpu_ms_total', 'Scroll: CPU time, all processes (ms)', 'ms'],
  ['typing.p50_ms', 'Typing: key to next frame, p50 (ms)', 'ms'],
  ['typing.p95_ms', 'Typing: p95 (ms)', 'ms'],
  ['typing.max_ms', 'Typing: max (ms)', 'ms'],
];
// the ones whose per-round medians are shown in the second table
const DRIFT_KEYS = ['startup.ready_ms', 'mem_idle.gpu_pws_mb', 'scroll.late', 'scroll.max_ms', 'scroll.task_ms', 'scroll.cpu_ms_by_type.gpu-process', 'scroll.cpu_ms_total', 'typing.p50_ms'];

function readResults(configs, rounds, outDir) {
  const res = new Map(); // name -> [{ round, data }]
  for (const c of configs) {
    const list = [];
    for (let r = 1; r <= rounds; r++) {
      const f = path.join(outDir, `${c.name}.r${r}.json`);
      if (!fs.existsSync(f)) continue;
      try { list.push({ round: r, data: JSON.parse(fs.readFileSync(f, 'utf8')) }); } catch (e) { fail(`cannot read ${f}: ${e.message}`); }
    }
    res.set(c.name, list);
  }
  return res;
}
const valuesOf = (entries, key) => entries.flatMap((e) => (e.data.runs || []).filter((r) => r.ok && num(r.m && r.m[key])).map((r) => r.m[key]));

function report(configs, res, o, orders) {
  const L = [];
  L.push(`### v2_perf matrix: ${configs.length} configuration(s), ${o.rounds} round(s) x ${o.runs} run(s)`, '');
  L.push(`- Matrix ${o.matrix}; output ${o.out}`);
  for (let r = 0; r < orders.length; r++) L.push(`- Round ${r + 1} ran: ${orders[r].map((c) => c.name).join(', ')}`);
  L.push('- Cells: median over all the runs of all the rounds / <small>min-max</small>. "-" = that step was not run.', '');
  // the configurations
  L.push('| Configuration | exe (sha256) | Config patch | Browser args | Bars state | Motion | Runs ok / rounds | Busy-PC runs | GPU process flags |', '|---|---|---|---|---|---|---:|---:|---|');
  for (const c of configs) {
    const ent = res.get(c.name) || [];
    const first = ent[0] && ent[0].data;
    const cond = (first && first.conditions) || {};
    const runs = ent.flatMap((e) => e.data.runs || []);
    const ok = runs.filter((r) => r.ok).length;
    const noisy = runs.filter((r) => r.noisy).length + ent.reduce((s, e) => s + (e.data.discarded || []).length, 0);
    const gf = [...new Set(runs.map((r) => (r.gpuProcessFlags ? r.gpuProcessFlags.join(' ') : null)).filter((x) => x != null))].map((x) => x || 'hardware (none)').join('; ') || '-';
    const unsup = runs.some((r) => r.scroll && r.scroll.bars && r.scroll.bars.unsupported);
    L.push(`| ${c.name} | ${first ? esc(first.exe.name + ' ' + first.exe.sha256.slice(0, 10)) : '-'} | ${cond.configPatch ? '`' + esc(cond.configPatch) + '`' : '-'} | ${cond.browserArgs ? '`' + esc(cond.browserArgs) + '`' : '-'} | ${esc((cond.barsState || '-') + (unsup ? ' (not supported by this exe: natural)' : ''))} | ${esc(cond.motion || '-')} | ${ok} / ${ent.length} | ${noisy} | ${esc(gf)} |`);
  }
  L.push('');
  // table 1
  L.push('**All rounds together**', '', `| Metric | ${configs.map((c) => c.name).join(' | ')} |`, `|---|${configs.map(() => '---:').join('|')}|`);
  for (const [key, label, kind] of METRICS) {
    L.push(`| ${label} | ${configs.map((c) => cell(valuesOf(res.get(c.name) || [], key), kind)).join(' | ')} |`);
  }
  L.push('');
  // table 2
  L.push('**Median of each round** (round 1 / round 2 / ...; a number that keeps going one way from round to round is drift of the PC, not of the build)', '', `| Metric | ${configs.map((c) => c.name).join(' | ')} |`, `|---|${configs.map(() => '---:').join('|')}|`);
  for (const key of DRIFT_KEYS) {
    const m = METRICS.find((x) => x[0] === key);
    L.push(`| ${m[1]} | ${configs.map((c) => {
      const ent = res.get(c.name) || [];
      const cells = [];
      for (let r = 1; r <= o.rounds; r++) {
        const e = ent.find((x) => x.round === r);
        cells.push(e ? fmt(median(valuesOf([e], key)), m[2]) : '-');
      }
      return cells.join(' / ');
    }).join(' | ')} |`);
  }
  return L.join('\n');
}

// ------------------------------------------------------------------------------------------------------------------------------ main
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  if (!o.matrix) fail('--matrix <file.json> is required\n' + HELP);
  if (!o.out) fail('--out <dir> is required\n' + HELP);
  if (!(o.rounds >= 1) || !Number.isInteger(o.rounds)) fail('--rounds must be a whole number of 1 or more');
  if (!(o.runs >= 1) || !Number.isInteger(o.runs)) fail('--runs must be a whole number of 1 or more');
  o.out = path.resolve(o.out);
  let configs = loadMatrix(o.matrix, o);
  if (o.only) {
    const unknown = o.only.filter((n) => !configs.some((c) => c.name === n));
    if (unknown.length) fail('--only names no configuration: ' + unknown.join(', '));
    configs = configs.filter((c) => o.only.includes(c.name));
  }
  // every configuration's options are checked now (invalid JSON in a patch, a typo in --motion...), before anything is launched
  for (const c of configs) {
    try { perf.parseArgs(childArgs(c, 1, o, o.out)); } catch (e) { fail(`${c.name}: ${e.message}`); }
  }
  // the order of each round
  const orders = [];
  for (let r = 0; r < o.rounds; r++) orders.push(o.reverseAlternate && r % 2 === 1 ? [...configs].reverse() : [...configs]);

  fs.mkdirSync(o.out, { recursive: true });
  if (o.dryRun) {
    for (let r = 0; r < o.rounds; r++) for (const c of orders[r]) console.log(`round ${r + 1}: node tools/perf/v2_perf.mjs ${childArgs(c, r + 1, o, o.out).map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(' ')}`);
    return;
  }
  if (!o.reportOnly) {
    const t0 = Date.now();
    for (let r = 0; r < o.rounds; r++) {
      for (const c of orders[r]) {
        if (aborted) fail('interrupted');
        const round = r + 1;
        const label = `${c.name} r${round}`;
        log(`round ${round}/${o.rounds}: ${c.name} (${c.exe}) ...`);
        const args = childArgs(c, round, o, o.out);
        const base = path.join(o.out, `${c.name}.r${round}`);
        try { fs.rmSync(base + '.json', { force: true }); } catch (e) { /* none */ }
        const t1 = Date.now();
        const r1 = await runChild(label, args, base);
        const bad = r1.code !== 0 || !fs.existsSync(base + '.json');
        if (bad) {
          console.error(`[run_matrix] ERROR: ${label} failed (exit ${r1.code}${r1.signal ? ', ' + r1.signal : ''}); stopping the matrix here. Command: node tools/perf/v2_perf.mjs ${args.join(' ')}`);
          console.error('[run_matrix] last lines of its progress output:\n  ' + r1.tail.slice(-12).join('\n  '));
          console.error(`[run_matrix] full log: ${base}.log`);
          process.exit(1);
        }
        log(`${label} done in ${Math.round((Date.now() - t1) / 1000)} s (${Math.round((Date.now() - t0) / 1000)} s since the start)`);
      }
    }
  }
  const res = readResults(configs, o.rounds, o.out);
  const md = report(configs, res, o, orders);
  fs.writeFileSync(path.join(o.out, 'matrix.md'), md + '\n');
  fs.writeFileSync(path.join(o.out, 'matrix.json'), JSON.stringify({
    tool: 'run_matrix', matrix: o.matrix, rounds: o.rounds, runs: o.runs, reverseAlternate: o.reverseAlternate, order: orders.map((x) => x.map((c) => c.name)),
    configs: configs.map((c) => ({ ...c, files: (res.get(c.name) || []).map((e) => `${c.name}.r${e.round}.json`) })),
    metrics: Object.fromEntries(METRICS.map(([key]) => [key, Object.fromEntries(configs.map((c) => { const v = sorted(valuesOf(res.get(c.name) || [], key)); return [c.name, v.length ? { n: v.length, median: median(v), min: v[0], max: v[v.length - 1] } : null]; }))])),
  }, null, 1));
  console.log(md);
  log(`wrote ${path.join(o.out, 'matrix.md')} and matrix.json`);
}

main().catch((e) => { console.error('[run_matrix] ERROR: ' + ((e && e.stack) || e)); process.exit(1); });
