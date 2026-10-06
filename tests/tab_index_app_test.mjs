// v2 P3: how app.js keeps the index tabs, run for real against the hand-made DOM of tests/fixtures/slot_env.mjs (the real app.js and the real
// frontend/js/tab_strip.js in one vm context; no browser, no files, no network):
//   * the keyed draw: one element per note, the same ones on every draw, nothing appended when nothing changed, a tab closed in the middle
//     keeps the other elements; the selected tab is the one tab stop and carries --d 0, its neighbours 1, 2 ...
//   * typing: the first keystroke that makes a note unsaved puts the dot on its tab, the next ones write nothing; the automatic title
//     follows the first line
//   * the keys in the strip: arrows, Home and End move the focus only; Enter and Space choose; Delete closes; Ctrl chords are left alone
//   * dragging a tab by height reorders the notes (and tab.list says so)
// The arithmetic is frontend/js/tab_strip_test.js; the real mouse and the real widening are tests/smoke/108_tab_index_expand.mjs.
//
// Node only. Run: node tests/tab_index_app_test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createEnv } from './fixtures/slot_env.mjs';

const NoteTitle = createRequire(import.meta.url)('../frontend/js/note_title.js'); // the automatic title of an untitled note

const queue = [];
const check = (name, fn) => queue.push({ name, fn });

// An app with `n` notes after the one it starts with: every element the app makes gets a style that records custom properties, and every row a box
// (30px tall, one under another) so that a drag has somewhere to land.
async function strip(n = 3) {
  const env = await createEnv();
  env.window.NoteTitle = NoteTitle;
  const doc = env.window.document;
  const recorder = () => ({ props: {}, setProperty(k, v) { this.props[k] = v; } });
  const made = doc.createElement;
  doc.createElement = (tag) => {
    const el = made(tag);
    el.style = recorder();
    return el;
  };
  const list = env.el('tabs-list');
  list.children.forEach((row) => { row.style = recorder(); }); // the note the app started with was made before the recorder
  const log = { appended: 0 };
  const append = list.appendChild;
  list.appendChild = (c) => { log.appended++; return append(c); };
  const helper = env.window.__testHelper;
  for (let i = 1; i <= n; i++) helper.createTab(`note-${i}.md`, `body ${i}\n`);
  await env.flush();
  const rows = () => list.children.slice();
  const ids = () => rows().map((r) => r.dataset.tabId);
  const active = () => rows().filter((r) => r.classList.contains('active'));
  const layOut = () => rows().forEach((r, i) => { r.getBoundingClientRect = () => ({ top: 38 + i * 30, bottom: 68 + i * 30, left: 0, right: 12, width: 12, height: 30 }); });
  const keydown = (row, init) => {
    const e = Object.assign({ key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: row, prevented: false, preventDefault() { this.prevented = true; } }, init);
    list._listeners.keydown.forEach((l) => l.fn(e));
    return e;
  };
  return { env, doc, list, log, rows, ids, active, layOut, keydown };
}

check('the draw: one element per note, the selected one alone is a tab stop, and --d counts the distance from it', async () => {
  const s = await strip(3);
  assert.equal(s.rows().length, 4, 'the note the app started with and three more');
  assert.ok(s.rows().every((r) => r.classList.contains('tab-item') && r.dataset.tabId), 'class tab-item and data-tab-id on every row');
  assert.equal(s.active().length, 1);
  const stops = s.rows().filter((r) => r.getAttribute('tabindex') === '0');
  assert.deepEqual(stops, s.active(), 'tabindex 0 on the selected tab only');
  assert.ok(s.rows().filter((r) => r !== s.active()[0]).every((r) => r.getAttribute('tabindex') === '-1'), 'and -1 on the others (the arrows reach them)');
  const at = s.rows().indexOf(s.active()[0]);
  s.rows().forEach((r, i) => assert.equal(r.style.props['--d'], String(Math.abs(i - at)), 'the distance of row ' + i));
  assert.equal(s.active()[0].children.find((c) => c.className === 'tab-title').textContent, 'note-3.md');
});

check('a draw that changes nothing writes nothing: the same elements, nothing appended', async () => {
  const s = await strip(3);
  const before = s.rows();
  const appended = s.log.appended;
  for (const id of s.ids()) await s.env.window.__mdMemoRPC.switchTab(id); // each switch draws the tabs
  await s.env.window.__mdMemoRPC.switchTab(s.ids()[3]);
  assert.equal(s.log.appended, appended, 'no element was appended by a switch');
  assert.deepEqual(s.rows(), before, 'the same elements in the same order');
  s.rows().forEach((r) => assert.ok(r.style.props['--d'] !== undefined));
  const sel = s.active()[0];
  assert.equal(sel.dataset.tabId, s.ids()[3], 'and the selection moved with the switches');
});

check('a note opened later is appended; a note closed in the middle takes only its own element away', async () => {
  const s = await strip(3);
  const before = Object.fromEntries(s.rows().map((r) => [r.dataset.tabId, r]));
  const appended = s.log.appended;
  s.env.window.__testHelper.createTab('note-4.md', 'x');
  await s.env.flush();
  assert.equal(s.log.appended, appended + 1, 'one element for the new note');
  assert.equal(s.rows().length, 5);
  const closing = s.ids()[2];
  assert.equal(await s.env.window.__mdMemoRPC.closeTab(closing), true);
  assert.equal(s.rows().length, 4);
  assert.ok(!s.ids().includes(closing));
  for (const r of s.rows()) if (before[r.dataset.tabId]) assert.equal(r, before[r.dataset.tabId], 'the elements of the other notes are the ones they were');
});

check('typing: the first keystroke puts the dot on the tab, the next ones write nothing to the strip', async () => {
  const s = await strip(2);
  const editor = s.env.editor;
  const row = s.active()[0];
  assert.ok(!row.children.some((c) => c.className === 'tab-dirty-dot'), 'a note nobody typed in has no dot');
  const touched = [];
  const appendRow = row.appendChild;
  row.appendChild = (c) => { touched.push(c.className); return appendRow(c); };
  editor.value += 'x';
  editor.dispatchEvent({ type: 'input' });
  const dot = row.children.find((c) => c.className === 'tab-dirty-dot');
  assert.ok(dot, 'the dot is there');
  assert.equal(dot.textContent, '●');
  assert.ok(row.classList.contains('is-dirty'), 'and the row is marked, for the strip\'s own narrow mark');
  assert.deepEqual(touched, ['tab-dirty-dot']);
  for (let i = 0; i < 20; i++) { editor.value += 'y'; editor.dispatchEvent({ type: 'input' }); }
  assert.deepEqual(touched, ['tab-dirty-dot'], 'twenty more keystrokes appended nothing and made nothing');
  assert.equal(row.children.filter((c) => c.className === 'tab-dirty-dot').length, 1, 'and there is still one dot');
});

check('the automatic title follows the first line while you type, on the tab and in the header', async () => {
  const s = await strip(0);
  s.env.window.__testHelper.createTab('', '');
  await s.env.flush();
  const row = s.active()[0];
  const editor = s.env.editor;
  editor.value = 'Shopping list\nmilk';
  editor.selectionStart = editor.selectionEnd = editor.value.length;
  editor.dispatchEvent({ type: 'input' });
  const title = row.children.find((c) => c.className === 'tab-title');
  assert.equal(title.textContent, 'Shopping list.md');
  assert.equal(row.title, 'Shopping list.md', 'and so does the tooltip, which used to stay behind');
});

check('keys: the arrows, Home and End move the focus along the tabs and choose nothing', async () => {
  const s = await strip(3);
  const selected = s.active()[0].dataset.tabId;
  const rows = s.rows();
  let e = s.keydown(rows[1], { key: 'ArrowDown' });
  assert.equal(e.prevented, true);
  assert.equal(s.doc.activeElement, rows[2], 'Down: the next tab has the focus');
  s.keydown(rows[2], { key: 'ArrowUp' });
  assert.equal(s.doc.activeElement, rows[1], 'Up: the previous one');
  s.keydown(rows[1], { key: 'Home' });
  assert.equal(s.doc.activeElement, rows[0]);
  s.keydown(rows[0], { key: 'End' });
  assert.equal(s.doc.activeElement, rows[3]);
  s.keydown(rows[3], { key: 'ArrowDown' });
  assert.equal(s.doc.activeElement, rows[0], 'and Down from the last wraps to the first');
  assert.equal(s.active()[0].dataset.tabId, selected, 'nothing was chosen by moving');
});

check('keys: Enter and Space choose the tab under the focus (the note gets the focus); a key it does not know is left alone', async () => {
  const s = await strip(3);
  const rows = s.rows();
  let e = s.keydown(rows[0], { key: 'Enter' });
  assert.equal(e.prevented, true);
  assert.equal(s.active()[0].dataset.tabId, rows[0].dataset.tabId, 'Enter chose the first tab');
  assert.equal(s.doc.activeElement, s.env.editor, 'and the focus went back to the note');
  e = s.keydown(rows[2], { key: ' ' });
  assert.equal(s.active()[0].dataset.tabId, rows[2].dataset.tabId, 'Space chose the third');
  e = s.keydown(rows[1], { key: 'a' });
  assert.equal(e.prevented, false, 'a letter is not the strip\'s');
  e = s.keydown(rows[1], { key: 'ArrowDown', ctrlKey: true });
  assert.equal(e.prevented, false, 'and neither is a Ctrl chord (Ctrl+Tab and the like go on)');
  e = s.keydown(rows[1], { key: 'ArrowDown', altKey: true });
  assert.equal(e.prevented, false, 'nor an Alt chord');
  e = s.keydown(null, { key: 'Enter', target: s.list });
  assert.equal(e.prevented, false, 'a key that did not come from a tab is not the strip\'s');
});

check('keys: Delete closes the tab (the notes that are left keep their elements)', async () => {
  const s = await strip(3);
  const rows = s.rows();
  const e = s.keydown(rows[1], { key: 'Delete' });
  assert.equal(e.prevented, true);
  await s.env.flush();
  assert.equal(s.rows().length, 3);
  assert.ok(!s.ids().includes(rows[1].dataset.tabId));
  assert.deepEqual(s.rows(), [rows[0], rows[2], rows[3]], 'the other elements are the ones they were, in order');
});

check('keys: Delete on a tab that is not the open note gives the focus to the tab that took its place; on the open note the focus goes to the note', async () => {
  const s = await strip(3);
  const rows = s.rows();
  s.doc.activeElement = rows[1];
  s.keydown(rows[1], { key: 'Delete' });
  s.doc.activeElement = s.doc.body; // what the browser does with the focus of an element that has left the page
  await s.env.flush();
  assert.equal(s.doc.activeElement, rows[2], 'the tab below it, which moved up into its place');
  s.doc.activeElement = rows[2];
  s.keydown(rows[2], { key: 'Delete' });
  s.doc.activeElement = s.doc.body;
  await s.env.flush();
  assert.equal(s.doc.activeElement, rows[3], 'and again');
  assert.ok(s.active()[0] === rows[3], 'the open note is still the last tab');
  s.keydown(rows[3], { key: 'Delete' }); // the open note: closing it opens a neighbour, and the note has the focus
  await s.env.flush();
  assert.equal(s.doc.activeElement, s.env.editor);
});

check('keys: the focus stays on a tab when the list changes shape under it (a keyboard user closes the tab next to it)', async () => {
  const s = await strip(3);
  const rows = s.rows();
  // what the browser does: taking the list's children out (the list is emptied and filled again when its shape changes) drops the focus
  const innerHTML = Object.getOwnPropertyDescriptor(s.list, 'innerHTML');
  Object.defineProperty(s.list, 'innerHTML', { configurable: true, get: innerHTML.get, set(v) { innerHTML.set.call(s.list, v); if (v === '') s.doc.activeElement = s.doc.body; } });
  s.doc.activeElement = rows[3];
  await s.env.window.__mdMemoRPC.closeTab(rows[1].dataset.tabId);
  await s.env.flush();
  assert.equal(s.doc.activeElement, rows[3], 'the tab that had the focus still has it');
  assert.equal(s.rows().length, 3, 'and the list did change shape');
});

check('dragging: a press that moves 4px picks the place by the height of the pointer, and the new order is the order of the notes', async () => {
  const s = await strip(3);
  s.layOut();
  const win = s.env.window;
  const handlers = {};
  const add = win.addEventListener;
  win.addEventListener = (type, fn, opt) => { handlers[type] = fn; return add(type, fn, opt); };
  const rows = s.rows();
  const first = rows[0];
  const down = first._listeners.pointerdown[0].fn;
  down({ button: 0, clientX: 3, clientY: 50, pointerId: 1, target: first, altKey: false });
  first.setPointerCapture = () => {};
  handlers.pointermove({ clientX: 3, clientY: 52 }); // 2px: not a drag yet
  assert.ok(!first.classList.contains('dragging'));
  handlers.pointermove({ clientX: 3, clientY: 38 + 3 * 30 + 25 }); // the lower half of the 4th tab
  assert.ok(first.classList.contains('dragging'));
  assert.ok(rows[3].classList.contains('drag-over-bottom'), 'the line is under the tab the pointer is over');
  handlers.pointerup({});
  assert.ok(!first.classList.contains('dragging') && !rows[3].classList.contains('drag-over-bottom'), 'the marks are gone');
  assert.deepEqual(s.ids(), [rows[1], rows[2], rows[3], rows[0]].map((r) => r.dataset.tabId), 'the dragged note went to the end');
  const order = Array.from(await win.__mdMemoRPC.getTabs(), (t) => t.id); // (an array of the page's realm: copied before it is compared)
  assert.deepEqual(order, s.ids(), 'and tab.list says the same');
});

check('dragging: a press that does not move is a click; a drag that ends on itself changes nothing', async () => {
  const s = await strip(3);
  s.layOut();
  const win = s.env.window;
  const handlers = {};
  const add = win.addEventListener;
  win.addEventListener = (type, fn, opt) => { handlers[type] = fn; return add(type, fn, opt); };
  const rows = s.rows();
  const before = s.ids();
  rows[0]._listeners.pointerdown[0].fn({ button: 0, clientX: 3, clientY: 50, pointerId: 1, target: rows[0], altKey: false });
  handlers.pointerup({});
  assert.equal(s.active()[0].dataset.tabId, rows[0].dataset.tabId, 'a click chose the tab');
  rows[1]._listeners.pointerdown[0].fn({ button: 0, clientX: 3, clientY: 80, pointerId: 2, target: rows[1], altKey: false });
  rows[1].setPointerCapture = () => {};
  handlers.pointermove({ clientX: 3, clientY: 90 });
  handlers.pointermove({ clientX: 3, clientY: 100 }); // still over its own row (68..98 is row 1; 98..128 is row 2)
  handlers.pointermove({ clientX: 3, clientY: 80 });
  handlers.pointerup({});
  assert.deepEqual(s.ids(), before, 'dropped on itself: the order is the same');
  const listening = handlers.pointermove;
  rows[0]._listeners.pointerdown[0].fn({ button: 2, clientX: 3, clientY: 50, pointerId: 3, target: rows[0], altKey: false });
  assert.equal(handlers.pointermove, listening, 'a right button press starts nothing: no new listener (the context menu is the page\'s)');
});

check('Ctrl+Tab goes to the next note, Ctrl+Shift+Tab to the previous one, both round the end', async () => {
  const s = await strip(3);
  const ids = s.ids();
  const where = () => s.active()[0].dataset.tabId;
  const press = (init) => s.env.key(s.env.editor, Object.assign({ key: 'Tab', code: 'Tab', keyCode: 9, ctrlKey: true }, init));
  assert.equal(where(), ids[3], 'the last note is open');
  press({});
  assert.equal(where(), ids[0], 'Ctrl+Tab from the last note goes round to the first');
  press({});
  assert.equal(where(), ids[1]);
  press({ shiftKey: true });
  assert.equal(where(), ids[0], 'Ctrl+Shift+Tab goes back');
  press({ shiftKey: true });
  assert.equal(where(), ids[3], 'and round the other end');
  const e = press({ shiftKey: true });
  assert.equal(e.defaultPrevented, true, 'the browser does not get the key');
  assert.equal(where(), ids[2]);
  press({ ctrlKey: false });
  assert.equal(where(), ids[2], 'a Tab without Ctrl is the editor\'s (indent), not a note switch');
});

check('the x of a tab is a .tab-close with a translated title, and closes the note', async () => {
  const s = await strip(1);
  const row = s.rows()[1];
  const x = row.children.find((c) => c.className === 'tab-close');
  assert.ok(x, 'the close mark');
  assert.equal(x.textContent, '×');
  assert.equal(x.getAttribute('data-i18n-title'), 'closeTabTitle', 'applyLanguage() retitles it');
  const res = x.onclick({ stopPropagation() {} });
  await res;
  await s.env.flush();
  assert.equal(s.rows().length, 1, 'closing the open note left the one the app started with');
});

check('btn-pin-tabs toggles pinned sidebar state, aria-pressed, and persists in localStorage', async () => {
  const s = await strip(1);
  const btnPin = s.doc.getElementById('btn-pin-tabs');
  assert.ok(btnPin, 'btn-pin-tabs exists');
  assert.equal(s.doc.body.classList.contains('tabs-pinned'), false);
  assert.equal(btnPin.getAttribute('aria-pressed') || 'false', 'false');
  btnPin.onclick();
  assert.equal(s.doc.body.classList.contains('tabs-pinned'), true);
  assert.equal(btnPin.getAttribute('aria-pressed'), 'true');
  assert.equal(btnPin.classList.contains('active'), true);
  assert.equal(s.env.window.localStorage.getItem('md-memo-tabs-pinned'), '1');
  btnPin.onclick();
  assert.equal(s.doc.body.classList.contains('tabs-pinned'), false);
  assert.equal(btnPin.getAttribute('aria-pressed'), 'false');
  assert.equal(btnPin.classList.contains('active'), false);
  assert.equal(s.env.window.localStorage.getItem('md-memo-tabs-pinned'), '0');
});

(async () => {
  let failed = 0;
  for (const { name, fn } of queue) {
    try {
      await fn();
      console.log('PASS: ' + name);
    } catch (err) {
      failed++;
      console.log('FAIL: ' + name + '\n  ' + (err && err.stack || err));
    }
  }
  if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log(`\n${queue.length} checks passed.`);
})();
