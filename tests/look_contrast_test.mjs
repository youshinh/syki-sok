// v2 phase P1b: the two looks of the window (ink = dark, paper = light) are readable, and the structure that keeps them apart holds.
//
// What is locked (all from frontend/css/tokens.css, no browser):
//   1. Contrast. For the ink and the paper look and for every accent (olive, blue, forest, charcoal, vermilion; a self-chosen accent is
//      computed by js/appearance.js and checked against the same surfaces below), the texts of the window read on the surfaces they sit on:
//      the main text 4.5:1 or more, supporting text (muted, placeholders, key hints) 3:1 or more on the quiet surfaces and 4.5:1 on the
//      main ones, accent text and the text on an accent fill 4.5:1, state colours (error, ok, warning, badges) 4.5:1, the focus ring and
//      the accent as a line 3:1. The list of pairs is PAIRS below: a pair is a text token, the surface tokens it sits on, a minimum.
//   2. Structure. body.look-paper comes after the ink blocks, defines every token that an ink accent block defines (so none of them
//      leaks into paper), defines every token of the base block except those that are the same in both looks (SAME_IN_BOTH, each with
//      a reason); the paper accent blocks define the same set of tokens; the channel tokens (--accent-rgb, --ink-rgb, ...) are the
//      colour of the token they stand for.
//   3. The margin and the bars (P2b): the line numbers are written in the margin with no panel behind them, as the muted text colour at
//      --linenum-a, and must still be 3:1 against the page on both looks; the header and the status bar are see-through (css/chrome.css:
//      --bar-a), so their texts are measured on the bar laid over a dense page, 15% of it glyph pixels (4.5:1) and over the
//      brightest pixel of that text (3:1).
//   4. The sticky note (P5): the paper of a floating panel is --sheet with the accent laid over it at --note-tint-a (css/style.css, "The sticky
//      note"; no color-mix()). Every text a panel shows reads on THAT paper (4.5:1; the placeholders 3:1), for both looks, all five accents and
//      a self-chosen one; the adhesive strip that shows focus (--note-tape-focus) is 3:1 against the paper under it and against the page behind
//      it (WCAG 1.4.11), and visibly different (2:1) from what the strip is when nothing in the note has focus; the tint stays a tint (at most 20%).
//   5. The mutation check: each of these checks fails on a copy of tokens.css that is broken the way the check is meant to catch.
//
// Node only. Run: node tests/look_contrast_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { LOOKS, ACCENTS, parseRules, readTokens, tokensFor, rootTokensFor, colourOf, composite, contrast, hex, resolveValue, parseColour } from './lib/look_lib.mjs';

const require = createRequire(import.meta.url);
global.window = global;
const Appearance = require('../frontend/js/appearance.js');

// ---- the pairs ------------------------------------------------------------------------------------------------------------------------
// [text token, [surface tokens], minimum, what it is]. A translucent surface (a veil, a tint) is laid over --bg-modal first.
// (v2 P4: the preview is a sheet of paper, --sheet; --bg-preview, the tinted surface it had before, is kept in the list because the token is still defined)
const MAIN_SURFACES = ['bg-main', 'bg-editor', 'bg-modal', 'bg-context', 'bg-header', 'bg-tab', 'bg-tab-active', 'bg-preview', 'sheet', 'bg-md-block'];
const FIELD_SURFACES = ['bg-input', 'bg-field', 'bg-btn', 'bg-key', 'bg-table', 'bg-table-head', 'bg-btn-action', 'bg-md-inline', 'bg-md-th', 'bg-md-stripe'];
const HOVER_SURFACES = ['bg-tab-hover', 'bg-btn-hover', 'bg-icon-hover', 'bg-hover-subtle', 'bg-btn-action-hover', 'accent-active-bg', 'bg-context-hover'];

const PAIRS = [
  ['text-main', MAIN_SURFACES.concat(FIELD_SURFACES, ['accent-active-bg', 'bg-context-hover']), 4.5, 'the body text'],
  ['text-editor', ['bg-editor', 'bg-main'], 4.5, 'the text of the editor'],
  ['text-active', MAIN_SURFACES.concat(FIELD_SURFACES, HOVER_SURFACES), 4.5, 'the strong text (hover, selected)'],
  ['ink', ['page', 'sheet', 'wall'], 4.5, 'the v2 text on the v2 surfaces'],
  ['ink-2', ['page', 'sheet', 'wall'], 4.5, 'the v2 supporting text on the v2 surfaces'],
  ['text-muted', MAIN_SURFACES, 4.5, 'the supporting text on the main surfaces'],
  ['text-muted', FIELD_SURFACES.concat(HOVER_SURFACES.filter((n) => !/^accent|context/.test(n))), 3, 'the supporting text on fields and hovered buttons'],
  ['text-soft', ['bg-modal+veil-07', 'bg-main+veil-07'], 4.5, 'the chips'],
  ['text-placeholder', ['bg-input', 'bg-field'], 3, 'the placeholders'],
  ['text-key', ['bg-modal', 'bg-key'], 4.5, 'the key names'],
  ['text-key-empty', ['bg-modal'], 3, 'an unassigned key'],
  ['text-dim', ['bg-preview', 'sheet', 'bg-main'], 3, 'the loading text'],
  ['text-idle', ['bg-modal', 'bg-main'], 4.5, 'the idle badge text'],
  ['text-ambient', ['bg-main+veil-08', 'bg-modal+veil-08'], 4.5, 'the ambient pill'],
  ['text-code-preview', ['bg-field'], 4.5, 'the command preview'],
  ['text-on-accent', ['accent-color'], 4.5, 'the text on an accent fill (primary button, switch)'],
  ['text-on-accent', ['accent-hover'], 3, 'the same, on the hovered fill'],
  ['text-badge', ['accent-color'], 4.5, 'the PREVIEW badge'],
  ['text-on-danger', ['bg-danger-solid'], 4.5, 'the text on the red close button'],
  ['text-on-statusbar', ['bg-statusbar', 'bg-statusbar+shade-25'], 4.5, 'the status bar text, on the bar and on a pill'],
  ['status-ok', ['bg-statusbar+shade-25'], 4.5, 'a state of the status bar (ok) on a pill'],
  ['status-warn', ['bg-statusbar+shade-25'], 4.5, 'a state of the status bar (warning) on a pill'],
  ['status-error', ['bg-statusbar+shade-25'], 4.5, 'a state of the status bar (error) on a pill'],
  ['accent-label', ['bg-main', 'bg-editor', 'bg-modal', 'bg-context', 'bg-header', 'bg-input', 'bg-preview', 'sheet', 'bg-md-block'], 4.5, 'the accent as text (labels)'],
  ['accent-hover', ['bg-editor', 'bg-modal', 'bg-main'], 3, 'the accent as a line, a ring or a ghost text'],
  ['focus-ring', ['bg-main', 'bg-modal', 'bg-header', 'bg-tab'], 3, 'the focus ring'],
  ['md-heading', ['bg-preview', 'sheet', 'bg-main'], 4.5, 'the headings of the preview, on the sheet'],
  ['md-h1', ['bg-preview', 'sheet', 'bg-main'], 4.5, 'the first heading, on the sheet'],
  ['md-quote', ['bg-md-block'], 4.5, 'a quote'],
  ['md-th', ['bg-md-th'], 4.5, 'a table head'],
  ['md-code', ['bg-md-inline', 'bg-md-block', 'bg-preview', 'sheet'], 4.5, 'inline code'],
  ['text-error', ['bg-modal', 'bg-main'], 4.5, 'an error text'],
  ['text-error-hover', ['bg-modal', 'bg-main'], 4.5, 'an error text, hovered'],
  ['text-ok', ['bg-modal', 'bg-main'], 4.5, 'an ok text'],
  ['text-warn-orange', ['bg-modal', 'bg-main'], 4.5, 'a warning text'],
  ['text-danger-badge', ['bg-modal', 'bg-main'], 4.5, 'a danger badge text'],
  ['text-danger-hint', ['bg-modal', 'bg-main'], 4.5, 'a danger hint'],
  ['text-recipe-tag', ['bg-modal', 'bg-main'], 4.5, 'the RECIPE mark'],
  ['coral', ['bg-modal', 'bg-main', 'bg-md-block'], 4.5, 'an error'],
  ['coral', ['bg-modal+coral-12'], 4.5, 'an error on its tint'],
  ['rose', ['bg-modal', 'bg-main', 'bg-modal+rose-10'], 4.5, 'a failure'],
  ['salmon', ['bg-modal'], 4.5, 'the About dialog error'],
  ['ok-text', ['bg-modal+ok-bg', 'bg-main+ok-bg'], 4.5, 'a finished task'],
  ['fail-text', ['bg-modal+fail-bg', 'bg-main+fail-bg'], 4.5, 'a failed task'],
  ['caution', ['bg-modal', 'bg-main', 'bg-modal+caution-12'], 4.5, 'a caution'],
  ['cloud-mark', ['bg-modal', 'bg-main'], 4.5, 'the cloud mark'],
  ['key-rec-text', ['bg-modal+key-rec-bg'], 4.5, 'a key being recorded'],
  ['jump-link', ['bg-main', 'bg-modal'], 4.5, 'a link to the editor'],
  ['jump-link-hover', ['bg-main+jump-link-bg', 'bg-modal+jump-link-bg'], 4.5, 'the same, hovered'],
  ['semantic-ok-text', ['bg-modal', 'bg-main'], 4.5, 'semantic search ok'],
  ['semantic-warn-text', ['bg-modal', 'bg-main'], 4.5, 'semantic search warning'],
  ['badge-ok-text', ['bg-modal+badge-ok-bg'], 4.5, 'a running badge'],
  ['badge-danger-text', ['bg-modal+badge-danger-bg'], 4.5, 'a stopped badge'],
  ['badge-busy-text', ['bg-modal'], 4.5, 'a busy badge'],
  ['badge-git-warn-text', ['bg-modal+badge-git-warn-bg'], 4.5, 'a Git warning badge'],
  ['badge-git-ok-text', ['bg-modal+badge-git-ok-bg'], 4.5, 'a Git linked badge'],
  ['badge-git-idle-text', ['bg-modal+badge-git-idle-bg'], 4.5, 'a Git idle badge'],
  ['crimson', ['bg-modal', 'bg-main'], 3, 'the recording red'],
  ['dirty-dot', ['bg-tab', 'bg-header', 'bg-modal'], 3, 'the unsaved dot'],
  ['result-open', ['bg-editor'], 3, 'the result block bar (open), in the margin of the page'],
  ['result-body', ['bg-editor'], 3, 'the result block bar (result), in the margin of the page'],
  ['result-close', ['bg-editor'], 3, 'the result block bar (close), in the margin of the page'],
  ['switch-thumb-on', ['accent-color'], 3, 'the switch knob on its accent track']
];

// P5: what a sticky note shows, on the paper of a note (--sheet under the accent tint; a chip is a veil over that)
const NOTE = 'sheet+note-tint';
PAIRS.push(
  ['text-main', [NOTE], 4.5, 'the text of a sticky note'],
  ['text-active', [NOTE], 4.5, 'the strong text of a sticky note'],
  ['text-muted', [NOTE], 4.5, 'the hint and the context line of a sticky note'],
  ['text-soft', [NOTE + '+veil-07'], 4.5, 'the chips of a sticky note'],
  ['text-placeholder', [NOTE], 3, 'the placeholder of the field of a sticky note'],
  ['text-key', [NOTE], 4.5, 'the key names in a sticky note'],
  ['accent-label', [NOTE], 4.5, 'the kind label of a sticky note (Ask, Rewrite, Commands)'],
  ['text-error', [NOTE], 4.5, 'an error in a sticky note'],
  ['coral', [NOTE, NOTE + '+coral-12'], 4.5, 'an error mark in a sticky note'],
  ['text-ok', [NOTE], 4.5, 'an ok text in a sticky note'],
  ['cloud-mark', [NOTE], 4.5, 'the cloud mark in a sticky note'],
  ['caution', [NOTE], 4.5, 'a caution in a sticky note'],
  ['text-recipe-tag', [NOTE], 4.5, 'the RECIPE mark in a sticky note'],
  ['note-tape-focus', [NOTE, 'page'], 3, 'the strip of a sticky note that has focus, against its paper and against the page behind it']
);

// Pairs that hold only on one look: the accent as text on paper (ink uses accent-label for text)
const PAPER_ONLY = [
  ['accent-color', ['bg-main', 'bg-modal'], 4.5, 'paper: the accent colour also draws text (a countdown, a heading)'],
  ['accent-hover', ['bg-main', 'bg-modal'], 4.5, 'paper: the accent as a link text']
];

// Tokens that are the same in both looks, so the paper block need not define them (each with the reason)
const SAME_IN_BOTH = {
  'text-on-danger': 'white on the red close button',
  'bg-html-page': 'an HTML page in the preview is always a white page',
  'bg-mermaid-light': 'a light diagram card is white on any look',
  'border-mermaid-light': 'the border of that card',
  'text-mermaid-light': 'the text of that card',
  'mermaid-primary': 'the colour Mermaid draws its dark nodes with',
  'bg-danger-solid': 'the red of the close button',
  'bg-qr': 'a QR code needs a white card',
  'swatch-olive': 'the swatches of Settings show the accent whichever look is on',
  'swatch-blue': 'same',
  'swatch-forest': 'same',
  'swatch-charcoal': 'same',
  'swatch-vermilion': 'same',
  'swatch-custom': 'same',
  'tab-accent': 'follows --accent-rgb',
  'tab-base': 'follows --wall',
  'tab-ink': 'follows --ink',
  'tab-ink-hi': 'follows --text-on-accent',
  'tab-hair': 'follows --hair',
  'tab-dirty': 'follows --dirty-dot',
  'tab-conflict': 'follows --coral',
  'tab-close-hover-bg': 'follows --bg-danger-solid',
  'gutter-shade': 'follows --shade',
  'pane-focus': 'follows --accent-rgb',
  'note-tint': 'follows --accent-rgb and --note-tint-a',
  'note-tape': 'follows --accent-rgb',
  'gutter-w': 'a length, the same on both looks (P4)',
  'desk-margin': 'same',
  'sheet-max': 'same',
  'note-fold': 'same (P5)',
  'rec-dot-note': ''
};
delete SAME_IN_BOTH['rec-dot-note'];

// ---- the checks (functions of the text of tokens.css, so the mutation check can run them on a broken copy) ------------------------------------
function surface(map, spec) {
  const [base, ...layers] = spec.split('+');
  // a translucent surface alone is laid over --bg-modal; "a+b" is b laid over a
  let c = colourOf(map, base);
  if (c.a < 1) c = composite(c, colourOf(map, 'bg-modal'));
  for (const l of layers) c = composite(colourOf(map, l), c);
  return c;
}

function contrastProblems(css) {
  const rules = parseRules(css);
  const problems = [];
  for (const look of LOOKS) {
    for (const accent of ACCENTS) {
      const map = tokensFor(look, accent, rules);
      const pairs = PAIRS.concat(look === 'paper' ? PAPER_ONLY : []);
      for (const [text, surfaces, min, what] of pairs) {
        for (const spec of surfaces) {
          let fg, bg;
          try {
            bg = surface(map, spec);
            fg = colourOf(map, text);
            if (fg.a < 1) fg = composite(fg, bg);
          } catch (e) {
            problems.push(look + ' ' + accent + ': ' + text + ' on ' + spec + ': ' + e.message);
            continue;
          }
          const r = contrast(fg, bg);
          if (r < min) problems.push(look + ' ' + accent + ': ' + text + ' ' + hex(fg) + ' on ' + spec + ' ' + hex(bg) + ' is ' + r.toFixed(2) + ':1, needs ' + min + ' (' + what + ')');
        }
      }
    }
  }
  return problems;
}

// ---- P2b: the line numbers in the margin, and the see-through bars --------------------------------------------------------------------------
const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const mix = (a, b, k) => ({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: 1 });
const channels = (text) => { const m = /(\d+)\s+(\d+)\s+(\d+)/.exec(text); return m ? { r: +m[1], g: +m[2], b: +m[3], a: 1 } : null; };

// The opacity the bars get from chrome.css: light (the plain rule) and glass (the rule inside @supports for backdrop-filter).
function barAlphas(chrome) {
  const text = noComments(chrome);
  const light = /body\[data-bars="light"\] #header,[^{]*\{\s*--bar-a:\s*([\d.]+)/.exec(text);
  const glass = /@supports[^{]*\{\s*body\[data-bars="glass"\] #header,[^{]*\{\s*--bar-a:\s*([\d.]+)/.exec(text);
  return { light: light ? parseFloat(light[1]) : NaN, glass: glass ? parseFloat(glass[1]) : NaN };
}

// What can be under a bar: a page whose area is 15% glyph pixels (a dense monospace note; ordinary prose is nearer 10%), which is what
// glass, blurring the page, turns it into; and for the light bars, which blur nothing, also the brightest pixel of the text itself.
function underlays(map, bars) {
  const page = colourOf(map, 'page');
  const ink = colourOf(map, 'ink');
  const list = [['a dense page', mix(page, ink, 0.15), 4.5]];
  if (bars === 'light') list.push(['the text itself', ink, 3]);
  return list;
}

function marginProblems(tokens, chrome) {
  const rules = parseRules(tokens);
  const problems = [];
  const alphas = barAlphas(chrome);
  for (const [k, v] of Object.entries(alphas)) if (!(v > 0 && v < 1)) problems.push('chrome.css: the ' + k + ' opacity of the bars is not a number between 0 and 1');
  for (const look of LOOKS) {
    for (const accent of ACCENTS) {
      const map = tokensFor(look, accent, rules);
      const where = look + ' ' + accent + ': ';
      try {
        // line numbers: --text-muted-rgb at --linenum-a over the page they are written on
        const alpha = parseFloat(resolveValue(map.get('linenum-a'), map));
        const muted = channels(resolveValue(map.get('text-muted-rgb'), map));
        const page = colourOf(map, 'bg-editor');
        const shown = composite({ ...muted, a: alpha }, page);
        const r = contrast(shown, page);
        if (!(alpha > 0 && alpha <= 1)) problems.push(where + '--linenum-a is ' + map.get('linenum-a'));
        else if (r < 3) problems.push(where + 'the line numbers ' + hex(shown) + ' on the page ' + hex(page) + ' are ' + r.toFixed(2) + ':1, need 3');
      } catch (e) { problems.push(where + 'line numbers: ' + e.message); }
      for (const [bars, a] of Object.entries(alphas)) {
        if (!(a > 0 && a < 1)) continue;
        for (const [what, under, min] of underlays(map, bars)) {
          try {
            const top = composite({ ...channels(resolveValue(map.get('bar-top-rgb'), map)), a }, under);
            const bottom = composite({ ...channels(resolveValue(map.get('bar-bottom-rgb'), map)), a }, under);
            for (const [name, fg, bg] of [['text-muted', colourOf(map, 'text-muted'), top], ['text-main', colourOf(map, 'text-main'), top], ['text-on-statusbar', colourOf(map, 'text-on-statusbar'), bottom]]) {
              const r = contrast(composite(fg, bg), bg);
              if (r < min) problems.push(where + bars + ' bars over ' + what + ': ' + name + ' on the bar ' + hex(bg) + ' is ' + r.toFixed(2) + ':1, needs ' + min);
            }
          } catch (e) { problems.push(where + bars + ': ' + e.message); }
        }
      }
    }
  }
  return problems;
}

// A self-chosen accent (js/appearance.js) against the surfaces that tokens.css really has: the constants of the maths are the surfaces
const CUSTOM_PAIRS = [
  ['accent-label', ['bg-main', 'bg-editor', 'bg-modal', 'bg-context', 'bg-header', 'bg-input', 'bg-preview', 'bg-md-block', 'bg-icon-hover'], 4.5, 'the accent as text'],
  ['text-on-accent', ['accent-color'], 4.5, 'the text on the fill'],
  ['text-badge', ['accent-color'], 4.5, 'the PREVIEW badge text'],
  ['text-active', ['accent-active-bg', 'bg-context-hover'], 4.5, 'the selected row text'],
  ['text-main', ['bg-preview'], 4.5, 'the preview text'],
  ['accent-hover', ['bg-editor', 'bg-modal', 'bg-main'], 3, 'the accent as a line or ring']
];
const CUSTOM_INK_ONLY = [['text-on-statusbar', ['bg-statusbar'], 4.5, 'the status bar text']];
const CUSTOM_PAPER_ONLY = [
  ['accent-color', ['bg-main', 'bg-modal'], 4.5, 'the accent colour as text'],
  ['accent-hover', ['bg-main', 'bg-modal'], 4.5, 'the accent as link text']
];

function customProblems(css) {
  const rules = parseRules(css);
  const problems = [];
  const SAMPLES = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#000000', '#ffffff', '#ff6600', '#7f7f00', '#3366ff', '#d946ef', '#00b894'];
  for (const look of LOOKS) {
    const map = tokensFor(look, 'olive', rules);
    const pairs = CUSTOM_PAIRS.concat(look === 'ink' ? CUSTOM_INK_ONLY : CUSTOM_PAPER_ONLY);
    for (const sample of SAMPLES) {
      const t = Appearance.customAccent(sample, look);
      const over = new Map(map);
      for (const [k, v] of Object.entries(t)) over.set(k.slice(2), v);
      for (const [text, surfaces, min, what] of pairs) {
        for (const spec of surfaces) {
          let fg, bg;
          try { bg = surface(over, spec); fg = colourOf(over, text); if (fg.a < 1) fg = composite(fg, bg); } catch (e) { problems.push(look + ' custom ' + sample + ': ' + e.message); continue; }
          const r = contrast(fg, bg);
          if (r < min) problems.push(look + ' custom ' + sample + ': ' + text + ' ' + hex(fg) + ' on ' + spec + ' ' + hex(bg) + ' is ' + r.toFixed(2) + ':1, needs ' + min + ' (' + what + ')');
        }
      }
    }
  }
  return problems;
}

function structureProblems(css) {
  const rules = parseRules(css);
  const problems = [];
  const at = (sel) => rules.findIndex((r) => r.selectors.includes(sel));
  // the base is every rule that names body.dark-theme (the main block and the result-block rule that groups it with the olive accent)
  const baseRules = rules.filter((r) => r.selectors.includes('body.dark-theme'));
  const base = baseRules[0] && { decls: baseRules.flatMap((r) => r.decls) };
  const paper = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === 'body.look-paper');
  if (!base) return ['body.dark-theme (the ink base) is missing'];
  if (!paper) return ['body.look-paper (the paper block) is missing'];
  // order: base, ink accents, paper, paper accents
  const inkAccents = ACCENTS.map((a) => 'body.theme-' + a);
  const paperAccents = ACCENTS.map((a) => 'body.look-paper.theme-' + a);
  if (!(at('body.dark-theme') < at('body.look-paper'))) problems.push('body.look-paper must come after the ink base block');
  for (const s of inkAccents) {
    if (at(s) === -1) problems.push(s + ' is missing');
    else if (!(at(s) < at('body.look-paper'))) problems.push(s + ' must come before body.look-paper (paper is the later, so it wins a tie)');
  }
  for (const s of paperAccents) {
    if (at(s) === -1) problems.push(s + ' is missing');
    else if (!(at('body.look-paper') < at(s))) problems.push(s + ' must come after body.look-paper');
  }
  // every ink rule that sets a token for an accent (and the result block rules) is answered by the paper block
  const inkAccentTokens = new Set();
  for (const r of rules) {
    if (r === baseRules[0]) continue;
    if (r.selectors.some((s) => /^body\.theme-/.test(s) || s === 'body.dark-theme')) for (const [n] of r.decls) inkAccentTokens.add(n);
  }
  const paperHas = new Set(paper.decls.map(([n]) => n));
  for (const n of inkAccentTokens) if (!paperHas.has(n)) problems.push('body.look-paper does not define --' + n + ', which an ink accent block sets (it would leak into paper)');
  // every token of the base block is defined by the paper block, unless it is the same in both looks
  for (const [n] of base.decls) if (!paperHas.has(n) && !(n in SAME_IN_BOTH)) problems.push('body.look-paper does not define --' + n + ' (and it is not in SAME_IN_BOTH)');
  for (const n of Object.keys(SAME_IN_BOTH)) if (!base.decls.some(([k]) => k === n)) problems.push('SAME_IN_BOTH lists --' + n + ', which the base block does not define');
  for (const [n] of paper.decls) if (!base.decls.some(([k]) => k === n)) problems.push('body.look-paper defines --' + n + ', which the base block does not');
  // the paper accent blocks define the same set, and it is exactly the accent set that the ink accent blocks define
  const sets = paperAccents.map((s) => { const r = rules.find((x) => x.selectors.includes(s)); return r ? r.decls.map(([n]) => n).sort().join(',') : ''; });
  if (new Set(sets).size > 1) problems.push('the paper accent blocks do not define the same tokens: ' + sets.map((x, i) => paperAccents[i] + ' ' + x.split(',').length).join(', '));
  // the canvas
  const rootPaper = rules.find((r) => r.selectors.includes(':root.look-paper'));
  if (!rootPaper) problems.push(':root.look-paper (the canvas of paper) is missing');
  return problems;
}

function channelProblems(css) {
  const rules = parseRules(css);
  const problems = [];
  const chan = (c) => [c.r, c.g, c.b].map(Math.round).join(' ');
  for (const look of LOOKS) {
    for (const accent of ACCENTS) {
      const map = tokensFor(look, accent, rules);
      const where = look + ' ' + accent + ': ';
      const tie = (rgbToken, colourToken) => {
        try {
          const want = chan(colourOf(map, colourToken));
          const have = resolveValue(map.get(rgbToken), map).trim();
          if (have !== want) problems.push(where + '--' + rgbToken + ' is "' + have + '" but --' + colourToken + ' is ' + hex(colourOf(map, colourToken)) + ' ("' + want + '")');
        } catch (e) { problems.push(where + rgbToken + ': ' + e.message); }
      };
      tie('ink-rgb', 'ink');
      tie('page-rgb', 'page');
      tie('sheet-rgb', 'sheet');
      tie('wall-rgb', 'wall');
      tie('bar-top-rgb', 'bg-header');
      tie('bar-bottom-rgb', 'bg-statusbar');
      tie('text-muted-rgb', 'text-muted');
      tie('accent-rgb', look === 'paper' ? 'accent-color' : 'accent-hover');
      // the v2 names are the roles the old names had
      for (const [v2, old] of [['page', 'bg-editor'], ['ink', 'text-main'], ['ink-2', 'text-muted'], ['sheet', 'bg-modal'], ['wall', 'bg-header']]) {
        try {
          const a = hex(colourOf(map, v2));
          const b = hex(colourOf(map, old));
          if (v2 !== 'wall' && v2 !== 'sheet' && a !== b) problems.push(where + '--' + v2 + ' ' + a + ' differs from --' + old + ' ' + b);
        } catch (e) { problems.push(where + v2 + ': ' + e.message); }
      }
      // the shade channel is the shadow colour
      try {
        const shade = colourOf(map, 'shade');
        if (chan(shade) !== resolveValue(map.get('shade-rgb'), map).trim()) problems.push(where + '--shade does not use --shade-rgb');
      } catch (e) { problems.push(where + 'shade: ' + e.message); }
      // the canvas is the page and its text
      const root = rootTokensFor(look, rules);
      const canvas = parseColour(root.get('canvas-bg'));
      const page = colourOf(map, 'bg-main');
      if (hex(canvas) !== hex(page)) problems.push(where + '--canvas-bg ' + hex(canvas) + ' differs from --bg-main ' + hex(page));
      if (contrast(parseColour(root.get('canvas-fg')), canvas) < 7) problems.push(where + '--canvas-fg is not 7:1 on the canvas');
    }
  }
  return problems;
}

// ---- P3: the index tabs ------------------------------------------------------------------------------------------------------------------------
// A tab is the accent laid over --tab-base at max(floor, base - step x distance) (the selected one at 1: css/style.css, the numbers are read from
// there); its name is --tab-ink on every tab but the selected one, which is --tab-ink-hi; both 4.5:1. The marks sit on the base colour inside a ring of
// it, so they are measured against that: the dot 3:1 (a graphic), the "!" 4.5:1 (a character). The selected tab has to show against the page while
// the strip is collapsed (3:1), and the red of the close mark carries its white mark.
function tabMix(style) {
  const text = noComments(style);
  const n = (name) => { const m = new RegExp('--tab-mix-' + name + ':\\s*([\\d.]+);').exec(text); return m ? parseFloat(m[1]) : NaN; };
  return { floor: n('floor'), base: n('base'), step: n('step') };
}

function tabProblems(tokens, style, customAccent = Appearance.customAccent) {
  const rules = parseRules(tokens);
  const problems = [];
  const { floor, base, step } = tabMix(style);
  if (!(floor > 0 && base > floor && step > 0)) return ['css/style.css: --tab-mix-floor / --tab-mix-base / --tab-mix-step are not numbers in order (' + [floor, base, step].join(', ') + ')'];
  const opacities = [1];
  for (let d = 1; d <= 6; d++) opacities.push(Math.max(floor, base - step * d));
  for (const look of LOOKS) {
    for (const accent of ACCENTS) {
      const map = tokensFor(look, accent, rules);
      const where = look + ' ' + accent + ': ';
      try {
        const ground = colourOf(map, 'tab-base');
        const fill = colourOf(map, 'tab-accent');
        opacities.forEach((o, d) => {
          const row = composite({ ...fill, a: o }, ground);
          const textToken = d === 0 ? 'tab-ink-hi' : 'tab-ink';
          const r = contrast(composite(colourOf(map, textToken), row), row);
          if (r < 4.5) problems.push(where + '--' + textToken + ' on a tab at distance ' + d + ' (fill ' + Math.round(o * 100) + '%, ' + hex(row) + ') is ' + r.toFixed(2) + ':1, needs 4.5');
        });
        const dot = contrast(colourOf(map, 'tab-dirty'), ground);
        if (dot < 3) problems.push(where + 'the unsaved dot on its ring of --tab-base is ' + dot.toFixed(2) + ':1, needs 3');
        const bang = contrast(colourOf(map, 'tab-conflict'), ground);
        if (bang < 4.5) problems.push(where + 'the "!" of a conflict on --tab-base is ' + bang.toFixed(2) + ':1, needs 4.5');
        const strip = contrast(fill, colourOf(map, 'page'));
        if (strip < 3) problems.push(where + 'the selected tab (' + hex(fill) + ') against the page is ' + strip.toFixed(2) + ':1 in the collapsed strip, needs 3');
        const close = contrast(colourOf(map, 'text-on-danger'), colourOf(map, 'tab-close-hover-bg'));
        if (close < 4.5) problems.push(where + 'the close mark on its red is ' + close.toFixed(2) + ':1, needs 4.5');
      } catch (e) { problems.push(where + e.message); }
    }
  }
  // a self-chosen accent: the text on its selected tab is chosen against the fill that tab really has (ink: --accent-rgb = the lighter colour)
  const SAMPLES = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#000000', '#ffffff', '#ff6600', '#7f7f00', '#3366ff', '#d946ef', '#00b894'];
  for (const look of LOOKS) {
    const map = tokensFor(look, 'custom', rules); // <body class="theme-custom">: no accent block, the base block and the properties the script sets
    for (const sample of SAMPLES) {
      const t = customAccent(sample, look);
      const over = new Map(map);
      for (const [k, v] of Object.entries(t)) over.set(k.slice(2), v);
      try {
        const fill = colourOf(over, 'tab-accent');
        const r = contrast(colourOf(over, 'tab-ink-hi'), fill);
        if (r < 4.5) problems.push(look + ' custom ' + sample + ': --tab-ink-hi on the selected tab ' + hex(fill) + ' is ' + r.toFixed(2) + ':1, needs 4.5');
      } catch (e) { problems.push(look + ' custom ' + sample + ': ' + e.message); }
    }
  }
  return problems;
}

// ---- P5: the sticky note --------------------------------------------------------------------------------------------------------------------
// The paper is --sheet, then the tint (--note-tint: the accent at --note-tint-a), then the strip on top (--note-tape at rest, --note-tape-focus while
// focus is inside). The texts on it are PAIRS above; here are the properties of the strip and the tint.
function noteProblems(tokens, customAccent = Appearance.customAccent) {
  const rules = parseRules(tokens);
  const problems = [];
  const check = (where, map) => {
    try {
      const a = parseFloat(resolveValue(map.get('note-tint-a'), map));
      if (!(a > 0 && a <= 0.2)) problems.push(where + '--note-tint-a is ' + map.get('note-tint-a') + ': the paper of a note is a TINT of the accent (more than 0 and at most 0.2)');
      const paper = surface(map, NOTE);
      const focus = colourOf(map, 'note-tape-focus');
      const rest = composite(colourOf(map, 'note-tape'), paper); // the strip while nothing in the note has focus: the tape laid over the paper
      const against = [['the paper under it', paper, 3], ['the page behind it', colourOf(map, 'page'), 3], ['the strip at rest', rest, 2]];
      for (const [what, other, min] of against) {
        const r = contrast(focus, other);
        if (r < min) problems.push(where + 'the strip with focus ' + hex(focus) + ' against ' + what + ' ' + hex(other) + ' is ' + r.toFixed(2) + ':1, needs ' + min);
      }
    } catch (e) { problems.push(where + e.message); }
  };
  for (const look of LOOKS) {
    for (const accent of ACCENTS) check(look + ' ' + accent + ': ', tokensFor(look, accent, rules));
  }
  // a self-chosen accent: the tint and the strip follow --accent-rgb, --accent-label and --accent-color, which the script computes
  const SAMPLES = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#000000', '#ffffff', '#ff6600', '#7f7f00', '#3366ff', '#d946ef', '#00b894'];
  for (const look of LOOKS) {
    const map = tokensFor(look, 'custom', rules);
    for (const sample of SAMPLES) {
      const over = new Map(map);
      for (const [k, v] of Object.entries(customAccent(sample, look))) over.set(k.slice(2), v);
      check(look + ' custom ' + sample + ': ', over);
      for (const [text, min] of [['text-main', 4.5], ['text-muted', 4.5], ['accent-label', 4.5]]) {
        try {
          const paper = surface(over, NOTE);
          const r = contrast(colourOf(over, text), paper);
          if (r < min) problems.push(look + ' custom ' + sample + ': ' + text + ' on the paper of a note ' + hex(paper) + ' is ' + r.toFixed(2) + ':1, needs ' + min);
        } catch (e) { problems.push(look + ' custom ' + sample + ': ' + e.message); }
      }
    }
  }
  return problems;
}

// ---- running -------------------------------------------------------------------------------------------------------------------------------
const css = readTokens();
const chromeCss = fs.readFileSync('frontend/css/chrome.css', 'utf8').replace(/\r\n/g, '\n');
const styleCss = fs.readFileSync('frontend/css/style.css', 'utf8').replace(/\r\n/g, '\n');
const failures = [];
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS: ' + name); } catch (e) { failures.push(name); console.log('FAIL: ' + name); console.log(e && e.message ? e.message : e); }
}
const none = (list, what) => assert.deepEqual(list, [], what + ':\n  ' + list.join('\n  '));

check('contrast: every text of the window reads on its surfaces, on ink and on paper, for all five accents', () => {
  none(contrastProblems(css), 'a text does not read');
});

check('contrast: a self-chosen accent (js/appearance.js) reads on the surfaces of each look', () => {
  none(customProblems(css), 'a self-chosen accent does not read');
});

check('structure: the paper block follows the ink blocks, covers what they set, and the paper accents are alike', () => {
  none(structureProblems(css), 'the structure of tokens.css is wrong');
});

check('channels: --accent-rgb, --ink-rgb, --page-rgb, --sheet-rgb, --wall-rgb, --bar-*-rgb and --text-muted-rgb are the colour of their token, on every look and accent', () => {
  none(channelProblems(css), 'a channel token drifted from its colour');
});

check('margin: the line numbers keep 3:1 against the page, and the texts of the see-through bars read over text, on both looks and all five accents', () => {
  none(marginProblems(css, chromeCss), 'the margin or a bar does not read');
});

check('index tabs: the names read on every shade of tab (the selected one with --tab-ink-hi), the marks read on their ring, the selected tab shows in the collapsed strip, on both looks and all five accents and a self-chosen one', () => {
  none(tabProblems(css, styleCss), 'an index tab does not read');
});

check('sticky notes: every text of a panel reads on the paper of a note (the sheet under the accent tint), the strip that shows focus is 3:1 against the paper and the page and 2:1 against the strip at rest, on both looks and all five accents and a self-chosen one', () => {
  none(noteProblems(css), 'a sticky note does not read');
});

check('the v2 contract: the two looks differ on the surfaces and the text (paper is light, ink is dark)', () => {
  const ink = tokensFor('ink', 'olive');
  const paper = tokensFor('paper', 'olive');
  const L = (m, n) => { const c = colourOf(m, n); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  assert.ok(L(paper, 'page') > 200 && L(ink, 'page') < 60, 'page: paper light, ink dark');
  assert.ok(L(paper, 'ink') < 60 && L(ink, 'ink') > 180, 'ink text: dark on paper, light on ink');
  assert.ok(L(paper, 'wall') < L(paper, 'page') && L(ink, 'wall') < L(ink, 'page'), 'the wall is behind the page (darker) on both looks');
  assert.ok(L(ink, 'page') < L(ink, 'sheet') && L(paper, 'page') <= L(paper, 'sheet'), 'the sheet lies on the page (lighter) on both looks');
  assert.equal(hex(colourOf(paper, 'wall')), '#e6e6e1');
  assert.equal(hex(colourOf(paper, 'page')), '#fbfbf9');
  assert.equal(hex(colourOf(paper, 'sheet')), '#ffffff');
  assert.equal(hex(colourOf(paper, 'ink')), '#16171b');
  assert.equal(hex(colourOf(ink, 'wall')), '#0a0a0a');
  assert.equal(hex(colourOf(ink, 'page')), '#1e1e1e');
  assert.equal(hex(colourOf(ink, 'sheet')), '#252526');
  assert.equal(hex(colourOf(ink, 'ink')), '#dcdde3');
  assert.equal(hex(colourOf(ink, 'ink-2')), '#9d9d9d');
});

check('the five accents exist on both looks and the default accent of ink is Dark Olive', () => {
  for (const look of LOOKS) {
    const colours = new Set();
    for (const accent of ACCENTS) colours.add(hex(colourOf(tokensFor(look, accent), 'accent-color')));
    assert.equal(colours.size, 5, look + ': five different accent colours');
  }
  assert.equal(hex(colourOf(tokensFor('ink', 'olive'), 'accent-color')), '#556b2f');
  assert.equal(hex(colourOf(tokensFor('ink', 'vermilion'), 'accent-color')), '#b8472c');
  assert.equal(hex(colourOf(tokensFor('ink', 'vermilion'), 'accent-hover')), '#cf5c3c');
  assert.equal(hex(colourOf(tokensFor('ink', 'vermilion'), 'accent-label')), '#f1977c');
  // the base block alone (what <body class="dark-theme"> with no accent class looks like) is Dark Olive, as the page ships
  assert.equal(hex(colourOf(tokensFor('ink', 'none'), 'accent-color')), '#556b2f');
});

// ---- the mutation check: every check above fails on a copy of tokens.css that is broken the way it is meant to catch ---------------------------
function mutate(text, find, replace) {
  assert.ok(text.includes(find), 'the mutation target exists in tokens.css: ' + find);
  return text.replace(find, replace);
}
const paperStart = css.indexOf('body.look-paper {');
check('mutation check: broken copies of tokens.css are caught by the contrast, structure and channel checks', () => {
  assert.equal(contrastProblems(css).length, 0, 'the real file is clean (the premise of the mutations)');
  assert.equal(structureProblems(css).length, 0);
  assert.equal(channelProblems(css).length, 0);
  // contrast
  const paperText = css.slice(paperStart);
  const weakMuted = css.slice(0, paperStart) + mutate(paperText, '--text-muted: #62636b;', '--text-muted: #9a9ba3;');
  assert.ok(contrastProblems(weakMuted).some((p) => /text-muted/.test(p)), 'a washed-out supporting text on paper is caught');
  const darkLabel = mutate(css, '--accent-label: #a6c26a;\n  --accent-active-bg: #424e30;\n  --bg-preview: #1e2227;\n  --accent-rgb: 107 132 61;', '--accent-label: #556b2f;\n  --accent-active-bg: #424e30;\n  --bg-preview: #1e2227;\n  --accent-rgb: 107 132 61;');
  assert.ok(contrastProblems(darkLabel).some((p) => /accent-label/.test(p)), 'a dark accent label on ink is caught');
  const lightLabel = css.slice(0, paperStart) + paperText.split('--accent-label: #3f5226;').join('--accent-label: #a6c26a;'); // the general block and the olive block
  assert.ok(contrastProblems(lightLabel).some((p) => /paper olive: accent-label/.test(p)), 'a light accent label on paper is caught');
  const whiteOnYellow = css.slice(0, paperStart) + mutate(paperText, '--accent-color: #b8472c;', '--accent-color: #e8c200;');
  assert.ok(contrastProblems(whiteOnYellow).some((p) => /vermilion: text-on-accent/.test(p)), 'white text on a pale accent fill is caught');
  const lightState = css.slice(0, paperStart) + mutate(paperText, '--coral: #b3261e;', '--coral: #f48771;');
  assert.ok(contrastProblems(lightState).some((p) => /coral/.test(p)), 'a dark-look state colour on paper is caught');
  // structure
  const noPaperToken = css.slice(0, paperStart) + mutate(paperText, '  --text-soft: #44454c;\n', '');
  assert.ok(structureProblems(noPaperToken).some((p) => /--text-soft/.test(p)), 'a token that paper forgot is caught');
  const leak = css.slice(0, paperStart) + mutate(paperText, '  --status-ok: #1a6f3d;\n', '');
  assert.ok(structureProblems(leak).some((p) => /--status-ok/.test(p)), 'a token of an ink accent block that paper does not answer (a leak) is caught');
  const paperFirst = css.slice(0, css.indexOf('body.dark-theme {')) + paperText + '\n' + css.slice(css.indexOf('body.dark-theme {'), paperStart);
  assert.ok(structureProblems(paperFirst).some((p) => /must come after the ink base block/.test(p)), 'paper before the ink base is caught');
  const uneven = css.slice(0, paperStart) + mutate(paperText, 'body.look-paper.theme-forest {\n  --bg-context-hover: #e2f1ec;', 'body.look-paper.theme-forest {');
  assert.ok(structureProblems(uneven).some((p) => /paper accent blocks do not define the same tokens/.test(p)), 'a paper accent block with a missing token is caught');
  // channels
  const drift = mutate(css, '--accent-rgb: 107 132 61;\n  --bar-bottom-rgb: 59 68 43;\n  --aura-gradient: radial-gradient(circle, rgba(138', '--accent-rgb: 107 132 60;\n  --bar-bottom-rgb: 59 68 43;\n  --aura-gradient: radial-gradient(circle, rgba(138');
  assert.ok(channelProblems(drift).some((p) => /accent-rgb/.test(p)), 'a channel token that drifted from its colour is caught');
  const driftInk = css.slice(0, paperStart) + mutate(paperText, '--ink-rgb: 22 23 27;', '--ink-rgb: 22 23 28;');
  assert.ok(channelProblems(driftInk).some((p) => /ink-rgb/.test(p)), 'a drifted --ink-rgb is caught');
  // the margin and the bars
  assert.equal(marginProblems(css, chromeCss).length, 0, 'the real files are clean (the premise of the mutations)');
  const faintInk = mutate(css, '--linenum-a: 0.68;', '--linenum-a: 0.45;');
  assert.ok(marginProblems(faintInk, chromeCss).some((p) => /ink .*line numbers/.test(p)), 'line numbers too faint on ink are caught');
  const faintPaper = css.slice(0, paperStart) + mutate(paperText, '--linenum-a: 0.74;', '--linenum-a: 0.5;');
  assert.ok(marginProblems(faintPaper, chromeCss).some((p) => /paper .*line numbers/.test(p)), 'line numbers too faint on paper are caught');
  const noAlpha = mutate(css, '  --linenum-a: 0.68;\n', '');
  assert.ok(marginProblems(noAlpha, chromeCss).some((p) => /linenum-a/.test(p)), 'a look without --linenum-a is caught');
  const clear = chromeCss.replace('--bar-a: 0.55;', '--bar-a: 0.2;');
  assert.notEqual(clear, chromeCss);
  assert.ok(marginProblems(css, clear).some((p) => /glass bars over/.test(p)), 'bars so see-through that their text does not read are caught');
  const clearLight = chromeCss.replace('--bar-a: 0.86;', '--bar-a: 0.3;');
  assert.notEqual(clearLight, chromeCss);
  assert.ok(marginProblems(css, clearLight).some((p) => /light bars over/.test(p)), 'the same for the light bars');
  assert.ok(marginProblems(css, chromeCss.replace(/--bar-a: 0\.86;/, '')).some((p) => /opacity of the bars/.test(p)), 'a missing opacity is caught');
  // the index tabs
  assert.equal(tabProblems(css, styleCss).length, 0, 'the real files are clean (the premise of the mutations)');
  const dimInk = mutate(css, '--tab-ink: var(--ink);', '--tab-ink: var(--ink-2);');
  assert.ok(tabProblems(dimInk, styleCss).some((p) => /--tab-ink on a tab at distance/.test(p)), 'the dim supporting text on the tabs is caught');
  const lightFillLine = '/* the text on the full accent of a tab: the fill is light, white reads at 4.2:1 or less, the wall colour at 4.8 or more */\n  --tab-ink-hi: var(--wall);';
  assert.ok(css.includes(lightFillLine), 'the mutation target exists in tokens.css: the three light ink accents say --tab-ink-hi: var(--wall)');
  const whiteOnOlive = css.split(lightFillLine).join('--tab-ink-hi: var(--text-on-accent);');
  assert.ok(tabProblems(whiteOnOlive, styleCss).some((p) => /ink olive: --tab-ink-hi/.test(p)), 'white on the light Olive fill of ink is caught');
  const darkOnPaper = css.slice(0, paperStart) + mutate(paperText, '--tab-ink-hi: var(--text-on-accent);', '--tab-ink-hi: var(--ink);');
  assert.ok(tabProblems(darkOnPaper, styleCss).some((p) => /paper .*--tab-ink-hi/.test(p)), 'dark text on the dark paper fill is caught');
  const faintDot = css.slice(0, paperStart) + mutate(paperText, '--dirty-dot: #a8650a;', '--dirty-dot: #d8d0b8;');
  assert.ok(tabProblems(faintDot, styleCss).some((p) => /unsaved dot/.test(p)), 'an unsaved dot that does not show on its ring is caught');
  assert.ok(tabProblems(css, styleCss.replace('--tab-mix-floor: 0.2;', '')).some((p) => /not numbers in order/.test(p)), 'a missing shading constant is caught');
  const withoutTabInk = (hexColour, look) => { const o = Appearance.customAccent(hexColour, look); delete o['--tab-ink-hi']; return o; };
  assert.ok(tabProblems(css, styleCss, withoutTabInk).some((p) => /custom .*--tab-ink-hi/.test(p)), 'a self-chosen accent that does not choose its own --tab-ink-hi is caught');
  // the sticky note
  assert.equal(noteProblems(css).length, 0, 'the real file is clean (the premise of the mutations)');
  const heavyTint = mutate(css, '--note-tint-a: 0.12;', '--note-tint-a: 0.45;');
  assert.ok(noteProblems(heavyTint).some((p) => /ink .*--note-tint-a is 0\.45/.test(p)), 'a paper that is no longer a tint is caught');
  assert.ok(contrastProblems(heavyTint).some((p) => /ink .*\(the (strong )?text of a sticky note\)|\(the hint and the context line of a sticky note\)/.test(p)), 'a tint so heavy that the text on a note does not read is caught');
  const paleStripPaper = css.slice(0, paperStart) + mutate(paperText, '--note-tape-focus: var(--accent-color);', '--note-tape-focus: #d8dccf;');
  assert.ok(noteProblems(paleStripPaper).some((p) => /paper olive: the strip with focus/.test(p)), 'a pale strip on a pale paper is caught');
  assert.ok(contrastProblems(paleStripPaper).some((p) => /note-tape-focus/.test(p)), 'the same through the pairs');
  const dullStripInk = mutate(css, '--note-tape-focus: var(--accent-label);', '--note-tape-focus: var(--accent-active-bg);');
  assert.ok(noteProblems(dullStripInk).some((p) => /ink olive: the strip with focus/.test(p)), 'a dark strip on a dark paper is caught');
  const sameAsRest = mutate(css, '--note-tape-focus: var(--accent-label);', '--note-tape-focus: var(--note-tape);');
  assert.ok(noteProblems(sameAsRest).some((p) => /against the strip at rest/.test(p)), 'a focused strip that looks like the strip at rest is caught');
  const noTint = mutate(css, '  --note-tint: rgb(var(--accent-rgb) / var(--note-tint-a));\n', '');
  assert.ok(noteProblems(noTint).some((p) => /note-tint/.test(p)), 'a missing --note-tint is caught');
  const unthinned = (hexColour, look) => { const o = Appearance.customAccent(hexColour, look); delete o['--note-tint-a']; return o; };
  assert.ok(noteProblems(css, unthinned).some((p) => /ink custom #ffffff: text-muted on the paper of a note/.test(p)), 'a self-chosen accent that does not thin the tint of a note is caught');
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
console.log('\nAll look contrast tests passed!');
