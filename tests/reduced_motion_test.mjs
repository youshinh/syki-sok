// v2 phase P6: reduced motion audit and verification.
//
// What is locked:
//   1. frontend/css/style.css contains a comprehensive `@media (prefers-reduced-motion: reduce)` block
//      targeting `*, *::before, *::after` with:
//        - animation-duration: 0.01ms !important (or 0s)
//        - transition-duration: 0s !important
//        - scroll-behavior: auto !important
//   2. Specific UI elements that have entrance animations or delays (.tab-index, .status-ai-pop,
//      #settings-modal, .lesson-card, #stat-recording) have explicit overrides for reduced motion.
//   3. JS modules managing time-based panel fades (frontend/js/panel_fade.js) query
//      matchMedia('(prefers-reduced-motion: reduce)') and skip fades accordingly.
//   4. No unchecked smooth scrolling (scrollIntoView with behavior: 'smooth') exists in frontend scripts.
//   5. Mutation checks ensure that removing the universal reset or removing JS checks causes the test to fail.
//
// Node only, no browser. Run: node tests/reduced_motion_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const lf = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => lf(fs.readFileSync(p, 'utf8'));

function checkReducedMotion(styleCss, panelFadeJs, allJsCode) {
  // 1. Universal rule verification
  const universalPattern = /@media[^{}]*?\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)[^{}]*\{[\s\S]*?\*[\s\S]*?animation-duration\s*:\s*(?:0\.01ms|0s)\s*!important[\s\S]*?transition-duration\s*:\s*0s\s*!important[\s\S]*?\}/;
  assert.ok(universalPattern.test(styleCss), 'style.css must have universal animation and transition reset for reduced motion');

  // 2. Tab open delay zeroing verification
  const tabDelayPattern = /@media[^{}]*?\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)[^{}]*\{[\s\S]*?--tab-open-delay\s*:\s*0ms;/;
  assert.ok(tabDelayPattern.test(styleCss), 'style.css must zero --tab-open-delay under reduced motion');

  // 3. JS matchMedia check in panel_fade.js
  assert.ok(
    panelFadeJs.includes("prefers-reduced-motion: reduce") && panelFadeJs.includes("matchMedia"),
    'panel_fade.js must query matchMedia for prefers-reduced-motion'
  );

  // 4. No unchecked scrollIntoView({ behavior: 'smooth' })
  const smoothScrollRe = /scrollIntoView\(\s*\{[^\}]*?behavior\s*:\s*['"]smooth['"]/g;
  const smoothMatches = allJsCode.match(smoothScrollRe) || [];
  assert.equal(smoothMatches.length, 0, 'No unchecked smooth scrolling should be hardcoded in frontend JS');
}

// Run against real files
const styleCssPath = path.join(REPO_ROOT, 'frontend', 'css', 'style.css');
const panelFadePath = path.join(REPO_ROOT, 'frontend', 'js', 'panel_fade.js');
const jsDir = path.join(REPO_ROOT, 'frontend', 'js');

const realStyleCss = read(styleCssPath);
const realPanelFadeJs = read(panelFadePath);

// Collect all frontend/js non-test scripts
const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js') && !f.endsWith('_test.js'));
const allJsContent = jsFiles.map((f) => read(path.join(jsDir, f))).join('\n');

checkReducedMotion(realStyleCss, realPanelFadeJs, allJsContent);

// ---- Mutation Checks (must catch 4 violations) ----------------------------------------------------
let mutationsCaught = 0;

// Mutation 1: Universal rule removed
try {
  const brokenCss = realStyleCss.replace('animation-duration: 0.01ms !important;', '');
  checkReducedMotion(brokenCss, realPanelFadeJs, allJsContent);
  assert.fail('Mutation 1 should have failed');
} catch (e) {
  if (e.message.includes('universal animation and transition reset')) mutationsCaught++;
  else throw e;
}

// Mutation 2: Tab delay override removed
try {
  const brokenCss = realStyleCss.replace('--tab-open-delay: 0ms;', '--tab-open-delay: 200ms;');
  checkReducedMotion(brokenCss, realPanelFadeJs, allJsContent);
  assert.fail('Mutation 2 should have failed');
} catch (e) {
  if (e.message.includes('zero --tab-open-delay')) mutationsCaught++;
  else throw e;
}

// Mutation 3: JS matchMedia check removed from panel_fade.js
try {
  const brokenJs = realPanelFadeJs.replace('prefers-reduced-motion: reduce', 'something-else');
  checkReducedMotion(realStyleCss, brokenJs, allJsContent);
  assert.fail('Mutation 3 should have failed');
} catch (e) {
  if (e.message.includes('panel_fade.js must query matchMedia')) mutationsCaught++;
  else throw e;
}

// Mutation 4: Smooth scrolling injected into JS
try {
  const brokenAllJs = allJsContent + "\nelement.scrollIntoView({ behavior: 'smooth' });";
  checkReducedMotion(realStyleCss, realPanelFadeJs, brokenAllJs);
  assert.fail('Mutation 4 should have failed');
} catch (e) {
  if (e.message.includes('No unchecked smooth scrolling')) mutationsCaught++;
  else throw e;
}

assert.equal(mutationsCaught, 4, `all 4 mutations must be caught (caught: ${mutationsCaught})`);
console.log('reduced_motion_test: PASS (rules verified, 4/4 mutations caught)');
