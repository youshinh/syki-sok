// The preview must not be mistaken for the editor. Since v2 it is a sheet of paper (--sheet) lying on a desk (--wall): a different surface from the
// editor's page (--page), a shadow instead of a frame, and a "Preview" tag in the corner. All of it is CSS: the tag is a sibling after
// #preview-pane, so it shows only while the pane does, and no script has to remember to switch it on or off.
//
// The pixel check needs a real browser (done there: the sheet's shadow, the desk on both sides, the tag hidden for an HTML page).
// This test keeps the rules from being removed or drifting apart; the geometry of the four displays is in tests/split_view_style_test.mjs.
import fs from 'fs';
import assert from 'assert';
import { tokensFor, colourOf, hex } from './lib/look_lib.mjs';

console.log('=== Preview vs editor distinction tests ===');

const css = fs.readFileSync('frontend/css/style.css', 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const html = fs.readFileSync('frontend/index.html', 'utf8').replace(/\r\n/g, '\n');

const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|\\})\\s*' + esc + '\\s*\\{([^}]*)\\}'));
  assert(m, 'rule not found: ' + selector);
  return m[1];
};

// 1. On every look and accent the sheet is not the editor's own surface, and the desk is a third one.
{
  for (const look of ['ink', 'paper']) {
    for (const accent of ['olive', 'blue', 'forest', 'charcoal', 'vermilion']) {
      const map = tokensFor(look, accent);
      const [sheet, page, wall] = ['sheet', 'page', 'wall'].map((n) => hex(colourOf(map, n)));
      assert.notStrictEqual(sheet, page, look + ' ' + accent + ': the sheet must differ from the editor\'s page');
      assert.notStrictEqual(wall, page, look + ' ' + accent + ': the desk must differ from the page');
      assert.notStrictEqual(wall, sheet, look + ' ' + accent + ': the desk must differ from the sheet');
    }
  }
  console.log('PASS: on both looks the sheet, the page and the desk are three different surfaces.');
}

// 2. The full preview and the side preview are the sheet: its colour, no frame, and a shadow (the shadow is what lifts it from the desk).
{
  for (const sel of ['#preview-pane', '.secondary-preview-pane']) {
    const body = rule(sel);
    assert(/background:\s*var\(--sheet\)/.test(body), sel + ' must be the sheet colour (var(--sheet))');
    assert(!/\bborder\s*:/.test(body) && !/outline\s*:/.test(body), sel + ' has no frame: the shadow and the desk are the edge');
    assert(!/--bg-preview|--preview-frame/.test(body), sel + ' no longer uses the tinted surface and the accent frame of v1');
  }
  assert(/box-shadow:\s*none/.test(rule('body[data-view="preview"] #preview-pane')), 'the preview alone has no shadow');
  assert(/box-shadow:\s*none/.test(rule('body[data-view="side"] .secondary-preview-pane')), 'the side preview has no shadow');
  assert(/background:\s*var\(--bg-editor\)/.test(rule('body[data-view="side"] #workspace,\nbody[data-view="preview"] #workspace')), 'the workspace uses editor background in both preview displays');
  console.log('PASS: full and side preview have no shadow or frame, seamlessly filling the pane.');
}

// 3. The tag: hidden by default, shown only next to a visible, non-HTML #preview-pane.
{
  assert(/display:\s*none\s*;/.test(rule('.preview-badge')), '.preview-badge must be hidden by default');
  assert(/position:\s*absolute\s*;/.test(rule('.preview-badge')), '.preview-badge must not take space in the layout');
  assert(/pointer-events:\s*none\s*;/.test(rule('.preview-badge')), '.preview-badge must not catch clicks');
  const shown = rule('#preview-pane:not(.hidden):not(.html-mode) ~ .preview-badge');
  assert(/display:\s*inline-flex\s*;/.test(shown), 'the tag must be shown next to a visible, non-HTML preview pane');
  // it stands at the top right of the pane
  for (const sel of ['.preview-badge', '.preview-print-btn']) {
    assert(/right:\s*/.test(rule(sel)), sel + ' has right offset');
  }
  console.log('PASS: the Preview tag is CSS-driven (hidden, shown only beside the visible Markdown preview).');

  // Side preview badge: hidden by default (especially in pair view), shown only in side view when not hidden
  assert(/display:\s*none\s*!important/.test(rule('.secondary-preview-badge')), '.secondary-preview-badge must be hidden by default');
  const sideShown = rule('body[data-view="side"] .secondary-preview-badge:not([hidden])');
  assert(/display:\s*inline-flex\s*!important/.test(sideShown), '.secondary-preview-badge must be shown only in side view when not hidden');
  console.log('PASS: secondary preview badge is hidden in pair view and shown only in side preview mode.');
}

// 4. The markup: the tag comes after #preview-pane (the ~ selector looks forward), inside the same parent, and is translated.
{
  assert(/<div id="preview-pane"[^>]*><\/div>\s*(<!--[\s\S]*?-->\s*)?<div id="preview-badge"/.test(html),
    '#preview-badge must directly follow #preview-pane (same parent, later sibling)');
  assert(/<div id="preview-badge"[^>]*data-i18n="preview"/.test(html), 'the tag must use the existing "preview" translation');
  assert(/<div id="preview-badge"[^>]*aria-hidden="true"/.test(html), 'the tag is decoration: hidden from assistive tech');
  console.log('PASS: the tag follows #preview-pane and is translated.');
}

console.log('\nAll preview distinction tests PASSED!');
