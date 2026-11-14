// One command to run every frontend JS test (frontend/js/*_test.js + tests/*.mjs)
// in a single pass. Usage: node tools/run_js_tests.mjs [--serial]  (run from the repo root).
import { spawn } from 'child_process';
import { readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function listTestFiles(dir, suffixCheck) {
  let entries;
  try {
    entries = readdirSync(path.join(repoRoot, dir));
  } catch (e) {
    return [];
  }
  return entries
    .filter((name) => suffixCheck(name))
    .sort()
    .map((name) => path.join(dir, name));
}

const testFiles = [
  ...listTestFiles('frontend/js', (name) => name.endsWith('_test.js')),
  ...listTestFiles('tests', (name) => name.endsWith('.mjs')),
];

if (testFiles.length === 0) {
  console.error('No test files found under frontend/js/*_test.js or tests/*.mjs');
  process.exit(1);
}

const serial = process.argv.includes('--serial');
const concurrency = serial ? 1 : Math.max(1, Math.min(os.cpus().length || 4, 8));

console.log(`Running ${testFiles.length} JS test file(s) (concurrency=${concurrency})...\n`);

function runOne(relPath) {
  return new Promise((resolve) => {
    const absPath = path.join(repoRoot, relPath);
    const child = spawn(process.execPath, [absPath], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.on('error', (err) => {
      resolve({ relPath, passed: false, output: `${output}\n${err.message}` });
    });
    child.on('close', (code) => {
      resolve({ relPath, passed: code === 0, output });
    });
  });
}

const results = new Array(testFiles.length);
let nextIndex = 0;

async function worker() {
  while (true) {
    const idx = nextIndex++;
    if (idx >= testFiles.length) return;
    results[idx] = await runOne(testFiles[idx]);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, testFiles.length) }, () => worker()));

for (const { relPath, passed, output } of results) {
  if (passed) {
    console.log(`PASS  ${relPath}`);
  } else {
    console.log(`FAIL  ${relPath}`);
    const lines = output.split('\n').filter(Boolean);
    const failLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (/\bFAIL\b|AssertionError|Error:/i.test(lines[i])) {
        failLines.push(...lines.slice(i, Math.min(i + 5, lines.length)));
      }
    }
    if (failLines.length) {
      console.log('      --- failure lines ---');
      failLines.slice(0, 20).forEach((line) => console.log(`      ${line}`));
    }
    const tail = lines.slice(-20).join('\n');
    if (tail) {
      console.log('      --- last output lines ---');
      tail.split('\n').forEach((line) => console.log(`      ${line}`));
      console.log('      -------------------------');
    }
  }
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} test file(s) passed.`);

if (failed.length > 0) {
  console.log(`Failed: ${failed.map((r) => r.relPath).join(', ')}`);
  process.exit(1);
}

process.exit(0);
