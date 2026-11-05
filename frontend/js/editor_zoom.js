// Editor font zoom (Ctrl+= / Ctrl+-) calculation and persistence logic.
(function (global) {
  'use strict';

  const DEFAULT_FONT_SIZE = 14;
  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 36;
  const STORAGE_KEY = 'syki_font_size';

  function clampFontSize(size) {
    const n = parseInt(size, 10);
    if (isNaN(n)) return DEFAULT_FONT_SIZE;
    return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, n));
  }

  function calculateZoomIn(currentSize) {
    return clampFontSize((parseInt(currentSize, 10) || DEFAULT_FONT_SIZE) + 1);
  }

  function calculateZoomOut(currentSize) {
    return clampFontSize((parseInt(currentSize, 10) || DEFAULT_FONT_SIZE) - 1);
  }

  function calculateZoomReset() {
    return DEFAULT_FONT_SIZE;
  }

  function loadSavedFontSize(storage) {
    try {
      const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!store) return DEFAULT_FONT_SIZE;
      const saved = store.getItem(STORAGE_KEY);
      return saved ? clampFontSize(saved) : DEFAULT_FONT_SIZE;
    } catch (e) {
      return DEFAULT_FONT_SIZE;
    }
  }

  function saveFontSize(size, storage) {
    const clamped = clampFontSize(size);
    try {
      const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (store) store.setItem(STORAGE_KEY, clamped.toString());
    } catch (e) {}
    return clamped;
  }

  const api = {
    DEFAULT_FONT_SIZE: DEFAULT_FONT_SIZE,
    MIN_FONT_SIZE: MIN_FONT_SIZE,
    MAX_FONT_SIZE: MAX_FONT_SIZE,
    STORAGE_KEY: STORAGE_KEY,
    clampFontSize: clampFontSize,
    calculateZoomIn: calculateZoomIn,
    calculateZoomOut: calculateZoomOut,
    calculateZoomReset: calculateZoomReset,
    loadSavedFontSize: loadSavedFontSize,
    saveFontSize: saveFontSize
  };

  global.EditorZoom = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
