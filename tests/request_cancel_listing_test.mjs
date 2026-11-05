// The requests that wait in the note without having a way to be stopped (the Mermaid diagram, the infographic image, the infographic
// prompt) are listed in the task panel with a cancel, like an image being read: cancelling forgets the request, takes the waiting text
// out, and the late answer finds nothing waiting for it.
import assert from 'assert';
import fs from 'fs';

console.log('=== request cancel listing tests ===');
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');

const blocks = app.match(/registerPendingLLMRequest\(reqId, \{\s*tabId: curTab\.id,\s*anchorId: anchorId,\s*persistedText: insertion,\s*persistRestore: '',\s*listed: true[^}]*\}\);\s*listCancellableRequest\(reqId, anchorId\);/g) || [];
assert.equal(blocks.length, 3, 'the Mermaid diagram, the infographic image and the infographic prompt are listed, each with a cancel');

const fn = /function listCancellableRequest\(reqId, anchorId\) \{[\s\S]*?\r?\n  \}/.exec(app);
assert.ok(fn && /onCancel: \(\) => cancelImageRead\(reqId\)/.test(fn[0]) && /type: 'llm'/.test(fn[0]), 'the entry cancels through cancelImageRead');
assert.ok(/function cancelImageRead\(reqId\) \{[\s\S]*?pendingLLMRequests\.delete\(reqId\);[\s\S]*?applyAnchorReplacement\(info\.tabId, landOn, ''/.test(app), 'cancelling forgets the request and takes the waiting text out');
assert.ok(/window\.__onLLMResult = function \(reqId, resultText, errorText\) \{\s*const reqInfo = pendingLLMRequests\.get\(reqId\);\s*if \(!reqInfo\) return;/.test(app), 'a late answer of a forgotten request is ignored');
console.log('request cancel listing tests passed');
