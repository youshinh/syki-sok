// Deterministic 80,000-line Markdown note for the performance harness (tools/perf/v2_perf.mjs).
//
// The same seed always gives the same bytes (no Math.random, no Date, integer arithmetic only), so two builds are
// always measured on the same text. Content: Japanese and English paragraphs, headings of three levels, bullet / numbered /
// task lists, code fences, block quotes, tables, links, rules, and now and then one very long line that wraps into dozens of
// screen lines. The text has no trailing newline: the editor counts exactly `lines` lines.
//
//   node tools/perf/gen_note.mjs --out <file> [--lines 80000] [--seed 20261004]     (prints lines / chars / bytes / sha256)
//
// As a module: `import { generateNote } from './gen_note.mjs'` -> generateNote({ lines, seed }) returns the text.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LINES = 80000;
export const DEFAULT_SEED = 20261004;
// Bump when the generator's output changes on purpose: the baseline file records it next to the sha256.
export const GENERATOR_VERSION = 1;

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JA_SUBJ = ['このアプリ', 'メモの内容', '検索の結果', '保存したノート', '編集中の文章', '設定の画面', 'タブの一覧', 'プレビューの表示', '見出しの階層', 'キーボードの操作',
  'ファイルの読み込み', '画面の切り替え', '選択した範囲', '入力の履歴', '外部のエディタ', '変更の差分', '共有のリンク', '日々の記録', '会議の議事録', '調査のメモ',
  'スクロールの動き', 'レイアウトの計算', 'メモリの使用量', '起動までの時間', 'バックアップの手順', '翻訳した文章', '下書きの段落', 'コードの断片'];
const JA_MID = ['を素早く', 'を丁寧に', 'をまとめて', 'を順番に', 'を静かに', 'を何度も', 'をすべて', 'を少しずつ', 'を最後に', 'を先に', 'をあらためて', 'を一つずつ'];
const JA_VERB = ['確認します', '見直しました', '書き直しています', '整理しておきます', '比較してみます', '保存しておきました', '開いて読み返します', '引用して残します',
  '並べ替えて確かめます', '試してから記録します', '調べて書き足します', 'messageとして送ります', 'パフォーマンスを測ります', 'インデックスに加えます', 'リンクを貼っておきます'];
const JA_TAIL = ['。', '。', '。', '。ただし、時間のかかる場合があります。', '。あとで見返すために残しておきます。', '。うまくいかないときは、もう一度やり直します。', '。結果は次の節にまとめます。'];
const JA_TITLE = ['はじめに', '背景と目的', '調査の方法', '実験の結果', '考察', '今後の課題', '作業の手順', '決まったこと', '未解決の問題', '用語の整理', '参考にした資料', '付録'];

const EN_NOUN = ['editor', 'buffer', 'gutter', 'preview', 'scroll position', 'layout pass', 'tab', 'note', 'heading', 'selection', 'cursor', 'session', 'snapshot', 'index', 'query',
  'result', 'paragraph', 'table', 'code block', 'link', 'draft', 'history', 'setting', 'shortcut', 'palette', 'timeline', 'file', 'window'];
const EN_ADJ = ['large', 'small', 'stale', 'fresh', 'hidden', 'pinned', 'wrapped', 'collapsed', 'selected', 'empty', 'long', 'quiet', 'visible', 'local', 'shared', 'unsaved'];
const EN_VERB = ['renders', 'keeps', 'measures', 'updates', 'restores', 'compares', 'highlights', 'records', 'skips', 'loads', 'saves', 'waits for', 'scrolls past', 'rebuilds'];
const EN_ADV = ['quickly', 'lazily', 'twice', 'in order', 'on demand', 'once per frame', 'in the background', 'without blocking', 'after a short pause', 'from the start'];
const EN_TITLE = ['Overview', 'Goals and non-goals', 'Method', 'Measurements', 'Findings', 'Open questions', 'Checklist', 'Release notes', 'Meeting notes', 'Reading list', 'Appendix', 'Decisions'];

const CODE_LANGS = ['js', 'go', 'py', 'sh', 'json', 'css'];
const CODE_IDENT = ['count', 'items', 'result', 'offset', 'line', 'width', 'tab', 'cache', 'index', 'frame', 'buffer', 'state', 'value', 'text', 'path', 'delta'];
const CODE_FN = ['render', 'measure', 'update', 'load', 'save', 'parse', 'format', 'scan', 'flush', 'merge', 'apply', 'reset'];

export function generateNote(opts = {}) {
  const lines = opts.lines > 0 ? opts.lines : DEFAULT_LINES;
  const rnd = mulberry32((opts.seed >>> 0) || DEFAULT_SEED);
  const int = (n) => Math.floor(rnd() * n);
  const range = (a, b) => a + int(b - a + 1);
  const pick = (arr) => arr[int(arr.length)];
  const chance = (p) => rnd() < p;

  const out = [];
  const push = (s) => { out.push(s); };

  const jaSentence = () => pick(JA_SUBJ) + pick(JA_MID) + pick(JA_VERB) + pick(JA_TAIL);
  const enSentence = () => {
    const f = int(4);
    const s = f === 0 ? `The ${pick(EN_ADJ)} ${pick(EN_NOUN)} ${pick(EN_VERB)} every ${pick(EN_NOUN)} ${pick(EN_ADV)}.`
      : f === 1 ? `When the ${pick(EN_NOUN)} is ${pick(EN_ADJ)}, the ${pick(EN_NOUN)} ${pick(EN_VERB)} the ${pick(EN_ADJ)} ${pick(EN_NOUN)} ${pick(EN_ADV)}.`
        : f === 2 ? `A ${pick(EN_ADJ)} ${pick(EN_NOUN)} ${pick(EN_VERB)} a ${pick(EN_NOUN)}, so the ${pick(EN_NOUN)} stays ${pick(EN_ADJ)}.`
          : `We ${pick(EN_VERB)} the ${pick(EN_NOUN)} ${pick(EN_ADV)} and note how the ${pick(EN_ADJ)} ${pick(EN_NOUN)} behaves (see item ${range(1, 99)}).`;
    return s;
  };
  const link = () => {
    const f = int(3);
    const slug = `${pick(EN_NOUN).replace(/ /g, '-')}-${range(1, 9999)}`;
    if (f === 0) return `[${pick(EN_NOUN)} guide](https://example.com/docs/${slug})`;
    if (f === 1) return `[公式の説明](https://example.org/ja/${slug}#section-${range(1, 20)})`;
    return `<https://example.net/notes/${slug}>`;
  };
  // Text of about `chars` characters in the language `lang` ('ja' | 'en' | 'mix'), with the odd link or `code span`.
  const text = (lang, chars) => {
    let s = '';
    while (s.length < chars) {
      const l = lang === 'mix' ? (chance(0.5) ? 'ja' : 'en') : lang;
      let piece = l === 'ja' ? jaSentence() : enSentence();
      // a short wish (list item, table cell) gets a short phrase, not a whole sentence
      if (chars < 45) piece = l === 'ja' ? pick(JA_SUBJ) + pick(JA_MID) + pick(JA_VERB).slice(0, 4) : pick(EN_ADJ) + ' ' + pick(EN_NOUN) + ' ' + pick(EN_VERB);
      if (chance(0.06)) piece += (l === 'ja' ? '' : ' ') + link();
      if (chance(0.05)) piece += (l === 'ja' ? '' : ' ') + '`' + pick(CODE_FN) + '(' + pick(CODE_IDENT) + ')`';
      if (chance(0.04)) piece += (l === 'ja' ? '' : ' ') + '**' + pick(EN_ADJ) + ' ' + pick(EN_NOUN) + '**';
      s += (s && l === 'en' ? ' ' : '') + piece;
    }
    return s;
  };
  const lang = () => { const r = rnd(); return r < 0.45 ? 'ja' : r < 0.85 ? 'en' : 'mix'; };

  const heading = () => {
    const level = pick([1, 2, 2, 3, 3, 3]);
    const l = lang();
    const title = l === 'ja' ? pick(JA_TITLE) : l === 'en' ? pick(EN_TITLE) : pick(JA_TITLE) + ' (' + pick(EN_TITLE) + ')';
    push('#'.repeat(level) + ' ' + title + ' ' + range(1, 400));
    push('');
  };
  const paragraph = () => {
    const n = chance(0.15) ? range(2, 4) : range(1, 2);
    for (let i = 0; i < n; i++) {
      const veryLong = chance(0.010);
      push(text(lang(), veryLong ? range(700, 1900) : range(24, 210)));
    }
    push('');
  };
  const bullets = () => {
    const n = range(3, 9);
    const task = chance(0.25);
    for (let i = 0; i < n; i++) {
      const mark = task ? (chance(0.5) ? '- [x] ' : '- [ ] ') : (chance(0.8) ? '- ' : '* ');
      push((chance(0.2) ? '  ' : '') + mark + text(lang(), range(6, 55)));
    }
    push('');
  };
  const numbered = () => {
    const n = range(3, 7);
    for (let i = 1; i <= n; i++) push(i + '. ' + text(lang(), range(6, 45)));
    push('');
  };
  const codeLine = (kind) => {
    const a = pick(CODE_IDENT), b = pick(CODE_IDENT), f = pick(CODE_FN), n = range(0, 999);
    switch (kind) {
      case 'go': return pick([`func ${f}${pick(CODE_IDENT)}(${a} int) error {`, `\t${a} := ${f}(${b}, ${n})`, `\tif err != nil { return err }`, `\t// ${pick(EN_VERB)} the ${pick(EN_NOUN)}`, '}']);
      case 'py': return pick([`def ${f}_${a}(${b}, limit=${n}):`, `    ${a} = [${b} for ${b} in range(${n})]`, `    return ${a}`, `    # ${pick(EN_VERB)} the ${pick(EN_NOUN)}`, `for ${a} in ${b}:`]);
      case 'sh': return pick([`syki tab ${f} --index ${n}`, `echo "${pick(EN_VERB)} the ${pick(EN_NOUN)}" | syki scrap append`, `for f in *.md; do wc -l "$f"; done`, `# ${pick(EN_VERB)} the ${pick(EN_NOUN)}`]);
      case 'json': return pick([`  "${a}": ${n},`, `  "${b}": "${pick(EN_NOUN)}",`, `  "${f}": { "enabled": ${chance(0.5)}, "limit": ${n} },`, '  "tags": ["a", "b", "c"]']);
      case 'css': return pick([`.${a}-${b} { margin: ${range(0, 24)}px ${range(0, 24)}px; }`, `  color: var(--text-${pick(['main', 'muted', 'faint'])});`, `@media (max-width: ${range(320, 1200)}px) { .${a} { display: none; } }`]);
      default: return pick([`const ${a} = ${f}(${b}, ${n}); // ${pick(EN_VERB)} the ${pick(EN_NOUN)}`, `function ${f}${pick(CODE_IDENT)}(${a}, ${b}) {`, `  return ${a}.map((x) => x + ${n});`, `if (${a} > ${n}) { ${f}(); }`, '}']);
    }
  };
  const codeBlock = () => {
    const kind = pick(CODE_LANGS);
    push('```' + kind);
    const n = range(4, 26);
    for (let i = 0; i < n; i++) push(codeLine(kind));
    push('```');
    push('');
  };
  const quote = () => {
    const n = range(1, 3);
    for (let i = 0; i < n; i++) push('> ' + text(lang(), range(20, 140)));
    push('');
  };
  const table = () => {
    const cols = range(2, 4);
    const row = (f) => '| ' + Array.from({ length: cols }, () => f()).join(' | ') + ' |';
    push(row(() => pick(EN_NOUN)));
    push('| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |');
    const n = range(3, 8);
    for (let i = 0; i < n; i++) push(row(() => (chance(0.5) ? String(range(0, 99999)) : text(lang(), range(3, 12)))));
    push('');
  };
  const rule = () => { push('---'); push(''); };

  // Weights: paragraphs and lists dominate, the rest sprinkles variety. The mix is tuned so 80,000 lines come to about 3 million characters.
  const blocks = [[heading, 14], [paragraph, 22], [bullets, 18], [numbered, 6], [codeBlock, 15], [quote, 4], [table, 5], [rule, 5]];
  const total = blocks.reduce((s, b) => s + b[1], 0);
  push('# Performance test note ' + (opts.seed || DEFAULT_SEED));
  push('');
  while (out.length < lines) {
    let r = int(total);
    for (const [fn, w] of blocks) { if (r < w) { fn(); break; } r -= w; }
  }
  out.length = lines;
  // The last line is text, so a cut block never ends on an open code fence that would colour the rest of the preview.
  if (out[lines - 1] === '' || out[lines - 1].startsWith('```')) out[lines - 1] = 'end of the note';
  return out.join('\n');
}

export function noteStats(text) {
  return {
    lines: text.split('\n').length,
    chars: text.length,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
  const out = opt('out');
  if (!out) { console.error('usage: node tools/perf/gen_note.mjs --out <file> [--lines 80000] [--seed 20261004]'); process.exit(2); }
  const text = generateNote({ lines: Number(opt('lines', DEFAULT_LINES)), seed: Number(opt('seed', DEFAULT_SEED)) });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, text, 'utf8');
  console.log(JSON.stringify({ file: path.resolve(out), generator: GENERATOR_VERSION, seed: Number(opt('seed', DEFAULT_SEED)), ...noteStats(text) }));
}
