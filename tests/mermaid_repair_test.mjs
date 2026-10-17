// Mermaid repair (frontend/js/mermaid_repair.js): the usual slips of the AI are put right by rule, a diagram that is fine is not touched,
// and the wiring in app.js applies it to the AI's answer and, once, to a diagram that fails to draw.
//
// tests/fixtures/mermaid_repair_cases.json holds 132 diagrams: real answers of the AI to 13 different texts (two runs each) and the
// mistakes it is known to make, written out by hand. Each was run through Mermaid 10.9 (the bundled one): `rawOk` says whether it drew as
// it came, `expected` is what repair() makes of it, and every `expected` was checked to parse AND draw with the same Mermaid (132 of 132).
// Mermaid itself needs a browser, so here the output is pinned as it was checked.
import assert from 'assert';
import fs from 'fs';
import { createRequire } from 'module';

console.log('=== mermaid repair ===');
const require = createRequire(import.meta.url);
const R = require('../frontend/js/mermaid_repair.js');
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/mermaid_repair_cases.json', import.meta.url), 'utf8'));
assert.strictEqual(cases.length, 132);

// a diagram that already draws is not changed, except for these (each one is a deliberate, harmless-or-better change)
const MAY_CHANGE = new Set([
  'h:flow-end-label',          // [end] is quoted
  'h:flow-literal-newline',    // a literal \n in a label becomes <br/>
  'h:gantt-no-id-after',       // "after <task name>" names a task id (it parses, but fails to draw)
  'h:timeline-literal-n',      // a literal \n becomes <br>
  'h:mind-paren',              // 国内(個人/法人) was read as a shape and lost its text
  'h:mind-text-only',
  'h:gantt-after-name-id-mix',
  'h:fence-trailing'           // a closing fence left inside the diagram
]);
for (const c of cases) {
  const got = R.repair(c.code, c.tag);
  assert.strictEqual(got.code, c.expected, c.id + ': output as it was checked');
  if (c.rawOk && !MAY_CHANGE.has(c.id)) assert.strictEqual(got.code, c.code, c.id + ': a diagram that draws is left exactly as it is');
  if (c.rawOk && !MAY_CHANGE.has(c.id)) assert.deepStrictEqual(got.fixes, [], c.id + ': nothing is reported as fixed');
  // nothing the diagram says is lost: every run of Japanese text of the input is still in the output
  if (c.id !== 'h:flow-prose-first') // (the one that starts with a sentence of the AI's own: that is dropped on purpose)
  for (const word of c.code.match(/[぀-ヿ㐀-鿿]+/g) || []) assert.ok(got.code.indexOf(word) >= 0, c.id + ': "' + word + '" is still there');
  // putting it right twice changes nothing more
  const again = R.repair(got.code, '');
  assert.strictEqual(again.code, got.code, c.id + ': idempotent');
}
const changedCount = cases.filter((c) => c.expected !== c.code).length;
assert.ok(changedCount >= 50, 'the corpus has plenty of repairs (' + changedCount + ')');

// ---- what each rule does, written out
const fx = (code, tag) => R.repair(code, tag);
assert.strictEqual(fx('flowchart TD\n  A[実装(開発)] --> B[テスト(結合)]').code, 'flowchart TD\n  A["実装(開発)"] --> B["テスト(結合)"]', 'parentheses in a plain label: quoted');
assert.strictEqual(fx('flowchart TD\n  A["彼は"問題なし"と言った"] --> B["次へ"]').code, 'flowchart TD\n  A["彼は\'問題なし\'と言った"] --> B["次へ"]', 'a quote inside a quoted label');
assert.strictEqual(fx('flowchart TD\n  A --> B[リスト[1]]').code, 'flowchart TD\n  A --> B["リスト[1]"]', 'brackets inside a bracketed label');
assert.strictEqual(fx('flowchart TD\n  A -->|はい(OK)| B').code, 'flowchart TD\n  A -->|"はい(OK)"| B', 'parentheses in an edge label');
assert.strictEqual(fx('flowchart TD\n  A --> end\n  end --> B').code, 'flowchart TD\n  A --> endNode["end"]\n  endNode["end"] --> B', '`end` as a node');
assert.strictEqual(fx('flowchart TD\n  A[受付] → B[確認]').code, 'flowchart TD\n  A[受付] --> B[確認]', '→ as an arrow');
assert.strictEqual(fx('flowchart TD\n  A[受付→確認] --> B').code, 'flowchart TD\n  A[受付→確認] --> B', '→ inside a label is text');
assert.strictEqual(fx('flowchart TD\n  subgraph S1\n    A --> B').code, 'flowchart TD\n  subgraph S1\n    A --> B\nend', 'a subgraph that is never closed');
assert.strictEqual(fx('flowchart TD\n  A[/入力/] --> B[(DB)]').code, 'flowchart TD\n  A[/入力/] --> B[(DB)]', 'parallelogram and cylinder shapes are real syntax');
assert.strictEqual(fx('flowchart TD\n  A -- end --> B').code, 'flowchart TD\n  A -- end --> B', 'the word end in an edge text stays');

assert.strictEqual(fx('sequenceDiagram\n  A->>B: 確認; 実行').code, 'sequenceDiagram\n  A->>B: 確認#59; 実行', 'a ; in a message');
assert.strictEqual(fx('sequenceDiagram\n  A=>B: hi').code, 'sequenceDiagram\n  A->>B: hi', '=> as an arrow');
assert.strictEqual(fx('sequenceDiagram\n  participant end\n  A->>end: hi').code, 'sequenceDiagram\n  participant endP as end\n  A->>endP: hi', 'end as a participant');
assert.strictEqual(fx('sequenceDiagram\n  A->>B: req\n  deactivate B').code, 'sequenceDiagram\n  A->>B: req', 'a deactivate of a participant that is not active');
assert.strictEqual(fx('sequenceDiagram\n  A->>B: req\n  B-->>-A: ok').code, 'sequenceDiagram\n  A->>B: req\n  B-->>A: ok', 'a - mark of a participant that is not active');
assert.strictEqual(fx('sequenceDiagram\n  A->>+B: req\n  B-->>-A: ok').code, 'sequenceDiagram\n  A->>+B: req\n  B-->>-A: ok', '+ and - marks that match stay');
assert.strictEqual(fx('sequenceDiagram\n  loop 毎分\n    A->>B: ping\n  opt 失敗\n    B-->>A: err').code,
  'sequenceDiagram\n  loop 毎分\n    A->>B: ping\n  opt 失敗\n    B-->>A: err\n  end\n  end', 'blocks that are never closed (each end at the indent of its block)');

assert.strictEqual(fx('stateDiagram-v2\n  state Draft as "下書き"\n  [*] --> Draft').code, 'stateDiagram-v2\n  state "下書き" as Draft\n  [*] --> Draft', 'state X as "Label": the label comes first');
assert.strictEqual(fx('stateDiagram-v2\n  A --> B : 承認: 部長').code, 'stateDiagram-v2\n  A --> B : 承認： 部長', 'a second : in a transition text');
assert.strictEqual(fx('stateDiagram-v2\n  state S {\n    [*] --> a').code, 'stateDiagram-v2\n  state S {\n    [*] --> a\n}', 'a composite state that is never closed');

assert.strictEqual(fx('erDiagram\n  顧客 ||--o{ 注文 : 持つ').code, 'erDiagram\n  "顧客" ||--o{ "注文" : "持つ"', 'Japanese entity names and label: quoted');
assert.strictEqual(fx('erDiagram\n  C {\n    string 顧客ID\n    int 年齢 PK\n  }').code, 'erDiagram\n  C {\n    string attr1 "顧客ID"\n    int attr2 PK "年齢"\n  }', 'Japanese attribute names: the name moves to the comment');
assert.strictEqual(fx('erDiagram\n  A --> B : x').code, 'erDiagram\n  A }o--o{ B : x', 'an arrow as a relationship: the weakest cardinality');

assert.strictEqual(fx('mindmap\n  root((A))\n    x\n  root2((B))\n    y').code, 'mindmap\n  root((A))\n    x\n    root2((B))\n      y', 'a second root goes under the first');
assert.strictEqual(fx('mindmap\n  root((事業))\n    国内(個人/法人)\n    A[案1]').code, 'mindmap\n  root((事業))\n    国内（個人/法人）\n    A[案1]', 'parentheses in plain text; id + shape stays');

assert.strictEqual(fx('quadrantChart\n  x-axis 工数小 --> 工数大\n  y-axis 効果小 --> 効果大\n  施策A: [0.2, 0.9]').code,
  'quadrantChart\n  x-axis "工数小" --> "工数大"\n  y-axis "効果小" --> "効果大"\n  "施策A": [0.2, 0.9]', 'quadrant text in quotes');
assert.strictEqual(fx('quadrantChart\n  x-axis "L" --> "H"\n  y-axis "L" --> "H"\n  "A": [3, 9]\n  "B": [8, 2]').code,
  'quadrantChart\n  x-axis "L" --> "H"\n  y-axis "L" --> "H"\n  "A": [0.3, 0.9]\n  "B": [0.8, 0.2]', 'scores on 1..10 scale to 0..1 together');
assert.strictEqual(fx('quadrantChart\n  x-axis "L" --> "H"\n  y-axis "L" --> "H"\n  "A": [45, 80]\n  "B": [10, 100]').code,
  'quadrantChart\n  x-axis "L" --> "H"\n  y-axis "L" --> "H"\n  "A": [0.45, 0.8]\n  "B": [0.1, 1]', 'scores on 0..100 scale to 0..1 together');

assert.strictEqual(fx('pie title 言語\n  Python : 45%\n  "Go" : 15').code, 'pie title 言語\n  "Python" : 45\n  "Go" : 15', 'pie: no %, labels in quotes');
assert.strictEqual(fx('gantt\n  dateFormat YYYY-MM-DD\n  設計 :2025-04-01, 30d\n  実装 :after 設計, 30d').code,
  'gantt\n  dateFormat YYYY-MM-DD\n  設計 : t1, 2025-04-01, 30d\n  実装 : after t1, 30d', 'gantt: "after <name>" gets the task an id');
assert.strictEqual(fx('timeline\n  2020 : 創業\\n設立').code, 'timeline\n  2020 : 創業<br>設立', 'timeline: a literal \\n');

// the type line: missing (the fence was tagged with the type), buried in prose, or "mermaid" on a line of its own
assert.strictEqual(fx('title x\n2020 : a', 'timeline').code, 'timeline\ntitle x\n2020 : a');
assert.strictEqual(fx('[*] --> A', 'stateDiagram-v2').code, 'stateDiagram-v2\n[*] --> A');
assert.strictEqual(fx('flowchart TD\n  A --> B', 'flowchart TD').code, 'flowchart TD\n  A --> B', 'a type line that is there is not added again');
assert.strictEqual(fx('ここに図を示します:\nflowchart TD\n  A --> B').code, 'flowchart TD\n  A --> B');
assert.strictEqual(fx('mermaid\nflowchart TD\n  A --> B').code, 'flowchart TD\n  A --> B');
assert.strictEqual(fx('%%{init: {"theme":"dark"}}%%\nflowchart TD\n  A[x(y)] --> B').code, '%%{init: {"theme":"dark"}}%%\nflowchart TD\n  A["x(y)"] --> B', 'a directive before the type line is kept');
assert.strictEqual(fx('---\ntitle: T\n---\nflowchart TD\n  A[x(y)] --> B').code, '---\ntitle: T\n---\nflowchart TD\n  A["x(y)"] --> B', 'front matter is kept');
assert.strictEqual(fx('just some words').code, 'just some words', 'not a diagram: untouched');
assert.strictEqual(fx('', '').code, '');
assert.strictEqual(fx(undefined, undefined).code, '');

// ---- the whole answer
const answer = '### 受注業務の流れ\n```flowchart TD\n  A[受付(電話)] --> B[出荷]\n```\n\n### 受注の状態\n```stateDiagram-v2\n  [*] --> 受付\n  受付 --> 完了\n```\n\n### 予定\n```timeline\ntitle 予定\n2025年4月 : 開始\n```\n';
const fixed = R.repairAnswer(answer);
assert.strictEqual(fixed.text, '### 受注業務の流れ\n```mermaid\nflowchart TD\n  A["受付(電話)"] --> B[出荷]\n```\n\n### 受注の状態\n```mermaid\nstateDiagram-v2\n  [*] --> 受付\n  受付 --> 完了\n```\n\n### 予定\n```mermaid\ntimeline\ntitle 予定\n2025年4月 : 開始\n```\n', 'type-tagged fences become mermaid fences, and are repaired');
assert.ok(['fence-tag', 'type-line-added', 'flowchart-labels'].every((f) => fixed.fixes.indexOf(f) >= 0), 'and it says what it did: ' + fixed.fixes);
assert.strictEqual(R.repairAnswer('```\nflowchart TD\n  A --> B\n```').text, '```mermaid\nflowchart TD\n  A --> B\n```', 'an untagged fence that starts with a type line');
const fine = '### A\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n### B\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```';
assert.strictEqual(R.repairAnswer(fine).text, fine, 'an answer that is fine comes back as the same text');
assert.deepStrictEqual(R.repairAnswer(fine).fixes, []);
const other = 'Here:\n```js\nconst a = 1;\n```\n```python\nprint(1)\n```\n```\nplain\n```\n';
assert.strictEqual(R.repairAnswer(other).text, other, 'code that is not a diagram is not touched');
const open = '```timeline\ntitle x\n2020 : a\n';
assert.strictEqual(R.repairAnswer(open).text, open, 'a fence that is never closed is not touched');
assert.strictEqual(R.repairAnswer('```mermaid\r\nflowchart TD\r\n  A[x(y)] --> B\r\n```\r\n').text, '```mermaid\r\nflowchart TD\r\n  A["x(y)"] --> B\r\n```\r\n', 'CRLF stays CRLF');
assert.strictEqual(R.repairAnswer('').text, '');
assert.strictEqual(R.repairAnswer(null).text, '');

// ---- the wiring
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
assert.ok(/<script src="js\/mermaid_repair\.js\?v=[\d.]+"><\/script>/.test(html), 'the script is loaded');
assert.ok(html.indexOf('js/mermaid_repair.js') < html.indexOf('js/app.js'), 'before app.js');
assert.ok(/else if \(reqId\.startsWith\('mermaid_'\) && !errorText\) \{\s*\/\/[^\n]*\n\s*cleanedResult = stripMarkdownCodeFences\(cleanedResult, true\);\s*if \(window\.MermaidRepair\) cleanedResult = window\.MermaidRepair\.repairAnswer\(cleanedResult\)\.text;/.test(app), 'the answer of "Mermaid from a text" is repaired');
assert.ok(/svg = \(await window\.mermaid\.render\(id, drawn\)\)\.svg;\s*\} catch \(firstErr\) \{[\s\S]*?window\.MermaidRepair\.repair\(diagramCode\)\.code[\s\S]*?if \(fixed === diagramCode\) throw firstErr;[\s\S]*?window\.mermaid\.render\(id \+ 'r', drawn\)[\s\S]*?throw firstErr;/.test(app), 'a diagram that does not draw is repaired and drawn once more, and the first message is shown if that fails too');
assert.ok(/container\.dataset\.mermaidSrc = drawn;/.test(app), 'printing and export use the source that was drawn');
assert.ok(/removeMermaidLeftovers\(id \+ 'r'\)/.test(app), 'the failed second try leaves nothing in the page either');
// the prompt asks for what the rules would otherwise have to put right
const prompt = /const DEGRAM_MERMAID_SYSTEM_PROMPT = `([\s\S]*?)`;\r?\n/.exec(app)[1];
assert.ok(/The code fence language is exactly "mermaid"[^\n]*NEVER the diagram type/.test(prompt), 'the fence tag');
assert.ok(/quadrantChart: put EVERY text in double quotes/.test(prompt) && /state "Label" as ID/.test(prompt) && /exactly ONE root/.test(prompt), 'quadrant, state, mindmap');
console.log('mermaid repair tests passed');
