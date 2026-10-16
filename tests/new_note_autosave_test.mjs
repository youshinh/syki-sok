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
assert.ok(/mediaBatch\.push\(\{ file: file, kind: mediaKind \}\)/.test(app) && /openDroppedMediaBatch\(mediaBatch\)/.test(app) && /window\.__onDroppedMedia = function/.test(app), 'the images and recordings of a drop go to the backend together and the answers come back');
assert.ok(/const DROP_MEDIA_PARALLEL = 3;/.test(app) && /Math\.min\(DROP_MEDIA_PARALLEL, readable\.length\)/.test(app), 'they are read in parallel, a bounded number at a time');
assert.ok(/results\[i\] = await readDroppedMedia/.test(app) && /readable\.length === 1 \? body : '## ' \+ it\.file\.name/.test(app), 'one note: a section for each file in the order dropped (a single file has no heading)');
assert.ok(/failed === readable\.length\) return;/.test(app), 'when nothing could be read there is no note');
assert.ok(/armAutoSave\(tab\);\s*renderTabs\(\);\s*showMessage\(readable\.length === 1/.test(app), 'the note made of the text is autosaved into the folder for new notes');

for (const key of ['defaultNoteDirLabel', 'defaultNoteDirHint', 'newNoteAutoSaved', 'dropManyOpenConfirm', 'dropManyLinkConfirm', 'dropMediaWorkingAudio', 'dropMediaWorkingImage', 'dropMediaFailed', 'dropMediaTooLarge', 'dropMediaDone', 'dropMediaWorkingMany', 'dropMediaItemFailed', 'dropMediaTimeout', 'dropMediaBatchTitle', 'dropMediaDoneMany']) {
  assert.strictEqual((i18n.match(new RegExp('\n    ' + key + ': ', 'g')) || []).length, 2, key + ' exists in both languages');
}
console.log('new note autosave and dropped media tests passed');

// ---- the real batch: parallel but bounded, in the order dropped, one note, a failed file marked in place ----
{
  const grab = (re, what) => { const m = re.exec(app); assert.ok(m, what + ' exists'); return m[0]; };
  const src = [
    'const DROP_MEDIA_MAX_BYTES = 20 * 1024 * 1024;',
    grab(/const DROP_MEDIA_PARALLEL = 3;/, 'the bound'),
    grab(/const DROP_MEDIA_WAIT_MS = [^;]+;/, 'the wait'),
    'const droppedMediaPending = new Map();',
    grab(/async function readDroppedMedia\(file, kind\) \{[\s\S]*?\r?\n  \}\r?\n/, 'readDroppedMedia'),
    grab(/window\.__onDroppedMedia = function \(reqId, text, err\) \{[\s\S]*?\r?\n  \};/, 'the answer'),
    grab(/async function openDroppedMediaBatch\(items\) \{[\s\S]*?\r?\n  \}\r?\n/, 'openDroppedMediaBatch'),
  ].join('\n');
  let running = 0;
  let maxRunning = 0;
  const win = { backend: {} };
  const made = [];
  const msgs = [];
  const ctx = {
    window: win, config: { vision: {} }, console, setTimeout, clearTimeout, Promise,
    t: (k, p) => k + (p ? JSON.stringify(p) : ''), goErr: (x) => String(x), genReqId: (p) => p + Math.random().toString(36).slice(2),
    fileAsBase64: async () => 'AAAA', showMessage: (m) => msgs.push(m), renderTabs() {}, armAutoSave() {},
    createTab: (title, content) => { const tab = { title, content }; made.push(tab); return tab; },
  };
  win.backend.processDroppedMedia = async (id, name) => {
    running++; maxRunning = Math.max(maxRunning, running);
    // later files answer sooner, so the order of the answers is the reverse of the order dropped
    const delay = name === 'c.png' ? 1 : name === 'b.png' ? 15 : 30;
    setTimeout(() => { running--; win.__onDroppedMedia(id, name === 'bad.png' ? '' : 'text of ' + name, name === 'bad.png' ? 'no key' : ''); }, delay);
  };
  vm.createContext(ctx);
  vm.runInContext(src.replace('window.__onDroppedMedia =', 'window.__onDroppedMedia ='), ctx);
  const f = (name, kind) => ({ file: { name, size: 10, type: 'image/png' }, kind: kind || 'image' });
  await vm.runInContext('openDroppedMediaBatch', ctx)([f('a.png'), f('b.png'), f('c.png'), f('d.png'), f('bad.png'), f('e.png')]);
  assert.equal(made.length, 1, 'six files make ONE note');
  assert.ok(maxRunning > 1 && maxRunning <= 3, 'they run in parallel, at most 3 at a time (saw ' + maxRunning + ')');
  const order = ['a.png', 'b.png', 'c.png', 'd.png', 'bad.png', 'e.png'].map((n) => made[0].content.indexOf('## ' + n));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), 'the sections are in the order dropped, not the order answered');
  assert.ok(/## bad\.png\s+> dropMediaItemFailed\{"err":"no key"\}/.test(made[0].content), 'a file that failed says so in its own section');
  assert.ok(/text of a\.png/.test(made[0].content) && /text of e\.png/.test(made[0].content), 'the others are there');
  assert.ok(/^dropMediaBatchTitle\{"first":"a","n":5\}\.md$/.test(made[0].title), 'named after the first file and the count');

  made.length = 0;
  await vm.runInContext('openDroppedMediaBatch', ctx)([f('one.png')]);
  assert.equal(made[0].title, 'one.md');
  assert.equal(made[0].content, 'text of one.png\n', 'a single file is its text alone, no heading');
  made.length = 0;
  await vm.runInContext('openDroppedMediaBatch', ctx)([f('bad.png')]);
  assert.equal(made.length, 0, 'nothing read: no note');
}
console.log('batch tests passed');
