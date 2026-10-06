// Shared by the tests that read frontend/css/style.css and want to see the colours a rule ends up with.
//
// Since the colour tokens moved into frontend/css/tokens.css (v2 phase P1a), style.css says var(--veil-07) where it used to
// say rgba(255, 255, 255, 0.07). A test that asserts the design value ("a pale fill", "white text on the accent") reads
// the style sheet through withTokens(): every token that stands for one of those former literals is put back as its dark
// value, so the old assertions keep their meaning. The tokens that already existed before P1a (the surfaces, the text
// and the accent colours: ORIGINAL_TOKENS) are left as var(--name), because tests assert the use of those names.
// A token whose value is itself a var() (an alias such as --preview-frame: var(--accent-hover)) is left as var(--name) too: the name is the claim.
// withTokens() also puts tokens.css in front, so a test can look at "body.theme-blue { ... }" as before.
import fs from 'node:fs';

const lf = (s) => s.replace(/\r\n/g, '\n');
export const readTokensCss = () => lf(fs.readFileSync('frontend/css/tokens.css', 'utf8'));

export const ORIGINAL_TOKENS = new Set([
  'panel-width', 'panel-top', 'panel-modal-top', 'panel-shadow', 'panel-line',
  'bg-main', 'bg-header', 'bg-tab', 'bg-tab-active', 'bg-tab-hover', 'bg-editor', 'bg-line-num', 'bg-modal', 'bg-input', 'bg-btn',
  'bg-btn-hover', 'bg-context', 'bg-statusbar', 'bg-context-hover', 'accent-color', 'accent-hover', 'accent-label', 'accent-active-bg',
  'bg-preview', 'text-main', 'text-muted', 'text-active', 'border-color', 'status-ok', 'status-warn', 'status-error',
  'result-open', 'result-body', 'result-close', 'text-error'
]);

// name -> value of the base block of tokens.css (body.dark-theme)
export function baseTokens(tokensCss = readTokensCss()) {
  const at = tokensCss.indexOf('body.dark-theme {');
  if (at === -1) throw new Error('tokens.css has no body.dark-theme block');
  const body = tokensCss.slice(at, tokensCss.indexOf('\n}', at));
  const map = new Map();
  for (const m of body.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)) map.set(m[1], m[2].trim());
  return map;
}

export function withTokens(styleCss) {
  const tokensCss = readTokensCss();
  const base = baseTokens(tokensCss);
  const resolved = lf(styleCss).replace(/var\(--([\w-]+)\)/g, (whole, name) => (!ORIGINAL_TOKENS.has(name) && base.has(name) && !/^var\(/.test(base.get(name)) ? base.get(name) : whole));
  return tokensCss + '\n' + resolved;
}
