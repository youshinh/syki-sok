// The index tabs in the four views (v2 P3, S5), with the real mouse and keys: one page has the left strip; two note pages have a strip each, the right
// one on the right page's right edge (left of its scrollbar), and a click in a strip changes that strip's page; a preview beside the note has the
// left strip alone and it follows the left page; the preview alone has no strip at all; F6 goes note, header, left strip, right strip, the divider, status bar, note.
// Judged on the boxes, the computed styles and the app state; no picture.
import { assert, click, rpc, settle, waitFocus, waitHidden, waitShown } from './lib.mjs';

const notes = [];
for (let i = 1; i <= 5; i++) notes.push({ title: `view-note-${i}.md`, content: `# note ${i}\n\n${'text of the note\n'.repeat(60)}` });

const strip = (side) => `document.getElementById('tab-index-${side}')`;
const width = (side) => `Math.round(${strip(side)}.getBoundingClientRect().width)`;
const shownStrips = "['left', 'right'].filter(function (side) { var e = document.getElementById('tab-index-' + side); var cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; }).join('+')";
const mode = "document.getElementById('workspace').getAttribute('data-tabs')";
const ids = (list) => `Array.from(document.querySelectorAll('${list} .tab-item')).map(function (e) { return e.dataset.tabId; })`;
const selected = (list) => `(function () { var a = document.querySelector('${list} .tab-item.active'); return a ? a.dataset.tabId : null; })()`;
const rowBox = (list, i) => `(function () { var r = document.querySelectorAll('${list} .tab-item')[${i}].getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; })()`;
const ui = (s) => s.ev('window.__mdMemoRPC.getUiState()');

export default {
  title: 'index tabs in the four views: one page, two pages (a strip each, a click changes its own page), preview beside the note (left only, follows), preview alone (none), F6 round the strips',
  session: { notes },

  async run(s, t) {
    const move = (x, y) => s.page.mouseMove(x, y);
    const W = s.viewport.w;
    const all = await (async () => { await s.waitFor("document.querySelectorAll('#tabs-list .tab-item').length === 5"); return s.ev(ids('#tabs-list')); })();

    t.step('one page: the left strip alone; the right one is not there at all (no box, nothing to tab to)');
    assert.equal(await s.ev(mode), 'left');
    assert.equal(await s.ev(shownStrips), 'left');
    assert.equal(await s.ev(`${strip('right')}.getBoundingClientRect().width`), 0, 'the right strip has no box');
    assert.equal(await s.ev(`${strip('right')}.hidden`), true);
    const aria = (id) => `document.getElementById('${id}').getAttribute('aria-label')`;
    await s.waitFor(`${aria('tabs-list')} === ${JSON.stringify(t.pick('Tabs', 'タブ'))}`); // one page: the list is just "Tabs"

    t.step('two note pages (Alt+click on a tab opens it to the side): a strip for each page, the same notes in the same order, each marks its own page\'s note');
    await move(600, 400);
    const b2 = await s.ev(rowBox('#tabs-list', 1));
    await move(3, b2.y);
    await s.waitFor(`${width('left')} === 200`);
    await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 60, y: b2.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
    await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 60, y: b2.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 1 });
    await s.waitFor(`${mode} === 'both'`);
    await move(600, 400);
    await s.waitFor(`${width('left')} === 12 && ${width('right')} === 12`);
    assert.equal(await s.ev(shownStrips), 'left+right');
    await s.waitFor(`${aria('tabs-list')} === ${JSON.stringify(t.pick('Tabs of the left page', '左のページのタブ'))}`); // told apart for a screen reader
    assert.equal(await s.ev(aria('tabs-list-right')), t.pick('Tabs of the right page', '右のページのタブ'));
    assert.equal(await s.ev("document.querySelector('#tabs-list-right .tab-item.active').getAttribute('aria-selected')"), 'true', 'and each strip marks its own selected tab');
    assert.deepEqual(await s.ev(ids('#tabs-list-right')), all, 'the right strip lists the same notes in the same order');
    assert.equal(await s.ev(selected('#tabs-list')), (await ui(s)).activeTabId, 'the left strip marks the left page\'s note');
    assert.equal(await s.ev(selected('#tabs-list-right')), all[1], 'the right strip marks the right page\'s note');
    assert.equal((await ui(s)).secondaryTabId, all[1]);
    assert.equal(await s.ev(`document.querySelectorAll('#tabs-list-right .tab-item[tabindex="0"]').length`), 1, 'one tab stop in the right strip');

    t.step('the right strip stands on the right page\'s right edge, left of its scrollbar, below its title bar, and mirrors the left one');
    const geo = await s.ev(`(function () {
      var r = ${strip('right')}.getBoundingClientRect(), p = document.getElementById('secondary-pane').getBoundingClientRect(), h = document.getElementById('secondary-pane-header').getBoundingClientRect();
      var ed = document.getElementById('editor-secondary');
      var tab = document.querySelector('#tabs-list-right .tab-item').getBoundingClientRect();
      return { right: r.right, left: r.left, top: r.top, w: r.width, paneRight: p.right, headBottom: h.bottom, scrollbar: ed.offsetWidth - ed.clientWidth, gapVar: ${strip('right')}.style.getPropertyValue('--tab-scrollbar-w'), win: window.innerWidth, tabLeft: tab.left, tabRight: tab.right,
        fill: getComputedStyle(document.querySelector('#tabs-list-right .tab-item'), '::before').right, dir: getComputedStyle(document.querySelector('#tabs-list-right .tab-item')).flexDirection };
    })()`);
    assert.ok(geo.right <= geo.paneRight - 9 + 0.5, 'at least --tab-strip-gap-right (9px) in from the edge: ' + JSON.stringify(geo));
    assert.ok(geo.top >= geo.headBottom - 0.5, 'below the title bar of the right page');
    assert.equal(Math.round(geo.w), 12, 'collapsed it is the 12px to aim at');
    assert.equal(geo.dir, 'row-reverse', 'mirrored');
    assert.equal(geo.fill, '0px', 'the fill is on the strip\'s right edge');
    if (geo.scrollbar > 0) assert.ok(geo.right <= geo.paneRight - geo.scrollbar + 0.5, 'and clear of the page\'s scrollbar (' + geo.scrollbar + 'px)');
    const gap = parseFloat(geo.gapVar);
    assert.ok(gap > 0 ? Math.abs(Math.round(geo.paneRight - geo.right) - Math.max(9, gap)) <= 1 : Math.round(geo.paneRight - geo.right) === 9, 'the room kept is the larger of 9px and the measured scrollbar: ' + JSON.stringify(geo));

    t.step('a click in the right strip changes the right page only; a click in the left strip changes the left page only, with the keyboard in the other page');
    const leftBefore = await s.ev(selected('#tabs-list'));
    const r0 = await s.ev(rowBox('#tabs-list-right', 3));
    await move(geo.right - 3, r0.y);
    await s.waitFor(`${width('right')} === 200`);
    await s.waitFor("getComputedStyle(document.querySelector('#tabs-list-right .tab-title')).opacity === '1'");
    await s.page.click(geo.right - 60, r0.y);
    await s.waitFor(`window.__mdMemoRPC.getUiState().secondaryTabId === ${JSON.stringify(all[3])}`);
    assert.equal(await s.ev(selected('#tabs-list-right')), all[3]);
    assert.equal(await s.ev(selected('#tabs-list')), leftBefore, 'the left page did not change');
    assert.equal(await s.ev('document.activeElement.id'), 'editor-secondary', 'and the right page has the keyboard');
    await move(600, 400);
    await s.waitFor(`${width('right')} === 12`);
    const l0 = await s.ev(rowBox('#tabs-list', 0));
    await move(3, l0.y);
    await s.waitFor(`${width('left')} === 200`);
    await s.page.click(60, l0.y);
    await s.waitFor(`window.__mdMemoRPC.getUiState().activeTabId === ${JSON.stringify(all[0])}`);
    assert.equal((await ui(s)).secondaryTabId, all[3], 'the right page did not change');
    assert.equal(await s.ev('document.activeElement.id'), 'editor');
    await move(600, 400);
    await s.waitFor(`${width('left')} === 12`);

    t.step('the right strip opens over the right page\'s text without laying it out again, and shows the names mirrored');
    const box = "JSON.stringify([document.getElementById('editor-secondary').getBoundingClientRect().width, document.getElementById('secondary-pane').getBoundingClientRect().width])";
    const before = await s.ev(box);
    await move(geo.right - 3, r0.y);
    await s.waitFor(`${width('right')} === 200`);
    assert.equal(await s.ev(box), before, 'the page under the strip has the size it had');
    assert.equal(await s.ev(`Math.round(${strip('right')}.getBoundingClientRect().right)`), Math.round(geo.right), 'it widened to the left, its right edge stayed');
    assert.equal(await s.ev("getComputedStyle(document.querySelector('#tabs-list-right .tab-title')).textAlign"), 'right');
    await move(600, 400);
    await s.waitFor(`${width('right')} === 12`);

    t.step('F6 goes note, header, left strip, right strip, the divider between the pages, status bar, note (and back with Shift)');
    await s.ev("document.getElementById('editor').focus()");
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#header')");
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#tab-index-left')");
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#tab-index-right')");
    assert.equal(await s.ev("document.activeElement.classList.contains('active') && document.activeElement.getAttribute('tabindex')"), '0', 'the right strip\'s selected tab is where the focus lands');
    await s.waitFor(`${width('right')} === 200`);
    await s.key('F6');
    await waitFocus(s, 'pane-resizer'); // the editors keep Tab for indenting: F6 is how the keyboard reaches the divider (P4)
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#status-bar')");
    await s.key('F6');
    await s.waitFor("document.activeElement === document.getElementById('editor') || document.activeElement === document.getElementById('editor-secondary')");
    await s.key('F6', { shift: true });
    await s.key('F6', { shift: true });
    await waitFocus(s, 'pane-resizer');
    await s.key('F6', { shift: true });
    await s.waitFor("!!document.activeElement.closest('#tab-index-right')");
    await s.key('Enter');
    await waitFocus(s, 'editor-secondary');

    t.step('a preview beside the note: the left strip alone; it changes the left page and the preview comes with it, also when the preview was clicked last');
    await click(s, 'btn-secondary-mode');
    await s.waitFor(`${mode} === 'left'`);
    assert.equal(await s.ev(shownStrips), 'left');
    assert.equal(await s.ev("document.getElementById('secondary-preview-pane').classList.contains('hidden')"), false);
    await s.page.click(Math.round(W * 0.75), 300); // the preview has the keyboard's page now
    const l1 = await s.ev(rowBox('#tabs-list', 2));
    await move(3, l1.y);
    await s.waitFor(`${width('left')} === 200`);
    await s.page.click(60, l1.y);
    await s.waitFor(`window.__mdMemoRPC.getUiState().activeTabId === ${JSON.stringify(all[2])}`);
    assert.equal((await ui(s)).secondaryTabId, all[2], 'the preview follows the left page');
    assert.equal(await s.ev("document.getElementById('secondary-pane-title').textContent"), 'view-note-3.md');
    await move(600, 400);
    // the ways that name no strip go to the left page too, with the preview as the part you worked in last
    await s.page.click(Math.round(W * 0.75), 300);
    await rpc(s, 'openPanel("all_tabs")'); // (Ctrl+Tab would do the same, but a headless browser keeps that key for itself)
    await waitShown(s, 'tab-list-panel');
    await s.key('End');
    await s.key('Enter');
    await waitHidden(s, 'tab-list-panel');
    const afterTab = (await ui(s));
    assert.notEqual(afterTab.activeTabId, all[2], 'a row of the list of all tabs moved the left page');
    assert.equal(afterTab.secondaryTabId, afterTab.activeTabId, 'and the preview came with it');
    await s.page.click(Math.round(W * 0.75), 300);
    await click(s, 'btn-new-tab'); // (Ctrl+N would do the same; a headless browser keeps that key for itself)
    await s.waitFor(`window.__mdMemoRPC.getUiState().activeTabId !== ${JSON.stringify(afterTab.activeTabId)}`);
    const afterNew = (await ui(s));
    assert.equal(afterNew.secondaryTabId, afterNew.activeTabId, 'a new note is in the left page and the preview shows it');
    assert.equal(await s.ev(selected('#tabs-list')), afterNew.activeTabId);
    await s.ev("window.__mdMemoRPC.switchTab(" + JSON.stringify(all[2]) + ")");
    await s.waitFor(`window.__mdMemoRPC.getUiState().activeTabId === ${JSON.stringify(all[2])}`);

    t.step('the preview alone: no strip, nothing to aim at on the edge, and the strips come back with the page');
    await s.key('p', { ctrl: true });
    await s.waitFor(`${mode} === 'none'`);
    assert.equal(await s.ev(shownStrips), '');
    const y = (await s.ev(rowBox('#tabs-list', 0))).y;
    assert.equal(await s.ev(`(function () { var e = document.elementFromPoint(3, ${Math.round(y)}); return !!(e && e.closest('.tab-index')); })()`), false, 'the edge belongs to the page');
    await s.key('p', { ctrl: true });
    await s.waitFor(`${mode} === 'left'`);
    await s.waitFor(`${shownStrips} === 'left'`);
    await settle(100);
    assert.equal(await s.ev(selected('#tabs-list')), all[2]);

    t.step('closing the right page takes its strip away; the left one stays');
    await s.key('\\', { ctrl: true });
    await s.waitFor(`${mode} === 'both'`);
    await s.key('\\', { ctrl: true });
    await s.waitFor(`${mode} === 'left'`);
    assert.equal(await s.ev(shownStrips), 'left');
    assert.equal(await s.ev(`${strip('right')}.hidden`), true);
    await s.waitFor(`${aria('tabs-list')} === ${JSON.stringify(t.pick('Tabs', 'タブ'))}`); // and the list is just "Tabs" again
  },
};
