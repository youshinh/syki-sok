// The editor's right-click menu offers "Open Preview to the Side" (it had Open to the Side for another note, and Preview, but not this one,
// which the header button and Ctrl+Alt+V already do).
import assert from 'assert';
import fs from 'fs';

console.log('=== right-click: preview to the side ===');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('frontend/index.html');
const app = read('frontend/js/app.js');
const i18n = read('frontend/js/i18n.js');

const at = (id) => html.indexOf('id="' + id + '"');
assert.ok(at('ctx-preview-side') > at('ctx-toggle-preview') && at('ctx-preview-side') < at('ctx-open-to-side'), 'after Preview, before Open to the Side');
assert.ok(/id="ctx-preview-side">\s*<svg[^>]*>[^]*?<\/svg>\s*<span class="menu-label" data-i18n="ctxPreviewToSide">[^<]+<\/span>\s*<span class="shortcut" id="sc-ctx-preview-side">/.test(html), 'icon, label and shortcut like its neighbours');
assert.ok(/ctxPreviewSide\.onclick = \(\) => \{\n\s*contextMenu\.classList\.add\('hidden'\);\n\s*const previewTarget = contextMenuTargetTabId \|\| activeTabId;\n\s*contextMenuTargetTabId = null;[^\n]*\n\s*openPreviewToSide\(previewTarget\);/.test(app), 'it opens the preview of the note the menu was opened on');
assert.ok(/previewSideScEl\.textContent = config\.shortcuts\.previewToSide \? formatShortcutForDisplay\(config\.shortcuts\.previewToSide\) : ''/.test(app), 'its shortcut label follows the setting (blank when unassigned)');
for (const key of ['ctxPreviewToSide']) assert.strictEqual((i18n.match(new RegExp('\n    ' + key + ': ', 'g')) || []).length, 2, key + ' is in both languages');
assert.ok(/ctxPreviewToSide: "プレビューを横に開く"/.test(i18n) && /ctxPreviewToSide: "Open Preview to the Side"/.test(i18n));
console.log('right-click: preview to the side tests passed');
