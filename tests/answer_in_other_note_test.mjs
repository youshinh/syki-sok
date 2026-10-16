// An AI answer that lands in a note other than the one being viewed (the person moved to another note while the request was out) says
// which note, and the note is autosaved: the text was not typed, so nothing else would start that.
import assert from 'assert';
import fs from 'fs';

console.log('=== answer in another note tests ===');
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');
const i18n = fs.readFileSync(new URL('../frontend/js/i18n.js', import.meta.url), 'utf8');

assert.ok(/const notViewedTitle = \(reqInfo\.tabId !== activeTabId && !\(isSplitMode && reqInfo\.tabId === secondaryTabId\)\) \? \(targetTab\.title \|\| ''\) : '';/.test(app),
  'a note counts as viewed when it is the active tab or the one in the second pane');
assert.ok(/if \(notViewedTitle && !nothingToRestore && !errorText && typeof armAutoSave === 'function'\) armAutoSave\(targetTab\);/.test(app),
  'only a note that really got the answer is autosaved');
for (const key of ['aiCorrectionSuccess', 'rewriteSuccess', 'llmResponseInserted']) {
  assert.ok(app.includes("notViewedTitle ? elsewhere() : t('" + key + "')"), key + ' names the note when it is not the one being viewed');
}
assert.ok(!/notViewedTitle \? elsewhere\(\) : t\('aiCorrectionRestored'\)/.test(app), 'a restore is not announced as an answer');
assert.strictEqual((i18n.match(/\n    llmInsertedInOther: /g) || []).length, 2, 'in both languages');
assert.ok(/llmInsertedInOther: "The answer was added to \\"\{title\}\\"/.test(i18n) && /llmInsertedInOther: "回答を「\{title\}」に入れました/.test(i18n), 'the note is named');
console.log('answer in another note tests passed');
