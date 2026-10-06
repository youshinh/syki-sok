// v2 phase P6: JS compatibility scan for Safari 15.6 / macOS 10.15.
//
// What is locked:
//   Production scripts in frontend/js/ (*.js, excluding *_test.js) avoid modern JS syntax
//   and APIs that are unsupported in Safari 15.6 (WebKit on macOS 10.15), unless guarded
//   by feature detection (e.g. `typeof ... === 'function'`).
//
// Forbidden features without guard:
//   * Regex lookbehind: (?<=...) or (?<!...)                               (Safari 16.4)
//   * Class static blocks: static { ... }                                  (Safari 16.4)
//   * Array mutation-free methods: .toSorted(), .toReversed(), .toSpliced() (Safari 16.0)
//   * Array.fromAsync()                                                    (Safari 17.4)
//   * AbortSignal.timeout(), AbortSignal.any()                             (Safari 16.0)
//   * requestIdleCallback (missing in Safari <= 15.6)
//   * Document startViewTransition()                                       (Safari 18.0)
//
// Node only. Run: node tests/js_compat_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const lf = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => lf(fs.readFileSync(p, 'utf8'));

// Strip comments and strings from JS code to avoid false positives in comments/literals
function stripCommentsAndStrings(code) {
  let out = '';
  let i = 0;
  const len = code.length;
  while (i < len) {
    const c = code[i];
    const next = code[i + 1];

    // Single-line comment
    if (c === '/' && next === '/') {
      while (i < len && code[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }

    // Multi-line comment
    if (c === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < len) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    // String literals ('...', "...", `...`)
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < len && code[i] !== quote) {
        if (code[i] === '\\') {
          out += '  ';
          i += 2;
        } else {
          out += code[i] === '\n' ? '\n' : ' ';
          i++;
        }
      }
      if (i < len) {
        out += ' ';
        i++;
      }
      continue;
    }

    // Regular code
    out += c;
    i++;
  }
  return out;
}

const FORBIDDEN_PATTERNS = [
  { re: /\/\([^?]*\?<(?:=|!)/g, name: 'Regex lookbehind (?<=...) or (?<!...) (Safari 16.4)' },
  { re: /\bstatic\s*\{/g, name: 'Class static block (Safari 16.4)' },
  { re: /\.(?:toSorted|toReversed|toSpliced)\s*\(/g, name: 'Immutable array methods (.toSorted etc.) (Safari 16.0)' },
  { re: /\bArray\.fromAsync\b/g, name: 'Array.fromAsync (Safari 17.4)' },
  { re: /\bAbortSignal\.(?:timeout|any)\b/g, name: 'AbortSignal.timeout/any (Safari 16.0)' },
  { re: /\brequestIdleCallback\s*\(/g, name: 'requestIdleCallback() (unsupported in Safari 15.6)' },
  { re: /\bstartViewTransition\s*\(/g, name: 'startViewTransition (Safari 18.0)' }
];

function scanJsProblems(code, fileName) {
  const stripped = stripCommentsAndStrings(code);
  const problems = [];
  for (const { re, name } of FORBIDDEN_PATTERNS) {
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const line = stripped.substring(0, m.index).split('\n').length;
      problems.push({ file: fileName, line, feature: name });
    }
  }
  return problems;
}

// Run scanner on all production scripts in frontend/js/
const jsDir = path.join(REPO_ROOT, 'frontend', 'js');
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js') && !f.endsWith('_test.js'));

const allProblems = [];
for (const file of files) {
  const content = read(path.join(jsDir, file));
  const problems = scanJsProblems(content, file);
  allProblems.push(...problems);
}

assert.equal(
  allProblems.length,
  0,
  `Found unsupported modern JS features in production code:\n` +
    allProblems.map((p) => `  ${p.file}:${p.line} -> ${p.feature}`).join('\n')
);

// ---- Mutation Checks (must catch 3 injected violations) --------------------------------------------
let mutationsCaught = 0;

// Mutation 1: Lookbehind regex
try {
  const broken = 'const regex = /(?<=hello)world/;';
  const probs = scanJsProblems(broken, 'broken1.js');
  assert.ok(probs.length > 0);
  mutationsCaught++;
} catch (_) {}

// Mutation 2: toSorted()
try {
  const broken = 'const arr = items.toSorted();';
  const probs = scanJsProblems(broken, 'broken2.js');
  assert.ok(probs.length > 0);
  mutationsCaught++;
} catch (_) {}

// Mutation 3: requestIdleCallback
try {
  const broken = 'requestIdleCallback(() => doWork());';
  const probs = scanJsProblems(broken, 'broken3.js');
  assert.ok(probs.length > 0);
  mutationsCaught++;
} catch (_) {}

assert.equal(mutationsCaught, 3, `all 3 mutations must be caught (caught: ${mutationsCaught})`);
console.log('js_compat_test: PASS (0 compatibility violations, 3/3 mutations caught)');
