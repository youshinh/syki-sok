// v2 phase P6: forced colours audit and rules.
//
// What is locked:
//   1. Every surface identified in the forced-colors audit (docs/design/v2-plan-P6.md section 3) has an active rule
//      inside a `@media (forced-colors: active)` block in frontend/css/chrome.css or frontend/css/style.css.
//   2. `forced-color-adjust: none` is used ONLY on explicitly allowed surfaces (.accent-swatch and .fanchor-layer),
//      where preserving the original colour or transparent layer is essential to functionality.
//   3. Inside `@media (forced-colors: active)` blocks, no colour literals (#hex, rgb(), etc.) are used; only system
//      colour keywords (Canvas, CanvasText, Highlight, HighlightText, ButtonText, GrayText, LinkText), transparent,
//      currentColor, or none are permitted.
//   4. Mutation tests verify that removing a required surface, adding an unauthorized forced-color-adjust, or adding
//      a literal colour inside a forced-colors block causes the test to fail.
//
// Node only, no browser. Run: node tests/forced_colors_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const lf = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => lf(fs.readFileSync(p, 'utf8'));

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

// Extract the contents of all `@media (forced-colors: active)` blocks from a CSS string
function extractForcedColorsBlocks(css) {
  const clean = stripCssComments(css);
  const blocks = [];
  const re = /@media[^{}]*?\(\s*forced-colors\s*:\s*active\s*\)[^{}]*\{/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    let depth = 1;
    let idx = m.index + m[0].length;
    const start = idx;
    while (idx < clean.length && depth > 0) {
      const c = clean[idx];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      idx++;
    }
    if (depth === 0) {
      blocks.push({
        start: start,
        end: idx - 1,
        content: clean.substring(start, idx - 1)
      });
    }
  }
  return blocks;
}

// Surfaces required to have rules under forced-colors
const REQUIRED_SURFACES = [
  '.status-ai-track',
  '#settings-modal input[type="checkbox"]',
  '.accent-swatch',
  '.quick-pick-item',
  '.scraps-match-item',
  '.tab-list-row',
  '.btn-header-icon.active',
  '.scraps-filter-chip.on',
  '.clickable-badge::before',
  '#stat-recording .rec-dot',
  '.voice-dot',
  '.preview-badge',
  '.find-match-rect',
  '.result-accent-bar',
  '.ghost-diff-band',
  '.ghost-suggestion',
  '.fanchor-layer',
  '#cursor-aura',
  '.tab-item',
  '.inline-prompt-bar'
];

const ALLOWED_FORCED_COLOR_ADJUST_SELECTORS = [
  '.accent-swatch',
  '.fanchor-layer'
];

function checkForcedColors(chromeCss, styleCss) {
  const allCss = chromeCss + '\n' + styleCss;
  const blocks = extractForcedColorsBlocks(allCss);
  assert.ok(blocks.length > 0, 'at least one @media (forced-colors: active) block must exist');

  const combinedForcedCss = blocks.map((b) => b.content).join('\n');

  // 1. Verify required surfaces exist in forced-colors blocks
  for (const surface of REQUIRED_SURFACES) {
    const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const surfaceRe = new RegExp(escaped + '(?=[\\s,{>+~:[])', 'i');
    assert.ok(surfaceRe.test(combinedForcedCss), `forced-colors rules must cover surface: "${surface}"`);
  }

  // 2. Verify forced-color-adjust: none is strictly controlled across ALL css files
  const cleanAll = stripCssComments(allCss);
  const fcaRegex = /([^{};]+)\{[^{}]*?forced-color-adjust\s*:\s*none[^{}]*?\}/gi;
  let fcaMatch;
  while ((fcaMatch = fcaRegex.exec(cleanAll)) !== null) {
    const selector = fcaMatch[1].trim();
    const isAllowed = ALLOWED_FORCED_COLOR_ADJUST_SELECTORS.some((allowed) => selector.includes(allowed));
    assert.ok(isAllowed, `forced-color-adjust: none is not allowed on selector "${selector}"`);
  }

  // 3. Verify no raw colour literals (#hex, rgb(), hsl()) inside forced-colors blocks
  const HEX_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/;
  const FUNC_LITERAL = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i;
  assert.ok(!HEX_LITERAL.test(combinedForcedCss), 'forced-colors blocks must not contain hex colour literals');
  assert.ok(!FUNC_LITERAL.test(combinedForcedCss), 'forced-colors blocks must not contain rgb/hsl colour functions');
}

// Run against real files
const chromeCssPath = path.join(REPO_ROOT, 'frontend', 'css', 'chrome.css');
const styleCssPath = path.join(REPO_ROOT, 'frontend', 'css', 'style.css');

const realChromeCss = read(chromeCssPath);
const realStyleCss = read(styleCssPath);

checkForcedColors(realChromeCss, realStyleCss);

// ---- Mutation Checks (must catch 5 violations) ----------------------------------------------------
let mutationsCaught = 0;

// Mutation 1: Missing a required surface
try {
  const brokenCss = realChromeCss.replace('.ghost-suggestion', '.nonexistent-ghost');
  checkForcedColors(brokenCss, realStyleCss);
  assert.fail('Mutation 1 should have failed');
} catch (e) {
  if (e.message.includes('forced-colors rules must cover surface')) mutationsCaught++;
  else throw e;
}

// Mutation 2: Unauthorized forced-color-adjust
try {
  const brokenCss = realChromeCss + '\n.some-other-class { forced-color-adjust: none; }';
  checkForcedColors(brokenCss, realStyleCss);
  assert.fail('Mutation 2 should have failed');
} catch (e) {
  if (e.message.includes('forced-color-adjust: none is not allowed')) mutationsCaught++;
  else throw e;
}

// Mutation 3: Hex literal inside forced-colors
try {
  const brokenCss = realChromeCss.replace(
    '.preview-badge {\n    border: 1px solid CanvasText;\n  }',
    '.preview-badge {\n    border: 1px solid #ff0000;\n  }'
  );
  checkForcedColors(brokenCss, realStyleCss);
  assert.fail('Mutation 3 should have failed');
} catch (e) {
  if (e.message.includes('forced-colors blocks must not contain hex')) mutationsCaught++;
  else throw e;
}

// Mutation 4: rgb() literal inside forced-colors
try {
  const brokenCss = realChromeCss.replace(
    '.preview-badge {\n    border: 1px solid CanvasText;\n  }',
    '.preview-badge {\n    border: 1px solid rgb(255, 0, 0);\n  }'
  );
  checkForcedColors(brokenCss, realStyleCss);
  assert.fail('Mutation 4 should have failed');
} catch (e) {
  if (e.message.includes('forced-colors blocks must not contain rgb')) mutationsCaught++;
  else throw e;
}

// Mutation 5: No forced-colors blocks
try {
  checkForcedColors('body { color: red; }', 'div { color: blue; }');
  assert.fail('Mutation 5 should have failed');
} catch (e) {
  if (e.message.includes('at least one @media (forced-colors: active)')) mutationsCaught++;
  else throw e;
}

assert.equal(mutationsCaught, 5, `all 5 mutations must be caught (caught: ${mutationsCaught})`);
console.log('forced_colors_test: PASS (rules verified, 5/5 mutations caught)');
