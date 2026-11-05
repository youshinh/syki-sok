import assert from 'node:assert/strict';
import LineOperations from '../frontend/js/line_operations.js';

const {
  getLineBoundaries,
  computeMoveLineUp,
  computeMoveLineDown,
  computeDuplicateLineDown,
  computeDuplicateLineUp,
  computeDeleteLine,
  computeInsertLineBelow,
  computeInsertLineAbove
} = LineOperations;

console.log("=== Line Operations Evaluation Tests ===");

// 1. Move Line Up & Down
{
  const text = "line1\nline2\nline3";
  // Cursor on line2 (index 8)
  const movedUp = computeMoveLineUp(text, 8, 8);
  assert.equal(movedUp.value, "line2\nline1\nline3");
  assert.equal(movedUp.selectionStart, 2);

  // Move top line up should return null
  assert.equal(computeMoveLineUp("line1\nline2", 2, 2), null);

  // Move down
  const movedDown = computeMoveLineDown(text, 8, 8);
  assert.equal(movedDown.value, "line1\nline3\nline2");
  assert.equal(movedDown.selectionStart, 14);

  // Move bottom line down should return null
  assert.equal(computeMoveLineDown(text, 14, 14), null);
  console.log("PASS: Test 1 (Move line up/down)");
}

// 2. Multi-line Selection Move
{
  const text = "line1\nline2\nline3\nline4";
  // Select line2 to line3
  const start = 6; // 'l' in line2
  const end = 17; // '3' in line3
  const movedDown = computeMoveLineDown(text, start, end);
  assert.equal(movedDown.value, "line1\nline4\nline2\nline3");
  console.log("PASS: Test 2 (Multi-line selection move)");
}

// 3. Duplicate Line
{
  const text = "alpha\nbeta\ngamma";
  const dupDown = computeDuplicateLineDown(text, 7, 7); // on 'beta'
  assert.equal(dupDown.value, "alpha\nbeta\nbeta\ngamma");

  const dupUp = computeDuplicateLineUp(text, 7, 7);
  assert.equal(dupUp.value, "alpha\nbeta\nbeta\ngamma");
  console.log("PASS: Test 3 (Duplicate line up/down)");
}

// 4. Delete Line
{
  const text = "one\ntwo\nthree";
  const delMid = computeDeleteLine(text, 5, 5); // on 'two'
  assert.equal(delMid.value, "one\nthree");

  const delTop = computeDeleteLine("one\ntwo", 1, 1);
  assert.equal(delTop.value, "two");

  const delBottom = computeDeleteLine("one\ntwo", 5, 5);
  assert.equal(delBottom.value, "one");
  console.log("PASS: Test 4 (Delete line)");
}

// 5. Insert Line Above & Below
{
  const text = "hello\nworld";
  const insBelow = computeInsertLineBelow(text, 2, 2);
  assert.equal(insBelow.value, "hello\n\nworld");
  assert.equal(insBelow.selectionStart, 6);

  const insAbove = computeInsertLineAbove(text, 8, 8); // on 'world'
  assert.equal(insAbove.value, "hello\n\nworld");
  assert.equal(insAbove.selectionStart, 6);
  console.log("PASS: Test 5 (Insert line above/below)");
}

console.log("All 5 Line Operations evaluation tests passed successfully!");
