// v2 P3 (S4 and S5): the index tabs with TWO note pages on screen, and what a strip does with the pointer, run for real against the hand-made DOM of
// tests/fixtures/slot_env.mjs (the real app.js and tab_strip.js in one vm context; no browser, no files, no network). The rules, not the markup:
//   * one page: the left strip alone (<main id="workspace" data-tabs="left">, the right strip hidden and empty)
//   * two note pages: two strips, the same notes in the same order, each marking the note of its OWN page and being its own tab stop; a click
//     (or Enter) in a strip changes that strip's page and nothing else, whichever page has the keyboard; Alt+click opens a note to the side
//   * a note shown in both pages has a tab in each strip; typing in it puts the dot, and the automatic name, in both strips and in the page title
//   * the order is the notes' order: a drag in either strip moves the note in both; Esc, leaving the strip, or the system taking the pointer
//     lets the tab go where it was; a press that does not move is a click
//   * "Open to the Side" in the context menu acts on the tab that was right-clicked, once; any other right-click forgets that tab
//   * a file dropped on a strip opens as a new note
// A preview beside the note and the preview alone are in tests/second_panel_test.mjs (its page has the renderer libraries); the real mouse
// is tests/smoke/109_tab_index_reorder.mjs and 113_tab_index_modes.mjs.
//
// Node only. Run: node tests/tab_index_pages_test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createEnv } from './fixtures/slot_env.mjs';

const NoteTitle = createRequire(import.meta.url)('../frontend/js/note_title.js');

const queue = [];
const check = (name, fn) => queue.push({ name, fn });

// An app with `n` notes after the one it starts with, and a way to press on a tab the way the pointer does. Every row gets a box (30px tall, one
// under another) so that a drag has somewhere to land, and each strip's root a box (the strip's own place).
async function pages(n = 3) {
  const env = await createEnv();
  env.window.NoteTitle = NoteTitle;
  const doc = env.window.document;
  const made = doc.createElement;
  doc.createElement = (tag) => {
    const el = made(tag);
    el.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    return el;
  };
  const helper = env.window.__testHelper;
  for (let i = 1; i <= n; i++) helper.createTab(`note-${i}.md`, `body ${i}\n`);
  await env.flush();

  const left = env.el('tabs-list');
  const right = env.el('tabs-list-right');
  left.children.forEach((row) => { row.style = { props: {}, setProperty(k, v) { this.props[k] = v; } }; });
  if (left.children.length > 1) { // the first row's distance was written to its old style: move the selection away and back so the recorder has it
    const order = left.children.map((r) => r.dataset.tabId);
    await env.window.__mdMemoRPC.switchTab(order[0]);
    await env.window.__mdMemoRPC.switchTab(order[order.length - 1]);
  }
  const rowsOf = (list) => list.children.slice();
  const ids = (list) => rowsOf(list).map((r) => r.dataset.tabId);
  const selectedOf = (list) => rowsOf(list).filter((r) => r.classList.contains('active'));
  const layOut = (list, root, x0, x1) => {
    rowsOf(list).forEach((r, i) => { r.getBoundingClientRect = () => ({ top: 38 + i * 30, bottom: 68 + i * 30, left: x0, right: x1, width: x1 - x0, height: 30 }); });
    env.el(root).getBoundingClientRect = () => ({ top: 38, bottom: 38 + 30 * 9, left: x0, right: x1, width: x1 - x0, height: 30 * 9 });
  };

  // the window-level pointer handlers a press registers (the last of each kind), as in tab_index_app_test.mjs
  const win = env.window;
  const handlers = {};
  const add = win.addEventListener;
  win.addEventListener = (type, fn, opt) => { handlers[type] = fn; return add(type, fn, opt); };
  const down = (row, init) => {
    row.setPointerCapture = () => {};
    row._listeners.pointerdown[0].fn(Object.assign({ button: 0, clientX: 3, clientY: 50, pointerId: 1, target: row, altKey: false }, init));
  };
  const click = (row, init) => { down(row, init); handlers.pointerup({}); };
  const keydown = (list, row, init) => {
    const e = Object.assign({ key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: row, prevented: false, preventDefault() { this.prevented = true; } }, init);
    list._listeners.keydown.forEach((l) => l.fn(e));
    return e;
  };
  const open = async (id) => { await helper.openSplitEditor(id); await env.flush(); };
  const titleOf = (row) => row.children.find((c) => c.className === 'tab-title');
  return { env, doc, win, helper, left, right, rowsOf, ids, selectedOf, layOut, handlers, down, click, keydown, open, titleOf };
}

const mode = (s) => s.env.el('workspace').getAttribute('data-tabs');
const pageTitle = (s) => s.env.el('secondary-pane-title').textContent;

check('one page: the workspace says "left", the right strip is hidden and has no tabs', async () => {
  const s = await pages(2);
  assert.equal(mode(s), 'left');
  assert.equal(s.env.el('tab-index-right').hidden, true);
  assert.equal(s.right.children.length, 0, 'nothing is drawn in a strip that is not shown');
  assert.equal(s.left.children.length, 3);
});

check('two note pages: two strips with the same notes in the same order, each marks its own page\'s note and is its own tab stop', async () => {
  const s = await pages(3);
  const ids = s.ids(s.left);
  await s.open(ids[1]);
  assert.equal(mode(s), 'both');
  assert.equal(s.env.el('tab-index-right').hidden, false);
  assert.deepEqual(s.ids(s.right), ids, 'the same notes in the same order');
  assert.equal(s.selectedOf(s.left).length, 1);
  assert.equal(s.selectedOf(s.right).length, 1);
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, ids[3], 'the left strip marks the note of the left page (the last one made)');
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, ids[1], 'the right strip marks the note of the right page');
  for (const list of [s.left, s.right]) {
    const stops = s.rowsOf(list).filter((r) => r.getAttribute('tabindex') === '0');
    assert.deepEqual(stops, s.selectedOf(list), 'each strip is one tab stop, on its own selected tab');
    const at = s.rowsOf(list).indexOf(s.selectedOf(list)[0]);
    s.rowsOf(list).forEach((r, i) => assert.equal(r.style.props['--d'], String(Math.abs(i - at)), 'each strip shades by the distance from its own selected tab'));
  }
  assert.notEqual(s.left.children[0], s.right.children[0], 'a note has an element of its own in each strip');
  assert.equal(s.right.children[0].dataset.tabId, ids[0]);
  assert.ok(s.right.children.every((r) => r.classList.contains('tab-item') && r.dataset.tabId), 'the same contract: .tab-item with data-tab-id');
  // back to one page: the right strip goes
  s.helper.closeSecondaryPane();
  await s.env.flush();
  assert.equal(mode(s), 'left');
  assert.equal(s.env.el('tab-index-right').hidden, true);
});

check('a click on a strip changes that strip\'s page and only that page, whichever page has the keyboard', async () => {
  const s = await pages(3);
  const ids = s.ids(s.left);
  await s.open(ids[1]);
  const leftNote = () => s.selectedOf(s.left)[0].dataset.tabId;
  const rightNote = () => s.selectedOf(s.right)[0].dataset.tabId;
  assert.equal(s.env.el('editor-secondary') === s.doc.activeElement, true, 'the right page has the keyboard');
  s.click(s.rowsOf(s.left)[1]);
  assert.equal(leftNote(), ids[1], 'a click in the left strip changed the left page even though the right page had the keyboard');
  assert.equal(rightNote(), ids[1], 'and the right page is where it was (here it is the same note)');
  assert.equal(s.env.editor.value, 'body 1\n', 'the left page shows that note');
  assert.equal(s.doc.activeElement, s.env.editor, 'and has the keyboard now');
  s.click(s.rowsOf(s.right)[2]);
  assert.equal(rightNote(), ids[2], 'a click in the right strip changed the right page');
  assert.equal(leftNote(), ids[1], 'and the left page stays');
  assert.equal(pageTitle(s), 'note-2.md', 'the right page\'s own title follows its note');
  assert.equal(s.env.el('editor-secondary').value, 'body 2\n');
  assert.equal(s.doc.activeElement, s.env.el('editor-secondary'), 'the right page has the keyboard now');
  // a click on the note the page already shows only gives the page the keyboard
  s.click(s.rowsOf(s.left)[1]);
  assert.equal(s.doc.activeElement, s.env.editor);
  assert.equal(leftNote(), ids[1]);
  const tabs = Array.from(await s.win.__mdMemoRPC.getTabs(), (t) => [t.id, t.pane]);
  assert.deepEqual(tabs.filter((t) => t[1]), [[ids[1], 'primary'], [ids[2], 'secondary']], 'tab.list says which note is in which page, as it always did');
});

check('Enter and Space in a strip choose for that strip\'s page; Alt+click and Alt+Enter open the note in the right page from either strip', async () => {
  const s = await pages(3);
  const ids = s.ids(s.left);
  await s.open(ids[1]);
  let e = s.keydown(s.right, s.rowsOf(s.right)[0], { key: 'Enter' });
  assert.equal(e.prevented, true);
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, ids[0], 'Enter in the right strip chose for the right page');
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, ids[3]);
  e = s.keydown(s.left, s.rowsOf(s.left)[2], { key: ' ' });
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, ids[2], 'Space in the left strip chose for the left page');
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, ids[0]);
  s.click(s.rowsOf(s.left)[1], { altKey: true });
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, ids[1], 'Alt+click in the left strip opened that note in the right page');
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, ids[2], 'and left the left page alone');
  s.click(s.rowsOf(s.right)[3], { altKey: true });
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, ids[3], 'Alt+click in the right strip does the same thing: it opens to the side');
  e = s.keydown(s.right, s.rowsOf(s.right)[0], { key: 'ArrowDown' });
  assert.equal(s.doc.activeElement, s.rowsOf(s.right)[1], 'the arrows walk the strip the key came from');
});

check('Ctrl+Tab cycles the page you are working in', async () => {
  const s = await pages(3);
  const ids = s.ids(s.left);
  await s.open(ids[0]);
  const press = (init) => s.env.key(s.doc.activeElement, Object.assign({ key: 'Tab', code: 'Tab', keyCode: 9, ctrlKey: true }, init));
  assert.equal(s.doc.activeElement, s.env.el('editor-secondary'));
  press({});
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, ids[1], 'in the right page Ctrl+Tab moves the right page');
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, ids[3]);
  s.click(s.rowsOf(s.left)[3]);
  press({});
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, ids[0], 'and in the left page it moves the left one');
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, ids[1]);
});

check('a note that is open in both pages has a tab in each strip; typing in either page puts the dot and the automatic name in both', async () => {
  const s = await pages(0);
  s.helper.createTab('', '');
  await s.env.flush();
  const id = s.ids(s.left)[1];
  await s.open(id);
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, id);
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, id, 'the same note is selected in both strips');
  const second = s.env.el('editor-secondary');
  second.value = 'Plan for May\nitems';
  second.selectionStart = second.selectionEnd = second.value.length;
  second.dispatchEvent({ type: 'input' });
  for (const list of [s.left, s.right]) {
    const row = s.rowsOf(list).find((r) => r.dataset.tabId === id);
    assert.ok(row.children.some((c) => c.className === 'tab-dirty-dot'), 'the dot is on the note\'s tab in this strip');
    assert.ok(row.classList.contains('is-dirty'));
    assert.equal(s.titleOf(row).textContent, 'Plan for May.md', 'and so is the automatic name');
  }
  assert.equal(pageTitle(s), 'Plan for May.md', 'and in the title above the right page');
  // typing in the left page too
  s.env.editor.value = 'Plan for June\nitems';
  s.env.editor.selectionStart = s.env.editor.selectionEnd = s.env.editor.value.length;
  s.env.editor.dispatchEvent({ type: 'input' });
  assert.equal(s.titleOf(s.rowsOf(s.right).find((r) => r.dataset.tabId === id)).textContent, 'Plan for June.md');
  assert.equal(pageTitle(s), 'Plan for June.md');
});

check('closing the note of the right page leaves the right page the first note, and both strips follow', async () => {
  const s = await pages(3);
  const ids = s.ids(s.left);
  await s.open(ids[2]);
  assert.equal(await s.win.__mdMemoRPC.closeTab(ids[2]), true);
  await s.env.flush();
  assert.deepEqual(s.ids(s.right), s.ids(s.left));
  assert.equal(s.ids(s.right).length, 3);
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, ids[0], 'the right page took the first note left');
  assert.equal(pageTitle(s), s.titleOf(s.rowsOf(s.right)[0]).textContent, 'and the title above the right page names it');
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, ids[3]);
});

check('dragging in the right strip moves the note in both strips; the right strip\'s own tabs show the marks', async () => {
  const s = await pages(3);
  const ids = s.ids(s.left);
  await s.open(ids[1]);
  s.layOut(s.left, 'tab-index-left', 0, 12);
  s.layOut(s.right, 'tab-index-right', 1100, 1112);
  const rows = s.rowsOf(s.right);
  s.down(rows[0], { clientX: 1105, clientY: 50 });
  s.handlers.pointermove({ clientX: 1105, clientY: 38 + 3 * 30 + 25 });
  assert.ok(rows[0].classList.contains('dragging'));
  assert.ok(rows[3].classList.contains('drag-over-bottom'), 'the line is under the tab the pointer is over, in the right strip');
  assert.ok(s.rowsOf(s.left).every((r) => !r.classList.contains('drag-over-bottom') && !r.classList.contains('dragging')), 'and the other strip shows nothing');
  s.doc.activeElement = rows[0]; // the press gave the dragged tab the focus (a strip with the focus in it stays open)
  s.handlers.pointerup({});
  assert.ok(rows.every((r) => !r.classList.contains('dragging') && !r.classList.contains('drag-over-bottom')), 'the marks are gone');
  assert.equal(s.doc.activeElement, s.env.el('editor-secondary'), 'and the page you work in has the focus back, so the strip can close');
  const want = [ids[1], ids[2], ids[3], ids[0]];
  assert.deepEqual(s.ids(s.right), want, 'the right strip has the new order');
  assert.deepEqual(s.ids(s.left), want, 'and so has the left strip: the order is the notes\'');
  assert.deepEqual(Array.from(await s.win.__mdMemoRPC.getTabs(), (t) => t.id), want, 'and tab.list');
  assert.equal(s.selectedOf(s.right)[0].dataset.tabId, ids[1], 'each strip still marks its own page\'s note');
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, ids[3]);
});

check('a drag is let go of by Esc, by the pointer leaving the strip, and by the system taking the pointer; nothing moves', async () => {
  const s = await pages(3);
  const ids = s.ids(s.left);
  s.layOut(s.left, 'tab-index-left', 0, 12);
  const rows = s.rowsOf(s.left);
  const lower = { clientX: 3, clientY: 38 + 3 * 30 + 25 };
  // Esc
  s.down(rows[0]);
  s.handlers.pointermove(lower);
  assert.ok(rows[3].classList.contains('drag-over-bottom'));
  const esc = { key: 'Escape', prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  s.handlers.keydown(esc);
  assert.ok(esc.prevented && esc.stopped, 'Esc is taken (it does not also close something behind the strip)');
  assert.ok(rows.every((r) => !r.classList.contains('dragging') && !r.classList.contains('drag-over-bottom')), 'the marks are gone');
  assert.deepEqual(s.ids(s.left), ids, 'Esc: the order is the same');
  // a key that is not Esc is not a cancel
  s.down(rows[0]);
  s.handlers.pointermove(lower);
  s.handlers.keydown({ key: 'a', preventDefault() {}, stopPropagation() {} });
  assert.ok(rows[0].classList.contains('dragging'), 'another key leaves the drag going');
  s.handlers.pointerup({});
  assert.deepEqual(s.ids(s.left), [ids[1], ids[2], ids[3], ids[0]], 'and a drop moves the note');
  s.layOut(s.left, 'tab-index-left', 0, 12); // the elements are in a new order: their boxes are laid out again
  // leaving the strip: the drop is off, the marks go; coming back puts them back
  const order = s.ids(s.left);
  const first = s.rowsOf(s.left)[0];
  s.down(first);
  s.handlers.pointermove(lower);
  assert.ok(s.rowsOf(s.left)[3].classList.contains('drag-over-bottom'));
  s.handlers.pointermove({ clientX: 400, clientY: lower.clientY });
  assert.ok(s.rowsOf(s.left).every((r) => !r.classList.contains('drag-over-bottom') && !r.classList.contains('drag-over-top')), 'well away from the strip there is no place to drop');
  s.handlers.pointerup({});
  assert.deepEqual(s.ids(s.left), order, 'dropped away from the strip: nothing moved');
  assert.ok(s.rowsOf(s.left).every((r) => !r.classList.contains('dragging')));
  // the system takes the pointer (pointercancel)
  s.down(s.rowsOf(s.left)[0]);
  s.handlers.pointermove(lower);
  s.handlers.pointercancel({});
  assert.deepEqual(s.ids(s.left), order, 'pointercancel: nothing moved either');
  assert.ok(s.rowsOf(s.left).every((r) => !r.classList.contains('dragging') && !r.classList.contains('drag-over-bottom')));
  // none of it left a listener behind: a press that does not move is a click
  s.down(s.rowsOf(s.left)[1]);
  s.handlers.pointerup({});
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, order[1]);
});

check('a right-click on a tab names it for "Open to the Side", once; a right-click anywhere else forgets it', async () => {
  const s = await pages(3);
  const ids = s.ids(s.left);
  const menu = s.env.el('context-menu');
  const openToSide = s.env.el('ctx-open-to-side');
  const rows = s.rowsOf(s.left);
  assert.equal(typeof openToSide.onclick, 'function', 'the menu item is wired');
  const rightClick = (target) => {
    if (target && target._listeners && target._listeners.contextmenu) target._listeners.contextmenu.forEach((l) => l.fn({ target }));
    return s.env.fireWindow('contextmenu', { target, clientX: 20, clientY: 60 });
  };
  const rightPage = () => s.selectedOf(s.right)[0] && s.selectedOf(s.right)[0].dataset.tabId;
  rightClick(rows[0]);
  openToSide.onclick();
  await s.env.flush();
  assert.equal(rightPage(), ids[0], 'Open to the Side acted on the tab that was right-clicked, not on the open note');
  openToSide.onclick(); // the menu item again, with no new right-click: the tab was used up
  await s.env.flush();
  assert.equal(rightPage(), ids[3], 'a tab is named for one use: without a new right-click the item is about the open note');
  assert.equal(menu.classList.contains('hidden'), true, 'and the menu closed');
  // used up: the next menu, opened on the text, is about the note on screen
  rightClick(s.env.editor);
  openToSide.onclick();
  await s.env.flush();
  assert.equal(rightPage(), ids[3], 'a menu opened on the text acts on the open note: the old tab is not remembered');
  // a tab named, then a right-click elsewhere without using the menu, then the menu
  rightClick(s.rowsOf(s.left)[1]);
  rightClick(s.env.editor);
  openToSide.onclick();
  await s.env.flush();
  assert.equal(rightPage(), ids[3], 'a right-click elsewhere forgot the tab that was named before');
  // and from the right strip
  rightClick(s.rowsOf(s.right)[2]);
  openToSide.onclick();
  await s.env.flush();
  assert.equal(rightPage(), ids[2], 'a tab of the right strip is named the same way');
});

check('a file dropped on a strip opens as a new note (text only), and a drop on the text is not the strip\'s', async () => {
  const s = await pages(2);
  const before = s.left.children.length;
  const file = (name, bytes) => ({ name, type: '', path: '', slice: () => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }), text: async () => 'dropped text' });
  const drop = async (target, files) => {
    const e = s.env.fireWindow('drop', { target, dataTransfer: { files } });
    await s.env.flush();
    return e;
  };
  let e = await drop(s.rowsOf(s.left)[1], [file('from-disk.md', [104, 105])]);
  assert.equal(e.defaultPrevented, true, 'the browser does not navigate to the file');
  assert.equal(s.left.children.length, before + 1, 'a new note');
  assert.equal(s.titleOf(s.rowsOf(s.left)[before]).textContent, 'from-disk.md');
  assert.equal(s.selectedOf(s.left)[0].dataset.tabId, s.ids(s.left)[before], 'and it is open');
  await drop(s.left, [file('picture.bin', [0, 1, 2])]);
  assert.equal(s.left.children.length, before + 1, 'a file with a NUL byte is not a note');
  await drop(s.env.el('tab-index-left'), [file('again.md', [104])]);
  assert.equal(s.left.children.length, before + 2, 'a drop on the empty strip is the same');
});

check('a saved session with two note pages comes back with both strips', async () => {
  const note = (id, title) => ({ id, title, path: '', content: 'body ' + id, isDirty: false, encoding: 'UTF-8', cursorPos: 0 });
  const session = { tabs: [note('a', 'a.md'), note('b', 'b.md'), note('c', 'c.md')], activeTabId: 'a', tabCounter: 4, isSplitMode: true, secondaryTabId: 'c', secondaryViewMode: 'editor', activePane: 'secondary', isPreviewMode: false };
  const env = await createEnv({ localStorage: { md_memo_session_v1: JSON.stringify(session) } });
  await env.flush();
  const left = env.el('tabs-list').children;
  const right = env.el('tabs-list-right').children;
  assert.equal(env.el('workspace').getAttribute('data-tabs'), 'both');
  assert.equal(env.el('tab-index-right').hidden, false);
  assert.deepEqual(left.map((r) => r.dataset.tabId), ['a', 'b', 'c']);
  assert.deepEqual(right.map((r) => r.dataset.tabId), ['a', 'b', 'c']);
  assert.equal(left.filter((r) => r.classList.contains('active'))[0].dataset.tabId, 'a');
  assert.equal(right.filter((r) => r.classList.contains('active'))[0].dataset.tabId, 'c');
  // and a session of one page does not
  const one = await createEnv({ localStorage: { md_memo_session_v1: JSON.stringify({ ...session, isSplitMode: false }) } });
  await one.flush();
  assert.equal(one.el('workspace').getAttribute('data-tabs'), 'left');
  assert.equal(one.el('tab-index-right').hidden, true);
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
