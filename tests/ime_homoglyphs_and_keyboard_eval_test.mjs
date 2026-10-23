// Evaluation test for Code fence variants, Keyboard layout proximity, and Homoglyphs
// Evaluates: ''' / """ / ・・・ / @@@ / …, wave dash ~~, table pipe |, link parens, agent mentions.
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

console.log('=== IME Homoglyphs & JIS Keyboard Layout Evaluation Tests ===');

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const ctx = { console, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(read('frontend/js/ime_guardian.js'), ctx);

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

const normPrefix = ctx.normalizeZenkakuMarkdownPrefix;
const normMarkdown = ctx.normalizeZenkakuMarkdown;
const normCode = ctx.normalizeZenkakuCode;
const normSlot = slotCtx.window.SlotAgent._normalizeIMESlotTrigger;

// 1. Code Fence Variants (JIS keyboard Shift+@ mistakes, 3 middle dots, triple quotes, ellipsis)
{
  assert.strictEqual(normPrefix('｀｀｀'), '```');
  assert.strictEqual(normPrefix('｀｀｀ｊｓ'), '```js');
  assert.strictEqual(normPrefix("'''"), '```');
  assert.strictEqual(normPrefix("'''python"), '```python');
  assert.strictEqual(normPrefix('"""'), '```');
  assert.strictEqual(normPrefix('"""go'), '```go');
  assert.strictEqual(normPrefix('・・・'), '```');
  assert.strictEqual(normPrefix('・・・ｊｓ'), '```js');
  assert.strictEqual(normPrefix('…'), '```');
  assert.strictEqual(normPrefix('@@@'), '```');
  assert.strictEqual(normPrefix('  ・・・'), '  ```');
  console.log('PASS: Code fence variants (dots, quotes, JIS @@@, ellipsis) normalized.');
}

// 2. Homoglyph Strikethrough, Bold, Links, and Mentions
{
  function testSlot(input, expected) {
    const fakeEditor = {
      value: input,
      selectionStart: input.length,
      selectionEnd: input.length,
      focus: () => {},
      setSelectionRange: () => {},
      dispatchEvent: () => {}
    };
    const res = normSlot(fakeEditor, input.length, input);
    assert.strictEqual(res, true, `Trigger ${input} should match`);
    assert.strictEqual(fakeEditor.value, expected);
  }

  // Wave dash and full-width tilde for strikethrough
  testSlot('テキスト 〜〜', 'テキスト ~~');
  testSlot('テキスト ～～', 'テキスト ~~');

  // Bold and Italic full-width
  testSlot('テキスト ＊＊', 'テキスト **');
  testSlot('テキスト ＿＿', 'テキスト __');

  // Markdown link parenthesis variations
  testSlot('[リンクタイトル]（', '[リンクタイトル](');
  testSlot('［リンクタイトル］（', '[リンクタイトル](');
  testSlot('[リンクタイトル］(', '[リンクタイトル](');
  testSlot('[リンクタイトル](https://example.com）', '[リンクタイトル](https://example.com)');

  // Agent mentions in slots: ｛＠ -> {@, ［＠ -> [@, 【＠ -> 【@
  testSlot('スロット ｛＠', 'スロット {@');
  testSlot('スロット ［＠', 'スロット [@');
  testSlot('スロット 【＠', 'スロット 【@');

  console.log('PASS: Homoglyphs and link/slot symbols normalized surgically.');
}

// 3. Table Pipe Homoglyph (｜ vs |)
{
  assert.strictEqual(normPrefix('｜ 列1 ｜ 列2 ｜'), '| 列1 | 列2 |');
  assert.strictEqual(normMarkdown('｜ 列1 ｜ 列2 ｜'), '| 列1 | 列2 |');
  console.log('PASS: Table pipe homoglyphs normalized.');
}

// 4. In-Code Yen and Homoglyphs (￥ -> \, 〜 -> ~)
{
  assert.strictEqual(normCode('const path = "C:￥￥Users";'), 'const path = "C:\\\\Users";');
  assert.strictEqual(normCode('let bitwise = 〜mask;'), 'let bitwise = ~mask;');
  assert.strictEqual(normCode('let pipe = a ｜ b;'), 'let pipe = a | b;');
  console.log('PASS: In-code Yen sign and homoglyphs normalized.');
}

// 5. Interactive Task Checkboxes & Bullet variants
{
  assert.strictEqual(normPrefix('- ［ ］'), '- [ ] ');
  assert.strictEqual(normPrefix('- ［x］'), '- [x] ');
  assert.strictEqual(normPrefix('- ［ｘ］'), '- [x] ');
  assert.strictEqual(normPrefix('- [　]'), '- [ ] ');
  assert.strictEqual(normPrefix('＊ '), '- ');
  assert.strictEqual(normPrefix('＊　'), '- ');
  assert.strictEqual(normPrefix('＋ '), '- ');
  console.log('PASS: Task checkboxes and bullet variants normalized.');
}

// 6. Horizontal Rules (3 dashes/underscores with IME on)
{
  assert.strictEqual(normPrefix('ーーー'), '---');
  assert.strictEqual(normPrefix('―――'), '---');
  assert.strictEqual(normPrefix('－－－'), '---');
  assert.strictEqual(normPrefix('＊＊＊'), '---');
  assert.strictEqual(normPrefix('＿＿＿'), '---');
  console.log('PASS: Horizontal rule variants normalized.');
}

console.log('ALL HOMOGLYPHS & KEYBOARD TESTS PASSED!');
