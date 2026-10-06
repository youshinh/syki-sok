// Which of the four displays the window is in, and the arithmetic of the divider between two pages (v2, docs/design/v2-plan-P4-P5.md).
//
//   page      one page (the editor alone)
//   pair      two editors side by side, with the gutter between them
//   side      the editor and, beside it, the preview of a note on a sheet of paper
//   preview   the preview alone, a sheet of paper on the desk
//
// The state of the app is three variables (isPreviewMode, isSplitMode, secondaryViewMode); app.js (applyViewMode) puts the answer of
// viewOf() on <body data-view>, and the stylesheet reads that one attribute. The divider's ratio is the share of the left page in the
// room the two pages SHARE: the window's width minus the divider's own width (the gutter is 24px wide now, so "half the window" would
// not make two equal pages). Pure functions, no DOM: usable in Node tests.
(function (global) {
  'use strict';

  const MIN_RATIO = 0.15;      // the left page is never narrower than this share of the room ...
  const MAX_RATIO = 0.85;      // ... nor wider than this one
  const DEFAULT_RATIO = 0.5;
  const KEY_STEP = 0.02;       // an arrow key: two points
  const KEY_STEP_BIG = 0.1;    // with Shift: ten points

  // state: { isPreviewMode, isSplitMode, secondaryViewMode } -> 'page' | 'pair' | 'side' | 'preview'
  function viewOf(state) {
    const s = state || {};
    if (s.isPreviewMode) return 'preview';
    if (s.isSplitMode) return s.secondaryViewMode === 'preview' ? 'side' : 'pair';
    return 'page';
  }

  function clampRatio(ratio) {
    const r = Number(ratio);
    if (!Number.isFinite(r)) return DEFAULT_RATIO;
    return Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));
  }

  // The left page's share after the divider was dragged `dxPx` from where it was picked up (the left page was `startLeftPx` wide then).
  // totalPx is the workspace's width, dividerPx the divider's. null when there is no room to share (a window that is not laid out).
  function ratioAfterDrag(startLeftPx, dxPx, totalPx, dividerPx) {
    const room = Number(totalPx) - (Number(dividerPx) || 0);
    if (!(room > 0)) return null;
    const left = Number(startLeftPx) + (Number(dxPx) || 0);
    if (!Number.isFinite(left)) return null;
    return clampRatio(left / room);
  }

  // What a key does to the divider (it has the keyboard focus): the new ratio, or null for a key it does not handle.
  //   ArrowLeft / ArrowRight  two points (ten with Shift)      Home / End  the narrowest / the widest left page      Enter  half and half
  function ratioAfterKey(ratio, key, shift) {
    const step = shift ? KEY_STEP_BIG : KEY_STEP;
    switch (key) {
      case 'ArrowLeft': return clampRatio(clampRatio(ratio) - step);
      case 'ArrowRight': return clampRatio(clampRatio(ratio) + step);
      case 'Home': return MIN_RATIO;
      case 'End': return MAX_RATIO;
      case 'Enter': return DEFAULT_RATIO;
      default: return null;
    }
  }

  // aria-valuenow of the divider: the left page's share, in whole percent.
  function percentOf(ratio) {
    return Math.round(clampRatio(ratio) * 100);
  }

  // The value of the left page's flex-basis: its share of the room the divider leaves (a CSS calc, so the window can be resized without
  // a script). `dividerVar` is the custom property that holds the divider's width in the stylesheet.
  function basisOf(ratio, dividerVar) {
    return 'calc((100% - var(' + (dividerVar || '--split-w') + ', 5px)) * ' + clampRatio(ratio).toFixed(4) + ')';
  }

  const api = { viewOf, clampRatio, ratioAfterDrag, ratioAfterKey, percentOf, basisOf, MIN_RATIO, MAX_RATIO, DEFAULT_RATIO, KEY_STEP, KEY_STEP_BIG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ViewLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
