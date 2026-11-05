(function (global) {
  'use strict';

  function getLineBoundaries(val, start, end) {
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;
    return { lineStart: lineStart, lineEnd: lineEnd };
  }

  function computeMoveLineUp(val, start, end) {
    const { lineStart, lineEnd } = getLineBoundaries(val, start, end);
    if (lineStart === 0) return null; // Already at top

    const prevLineStart = val.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLineText = val.substring(prevLineStart, lineStart - 1);
    const targetText = val.substring(lineStart, lineEnd);

    const newBlock = targetText + '\n' + prevLineText;
    const newVal = val.substring(0, prevLineStart) + newBlock + val.substring(lineEnd);
    const shift = prevLineText.length + 1;
    return {
      value: newVal,
      selectionStart: start - shift,
      selectionEnd: end - shift,
      prevLineStart: prevLineStart,
      lineEnd: lineEnd,
      newBlock: newBlock,
      shift: shift
    };
  }

  function computeMoveLineDown(val, start, end) {
    const { lineStart, lineEnd } = getLineBoundaries(val, start, end);
    if (lineEnd >= val.length) return null; // Already at bottom

    const nextLineEndIdx = val.indexOf('\n', lineEnd + 1);
    const nextLineEnd = nextLineEndIdx === -1 ? val.length : nextLineEndIdx;
    const nextLineText = val.substring(lineEnd + 1, nextLineEnd);
    const targetText = val.substring(lineStart, lineEnd);

    const newBlock = nextLineText + '\n' + targetText;
    const newVal = val.substring(0, lineStart) + newBlock + val.substring(nextLineEnd);
    const shift = nextLineText.length + 1;
    return {
      value: newVal,
      selectionStart: start + shift,
      selectionEnd: end + shift,
      lineStart: lineStart,
      nextLineEnd: nextLineEnd,
      newBlock: newBlock,
      shift: shift
    };
  }

  function computeDuplicateLineDown(val, start, end) {
    const { lineStart, lineEnd } = getLineBoundaries(val, start, end);
    const targetText = val.substring(lineStart, lineEnd);
    const newVal = val.substring(0, lineEnd) + '\n' + targetText + val.substring(lineEnd);
    const shift = targetText.length + 1;
    return {
      value: newVal,
      selectionStart: start + shift,
      selectionEnd: end + shift,
      insertPos: lineEnd,
      toInsert: '\n' + targetText,
      shift: shift
    };
  }

  function computeDuplicateLineUp(val, start, end) {
    const { lineStart, lineEnd } = getLineBoundaries(val, start, end);
    const targetText = val.substring(lineStart, lineEnd);
    const newVal = val.substring(0, lineStart) + targetText + '\n' + val.substring(lineStart);
    const shift = targetText.length + 1;
    return {
      value: newVal,
      selectionStart: start + shift,
      selectionEnd: end + shift,
      insertPos: lineStart,
      toInsert: targetText + '\n',
      shift: shift
    };
  }

  function computeDeleteLine(val, start, end) {
    const { lineStart, lineEnd } = getLineBoundaries(val, start, end);
    let deleteStart = lineStart;
    let deleteEnd = lineEnd;

    if (deleteEnd < val.length && val[deleteEnd] === '\n') {
      deleteEnd += 1;
    } else if (deleteStart > 0 && val[deleteStart - 1] === '\n') {
      deleteStart -= 1;
    }

    const newVal = val.substring(0, deleteStart) + val.substring(deleteEnd);
    const newPos = Math.min(lineStart, newVal.length);
    return {
      value: newVal,
      selectionStart: newPos,
      selectionEnd: newPos,
      deleteStart: deleteStart,
      deleteEnd: deleteEnd
    };
  }

  function computeInsertLineBelow(val, start, end) {
    let lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;
    const newVal = val.substring(0, lineEnd) + '\n' + val.substring(lineEnd);
    return {
      value: newVal,
      selectionStart: lineEnd + 1,
      selectionEnd: lineEnd + 1,
      insertPos: lineEnd
    };
  }

  function computeInsertLineAbove(val, start, end) {
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const newVal = val.substring(0, lineStart) + '\n' + val.substring(lineStart);
    return {
      value: newVal,
      selectionStart: lineStart,
      selectionEnd: lineStart,
      insertPos: lineStart
    };
  }

  const api = {
    getLineBoundaries: getLineBoundaries,
    computeMoveLineUp: computeMoveLineUp,
    computeMoveLineDown: computeMoveLineDown,
    computeDuplicateLineUp: computeDuplicateLineUp,
    computeDuplicateLineDown: computeDuplicateLineDown,
    computeDeleteLine: computeDeleteLine,
    computeInsertLineAbove: computeInsertLineAbove,
    computeInsertLineBelow: computeInsertLineBelow
  };

  global.LineOperations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
