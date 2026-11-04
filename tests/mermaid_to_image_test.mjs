import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Gemini / Nano Banana image generation and Local PNG renderer wiring', async (t) => {
  const appJs = readFileSync('frontend/js/app.js', 'utf8');

  await t.test('wires shortcut and context menu to generateImageFromMermaid (Gemini / Nano Banana)', () => {
    assert.match(
      appJs,
      /matchShortcut\(e,\s*config\.shortcuts\s*&&\s*config\.shortcuts\.mermaidToImage\)[^}]+generateImageFromMermaid\(\)/,
      'mermaidToImage shortcut must call generateImageFromMermaid'
    );
    assert.match(
      appJs,
      /ctxMermaidToImage\.onclick\s*=\s*\(\)\s*=>\s*\{[^}]+generateImageFromMermaid\(\);/,
      'ctxMermaidToImage must call generateImageFromMermaid'
    );
  });

  await t.test('calls backend.generateImageAsync with ImageConfig', () => {
    assert.match(
      appJs,
      /window\.backend\.generateImageAsync\(/,
      'generateImageFromMermaid must call window.backend.generateImageAsync'
    );
  });

  await t.test('exposes generateImageFromMermaid and renderMermaidToImage to test helper', () => {
    assert.match(
      appJs,
      /generateImageFromMermaid,/,
      'Must expose generateImageFromMermaid in test helper'
    );
    assert.match(
      appJs,
      /renderMermaidToImage,/,
      'Must expose renderMermaidToImage in test helper'
    );
  });
});
