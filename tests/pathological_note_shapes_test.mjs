// Pathological note-shape stress test (Node fast layer).
// Verifies that pure frontend text/markdown/hash/comment/search/gutter/HTML-to-MD engines
// handle extreme note shapes without catastrophic O(N^2) stalls, crashes, or wrong results.
//   node tests/pathological_note_shapes_test.mjs
//   SYKI_STRESS=1 node tests/pathological_note_shapes_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const STRESS = process.env.SYKI_STRESS === '1';
const SCALE = STRESS ? 3 : 1;
const MAX_OP_MS = STRESS ? 8000 : 3000;

globalThis.window = globalThis;
globalThis.document = undefined;

const require = createRequire(import.meta.url);
const FindReplaceEngine = require('../frontend/js/find_replace_engine.js');
const NoteHash = require('../frontend/js/note_hash.js');
const NoteTitle = require('../frontend/js/note_title.js');
const LineGutter = require('../frontend/js/line_gutter.js');
const HtmlComments = require('../frontend/js/html_comments.js');
const HtmlToMd = require('../frontend/js/html_to_md.js');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start !== -1, `function ${name} not found in app.js`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.substring(start, i + 1);
}

const appCode = fs.readFileSync(path.resolve('frontend/js/app.js'), 'utf-8');
const nlCtx = vm.createContext({ Math });
vm.runInContext(`${extractFunction(appCode, 'countNewlines')}\nglobalThis.countNewlines = countNewlines;`, nlCtx);
const countNewlines = nlCtx.countNewlines;

function refCountNewlines(text) {
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

function measure(name, fn) {
  const t0 = performance.now();
  const res = fn();
  const ms = performance.now() - t0;
  assert.ok(ms < MAX_OP_MS, `${name} took ${ms.toFixed(1)} ms (limit ${MAX_OP_MS} ms)`);
  return { res, ms };
}

// ---------------------------------------------------------------------------
// 5 Pathological Note Shapes
// ---------------------------------------------------------------------------
function buildShapes() {
  // 1. many_lines
  const lineTotal = 40000 * SCALE;
  const manyLinesArr = new Array(lineTotal);
  for (let i = 0; i < lineTotal; i++) {
    if (i === 0) manyLinesArr[i] = '# 2026-11-19 Many Lines Note';
    else if (i % 5000 === 0) manyLinesArr[i] = `line ${i} NEEDLE <!-- comment ${i} -->`;
    else manyLinesArr[i] = `row ${i}: steady note text for stress check`;
  }
  const manyLines = manyLinesArr.join('\n');

  // 2. giant_single_line (no newlines)
  const giantChars = 500000 * SCALE;
  const unit = 'abcdefghij0123456789 ';
  const giantSingleLine = unit.repeat(Math.ceil(giantChars / unit.length)).slice(0, giantChars) + ' NEEDLE_TAIL';

  // 3. heading_and_comment_dense
  const headingCount = 5000 * SCALE;
  const headingArr = new Array(headingCount);
  for (let i = 0; i < headingCount; i++) {
    const level = i % 2 === 0 ? '#' : '##';
    headingArr[i] = `${level} Section ${i}\n<!-- tags: alpha, beta --><!-- outer <!-- inner -->\nbody line ${i} NEEDLE`;
  }
  const headingDense = headingArr.join('\n');

  // 4. unicode_surrogates (Japanese + surrogate pairs + combining marks)
  const uniUnit = '竹林設計😀🚀🎋e\u0301日本語テスト ';
  const uniTarget = 200000 * SCALE;
  const unicodeSurrogates = '# タイトル😀\n' + uniUnit.repeat(Math.ceil(uniTarget / uniUnit.length)).slice(0, uniTarget) + '\n単独 日本語_NEEDLE 終端';

  // 5. regex_and_html_bait (unclosed <!--, unclosed brackets, HTML table payload)
  const baitCount = 5000 * SCALE;
  const baitText =
    '# Regex & Comment Bait\n' +
    '<!-- unclosed comment prefix [unclosed link ((a+)+)$\n'.repeat(baitCount) +
    '\nNEEDLE end line';
  const htmlTable =
    '<table><thead><tr><th>col1</th><th>col2</th></tr></thead><tbody>' +
    '<tr><td>c1</td><td>c2</td></tr>'.repeat(baitCount) +
    '</tbody></table>';

  return [
    { name: 'many_lines', text: manyLines, query: 'NEEDLE', wantMinHits: Math.floor((lineTotal - 1) / 5000), isRegex: false },
    { name: 'giant_single_line', text: giantSingleLine, query: 'NEEDLE_TAIL', wantMinHits: 1, isRegex: false },
    { name: 'heading_and_comment_dense', text: headingDense, query: 'NEEDLE(?:_TAIL)?', wantMinHits: headingCount, isRegex: true },
    { name: 'unicode_surrogates', text: unicodeSurrogates, query: '日本語_NEEDLE', wantMinHits: 1, isRegex: false, wholeWord: true },
    { name: 'regex_and_html_bait', text: baitText, html: htmlTable, query: '((a+)+)$', wantMinHits: baitCount, isRegex: false }
  ];
}

const shapes = buildShapes();
const timings = [];

for (const sh of shapes) {
  const row = {
    shape: sh.name,
    chars: sh.text.length,
    lines: 0,
    hashMs: 0,
    titleMs: 0,
    findMs: 0,
    gutterMs: 0,
    commentMs: 0,
    newlineMs: 0,
    htmlToMdMs: '-'
  };

  // 1. countNewlines
  const nl = measure(`${sh.name}:countNewlines`, () => countNewlines(sh.text));
  assert.equal(nl.res, refCountNewlines(sh.text), `${sh.name}: countNewlines mismatch`);
  row.newlineMs = nl.ms;
  row.lines = nl.res + 1;

  // 2. NoteHash
  const h1 = measure(`${sh.name}:hash16`, () => NoteHash.hash16(sh.text));
  assert.match(h1.res, /^[0-9a-f]{16}$/);
  assert.equal(h1.res, NoteHash.hash16(sh.text), `${sh.name}: hash16 not deterministic`);
  row.hashMs = h1.ms;

  // 3. NoteTitle
  const nt = measure(`${sh.name}:deriveTitle`, () => {
    const title = NoteTitle.deriveTitle(sh.text);
    const saveName = NoteTitle.defaultSaveName(sh.text, '2026-11-19');
    return { title, saveName };
  });
  assert.equal(typeof nt.res.title, 'string');
  assert.equal(typeof nt.res.saveName, 'string');
  row.titleMs = nt.ms;

  // 4. FindReplaceEngine
  const fr = measure(`${sh.name}:findReplace`, () => {
    const re = FindReplaceEngine.buildFindRegex(sh.query, !!sh.isRegex, false);
    let hits = 0;
    let firstExpanded = '';
    FindReplaceEngine.scanFindMatches(sh.text, re, !!sh.wholeWord, (m) => {
      if (hits === 0) firstExpanded = FindReplaceEngine.expandReplacement('[$&]', m, sh.text);
      hits++;
    });
    return { hits, firstExpanded };
  });
  assert.ok(fr.res.hits >= sh.wantMinHits, `${sh.name}: hits=${fr.res.hits}, want >= ${sh.wantMinHits}`);
  assert.ok(fr.res.firstExpanded.length >= 3);
  row.findMs = fr.ms;

  // 5. LineGutter
  const lg = measure(`${sh.name}:lineGutter`, () => {
    const units = LineGutter.wrapUnits(1100, 14);
    const scan = LineGutter.findLongLines(sh.text, units, 4);
    const sampleTo = Math.min(scan.lines, 500);
    const rows = new Uint32Array(sampleTo).fill(1);
    const block = LineGutter.gutterBlockText(0, sampleTo, rows);
    return { lines: scan.lines, longCount: scan.long.length, blockLen: block.length };
  });
  assert.equal(lg.res.lines, row.lines, `${sh.name}: LineGutter line count mismatch`);
  assert.ok(lg.res.blockLen > 0);
  row.gutterMs = lg.ms;

  // 6. HtmlComments
  const hc = measure(`${sh.name}:htmlComments`, () => {
    const ranges = HtmlComments.htmlCommentRanges(sh.text);
    for (let i = 1; i < ranges.length; i++) {
      assert.ok(ranges[i - 1][1] <= ranges[i][0], `${sh.name}: overlapping comment range`);
    }
    const stripped = HtmlComments.removeComments(sh.text);
    const masked = HtmlComments.maskComments(sh.text);
    return { ranges, stripped, masked };
  });
  assert.equal(hc.res.masked.length, sh.text.length, `${sh.name}: maskComments changed length`);
  if (sh.name === 'regex_and_html_bait') {
    assert.ok(hc.res.stripped.includes('NEEDLE end line'), 'unclosed <!-- must not swallow tail');
  }
  row.commentMs = hc.ms;

  // 7. HtmlToMd (on large HTML table payload)
  if (sh.html) {
    const hm = measure(`${sh.name}:htmlToMd`, () => {
      const has = HtmlToMd.hasStructure(sh.html);
      const md = HtmlToMd.convert(sh.html);
      const sep = HtmlToMd.separateBlock(md.slice(0, 200), 'before text', 'after text');
      return { has, md, sep };
    });
    assert.equal(hm.res.has, true);
    assert.ok(hm.res.md.includes('| c1 | c2 |'), 'table rows converted');
    assert.ok(hm.res.sep.startsWith('\n\n'));
    row.htmlToMdMs = hm.ms.toFixed(1);
  }

  timings.push(row);
}

console.log(`Pathological Note Shapes Benchmark (scale=${SCALE}x, stress=${STRESS})`);
console.log('| Shape | Chars | Lines | countNewlines (ms) | NoteHash (ms) | NoteTitle (ms) | FindReplace (ms) | LineGutter (ms) | HtmlComments (ms) | HtmlToMd (ms) |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of timings) {
  console.log(
    `| ${r.shape} | ${r.chars} | ${r.lines} | ${r.newlineMs.toFixed(1)} | ${r.hashMs.toFixed(1)} | ${r.titleMs.toFixed(1)} | ${r.findMs.toFixed(1)} | ${r.gutterMs.toFixed(1)} | ${r.commentMs.toFixed(1)} | ${r.htmlToMdMs} |`
  );
}
console.log('PASS: all pathological note shapes completed within limits.');
