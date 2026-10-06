// v2 P4: the RULES of the four displays in the stylesheets (the pixels were looked at in the real app, in both looks, at 1120 and 600 px and in forced colours).
// A rule here is something a later change could quietly undo:
//   * the divider is --split-w wide and the left page leaves exactly that out of its basis; in a pair of editors it is a gutter (a shadow across
//     its middle, dots that fade towards both sides, no line), beside a preview only a grip; rested on, dragged or focused it shows the accent line;
//     <body data-boundary> picks dots / shade / line;
//   * the page that has the keyboard shows a 2px accent line at its top (pair and side only), no outline, no frame;
//   * the preview is a sheet on a desk: the desk is the workspace's background (side, preview), the sheet is the preview box itself (no wrapper,
//     the tests and print.css know the #workspace > #preview-pane chain), centred and --sheet-max wide at most, with a shadow; an HTML note fills the pane;
//   * both pages keep the same room at the top for the right page's name band, which is a small band and not a bar; the right strip starts under it;
//   * a narrow window and forced colours have their own rules; nothing here uses what macOS 10.15 (Safari 15.6) cannot read;
//   * on paper (print.css) none of it exists: no shadow, no margin, no width of its own.
// The block that takes a mutation of a source is the mutation check at the end: each break must make styleProblems() say so.
//
// Node only. Run: node tests/split_view_style_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const files = {
  style: noComments(read('frontend/css/style.css')),
  chrome: noComments(read('frontend/css/chrome.css')),
  print: noComments(read('frontend/css/print.css')),
  tokens: noComments(read('frontend/css/tokens.css'))
};

const squash = (s) => s.replace(/\s+/g, ' ').trim();
// the declarations of every rule whose selector list is exactly `selector` (whitespace-insensitive, "a,\nb" = "a, b")
function decls(css, selector) {
  const want = squash(selector);
  const found = [];
  for (const m of css.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) if (squash(m[1]) === want) found.push(m[2]);
  return found.length ? found.join('\n') : null;
}
const prop = (d, name) => {
  if (d === null) return null;
  const m = d.match(new RegExp('(?:^|[;\\s])' + name.replace(/[-]/g, '\\-') + ':\\s*([^;]+);'));
  return m ? squash(m[1]) : null;
};
// the text inside the braces of the first block that starts with `head` (an at-rule), or null
function block(css, head) {
  const i = css.indexOf(head);
  if (i < 0) return null;
  const open = css.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < css.length; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}' && --depth === 0) return css.slice(open + 1, k);
  }
  return null;
}

// every block that starts with `head` (an at-rule), cut out: [css without them, their inner texts joined]
function cutBlocks(css, head) {
  let rest = css, inner = '';
  for (;;) {
    const i = rest.indexOf(head);
    if (i < 0) return [rest, inner];
    const open = rest.indexOf('{', i);
    let depth = 0, end = -1;
    for (let k = open; k < rest.length; k++) {
      if (rest[k] === '{') depth++;
      else if (rest[k] === '}' && --depth === 0) { end = k; break; }
    }
    if (end < 0) return [rest, inner];
    inner += rest.slice(open + 1, end) + '\n';
    rest = rest.slice(0, i) + rest.slice(end + 1);
  }
}

function styleProblems(f) {
  const p = [];
  const need = (cond, text) => { if (!cond) p.push(text); };
  const { chrome, print, tokens } = f;
  // the rules for forced colours are judged on their own; everything else is judged without them (a selector used in both would otherwise add up)
  const [style, forcedText] = cutBlocks(f.style, '@media (forced-colors: active)');

  // ---- the divider
  need(prop(decls(style, '#editor-pane, .pane-resizer'), '--split-w') === 'var(--gutter-w)', 'the divider and the left page start from the gutter\'s width (--split-w: var(--gutter-w))');
  need(prop(decls(style, 'body[data-boundary="line"] #editor-pane, body[data-boundary="line"] .pane-resizer'), '--split-w') === '5px', 'the thin line is 5px wide');
  const rz = decls(style, '.pane-resizer');
  need(rz !== null, 'there is a .pane-resizer rule');
  need(prop(rz, 'width') === 'var(--split-w)' && prop(rz, 'flex') === '0 0 var(--split-w)', 'the divider is --split-w wide and does not shrink or grow (the left page leaves exactly that out of its basis)');
  need(prop(rz, 'background') === 'var(--gutter-shade)', 'the gutter: the shadow across its middle (--gutter-shade)');
  need(prop(rz, 'cursor') === 'col-resize' && prop(rz, 'height') === '100%', 'the pointer says it can be dragged, and it is as tall as the pages');
  need(!/border-left\s*:/.test(rz || '') && !/--border-color/.test(rz || ''), 'no line of its own in the gutter: the shadow and the dots are the divider');
  need(!/accent-color/.test(rz || ''), 'and it is not filled with the accent when it is rested on');
  const dots = decls(style, '.pane-resizer::before');
  need(dots !== null && /radial-gradient\([^)]*var\(--gutter-dot\)/.test(dots), 'the dots are a radial-gradient of --gutter-dot');
  need(dots !== null && prop(dots, 'background-size') === '8px 8px', 'on an 8px grid');
  need(dots !== null && /-webkit-mask-image:\s*linear-gradient/.test(dots) && /(^|[;\s])mask-image:\s*linear-gradient/.test(dots), 'the dots fade towards both sides with a mask, written with and without the prefix (Safari up to 15.3 needs -webkit-)');
  need(dots !== null && dots.indexOf('-webkit-mask-image') < dots.search(/(^|[;\s])mask-image/), 'the prefixed property comes first');
  need(dots !== null && /pointer-events:\s*none/.test(dots) && prop(dots, 'inset') === '0', 'and they take no pointer events');
  need(dots !== null && !/animation|transition|will-change|filter/.test(dots), 'the dots never change: nothing repaints them while the pages scroll');
  const line = decls(style, '.pane-resizer::after');
  need(line !== null && prop(line, 'background') === 'var(--accent-hover)' && prop(line, 'width') === '2px' && prop(line, 'opacity') === '0', 'a 2px line of the accent, invisible until it is wanted');
  need(prop(decls(style, '.pane-resizer:hover::after, .pane-resizer.resizing::after'), 'opacity') === '1', 'it shows when the divider is rested on or dragged');
  need(prop(decls(style, '.pane-resizer:focus-visible::after'), 'opacity') === '1', 'and when the keyboard is on it (a rule of its own: an engine that does not know :focus-visible drops a whole rule that lists it)');
  need(prop(decls(style, '.pane-resizer:focus-visible'), 'outline') === 'none', 'the accent line is the keyboard\'s mark on the divider: the general ring would frame a 24px gutter (forced colours draw their own outline)');
  need(prop(decls(style, 'body[data-boundary="shade"] .pane-resizer::before, body[data-boundary="line"] .pane-resizer::before'), 'display') === 'none', 'no dots with the shadow-only look, or with the thin line');
  const thin = decls(style, 'body[data-boundary="line"] .pane-resizer');
  need(thin !== null && prop(thin, 'background') === 'none' && prop(thin, 'border-left') === '1px solid var(--hair)', 'the thin look: a 1px hairline and nothing else');

  // ---- the page that has the keyboard
  const focusSel = 'body[data-view="pair"] #editor-pane.pane-focused::before, body[data-view="pair"] #secondary-pane.pane-focused::before, body[data-view="side"] #editor-pane.pane-focused::before, body[data-view="side"] #secondary-pane.pane-focused::before';
  const focus = decls(style, focusSel);
  need(focus !== null, 'the focused page has a line, in a pair and beside a preview only (not on one page)');
  need(focus !== null && prop(focus, 'height') === '2px' && prop(focus, 'background') === 'var(--pane-focus)' && prop(focus, 'top') === '0', 'a 2px line of --pane-focus along the top edge of the page');
  need(focus !== null && Number(prop(focus, 'z-index')) > 100, 'over the header bar (z-index 100), so it does not fade with the bar and no text is struck through when the bar is away');
  need(focus !== null && /pointer-events:\s*none/.test(focus), 'that takes no pointer events');
  need(!/outline-pane-focus/.test(style), 'the old 1px outline of the focused page is gone');
  need(prop(decls(style, '#secondary-pane'), 'position') === 'relative', 'the right page holds the line and the band (position: relative)');

  // ---- the desk and the sheets
  need(prop(decls(style, 'body[data-view="side"] #workspace, body[data-view="preview"] #workspace'), 'background') === 'var(--bg-editor)', 'the workspace has editor background in preview displays');
  need(prop(decls(style, 'body[data-view="side"] #secondary-pane'), 'background') === 'var(--bg-editor)', 'the right page has editor background beside a preview');
  const pv = decls(style, 'body[data-view="preview"] #preview-pane');
  need(pv !== null && prop(pv, 'width') === '100%', 'the preview alone: 100% width');
  need(pv !== null && prop(pv, 'margin') === '0' && prop(pv, 'flex') === '1', 'fills workspace');
  need(pv !== null && prop(pv, 'box-shadow') === 'none', 'without shadow');
  const pvh = decls(style, 'body[data-view="preview"] #preview-pane.html-mode');
  need(pvh !== null && prop(pvh, 'width') === 'auto' && prop(pvh, 'margin') === '0' && prop(pvh, 'box-shadow') === 'none' && prop(pvh, 'flex') === '1', 'an HTML note fills the window: no desk, no shadow');
  const sd = decls(style, 'body[data-view="side"] .secondary-preview-pane');
  need(sd !== null && prop(sd, 'margin') === '0' && prop(sd, 'box-shadow') === 'none', 'beside the editor: no margin and no shadow');
  need(sd !== null && prop(sd, '--pad-top-extra') === 'var(--pane-band-h)', 'the sheet keeps the same room at the top as the editor beside it');
  const sdh = decls(style, 'body[data-view="side"] .secondary-preview-pane.html-mode');
  need(sdh !== null && prop(sdh, 'margin') === '0' && prop(sdh, 'box-shadow') === 'none', 'an HTML note beside the editor fills its pane');
  for (const sel of ['#preview-pane', '.secondary-preview-pane']) {
    const d = decls(style, sel);
    need(d !== null && prop(d, 'background') === 'var(--sheet)' && !/\bborder\s*:/.test(d), sel + ' is the sheet colour and has no frame');
  }
  const sheets = decls(style, '#preview-pane, .secondary-preview-pane');
  need(sheets !== null && prop(sheets, 'scrollbar-width') === 'thin' && prop(sheets, 'scrollbar-color') === 'rgb(var(--ink-rgb) / 0.5) transparent', 'the scrollbar of a sheet is a thin one with a quiet thumb on no track (standard properties: the scrolling stays the own of the browser)');
  need(!/preview-pane[^{}]*::-webkit-scrollbar/.test(style), 'and no ::-webkit-scrollbar on the sheets: it would turn the overlay scrollbar of a Mac into a permanent bar');
  need(!/#preview-pane[^{]*\{[^}]*(?:position:\s*absolute|display:\s*grid)/.test(style) && !/class="[^"]*preview-sheet/.test(read('frontend/index.html')), 'the sheet is the preview box itself: no wrapper element, no new layout for it');

  need(prop(decls(style, 'body[data-view="pair"] .secondary-editor-pane'), '--pad-top-extra') === 'var(--pane-band-h)', 'the secondary editor pane keeps room at the top for the band');
  const band = decls(style, '.pane-header');
  need(band !== null && prop(band, 'position') === 'absolute' && prop(band, 'top') === 'var(--ov-top)' && prop(band, 'height') === 'var(--pane-band-h)', 'the right page\'s name band floats under the header bar, as tall as the room kept for it');
  need(band !== null && /rgb\(var\(--page-rgb\) \/ 0\.9\)/.test(prop(band, 'background') || ''), 'on the page colour at 90%, so the text that scrolls under it does not show through');
  need(prop(decls(style, 'body[data-view="side"] .pane-header'), 'background') === 'rgb(var(--page-rgb) / 0.85)', 'and on the sheet colour when the page beside the editor is a sheet');
  need(prop(decls(style, ':root'), '--pane-band-h') === '28px' && prop(decls(style, ':root'), '--grip-w') === '6px', 'the band is 28px and the grip 6px (lengths to be set by looking at the window)');
  need(/--tab-strip-pane-head:\s*var\(--pane-band-h\)/.test(style), 'the right strip of tabs starts under the band (one number)');
  need(prop(decls(style, '#workspace[data-tabs="both"] #editor-secondary'), 'padding-right') === 'max(var(--pad-x), calc(var(--tab-strip-gap-right) + var(--tab-hit-w) + 7px))', 'the right page\'s text keeps off its strip of tabs, which a page without a scrollbar has nothing to hold back');
  need(decls(chrome, '#secondary-pane') === null || !/padding|--ov-inset-top/.test(decls(chrome, '#secondary-pane')), 'chrome.css leaves the right page no room of its own at the top');

  // ---- sizes
  need(prop(decls(tokens, 'body.dark-theme'), '--gutter-w') === '24px' && prop(decls(tokens, 'body.dark-theme'), '--desk-margin') === '34px' && prop(decls(tokens, 'body.dark-theme'), '--sheet-max') === '800px', 'the gutter 24px, the desk 34px, the sheet 800px (css/tokens.css)');

  // ---- a narrow window
  const narrow = block(style, '@media (max-width: 900px)');
  need(narrow !== null && prop(decls(narrow, 'body.dark-theme'), '--desk-margin') === '12px' && prop(decls(narrow, 'body.dark-theme'), '--gutter-w') === '12px', 'in a window under 900px the desk is 12px and the gutter 12px');
  const narrowChrome = block(chrome, '@media (max-width: 900px)');
  need(narrowChrome !== null && prop(decls(narrowChrome, '#preview-pane'), 'padding-left') === '20px' && prop(decls(narrowChrome, '.secondary-preview-pane'), 'padding-right') === '16px', 'and the sheets keep less to the sides');

  // ---- forced colours
  const forced = forcedText;
  const fc = forcedText;
  need(/body\[data-view="side"\] #workspace,\s*body\[data-view="preview"\] #workspace\s*\{\s*background:\s*Canvas;/.test(fc), 'forced colours: the desk and the sheet are both Canvas');
  need(/\.pane-resizer\s*\{\s*background:\s*none;\s*border-left:\s*1px solid CanvasText;/.test(fc), 'forced colours: the divider is a line');
  need(/\.pane-resizer::before,\s*\.pane-resizer::after\s*\{\s*display:\s*none;/.test(fc), 'forced colours: no dots, no accent line');
  need(/\.pane-resizer:focus-visible\s*\{\s*outline:\s*2px solid Highlight;/.test(fc), 'forced colours: the keyboard\'s focus on the divider is an outline');
  need(/\.secondary-preview-pane:not\(\.html-mode\)\s*\{\s*border:\s*1px solid CanvasText;\s*box-shadow:\s*none;/.test(fc), 'forced colours: a sheet has a border instead of a shadow');
  need(/#secondary-pane\.pane-focused::before\s*\{\s*background:\s*Highlight;/.test(fc), 'forced colours: the page that has the keyboard is Highlight');

  // ---- paper
  const sheetPrint = decls(print, '#preview-pane:not(.hidden), body[data-print-pane="secondary"] #workspace #secondary-pane #secondary-preview-pane:not(.hidden)');
  need(sheetPrint !== null && /box-shadow:\s*none\s*!important/.test(sheetPrint), 'on paper the sheet has no shadow');
  need(sheetPrint !== null && /margin:\s*0\s*!important/.test(sheetPrint) && /width:\s*auto\s*!important/.test(sheetPrint) && /border:\s*0\s*!important/.test(sheetPrint), 'no desk margin, no width of its own, no border');

  // ---- what macOS 10.15 (Safari 15.6) cannot read, in the rules of this part
  for (const [name, css] of [['style.css', style], ['chrome.css', chrome]]) {
    const part = [decls(css, '.pane-resizer'), decls(css, '.pane-resizer::before'), decls(css, '.pane-header'), decls(css, 'body[data-view="preview"] #preview-pane'), narrow, forced].join('\n');
    need(!/color-mix\(|@container|container-type|\bcq[wihb]|scrollbar-gutter|:has\(/.test(part), name + ': nothing here that Safari 15.6 cannot read');
  }
  return p;
}

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS: ' + name); } catch (e) { failed++; console.log('FAIL: ' + name + '\n  ' + (e && e.message)); }
}

check('the rules of the four displays hold', () => {
  assert.deepEqual(styleProblems(files), []);
});

check('mutation check: broken copies of the sheets are caught', () => {
  const m = (file, find, replace) => {
    assert.ok(files[file].includes(find), 'the mutation applies: ' + find.slice(0, 70));
    return { ...files, [file]: files[file].replace(find, replace) };
  };
  const cases = [
    ['the divider has its old width', m('style', 'width: var(--split-w);\n  height: 100%;\n  cursor: col-resize;', 'width: 5px;\n  height: 100%;\n  cursor: col-resize;'), /--split-w wide/],
    ['the line divider is not 5px', m('style', 'body[data-boundary="line"] #editor-pane,\nbody[data-boundary="line"] .pane-resizer {\n  --split-w: 5px;', 'body[data-boundary="line"] #editor-pane,\nbody[data-boundary="line"] .pane-resizer {\n  --split-w: 10px;'), /thin line is 5px wide/],
    ['the gutter has a line again', m('style', '  background: var(--gutter-shade);\n  outline: none;', '  background: var(--gutter-shade);\n  border-left: 1px solid var(--border-color);\n  outline: none;'), /no line of its own/],
    ['the gutter has no shadow', m('style', '  background: var(--gutter-shade);\n  outline: none;', '  background: none;\n  outline: none;'), /shadow across its middle/],
    ['the dots have no mask', m('style', '  -webkit-mask-image: linear-gradient(to right, transparent, currentColor 35%, currentColor 65%, transparent);\n', ''), /with and without the prefix/],
    ['the dots are not on an 8px grid', m('style', 'background-size: 8px 8px;', 'background-size: 6px 6px;'), /8px grid/],
    ['the dots move', m('style', '  pointer-events: none;\n}\n\n.pane-resizer::after', '  pointer-events: none;\n  transition: opacity 1s;\n}\n\n.pane-resizer::after'), /nothing repaints/],
    ['the accent line is always there', m('style', '  opacity: 0;\n  transition: opacity 0.15s ease;', '  opacity: 1;\n  transition: opacity 0.15s ease;'), /invisible until it is wanted/],
    ['the keyboard does not show the line', m('style', '.pane-resizer:focus-visible::after {\n  opacity: 1;', '.pane-resizer:focus-visible::after {\n  opacity: 0;'), /keyboard is on it/],
    ['the focus rule is back in a list with the others', m('style', '.pane-resizer.resizing::after {\n  opacity: 1;', '.pane-resizer.resizing::after,\n.pane-resizer:focus-visible::after {\n  opacity: 1;'), /rested on or dragged/],
    ['the divider gets the general focus ring', m('style', '.pane-resizer:focus-visible {\n  outline: none;', '.pane-resizer:focus-visible {\n  outline: 2px solid var(--accent-hover);'), /accent line is the keyboard/],
    ['the scrollbar of a sheet is the wide default again', m('style', '  scrollbar-width: thin;\n  scrollbar-color: rgb(var(--ink-rgb) / 0.5) transparent;', '  scrollbar-color: rgb(var(--ink-rgb) / 0.5) transparent;'), /thin one/],
    ['the thumb is too faint', m('style', 'scrollbar-color: rgb(var(--ink-rgb) / 0.5) transparent;', 'scrollbar-color: rgb(var(--ink-rgb) / 0.2) transparent;'), /quiet thumb/],
    ['the scrollbar is painted by hand', { ...files, style: files.style + '\n#preview-pane::-webkit-scrollbar { width: 10px; }\n' }, /overlay scrollbar/],
    ['the shade look shows dots', m('style', 'body[data-boundary="shade"] .pane-resizer::before,\nbody[data-boundary="line"] .pane-resizer::before {\n  display: none;', 'body[data-boundary="shade"] .pane-resizer::before,\nbody[data-boundary="line"] .pane-resizer::before {\n  display: block;'), /no dots with the shadow-only look/],
    ['the thin line is not a hairline', m('style', 'body[data-boundary="line"] .pane-resizer {\n  background: none;\n  border-left: 1px solid var(--hair);', 'body[data-boundary="line"] .pane-resizer {\n  background: none;\n  border-left: 1px solid var(--border-color);'), /hairline/],
    ['the focused page has the old outline', m('style', 'content: "";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;', 'outline: 1px solid var(--outline-pane-focus);\n  content: "";\n  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;'), /old 1px outline/],
    ['the focus line is under the header again', m('style', '  pointer-events: none;\n  z-index: 101;', '  pointer-events: none;\n  z-index: 5;'), /over the header bar/],
    ['the focus line is below the header bar', m('style', '  top: 0;\n  height: 2px;\n  background: var(--pane-focus);', '  top: var(--ov-top);\n  height: 2px;\n  background: var(--pane-focus);'), /along the top edge/],
    ['the focus line is on one page too', m('style', 'body[data-view="pair"] #editor-pane.pane-focused::before,', 'body[data-view="page"] #editor-pane.pane-focused::before,\nbody[data-view="pair"] #editor-pane.pane-focused::before,'), /focused page has a line/],
    ['the workspace has wrong background', m('style', 'body[data-view="side"] #workspace,\nbody[data-view="preview"] #workspace {\n  background: var(--bg-editor);', 'body[data-view="side"] #workspace,\nbody[data-view="preview"] #workspace {\n  background: var(--page);'), /workspace has editor background/],
    ['the right page background is wrong', m('style', 'body[data-view="side"] #secondary-pane {\n  background: var(--bg-editor);', 'body[data-view="side"] #secondary-pane {\n  background: none;'), /has editor background beside a preview/],
    ['the preview alone is not 100% width', m('style', 'body[data-view="preview"] #preview-pane {\n  flex: 1;\n  width: 100%;', 'body[data-view="preview"] #preview-pane {\n  flex: 1;\n  width: 800px;'), /100% width/],
    ['the preview alone does not fill', m('style', 'body[data-view="preview"] #preview-pane {\n  flex: 1;\n  width: 100%;\n  margin: 0;', 'body[data-view="preview"] #preview-pane {\n  flex: 1;\n  width: 100%;\n  margin: 10px;'), /fills workspace/],
    ['the preview alone has shadow', m('style', 'body[data-view="preview"] #preview-pane {\n  flex: 1;\n  width: 100%;\n  margin: 0;\n  box-shadow: none;', 'body[data-view="preview"] #preview-pane {\n  flex: 1;\n  width: 100%;\n  margin: 0;\n  box-shadow: 0 4px 8px black;'), /without shadow/],
    ['an HTML note keeps the desk', m('style', 'body[data-view="preview"] #preview-pane.html-mode {\n  flex: 1;\n  width: auto;', 'body[data-view="preview"] #preview-pane.html-mode {\n  flex: 1;\n  width: 800px;'), /HTML note fills the window/],
    ['the side preview has margin or shadow', m('style', 'body[data-view="side"] .secondary-preview-pane {\n  --pad-top-extra: var(--pane-band-h);\n  margin: 0;\n  box-shadow: none;', 'body[data-view="side"] .secondary-preview-pane {\n  --pad-top-extra: var(--pane-band-h);\n  margin: 10px;\n  box-shadow: 0 4px 8px black;'), /no margin and no shadow/],
    ['the preview has a frame again', m('style', '#preview-pane {\n  background: var(--sheet);', '#preview-pane {\n  border: 2px solid var(--accent-hover);\n  background: var(--sheet);'), /has no frame/],
    ['the preview is tinted again', m('style', '#preview-pane {\n  background: var(--sheet);', '#preview-pane {\n  background: var(--bg-preview);'), /is the sheet colour/],
    ['the pages do not keep the same room', m('style', 'body[data-view="pair"] .secondary-editor-pane {\n  --pad-top-extra: var(--pane-band-h);', 'body[data-view="pair"] .secondary-editor-pane {\n  --pad-top-extra: 0px;'), /keeps room at the top/],
    ['the band is a bar again', m('style', '.pane-header {\n  position: absolute;', '.pane-header {\n  position: relative;'), /name band floats/],
    ['the band is see-through', m('style', 'background: rgb(var(--page-rgb) / 0.9);', 'background: none;'), /text that scrolls under it/],
    ['the strip starts over the band', m('style', '--tab-strip-pane-head: var(--pane-band-h);', '--tab-strip-pane-head: 32px;'), /starts under the band/],
    ['the right text runs under its strip', m('style', 'padding-right: max(var(--pad-x), calc(var(--tab-strip-gap-right) + var(--tab-hit-w) + 7px));', 'padding-right: var(--pad-x);'), /keeps off its strip/],
    ['the right page gets room of its own again', { ...files, chrome: files.chrome + '\n#secondary-pane { padding-top: var(--ov-top); }\n' }, /no room of its own/],
    ['the gutter is 5px again', m('tokens', '--gutter-w: 24px;', '--gutter-w: 5px;'), /gutter 24px/],
    ['a narrow window has the same desk', m('style', '--desk-margin: 12px;', '--desk-margin: 34px;'), /under 900px/],
    ['a narrow sheet keeps its wide margins', m('chrome', 'padding-left: 20px;', 'padding-left: 36px;'), /keep less to the sides/],
    ['forced colours: the divider is not a line', m('style', 'border-left: 1px solid CanvasText;', 'border-left: 0;'), /divider is a line/],
    ['forced colours: the sheet has no border', m('style', 'border: 1px solid CanvasText;\n    box-shadow: none;', 'box-shadow: none;'), /border instead of a shadow/],
    ['forced colours: the divider shows no focus', m('style', '.pane-resizer:focus-visible {\n    outline: 2px solid Highlight;', '.pane-resizer:focus-visible {\n    outline: 0;'), /keyboard's focus on the divider/],
    ['paper keeps the shadow', m('print', '  box-shadow: none !important;\n', ''), /no shadow/],
    ['a colour mix sneaks in', m('style', '  background: var(--gutter-shade);\n  outline: none;', '  background: color-mix(in srgb, red, blue);\n  outline: none;'), /Safari 15.6/]
  ];
  const bad = [];
  for (const [name, mutated, expect] of cases) {
    const found = styleProblems(mutated);
    if (!found.length) bad.push('SURVIVED: ' + name);
    else if (!found.some((t) => expect.test(t))) bad.push('caught, but not by the rule meant: ' + name + ' -> ' + found.join(' | '));
  }
  assert.deepEqual(bad, []);
  console.log('  all ' + cases.length + ' mutations are caught');
});

if (failed) {
  console.log(failed + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nAll split view style tests PASSED!');
