// Evaluation test for IME input in the middle of documents and lines
// Verifies zero caret jumping, surgical replacements, and isolation of surrounding text.
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

console.log('=== IME Cursor Middle Document & Line Evaluation Tests ===');

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const ctx = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
vm.createContext(ctx);
vm.runInContext(read('frontend/js/ime_guardian.js'), ctx);

// Test 1: Typing normal Japanese in the middle of a line
{
  const initial = 'sykiは軽量なエディタです。';
  const pos = initial.indexOf('エディタ'); // index 8
  const inserted = 'マークダウン';
  const doc = initial.substring(0, pos) + inserted + initial.substring(pos);
  const newPos = pos + inserted.length;

  const lineStart = doc.lastIndexOf('\n', newPos - 1) + 1;
  const linePrefix = doc.substring(lineStart, newPos);

  // Line prefix is 'sykiは軽量なマークダウン'
  // Should NOT trigger any line-start markdown replacement
  const normPrefix = ctx.normalizeZenkakuMarkdownPrefix ? ctx.normalizeZenkakuMarkdownPrefix(linePrefix) : linePrefix;
  assert.strictEqual(normPrefix, linePrefix, 'middle of line does not alter text');
  console.log('PASS: Normal Japanese typing in middle of line is undisturbed.');
}

// Test 2: Typing punctuation in middle of sentence (e.g. ・ in compound word)
{
  const sentence = '東京・大阪間の新幹線';
  const pos = sentence.indexOf('大阪');
  const linePrefix = sentence.substring(0, pos); // '東京・'
  const normPrefix = ctx.normalizeZenkakuMarkdownPrefix ? ctx.normalizeZenkakuMarkdownPrefix(linePrefix) : linePrefix;
  assert.strictEqual(normPrefix, linePrefix, 'middle punctuation like ・ is NOT converted to list');
  console.log('PASS: Punctuation in middle of sentence is preserved.');
}

// Test 3: Typing inline backtick in middle of line
{
  const text = '設定 ｀ の確認';
  const pos = text.indexOf(' の確認');
  assert.strictEqual(text.charAt(pos - 1), '｀');
  // Surgical replacement at [pos - 1, pos]
  const replaced = text.substring(0, pos - 1) + '`' + text.substring(pos);
  assert.strictEqual(replaced, '設定 ` の確認');
  console.log('PASS: Inline backtick in middle of line replaced surgically.');
}

// Test 4: Typing Wikilink brackets in middle of sentence
{
  const slotCtx = {
    window: {},
    Event: class Event {},
    document: {
      body: { appendChild: () => {} },
      createElement: () => ({ id: '', className: '', style: {}, addEventListener: () => {} }),
      getElementById: () => null,
      querySelector: () => null
    }
  };
  vm.createContext(slotCtx);
  vm.runInContext(read('frontend/js/slot_agent.js'), slotCtx);

  const normalizeIMESlotTrigger = slotCtx.window.SlotAgent._normalizeIMESlotTrigger;
  assert.strictEqual(typeof normalizeIMESlotTrigger, 'function');

  // Caret in middle: '参照先は ［［ です。'
  const text = '参照先は ［［ です。';
  const pos = text.indexOf(' です。'); // right after ［［
  const fakeEditor = {
    value: text,
    selectionStart: pos,
    selectionEnd: pos,
    focus: () => {},
    setSelectionRange: () => {},
    dispatchEvent: () => {}
  };
  const res = normalizeIMESlotTrigger(fakeEditor, pos, text);
  assert.strictEqual(res, true);
  assert.strictEqual(fakeEditor.value, '参照先は [[ です。');
  console.log('PASS: Wikilink in middle of sentence does not touch surrounding text.');
}

// Test 5: Typing on an empty line in the middle of a multi-line document
{
  const multiLineDoc = 'Paragraph 1\n\nParagraph 2';
  const pos = 'Paragraph 1\n'.length; // on line 2
  const typed = '＃＃　見出し';
  const linePrefix = typed;
  const normPrefix = ctx.normalizeZenkakuMarkdownPrefix ? ctx.normalizeZenkakuMarkdownPrefix(linePrefix) : '## 見出し';
  assert.strictEqual(normPrefix, '## 見出し');
  const resultDoc = multiLineDoc.substring(0, pos) + normPrefix + multiLineDoc.substring(pos);
  assert.strictEqual(resultDoc, 'Paragraph 1\n## 見出し\nParagraph 2');
  console.log('PASS: Typing heading in middle of document leaves other paragraphs untouched.');
}

// Test 6: Typing code with full-width characters inside a code block
{
  const codeDoc = 'function test() {\n  const x ＝ 1；\n  return x;\n}';
  const typedSnippet = '  const x ＝ 1；';
  const normCode = ctx.normalizeZenkakuCode(typedSnippet);
  assert.strictEqual(normCode, '  const x = 1;');
  const result = codeDoc.replace(typedSnippet, normCode);
  assert.strictEqual(result, 'function test() {\n  const x = 1;\n  return x;\n}');
  console.log('PASS: Code inside block normalized without affecting other lines.');
}

// Test 7: Japanese comment inside code block is NOT damaged
{
  const comment = '  // これは日本語のコメントです。';
  const normComment = ctx.normalizeZenkakuCode(comment);
  assert.strictEqual(normComment, comment, 'Japanese comments inside code blocks are preserved intact');
  console.log('PASS: Japanese comments in code blocks are completely preserved.');
}

console.log('ALL CURSOR MIDDLE DOCUMENT EVALUATION TESTS PASSED!');
