// Real-world Japanese IME pitfall & common mistake evaluation suite
// Tests all "あるある" input mistakes across Headings, Bullets, Quotes, Code Fences, Tasks, Slots, and Inlines.
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

console.log('=== Real-World Japanese IME Pitfall Evaluation Tests ===');

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

assert.strictEqual(typeof normPrefix, 'function', 'normalizeZenkakuMarkdownPrefix exists');
assert.strictEqual(typeof normMarkdown, 'function', 'normalizeZenkakuMarkdown exists');
assert.strictEqual(typeof normCode, 'function', 'normalizeZenkakuCode exists');
assert.strictEqual(typeof normSlot, 'function', 'normalizeIMESlotTrigger exists');

// --- 1. 見出しの入力あるある (Heading Pitfalls) ---
{
  // 1a. 全角スペース付き見出し
  assert.strictEqual(normPrefix('＃　'), '# ');
  assert.strictEqual(normPrefix('＃＃　'), '## ');
  assert.strictEqual(normPrefix('＃＃＃　'), '### ');
  assert.strictEqual(normPrefix('###　'), '### ');
  assert.strictEqual(normPrefix('  ＃　'), '  # ');

  // 1b. 半角スペース付き全角ハッシュ
  assert.strictEqual(normPrefix('＃ '), '# ');
  assert.strictEqual(normPrefix('＃＃ '), '## ');

  // 1c. 否定テスト：ハッシュタグやプログラミング言語名は見出し化しない
  assert.strictEqual(normPrefix('C＃'), 'C＃');
  assert.strictEqual(normPrefix('F＃'), 'F＃');
  assert.strictEqual(normPrefix('＃123'), '＃123');
  assert.strictEqual(normPrefix('文章の途中の＃ハッシュ'), '文章の途中の＃ハッシュ');

  console.log('PASS: Heading pitfall patterns verified.');
}

// --- 2. 箇条書き・リストの入力あるある (List & Bullet Pitfalls) ---
{
  // 2a. 日本語中黒
  assert.strictEqual(normPrefix('・ '), '- ');
  assert.strictEqual(normPrefix('・　'), '- ');
  assert.strictEqual(normPrefix('  ・ '), '  - ');

  // 2b. 長音符・全角マイナス・ダッシュによる誤爆
  assert.strictEqual(normPrefix('ー '), '- ');
  assert.strictEqual(normPrefix('ー　'), '- ');
  assert.strictEqual(normPrefix('－ '), '- ');
  assert.strictEqual(normPrefix('－　'), '- ');
  assert.strictEqual(normPrefix('― '), '- ');
  assert.strictEqual(normPrefix('―　'), '- ');

  // 2c. ハイフン・アスタリスク + 全角空白
  assert.strictEqual(normPrefix('-　'), '- ');
  assert.strictEqual(normPrefix('*　'), '* ');
  assert.strictEqual(normPrefix('+　'), '+ ');

  // 2d. 連番リスト（全角数字、全角ドット、全角空白）
  assert.strictEqual(normPrefix('１. '), '1. ');
  assert.strictEqual(normPrefix('１.　'), '1. ');
  assert.strictEqual(normPrefix('1．'), '1. ');
  assert.strictEqual(normPrefix('１．'), '1. ');
  assert.strictEqual(normPrefix('1.　'), '1. ');
  assert.strictEqual(normPrefix('１２. '), '12. ');

  // 2e. 否定テスト：文中の記号はリスト化しない
  assert.strictEqual(normPrefix('東京・大阪'), '東京・大阪');
  assert.strictEqual(normPrefix('2024-2026年'), '2024-2026年');
  assert.strictEqual(normPrefix('気温－5度'), '気温－5度');

  console.log('PASS: Bullet and list pitfall patterns verified.');
}

// --- 3. 引用の入力あるある (Blockquote Pitfalls) ---
{
  assert.strictEqual(normPrefix('＞ '), '> ');
  assert.strictEqual(normPrefix('＞　'), '> ');
  assert.strictEqual(normPrefix('>　'), '> ');
  assert.strictEqual(normPrefix('  ＞ '), '  > ');

  // 否定テスト：文中の不等号は引用化しない
  assert.strictEqual(normPrefix('A ＞ B'), 'A ＞ B');

  console.log('PASS: Blockquote pitfall patterns verified.');
}

// --- 4. コードフェンスと言語指定の入力あるある (Code Fence & Language Pitfalls) ---
{
  assert.strictEqual(normPrefix('｀｀｀'), '```');
  assert.strictEqual(normPrefix('  ｀｀｀'), '  ```');
  // 言語指定が全角英数で打たれた場合
  assert.strictEqual(normMarkdown('｀｀｀ｊｓ'), '```js');
  assert.strictEqual(normMarkdown('｀｀｀ｐｙｔｈｏｎ'), '```python');
  assert.strictEqual(normMarkdown('｀｀｀ｇｏ'), '```go');

  console.log('PASS: Code fence and language identifier patterns verified.');
}

// --- 5. タスクリスト・チェックボックスの入力あるある (Task Checkbox Pitfalls) ---
{
  assert.strictEqual(normMarkdown('- ［ ］ タスク'), '- [ ] タスク');
  assert.strictEqual(normMarkdown('- ［x］ 完了'), '- [x] 完了');
  assert.strictEqual(normMarkdown('- ［ｘ］ 完了'), '- [x] 完了');
  assert.strictEqual(normMarkdown('- [　] 全角空白タスク'), '- [ ] 全角空白タスク');

  console.log('PASS: Task checkbox pitfall patterns verified.');
}

// --- 6. コードブロック内の全角記号・空白あるある (In-Code Pitfalls) ---
{
  // 演算子・セミコロン・空白
  assert.strictEqual(normCode('ｃｏｎｓｔ　ｘ　＝　１；'), 'const x = 1;');
  assert.strictEqual(normCode('ｌｅｔ　ｙ　＋＝　２；'), 'let y += 2;');

  // 括弧類
  assert.strictEqual(normCode('ｆｕｎｃ（ａ，　ｂ）'), 'func(a, b)');
  assert.strictEqual(normCode('ａｒｒ［０］　＝　｛｝；'), 'arr[0] = {};');

  // クォート
  assert.strictEqual(normCode('”ｈｅｌｌｏ”'), '"hello"');
  assert.strictEqual(normCode('’ｗｏｒｌｄ’'), "'world'");

  // Python風インデント全角スペース
  assert.strictEqual(normCode('　　def foo():'), '  def foo():');

  // 日本語コメント・文字列リテラルは保持
  assert.strictEqual(normCode('  // これは日本語のコメントです：OK'), '  // これは日本語のコメントです:OK');

  console.log('PASS: In-code full-width symbol and space patterns verified.');
}

// --- 7. スロット記法・Wikiリンクの入力あるある (Slot & Wikilink Pitfalls) ---
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
    assert.strictEqual(res, true, `Slot trigger ${input} should match`);
    assert.strictEqual(fakeEditor.value, expected);
  }

  // 二重波括弧
  testSlot('メモ ｛｛', 'メモ {{');
  testSlot('メモ ｝｝', 'メモ }}');

  // プロンプトスロット
  testSlot('メモ ［？', 'メモ [?');
  testSlot('メモ ？］', 'メモ ?]');

  // アクションスロット
  testSlot('メモ ［！', 'メモ [!');
  testSlot('メモ ！］', 'メモ !]');

  // パイプスロット
  testSlot('メモ ［＞＞', 'メモ [>>');
  testSlot('メモ ＜＜］', 'メモ <<]');

  // 墨付き括弧スロット
  testSlot('メモ 【？', 'メモ 【?');
  testSlot('メモ 【！', 'メモ 【!');

  // Wikiリンク
  testSlot('メモ ［［', 'メモ [[');
  testSlot('メモ ］］', 'メモ ]]');

  console.log('PASS: Slot trigger and bracket pitfall patterns verified.');
}

console.log('ALL REAL-WORLD PITFALL EVALUATION TESTS PASSED!');
