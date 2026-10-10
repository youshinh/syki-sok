// Many tabs with one page and with two note pages (v2 P3, S6): 40 notes do not fit a strip, so each strip squeezes its tabs, scrolls inside its own box with
// the selected tab in view, and "+" and the All tabs button stay at the foot of the left strip; with two pages both strips do it, each for its own page's
// note; the All tabs list hangs beside the OPEN width of the left strip (also when the pointer is far away), and a row chosen in it goes to the page
// you work in; the palette and ui.open_panel open the same list. Judged on the boxes and the app state; no picture.
import { assert, click, openPalette, rpc, settle, waitHidden, waitShown } from './lib.mjs';

const COUNT = 40;
const notes = [];
for (let i = 1; i <= COUNT; i++) notes.push({ title: `long-named-project-note-number-${i}.md`, content: `# note ${i}\n\n${'text of the note\n'.repeat(30)}` });

const inBox = (list, scroll) => `(function () {
  var a = document.querySelector('${list} .tab-item.active'), sc = document.getElementById('${scroll}');
  if (!a) return false;
  var r = a.getBoundingClientRect(), b = sc.getBoundingClientRect();
  return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
})()`;
const scrolls = (scroll) => `(function () { var e = document.getElementById('${scroll}'); return e.scrollHeight > e.clientHeight; })()`;
const onScreen = (id) => `(function () { var r = document.getElementById('${id}').getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight; })()`;
const ui = (s) => s.ev('window.__sykiRPC.getUiState()');
const selected = (list) => `(function () { var a = document.querySelector('${list} .tab-item.active'); return a ? a.dataset.tabId : null; })()`;
const stripWidth = "Math.round(document.getElementById('tab-index-left').getBoundingClientRect().width)";

export default {
  title: 'many tabs, one page and two pages: each strip scrolls to its page\'s note, + and All tabs stay, the list hangs beside the open strip and goes to the page you work in',
  session: { notes },

  async run(s, t) {
    const move = (x, y) => s.page.mouseMove(x, y);

    t.step('one page: 40 tabs are squeezed and scroll; the selected tab is in view; + and All tabs are on the screen');
    await s.waitFor(`document.querySelectorAll('#tabs-list .tab-item').length === ${COUNT}`);
    await waitShown(s, 'btn-all-tabs');
    assert.equal(await s.ev(scrolls('tabs-scroll')), true, 'the left strip scrolls inside its own box');
    await s.waitFor(inBox('#tabs-list', 'tabs-scroll'));
    assert.equal(await s.ev(onScreen('btn-new-tab')), true, '+ is on the screen');
    assert.equal(await s.ev(onScreen('btn-all-tabs')), true, 'and so is All tabs');
    assert.equal(await s.ev("Math.round(document.querySelector('#tabs-list .tab-item').getBoundingClientRect().height)"), 20, 'the tabs were squeezed to their least first');

    t.step('the list hangs beside the OPEN width of the strip, though the pointer is far away and the strip is collapsed');
    await move(600, 400);
    await s.waitFor(`${stripWidth} === 12`);
    await click(s, 'btn-all-tabs');
    await waitShown(s, 'tab-list-panel');
    await move(600, 400);
    await s.waitFor(`${stripWidth} === 12`);
    const place = await s.ev("(function () { var p = document.getElementById('tab-list-panel').getBoundingClientRect(); return { left: p.left, top: p.top, bottom: p.bottom, h: window.innerHeight }; })()");
    assert.ok(place.left >= 200, 'the list starts after the 200px the strip widens to: ' + JSON.stringify(place));
    assert.ok(place.top >= 0 && place.bottom <= place.h, 'inside the window');
    await s.key('Escape');
    await waitHidden(s, 'tab-list-panel');

    t.step('two note pages (Ctrl+\\): both strips scroll, each to its own page\'s note; the right strip has no + and no All tabs');
    await s.key('\\', { ctrl: true });
    await s.waitFor("document.getElementById('workspace').getAttribute('data-tabs') === 'both'");
    await s.waitFor(`document.querySelectorAll('#tabs-list-right .tab-item').length === ${COUNT}`);
    await waitFocusOnSecond(s);
    assert.equal(await s.ev(scrolls('tabs-scroll-right')), true, 'the right strip scrolls too');
    await s.waitFor(inBox('#tabs-list', 'tabs-scroll'));
    await s.waitFor(inBox('#tabs-list-right', 'tabs-scroll-right'));
    assert.equal(await s.ev("document.querySelectorAll('#tab-index-right #btn-new-tab, #tab-index-right #btn-all-tabs').length"), 0);
    assert.equal(await s.ev(onScreen('btn-new-tab')) && await s.ev(onScreen('btn-all-tabs')), true, '+ and All tabs are still the left strip\'s');
    const right = await s.ev("(function () { var r = document.getElementById('tab-index-right').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: window.innerHeight }; })()");
    assert.ok(right.top >= 60 && right.bottom <= right.h, 'the right strip stands below the right page\'s title bar and inside the window: ' + JSON.stringify(right));

    t.step('the list goes to the page you work in: the right page has the keyboard, so its row changes the right page and the left page stays');
    const before = await ui(s);
    await click(s, 'btn-all-tabs');
    await waitShown(s, 'tab-list-panel');
    await s.key('End');
    await s.key('Enter');
    await waitHidden(s, 'tab-list-panel');
    const state = await s.state();
    const last = state.tabs[COUNT - 1].id;
    await s.waitFor(`window.__sykiRPC.getUiState().secondaryTabId === ${JSON.stringify(last)}`);
    assert.equal((await ui(s)).activeTabId, before.activeTabId, 'the left page did not change');
    await s.waitFor(inBox('#tabs-list-right', 'tabs-scroll-right'));
    assert.equal(await s.ev(selected('#tabs-list-right')), last, 'the right strip marks it and has it in view');

    t.step('the same list, with the keyboard in the left page, changes the left page');
    await s.ev("document.getElementById('editor').focus()");
    await click(s, 'btn-all-tabs');
    await waitShown(s, 'tab-list-panel');
    await s.key('Home');
    await s.key('Enter');
    await waitHidden(s, 'tab-list-panel');
    const first = state.tabs[0].id;
    await s.waitFor(`window.__sykiRPC.getUiState().activeTabId === ${JSON.stringify(first)}`);
    assert.equal((await ui(s)).secondaryTabId, last, 'the right page did not change');
    await s.waitFor(inBox('#tabs-list', 'tabs-scroll'));

    t.step('the palette and ui.open_panel open the same list');
    await openPalette(s);
    await s.type(t.pick('all tabs', 'すべてのタブ'));
    await s.waitFor("document.querySelectorAll('#quick-pick-list .quick-pick-item').length > 0");
    await s.key('Enter');
    await waitShown(s, 'tab-list-panel');
    assert.equal(await s.ev("document.querySelectorAll('#tab-list-rows .tab-list-row').length"), COUNT);
    await s.key('Escape');
    await waitHidden(s, 'tab-list-panel');
    const r = await rpc(s, 'openPanel("all_tabs")');
    assert.ok(r.ok, JSON.stringify(r));
    await waitShown(s, 'tab-list-panel');
    await s.key('Escape');
    await waitHidden(s, 'tab-list-panel');

    t.step('back to one page: the right strip goes, the left one keeps scrolling');
    await s.ev("document.getElementById('editor').focus()");
    await s.key('\\', { ctrl: true });
    await s.waitFor("document.getElementById('workspace').getAttribute('data-tabs') === 'left'");
    assert.equal(await s.ev("document.getElementById('tab-index-right').hidden"), true);
    assert.equal(await s.ev(scrolls('tabs-scroll')), true);
    await settle(100);
  },
};

async function waitFocusOnSecond(s) {
  await s.waitFor("document.activeElement && document.activeElement.id === 'editor-secondary'");
}
