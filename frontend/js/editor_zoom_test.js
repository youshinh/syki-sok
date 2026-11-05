const assert = require('assert');
const EditorZoom = require('./editor_zoom.js');

console.log('=== EditorZoom Tests ===');

// 1. Clamping boundaries
assert.strictEqual(EditorZoom.clampFontSize(14), 14);
assert.strictEqual(EditorZoom.clampFontSize(9), 10, 'clamps below min 10');
assert.strictEqual(EditorZoom.clampFontSize(37), 36, 'clamps above max 36');
assert.strictEqual(EditorZoom.clampFontSize('20'), 20, 'parses string numbers');
assert.strictEqual(EditorZoom.clampFontSize(NaN), 14, 'defaults on NaN');
assert.strictEqual(EditorZoom.clampFontSize(undefined), 14, 'defaults on undefined');

// 2. Zoom In / Out / Reset
assert.strictEqual(EditorZoom.calculateZoomIn(14), 15);
assert.strictEqual(EditorZoom.calculateZoomIn(36), 36, 'cannot exceed max 36');
assert.strictEqual(EditorZoom.calculateZoomOut(14), 13);
assert.strictEqual(EditorZoom.calculateZoomOut(10), 10, 'cannot fall below min 10');
assert.strictEqual(EditorZoom.calculateZoomReset(), 14);

// 3. Storage mock
const mockStorage = {
  data: {},
  getItem(k) { return this.data[k] || null; },
  setItem(k, v) { this.data[k] = v; }
};

assert.strictEqual(EditorZoom.loadSavedFontSize(mockStorage), 14, 'defaults when empty');
EditorZoom.saveFontSize(22, mockStorage);
assert.strictEqual(mockStorage.data[EditorZoom.STORAGE_KEY], '22');
assert.strictEqual(EditorZoom.loadSavedFontSize(mockStorage), 22);

EditorZoom.saveFontSize(50, mockStorage);
assert.strictEqual(mockStorage.data[EditorZoom.STORAGE_KEY], '36', 'saved value clamped');

console.log('All EditorZoom tests passed.');
