// Tests for IME Zenkaku/Hankaku Guards in syki::sok
// Evaluates markdown normalization, code block lexical shields, and slot agent triggers.
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

console.log('=== IME Zenkaku/Hankaku Guard Evaluation Tests ===');

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const ctx = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
vm.createContext(ctx);
vm.runInContext(read('frontend/js/ime_guardian.js'), ctx);

// 1. Export check
assert.strictEqual(typeof ctx.normalizeZenkakuMarkdown, 'function', 'ime_guardian.js exports normalizeZenkakuMarkdown');
assert.strictEqual(typeof ctx.normalizeZenkakuCode, 'function', 'ime_guardian.js exports normalizeZenkakuCode');

// 2. Markdown Headings Normalization
{
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('＃ 見出し1'), '# 見出し1');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('＃＃　見出し2'), '## 見出し2');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('###　見出し3'), '### 見出し3');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('  ＃＃＃　インデント見出し'), '  ### インデント見出し');
  console.log('PASS: Markdown headings with full-width hash or space normalized.');
}

// 3. Markdown Lists and Bullets Normalization
{
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('・ 箇条書き1'), '- 箇条書き1');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('・　箇条書き2'), '- 箇条書き2');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('ー 箇条書き3'), '- 箇条書き3');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('－ 箇条書き4'), '- 箇条書き4');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('― 箇条書き5'), '- 箇条書き5');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('-　ハイフン全角空白'), '- ハイフン全角空白');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('*　アスタリスク全角空白'), '* アスタリスク全角空白');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('１. 連番リスト'), '1. 連番リスト');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('1.　連番全角空白'), '1. 連番全角空白');
  console.log('PASS: Markdown bullet lists and numbers normalized.');
}

// 4. Markdown Blockquotes & Code Fences
{
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('＞ 引用文'), '> 引用文');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('>　引用全角空白'), '> 引用全角空白');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('｀｀｀javascript'), '```javascript');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('｀｀｀'), '```');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('｀code｀'), '`code`');
  console.log('PASS: Markdown blockquotes and code fences normalized.');
}

// 5. Wikilinks / Brackets Normalization
{
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('［［ノートリンク］］'), '[[ノートリンク]]');
  assert.strictEqual(ctx.normalizeZenkakuMarkdown('前［［リンク］］後'), '前[[リンク]]後');
  console.log('PASS: Full-width wikilinks brackets normalized.');
}

// 6. Code Lexical Shield: Alphanumeric & Symbols inside Code
{
  // Full-width ASCII -> Half-width ASCII
  assert.strictEqual(ctx.normalizeZenkakuCode('ｃｏｎｓｔ　ｘ　＝　１；'), 'const x = 1;');
  assert.strictEqual(ctx.normalizeZenkakuCode('ｆｕｎｃ　ｍａｉｎ（）　｛'), 'func main() {');
  assert.strictEqual(ctx.normalizeZenkakuCode('”ｈｅｌｌｏ”'), '"hello"');
  assert.strictEqual(ctx.normalizeZenkakuCode('ｐｒｉｎｔ（”こんにちは”）'), 'print("こんにちは")');
  console.log('PASS: Full-width code characters normalized to half-width.');
}

// 7. Slot Agent IME Trigger Normalization in slot_agent.js
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
  assert.strictEqual(typeof normalizeIMESlotTrigger, 'function', 'normalizeIMESlotTrigger is exported');

  function testTrigger(input, expectedReplaced) {
    const fakeEditor = {
      value: input,
      selectionStart: input.length,
      selectionEnd: input.length,
      focus: () => {},
      setSelectionRange: () => {},
      dispatchEvent: () => {}
    };
    const res = normalizeIMESlotTrigger(fakeEditor, input.length, input);
    assert.strictEqual(res, true, `trigger "${input}" should return true`);
    assert.strictEqual(fakeEditor.value, expectedReplaced, `trigger "${input}" should result in "${expectedReplaced}"`);
  }

  testTrigger('some text ｛｛', 'some text {{');
  testTrigger('some text ｝｝', 'some text }}');
  testTrigger('some text ［？', 'some text [?');
  testTrigger('some text ？］', 'some text ?]');
  testTrigger('some text ［！', 'some text [!');
  testTrigger('some text ！］', 'some text !]');
  testTrigger('some text ［＞＞', 'some text [>>');
  testTrigger('some text ＜＜］', 'some text <<]');
  testTrigger('some text 【？', 'some text 【?');
  testTrigger('some text 【！', 'some text 【!');
  testTrigger('some text ［［', 'some text [[');
  testTrigger('some text ］］', 'some text ]]');
  console.log('PASS: All slot agent full-width triggers normalized.');
}

// 8. Code Block Lexical Shield & Boundary Detection
{
  const guardian = new ctx.IMEGuardian();
  assert.strictEqual(typeof guardian.isInsideCodeBlock, 'function', 'isInsideCodeBlock exists');
  assert.strictEqual(typeof guardian.isInsideCode, 'function', 'isInsideCode exists');

  const doc = 'Intro\n```js\nconst x = 1;\n```\nOutro\n`inline code` more';
  // Position inside code block:
  const insideBlockPos = doc.indexOf('const x');
  assert.strictEqual(guardian.isInsideCodeBlock(doc, insideBlockPos), true, 'detects inside code block');
  assert.strictEqual(guardian.isInsideCode(doc, insideBlockPos), true, 'detects code block via isInsideCode');

  // Position outside code block:
  const outsidePos = doc.indexOf('Outro');
  assert.strictEqual(guardian.isInsideCodeBlock(doc, outsidePos), false, 'detects outside code block');

  // Position inside inline code:
  const insideInlinePos = doc.indexOf('inline code');
  assert.strictEqual(guardian.isInsideCodeBlock(doc, insideInlinePos), false, 'not in code block');
  assert.strictEqual(guardian.isInsideCode(doc, insideInlinePos), true, 'detects inside inline code');

  console.log('PASS: Code block and inline code lexical boundary detection.');
}

console.log('ALL ZENKAKU/HANKAKU GUARD EVALUATION TESTS PASSED!');
