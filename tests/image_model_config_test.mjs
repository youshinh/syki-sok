import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('llmConfigOf maps img_ request ids to config.image, not config.text', () => {
  const appJs = fs.readFileSync(path.resolve('frontend/js/app.js'), 'utf8');

  // Verify llmConfigOf includes img_ branch
  const match = appJs.match(/function llmConfigOf\(reqId\) \{[\s\S]*?\}/);
  assert.ok(match, 'llmConfigOf function must be found in app.js');
  const fnCode = match[0];
  assert.ok(fnCode.includes("startsWith('img_')"), 'llmConfigOf must check startsWith("img_")');
  assert.ok(fnCode.includes('config.image'), 'llmConfigOf must return config.image for img_');

  // Verify dedicated image model validation is present
  assert.ok(appJs.includes('function isDedicatedImageModel('), 'app.js must define isDedicatedImageModel');
  assert.ok(appJs.includes("imageModel = 'gemini-3.1-flash-image'"), 'app.js must default imageModel to gemini-3.1-flash-image');

  // Verify config defaults
  assert.ok(appJs.includes("model: 'gemini-3.1-flash-image'"), 'default config must specify gemini-3.1-flash-image');

  // Verify inheritTextConnection does NOT overwrite config.image.model
  const inheritMatch = appJs.match(/if \(saveInheritEl\.checked\) \{[\s\S]*?\n    \}/);
  assert.ok(inheritMatch, 'saveInheritEl block must exist');
  assert.ok(!inheritMatch[0].includes('config.image.model ='), 'inherit logic must NEVER overwrite config.image.model');
});
