// The numbers behind "Go to Line" (Ctrl+G / Cmd+G). The modal in app.js asks for a line and then moves the caret and the scroll
// of the editor; the arithmetic that decides *where* to move is kept here so it can be tested without a page:
//   * calculateTargetPosition(editorText, targetLine): the caret offset of the first character of that line, with the line number
//     clamped to the last line of the text (a request for line 99 of a three-line note goes to its last line instead of failing);
//     null when there is nothing to go to (no text, or a line number below 1 or not a number at all);
//   * getEditorLineCount(editorText): how many lines the editor holds, which is the maximum the dialog's number field accepts;
//   * getEditorCurrentLine(editorText, selectionStart): the line the caret is already on, so the dialog opens showing where the
//     reader is. An offset outside the text is clamped rather than trusted, because selectionStart comes from the page.
// Lines are counted the way a textarea counts them: split on '\n', so a text that ends with a newline has one more (empty) line
// than it has words, and the caret sitting on a '\n' still belongs to the line before it.
(function (global) {
  'use strict';

  function calculateTargetPosition(editorText, targetLine) {
    if (typeof editorText !== 'string' || isNaN(targetLine) || targetLine < 1) return null;
    const lines = editorText.split('\n');
    const clampedLine = Math.min(Math.floor(targetLine), lines.length);
    let charPos = 0;
    for (let i = 0; i < clampedLine - 1; i++) {
      charPos += lines[i].length + 1; // +1 for the '\n' that ends each line
    }
    return { charPos: charPos, clampedLine: clampedLine };
  }

  function getEditorLineCount(editorText) {
    if (typeof editorText !== 'string' || editorText.length === 0) return 1;
    return editorText.split('\n').length;
  }

  function getEditorCurrentLine(editorText, selectionStart) {
    if (typeof editorText !== 'string') return 1;
    const pos = Math.max(0, Math.min(Number(selectionStart) || 0, editorText.length));
    return editorText.substring(0, pos).split('\n').length;
  }

  const api = {
    calculateTargetPosition: calculateTargetPosition,
    getEditorLineCount: getEditorLineCount,
    getEditorCurrentLine: getEditorCurrentLine
  };

  global.GotoLine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
