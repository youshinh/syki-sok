// The index tabs are reordered, closed, opened to the side and dropped on with the real mouse (v2 P3, S4): dragging a tab up or down the strip puts
// the line where it would land, a drop moves the note (the order of tab.list AND of the session that is saved), Esc, the pointer leaving the strip
// and a press that does not move are not moves, the x closes only on the open strip, Alt+click and the context menu open a note to the side (the
// menu acts on the right-clicked tab, once), and a file dropped on the strip opens as a new note. Judged on the boxes, the classes and the app
// state; no picture. (Real mouse events through CDP, with `buttons` set, as a mouse has them.)
import { assert, backendCalls, click, rpc, settle, waitHidden, waitShown } from './lib.mjs';

const notes = [];
for (let i = 1; i <= 6; i++) notes.push({ title: `order-note-${i}.md`, content: `# note ${i}\n\n${'text of the note\n'.repeat(20)}` });

const stripWidth = "Math.round(document.getElementById('tab-index-left').getBoundingClientRect().width)";
const rowBox = (i) => `(function () { var r = document.querySelectorAll('#tabs-list .tab-item')[${i}].getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, top: r.top, bottom: r.bottom }; })()`;
const order = (s) => s.ev("Array.from(document.querySelectorAll('#tabs-list .tab-item')).map(function (e) { return e.dataset.tabId; })");
const marks = "Array.from(document.querySelectorAll('.tab-item')).filter(function (e) { return e.classList.contains('dragging') || e.classList.contains('drag-over-top') || e.classList.contains('drag-over-bottom'); }).length";
const savedOrder = async (s) => {
  const calls = await backendCalls(s, 'saveSession');
  if (!calls.length) return null;
  return JSON.parse(calls[calls.length - 1].args[0]).tabs.map((x) => x.id);
};

export default {
  title: 'index tabs: drag to reorder (tab.list and the saved session), Esc / away / no move are no move, x, Alt+click, context menu "Open to the Side", a file dropped on the strip',
  session: { notes },

  async run(s, t) {
    const dispatch = (type, x, y, extra) => s.page.cdp.send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: type === 'mouseMoved' ? 'left' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 }, extra));
    const move = (x, y) => s.page.mouseMove(x, y);
    // press on the tab `from` of the open strip, drag through the others to the height `y`, in steps like a hand
    const press = async (from) => {
      await move(600, 400);
      await s.waitFor(`${stripWidth} === 12`);
      const b = await s.ev(rowBox(from));
      await move(3, b.y);
      await s.waitFor(`${stripWidth} === 200`);
      await dispatch('mousePressed', 40, b.y);
      return b;
    };
    const dragTo = async (fromY, x, y) => {
      const steps = 8;
      for (let i = 1; i <= steps; i++) await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 40 + (x - 40) * i / steps, y: fromY + (y - fromY) * i / steps, button: 'left', buttons: 1 });
    };
    const release = (x, y) => dispatch('mouseReleased', x, y);
    // a right click as a mouse makes it: pressed with the right button down (buttons: 2), released with none
    const rightClick = async (x, y) => {
      await move(x, y);
      await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
      await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    };

    t.step('six tabs, one open; the order of tab.list and of the strip agree');
    await s.waitFor("document.querySelectorAll('#tabs-list .tab-item').length === 6");
    const first = await order(s);
    const tabs = (await rpc(s, 'getTabs()')).ok.map((x) => x.id);
    assert.deepEqual(first, tabs, 'the strip and tab.list list the notes in the same order');
    const openedAtStart = (await s.state()).activeTabId;

    t.step('a real drag of the first tab to the lower half of the fourth: the line shows where it lands, a drop moves the note, tab.list and the saved session say so');
    const b0 = await press(0);
    const b3 = await s.ev(rowBox(3));
    await dragTo(b0.y, 40, b3.bottom - 4);
    await s.waitFor(marks + ' >= 2');
    assert.equal(await s.ev("document.querySelectorAll('#tabs-list .tab-item')[3].classList.contains('drag-over-bottom')"), true, 'the line is under the fourth tab');
    assert.equal(await s.ev("document.querySelectorAll('#tabs-list .tab-item')[0].classList.contains('dragging')"), true, 'and the tab being dragged is marked');
    assert.equal(await s.ev("getComputedStyle(document.querySelectorAll('#tabs-list .tab-item')[3]).borderBottomWidth"), '2px', 'the line is 2px');
    await release(40, b3.bottom - 4);
    const moved = [first[1], first[2], first[3], first[0], first[4], first[5]];
    await s.waitFor(`JSON.stringify(Array.from(document.querySelectorAll('#tabs-list .tab-item')).map(function (e) { return e.dataset.tabId; })) === ${JSON.stringify(JSON.stringify(moved))}`);
    assert.equal(await s.ev(marks), 0, 'every mark is gone');
    assert.deepEqual((await rpc(s, 'getTabs()')).ok.map((x) => x.id), moved, 'tab.list has the new order');
    await s.waitFor('window.__docshot.calls.filter(function (c) { return c.fn === "saveSession"; }).length > 0');
    await settle(700);
    assert.deepEqual(await savedOrder(s), moved, 'and so has the session that was saved');
    assert.equal((await s.state()).activeTabId, openedAtStart, 'moving a note does not change which one is open');

    t.step('Esc during a drag lets the tab go: no mark, no move, nothing saved differently; the editor does not get the Esc');
    const before = await order(s);
    const b1 = await press(1);
    const b2 = await s.ev(rowBox(4));
    await dragTo(b1.y, 40, b2.top + 4);
    await s.waitFor(marks + ' >= 2');
    await s.key('Escape');
    await s.waitFor(marks + ' === 0');
    await release(40, b2.top + 4);
    await settle(200);
    assert.deepEqual(await order(s), before, 'the order is as it was');

    t.step('letting go well away from the strip is not a move either');
    const b4 = await press(2);
    await dragTo(b4.y, 40, b4.y + 60);
    await s.waitFor(marks + ' >= 2');
    await dragTo(b4.y + 60, 700, b4.y + 60);
    await s.waitFor(marks + ' <= 1');
    assert.equal(await s.ev("document.querySelectorAll('.tab-item.drag-over-top, .tab-item.drag-over-bottom').length"), 0, 'no line while the pointer is away from the strip');
    await release(700, b4.y + 60);
    await settle(200);
    assert.deepEqual(await order(s), before, 'dropped away: the order is as it was');
    assert.equal(await s.ev(marks), 0);

    t.step('a press that does not move is a click: it opens that note');
    await press(1);
    const open = (await order(s))[1];
    await release(40, (await s.ev(rowBox(1))).y);
    await s.waitFor(`window.__explore.state().activeTabId === ${JSON.stringify(open)}`);
    assert.deepEqual(await order(s), before, 'and moved nothing');

    t.step('the x on the open strip closes a note; on the collapsed strip there is no x to press');
    await move(600, 400);
    await s.waitFor(`${stripWidth} === 12`);
    assert.equal(await s.ev("getComputedStyle(document.querySelector('#tabs-list .tab-item .tab-close')).pointerEvents"), 'none', 'collapsed: the x takes no pointer');
    const victim = (await order(s))[5];
    const vb = await s.ev(rowBox(5));
    await move(3, vb.y);
    await s.waitFor(`${stripWidth} === 200`);
    await move(100, vb.y);
    await s.waitFor("getComputedStyle(document.querySelectorAll('#tabs-list .tab-item')[5].querySelector('.tab-close')).opacity === '1'");
    const xb = await s.ev("(function () { var r = document.querySelectorAll('#tabs-list .tab-item')[5].querySelector('.tab-close').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    await s.page.click(xb.x, xb.y);
    await s.waitFor("document.querySelectorAll('#tabs-list .tab-item').length === 5");
    assert.ok(!(await order(s)).includes(victim), 'that note is gone');

    t.step('Alt+click opens the note to the side (the right page), and the right strip appears');
    await move(600, 400);
    await s.waitFor(`${stripWidth} === 12`);
    const target = (await order(s))[2];
    const ab = await s.ev(rowBox(2));
    await move(3, ab.y);
    await s.waitFor(`${stripWidth} === 200`);
    await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 60, y: ab.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
    await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 60, y: ab.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 1 });
    await s.waitFor(`document.getElementById('workspace').getAttribute('data-tabs') === 'both'`);
    assert.equal((await rpc(s, 'getUiState()')).ok.secondaryTabId, target, 'the note is in the right page');

    t.step('the context menu: "Open to the Side" acts on the tab that was right-clicked, and only once');
    await move(600, 400);
    await s.waitFor(`${stripWidth} === 12`);
    const ids = await order(s);
    const rb = await s.ev(rowBox(0));
    await move(3, rb.y);
    await s.waitFor(`${stripWidth} === 200`);
    await rightClick(60, rb.y);
    await waitShown(s, 'context-menu');
    await click(s, 'ctx-open-to-side');
    await waitHidden(s, 'context-menu');
    await s.waitFor(`window.__mdMemoRPC.getUiState().secondaryTabId === ${JSON.stringify(ids[0])}`);
    // a tab is named by a right-click and the menu is dismissed without using it; the right-click on the text after that is about the open note
    const named = await s.ev(rowBox(2));
    await move(600, 400);
    await s.waitFor(`${stripWidth} === 12`);
    await move(3, named.y);
    await s.waitFor(`${stripWidth} === 200`);
    await rightClick(60, named.y);
    await waitShown(s, 'context-menu');
    await s.page.click(600, 300); // a click elsewhere dismisses the menu
    await waitHidden(s, 'context-menu');
    await move(600, 400);
    await rightClick(600, 300);
    await waitShown(s, 'context-menu');
    await click(s, 'ctx-open-to-side');
    await waitHidden(s, 'context-menu');
    const openNote = (await s.state()).activeTabId;
    await s.waitFor(`window.__mdMemoRPC.getUiState().secondaryTabId === ${JSON.stringify(openNote)}`);

    t.step('a file dropped on the strip opens as a new note');
    const count = (await order(s)).length;
    await s.ev(`(function () {
      var dt = new DataTransfer();
      dt.items.add(new File(['dropped text\\n'], 'dropped-on-the-strip.md', { type: 'text/markdown' }));
      var row = document.querySelector('#tabs-list .tab-item');
      row.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      row.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await s.waitFor(`document.querySelectorAll('#tabs-list .tab-item').length === ${count + 1}`);
    assert.equal(await s.ev("Array.from(document.querySelectorAll('#tabs-list .tab-title')).pop().textContent"), 'dropped-on-the-strip.md');
  },
};
