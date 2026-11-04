import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('renderMermaidToImage contract and mistake-proofing', async (t) => {
  const appJs = readFileSync('frontend/js/app.js', 'utf8');

  await t.test('calls repair(code).code and passes a string to mermaid.render', () => {
    // Crucial: repair() returns { code, fixes, type }. Passing the object itself
    // causes "i.replace is not a function" inside Mermaid's detectType parser.
    assert.match(
      appJs,
      /window\.MermaidRepair\.repair\(mermaidCode\)\.code/,
      'Must extract .code from MermaidRepair.repair'
    );
    assert.doesNotMatch(
      appJs,
      /await window\.mermaid\.render\([^,]+,\s*repaired\)/,
      'Must never pass repaired object directly to mermaid.render'
    );
  });

  await t.test('does not reference non-existent markdownLinkTarget in JS', () => {
    // markdownLinkTarget is a Go function; JS uses FileAnchor.encodeLinkTarget
    assert.doesNotMatch(
      appJs,
      /markdownLinkTarget\(/,
      'Must not call undefined markdownLinkTarget in app.js'
    );
  });

  await t.test('supports fallback preview container [data-mermaid-src]', () => {
    assert.match(
      appJs,
      /document\.querySelector\(\s*["']\[data-mermaid-src\]["']\s*\)/,
      'Must check [data-mermaid-src] on preview elements'
    );
  });

  await t.test('cleans up Mermaid error leftovers on failure', () => {
    assert.match(
      appJs,
      /removeMermaidLeftovers\(renderId\)/,
      'Must clean up renderId leftovers'
    );
    assert.match(
      appJs,
      /removeMermaidLeftovers\(renderId \+ ['"]r['"]\)/,
      'Must clean up repaired renderId leftovers'
    );
  });
});
