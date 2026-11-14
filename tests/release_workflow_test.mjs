// Regression checks for .github/workflows/release.yml learned from past CI/release failures:
// - gh release commands must pass --repo "$GITHUB_REPOSITORY" (v1.2.0 failure)
// - pwsh steps must read $env:RELEASE_TAG, not bare $RELEASE_TAG (v1.2.0 pwsh failure)
// - both Windows and macOS jobs run Go + JS tests before building/uploading
// - publish job un-drafts the release only when builds succeed
import assert from 'node:assert/strict';
import fs from 'node:fs';

const yml = fs.readFileSync('.github/workflows/release.yml', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (e) {
    failures.push(name);
    console.log('FAIL: ' + name);
    console.log(e && e.message ? e.message : e);
  }
}

check('every gh release command passes --repo', () => {
  const lines = yml.split('\n').filter((l) => /\bgh release\b/.test(l));
  assert.ok(lines.length >= 4, 'expected gh release commands in prepare, upload, and publish');
  for (const l of lines) {
    assert.ok(l.includes('--repo'), 'missing --repo in: ' + l.trim());
  }
});

check('pwsh steps use $env:RELEASE_TAG instead of bare $RELEASE_TAG', () => {
  const blocks = yml.split(/\n\s*-\s+name:/).slice(1);
  for (const b of blocks) {
    if (!/shell:\s*pwsh\b/.test(b)) continue;
    const runMatch = b.match(/\n\s*run:\s*\|\n([\s\S]*)/);
    if (!runMatch) continue;
    const script = runMatch[1];
    assert.ok(!/(?<!env:)\$RELEASE_TAG\b/.test(script), 'bare $RELEASE_TAG in pwsh step:\n' + script.slice(0, 200));
  }
});

check('both build-windows and build-macos run Go tests and JS tests', () => {
  const winSection = yml.split(/\n  build-macos:/)[0];
  const macSection = yml.split(/\n  build-macos:/)[1] || '';
  assert.ok(/go test\b/.test(winSection) && /node tools\/run_js_tests\.mjs/.test(winSection), 'Windows release runs Go + JS tests');
  assert.ok(/go test\b/.test(macSection) && /node tools\/run_js_tests\.mjs/.test(macSection), 'macOS release runs Go + JS tests');
});

check('publish job flips draft to false', () => {
  assert.ok(/gh release edit "\$RELEASE_TAG"[^\n]*--draft=false/.test(yml), 'publish job un-drafts the release');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
