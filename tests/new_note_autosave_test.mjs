// A note with no file yet is saved by autosave into the folder for new notes (CreateNoteInFolder); an image or a recording dropped to be
// opened becomes a note of its text; five or more files dropped at once ask first. Source-level pins plus the real canAutoCreate / armAutoSave.
import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

console.log('=== new note autosave and dropped media tests ===');
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
const i18n = fs.readFileSync(new URL('../frontend/js/i18n.js', import.meta.url), 'utf8');
const fn = (name) => {
  const m = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\r?\\n  \\}').exec(app);
  assert.ok(m, name + ' exists');
  return m[0];
};

// canAutoCreate / armAutoSave behave as the person expects.
const timers = [];
const env = {
  window: { backend: { createNoteInFolder: () => {} } },
  config: { general: { autoSave: true } },
  rpcAutoSaveTimers: null,
  texts: {},
  getTabText: (id) => (id in env.texts ? env.texts[id] : null),
  scheduleAutoSave: (tab) => { timers.push(tab.id); return timers.length; },
};
vm.createContext(env);
vm.runInContext(fn('canAutoCreate') + '\n' + fn('armAutoSave'), env);
const arm = (tab) => { timers.length = 0; vm.runInContext('armAutoSave(t)', Object.assign(env, { t: tab })); return timers.length; };

env.texts.n1 = 'hello';
assert.equal(arm({ id: 'n1', path: '' }), 1, 'a new note with text is autosaved');
env.texts.n2 = ' \n\t ';
assert.equal(arm({ id: 'n2', path: '' }), 0, 'an empty note makes no file');
assert.equal(arm({ id: 'n3', path: '', content: '' }), 0, 'nor does one with nothing in it');
assert.equal(arm({ id: 'n1', path: '', noAutoCreate: true }), 0, 'a note flagged noAutoCreate makes none');
env.config.general.autoSave = false;
assert.equal(arm({ id: 'n1', path: '' }), 0, 'with autosave off nothing is made');
env.config.general.autoSave = true;
env.window.backend = {};
assert.equal(arm({ id: 'n1', path: '' }), 0, 'a backend that cannot make files leaves the old behaviour');
env.window.backend = { createNoteInFolder: () => {} };
assert.equal(arm({ id: 'n1', path: 'C:/x/a.md' }), 1, 'a note with a file is autosaved as before');

// The save of a note with no file: the folder setting is sent, no dialog is involved, and a failure marks the note.
const save = fn('saveTabNow');
assert.ok(/opts && opts\.auto && !tab\.path && !forceSaveAs/.test(save), 'only the automatic save of a pathless note takes this branch');
assert.ok(/createNoteInFolder\(body, tab\.encoding, suggestedNoteName\(tab\), \(config\.general && config\.general\.defaultNoteDir\) \|\| ''\)/.test(save), 'the folder setting and the note name go with it');
assert.ok(!/withNativeDialog/.test(save.slice(save.indexOf('createNoteInFolder'), save.indexOf('if (!tab.path || forceSaveAs)'))), 'no dialog in the automatic branch');
assert.ok(/tab\.saveFailed = true/.test(save), 'a failed creation marks the note');
// Save As starts in the folder for new notes (or next to the note's own file).
assert.ok(/const startAt = tab\.path \|\| joinDefaultNoteDir\(suggestedName\);/.test(save), 'Save As starts in the right folder');

// Settings: the folder is loaded, saved, and has a browse button.
assert.ok(/id="cfg-default-note-dir"/.test(html) && /id="btn-browse-note-dir"/.test(html), 'the folder field and its Browse button');
assert.ok(/noteDirEl\.value = config\.general\.defaultNoteDir \|\| ''/.test(app) && /config\.general\.defaultNoteDir = saveNoteDirEl\.value\.trim\(\)/.test(app), 'loaded and saved');
assert.ok(/defaultNoteDir: ''/.test(app), 'empty by default: the daily scraps folder');

// Dropped media and the five-file question.
assert.ok(/const DROP_CONFIRM_FILES = 5;/.test(app) && /dropped\.length >= DROP_CONFIRM_FILES/.test(app), 'five or more files ask first');
assert.ok(/customConfirm\(t\(editor \? 'dropManyLinkConfirm' : 'dropManyOpenConfirm'/.test(app), 'the question names what will happen (open or link)');
const kind = vm.runInNewContext(fn('droppedMediaKind') + '; droppedMediaKind');
assert.equal(kind({ type: 'image/png', name: 'a' }), 'image');
assert.equal(kind({ type: 'audio/mp4', name: 'a' }), 'audio');
assert.equal(kind({ type: '', name: 'rec.M4A' }), 'audio');
assert.equal(kind({ type: '', name: 'scan.jpeg' }), 'image');
assert.equal(kind({ type: 'image/svg+xml', name: 'x.svg' }), '', 'an SVG is text, not a picture to read');
assert.equal(kind({ type: 'video/mp4', name: 'v.mp4' }), '', 'a video is not read');
assert.equal(kind({ type: 'text/markdown', name: 'a.md' }), '');
assert.ok(/openDroppedMedia\(file, mediaKind\);/.test(app) && /window\.__onDroppedMedia = function/.test(app), 'a dropped image or recording goes to the backend and its answer becomes a note');
assert.ok(/armAutoSave\(tab\);\s*renderTabs\(\);\s*showMessage\(t\('dropMediaDone'/.test(app), 'the note made of the text is autosaved into the folder for new notes');

for (const key of ['defaultNoteDirLabel', 'defaultNoteDirHint', 'newNoteAutoSaved', 'dropManyOpenConfirm', 'dropManyLinkConfirm', 'dropMediaWorkingAudio', 'dropMediaWorkingImage', 'dropMediaFailed', 'dropMediaTooLarge', 'dropMediaDone']) {
  assert.strictEqual((i18n.match(new RegExp('\n    ' + key + ': ', 'g')) || []).length, 2, key + ' exists in both languages');
}
console.log('new note autosave and dropped media tests passed');
