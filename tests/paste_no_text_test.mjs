// A picture pasted with nothing to read (scenery, a person): the prompt says what to answer then (NO_TEXT), and that answer puts the picture
// itself into the note, as a file next to the note, instead of a description of it. A transcription is untouched.
import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

console.log('=== paste: picture with no text ===');
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');
const i18n = fs.readFileSync(new URL('../frontend/js/i18n.js', import.meta.url), 'utf8');
const grab = (re, what) => { const m = re.exec(app); assert.ok(m, what + ' exists'); return m[0]; };

const src = [
  grab(/const NO_TEXT_ANSWER = [^\n]*\n/, 'the word'),
  grab(/const DEFAULT_VISION_PROMPT = [^\n]*\n/, 'the default prompt'),
  grab(/const NO_TEXT_RULE = [\s\S]*?;\r?\n/, 'the rule'),
  grab(/function visionPromptWithNoText\(prompt\) \{[\s\S]*?\r?\n  \}/, 'visionPromptWithNoText'),
  grab(/function isNoTextAnswer\(text\) \{[\s\S]*?\r?\n  \}/, 'isNoTextAnswer'),
  grab(/async function putImageInsteadOfText\(reqId, info\) \{[\s\S]*?\r?\n  \}\r?\n/, 'putImageInsteadOfText'),
].join('\n');

const calls = { saveAsset: [], replace: [], finished: [], messages: [] };
let saveResult = { relPath: 'assets/2026-10-17-101500.png' };
const ctx = {
  window: { backend: { saveAsset: async (dir, ext, b64) => { calls.saveAsset.push({ dir, ext, b64 }); if (saveResult instanceof Error) throw saveResult; return saveResult; } },
    FileAnchor: { encodeLinkTarget: (x) => x.replace(/ /g, '%20') } },
  t: (k, p) => k + (p ? JSON.stringify(p) : ''),
  getNoteDir: async () => 'C:\\notes',
  getTab: (id) => ({ id }),
  assetExtForMime: (m) => (m === 'image/jpeg' ? 'jpg' : 'png'),
  applyAnchorReplacement: (tabId, anchor, replacement, baseline) => { calls.replace.push({ tabId, anchor, replacement }); return true; },
  finishLlmTask: (reqId, info, status, error) => calls.finished.push({ reqId, status, error }),
  showMessage: (m) => calls.messages.push(m),
  String, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const run = (code) => vm.runInContext(code, ctx);

// the prompt: the rule is added to what is set; an empty prompt gets the default; the setting itself is not touched
const withRule = run('visionPromptWithNoText');
assert.ok(withRule('Read this into Markdown.').startsWith('Read this into Markdown.\n\n'), 'the person\'s own prompt stays first');
assert.ok(/exactly NO_TEXT and nothing else/.test(withRule('x')), 'it says what to answer');
assert.ok(withRule('').startsWith('Transcribe the content of this image'), 'an empty prompt gets the default');
assert.ok(withRule(undefined).includes('NO_TEXT'));

// which answers are "nothing to read"
const isNo = run('isNoTextAnswer');
for (const yes of ['NO_TEXT', ' NO_TEXT\n', 'no_text', 'NO_TEXT.', '`NO_TEXT`', '```\nNO_TEXT\n```', '**NO_TEXT**', '"NO_TEXT"', 'NO-TEXT', 'NO_TEXT。']) {
  assert.strictEqual(isNo(yes), true, JSON.stringify(yes) + ' is the answer');
}
for (const no of ['', 'A mountain lake at dawn.', 'The image has NO_TEXT in it.', '# Meeting\n\n- NO_TEXT', 'NO_TEXT_AT_ALL', 'NOT TEXT', 'text', null, undefined]) {
  assert.strictEqual(isNo(no), false, JSON.stringify(no) + ' is not');
}

// the picture is put in as a picture
const info = { tabId: 'tab_1', anchorId: '[Transcribing...]', baseline: null, noTextImage: { base64: 'AAAA', mimeType: 'image/jpeg' } };
await run('putImageInsteadOfText')('vision_1', info);
assert.deepStrictEqual(calls.saveAsset, [{ dir: 'C:\\notes', ext: 'jpg', b64: 'AAAA' }], 'kept as a file next to the note, with its own extension');
assert.deepStrictEqual(calls.replace, [{ tabId: 'tab_1', anchor: '[Transcribing...]', replacement: '![image](assets/2026-10-17-101500.png)' }], 'the waiting text becomes the picture');
assert.deepStrictEqual(calls.finished.map((c) => c.status), ['completed']);
assert.ok(calls.messages[0].startsWith('pasteImageNoText'), 'and it says why');

// a path with a space is encoded like a pasted picture's
calls.replace.length = 0;
saveResult = { relPath: 'my notes/assets/a b.png' };
await run('putImageInsteadOfText')('vision_2', info);
assert.strictEqual(calls.replace[0].replacement, '![image](my%20notes/assets/a%20b.png)');

// a failure: the waiting text goes, the note is as it was, the reason is said
calls.replace.length = 0; calls.finished.length = 0; calls.messages.length = 0;
saveResult = new Error('disk full');
await run('putImageInsteadOfText')('vision_3', info);
assert.deepStrictEqual(calls.replace, [{ tabId: 'tab_1', anchor: '[Transcribing...]', replacement: '' }]);
assert.strictEqual(calls.finished[0].status, 'failed');
assert.ok(/pasteImageSaveFailed.*disk full/.test(calls.messages[0]));

// the wiring: the request carries the rule and the picture, the answer is checked before anything else is done with it
assert.ok(/noTextImage: \{ base64: imgData\.base64, mimeType: imgData\.mimeType \}/.test(app), 'the picture is kept with the request');
assert.ok(/queryVisionAsync\(reqId, visionPromptWithNoText\(config\.vision\.prompt\), imgData\.base64/.test(app), 'the prompt carries the rule');
assert.ok(/if \(reqInfo\.noTextImage && !errorText && isNoTextAnswer\(cleanedResult\)\) \{\s*putImageInsteadOfText\(reqId, reqInfo\);\s*return;/.test(app), 'the answer is checked');
assert.ok(!/visionPromptWithNoText\(/.test(app.slice(app.indexOf('async function startMobileDrop'), app.indexOf('function cancelMobileDrop'))), 'Mobile Drop is untouched');
for (const key of ['pasteImageNoText']) assert.strictEqual((i18n.match(new RegExp('\n    ' + key + ': ', 'g')) || []).length, 2, key + ' is in both languages');
console.log('paste: picture with no text tests passed');
