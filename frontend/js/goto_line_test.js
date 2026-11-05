// Tests for goto_line.js: the arithmetic of "Go to Line" (Ctrl+G) — where the caret must land for a requested line, how many
// lines the number field may accept, and which line the caret is already on when the dialog opens.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const GotoLine = require('./goto_line.js');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL: ' + name);
    console.log(e && e.stack ? e.stack : e);
  }
}

// 'alpha\nbravo\ncharlie' — lines of 5, 5 and 7 characters, so line 2 starts at 6 and line 3 at 12.
const THREE_LINES = 'alpha\nbravo\ncharlie';

// ---- calculateTargetPosition -----------------------------------------------------------------

check('calculateTargetPosition: line 2 of a three-line note starts after the first line and its newline', () => {
  const got = GotoLine.calculateTargetPosition(THREE_LINES, 2);
  assert.deepStrictEqual(got, { charPos: 6, clampedLine: 2 });
  assert.strictEqual(THREE_LINES.slice(6, 11), 'bravo', 'charPos must land on the first character of the asked-for line');
  assert.deepStrictEqual(GotoLine.calculateTargetPosition(THREE_LINES, 1), { charPos: 0, clampedLine: 1 });
  assert.deepStrictEqual(GotoLine.calculateTargetPosition(THREE_LINES, 3), { charPos: 12, clampedLine: 3 });
  assert.strictEqual(THREE_LINES.slice(12), 'charlie');
});

check('calculateTargetPosition: line 99 of a three-line note goes to its last line, not past the text', () => {
  assert.deepStrictEqual(GotoLine.calculateTargetPosition(THREE_LINES, 99), { charPos: 12, clampedLine: 3 });
  assert.strictEqual(GotoLine.calculateTargetPosition(THREE_LINES, 4).clampedLine, 3, 'one past the end clamps too');
  assert.strictEqual(GotoLine.calculateTargetPosition('one line only', 5).charPos, 0, 'a single-line note: line 1 is the only line');
  assert.strictEqual(GotoLine.calculateTargetPosition(THREE_LINES, 2.7).clampedLine, 2, 'a fractional request is floored');
  // a note that ends with a newline has one more (empty) line, and going to it lands at the very end of the text
  const ends = 'alpha\nbravo\n';
  assert.deepStrictEqual(GotoLine.calculateTargetPosition(ends, 3), { charPos: 12, clampedLine: 3 });
  assert.strictEqual(ends.slice(12), '');
});

check('calculateTargetPosition: nothing to go to when the line number is below 1 or not a number', () => {
  for (const bad of [0, -1, -99, NaN, Infinity * -1]) {
    assert.strictEqual(GotoLine.calculateTargetPosition(THREE_LINES, bad), null, 'line ' + bad);
  }
  assert.strictEqual(GotoLine.calculateTargetPosition(THREE_LINES, undefined), null);
  assert.strictEqual(GotoLine.calculateTargetPosition(THREE_LINES, 'two'), null, 'not a number');
  const typed = GotoLine.calculateTargetPosition(THREE_LINES, '3'); // parseInt already turns the input field into a number; a numeric string works too
  assert.strictEqual(typed.clampedLine, 3);
  assert.strictEqual(typed.charPos, 12);
});

check('calculateTargetPosition: nothing to go to when there is no editor text to count', () => {
  for (const bad of [null, undefined, 42, {}, ['alpha'], true]) {
    assert.strictEqual(GotoLine.calculateTargetPosition(bad, 2), null, 'text ' + typeof bad);
  }
  assert.deepStrictEqual(GotoLine.calculateTargetPosition('', 1), { charPos: 0, clampedLine: 1 }, 'an empty note has one line');
});

// ---- getEditorLineCount ----------------------------------------------------------------------

check('getEditorLineCount: an empty note still has the one line the caret is on', () => {
  assert.strictEqual(GotoLine.getEditorLineCount(''), 1);
  assert.strictEqual(GotoLine.getEditorLineCount(null), 1);
  assert.strictEqual(GotoLine.getEditorLineCount(undefined), 1);
  assert.strictEqual(GotoLine.getEditorLineCount(7), 1, 'not a string');
});

check('getEditorLineCount: a single line without a newline is one line', () => {
  assert.strictEqual(GotoLine.getEditorLineCount('one line only'), 1);
  assert.strictEqual(GotoLine.getEditorLineCount('a'), 1);
});

check('getEditorLineCount: multi-line text is counted as a textarea counts it', () => {
  assert.strictEqual(GotoLine.getEditorLineCount(THREE_LINES), 3);
  assert.strictEqual(GotoLine.getEditorLineCount('a\nb'), 2);
  assert.strictEqual(GotoLine.getEditorLineCount('a\nb\n'), 3, 'the empty line after the last newline counts');
  assert.strictEqual(GotoLine.getEditorLineCount('\n'), 2);
  assert.strictEqual(GotoLine.getEditorLineCount('a\r\nb'), 2, 'a lone carriage return is not a line of its own');
});

// ---- getEditorCurrentLine --------------------------------------------------------------------

check('getEditorCurrentLine: the start of the text is line 1', () => {
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, 0), 1);
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, 5), 1, 'the caret on the first newline still belongs to line 1');
  assert.strictEqual(GotoLine.getEditorCurrentLine('', 0), 1);
});

check('getEditorCurrentLine: just past a newline is the next line', () => {
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, 6), 2);
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, 10), 2, 'the last character of line 2');
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, 12), 3);
});

check('getEditorCurrentLine: the end of the text is its last line', () => {
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, THREE_LINES.length), 3);
  assert.strictEqual(GotoLine.getEditorCurrentLine('a\nb\n', 4), 3, 'a note that ends with a newline: the caret is on the empty line');
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, THREE_LINES.length), GotoLine.getEditorLineCount(THREE_LINES),
    'the line the caret can reach last is the line count');
});

check('getEditorCurrentLine: an offset outside the text is clamped, never trusted', () => {
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, -5), 1);
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, -1), 1);
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, 9999), 3, 'past the end: the last line');
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, undefined), 1);
  assert.strictEqual(GotoLine.getEditorCurrentLine(THREE_LINES, 'abc'), 1, 'not a number');
  assert.strictEqual(GotoLine.getEditorCurrentLine(null, 5), 1, 'no text at all');
});

// ---- the module shape ------------------------------------------------------------------------

check('the module is usable from a page as well as from a test', () => {
  for (const key of ['calculateTargetPosition', 'getEditorLineCount', 'getEditorCurrentLine']) {
    assert.strictEqual(typeof GotoLine[key], 'function', 'missing: ' + key);
  }
  const ctx = { window: {} }; // no module in a page: the functions hang off window.GotoLine
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'goto_line.js'), 'utf8'), ctx);
  assert.ok(ctx.window.GotoLine, 'window.GotoLine is not set');
  // the page's own objects come from another realm, so the fields are compared rather than the whole result
  const inPage = ctx.window.GotoLine.calculateTargetPosition(THREE_LINES, 99);
  assert.strictEqual(inPage.clampedLine, 3);
  assert.strictEqual(inPage.charPos, 12);
  assert.strictEqual(ctx.window.GotoLine.getEditorLineCount(THREE_LINES), 3);
  assert.strictEqual(ctx.window.GotoLine.getEditorCurrentLine(THREE_LINES, 6), 2);
});

check('the same answers app.js gives today', () => {
  // openGotoLineModal / gotoLineNumber in app.js: the max of the number field, the line it opens showing, and the caret offset
  const editorValue = 'use Ctrl+G\njump to a line\nand scroll there\n';
  assert.strictEqual(GotoLine.getEditorLineCount(editorValue), Number(editorValue.split('\n').length));
  assert.strictEqual(GotoLine.getEditorCurrentLine(editorValue, 15), editorValue.substring(0, 15).split('\n').length);
  const target = 2;
  assert.strictEqual(GotoLine.calculateTargetPosition(editorValue, target).charPos,
    editorValue.split('\n').slice(0, target - 1).reduce((n, l) => n + l.length + 1, 0));
});

if (failed) {
  console.log(failed + ' goto_line check(s) failed');
  process.exit(1);
}
console.log('All goto_line tests passed.');
