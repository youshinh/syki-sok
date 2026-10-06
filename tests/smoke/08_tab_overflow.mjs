// Many tabs in the column of the index tabs (v2): the tabs are squeezed before the column scrolls, the "+" button stays on screen, the
// "All tabs" button appears and lists every tab (the open one marked), choosing a row opens that tab and scrolls it into view, Escape
// closes the list and gives the focus back to its button, the palette opens the same list, and with a window tall enough for all the
// tabs the button goes away again. (UX review B2; the strip stands on the left edge since v2 P3.)
import { assert, click, openPalette, shown, waitFocus, waitHidden, waitShown } from './lib.mjs';

const COUNT = 40;
const notes = [];
for (let i = 1; i <= COUNT; i++) notes.push({ title: `long-named-project-note-number-${i}.md`, content: `# note ${i}\n` });

const activeTabInStrip = `(function () {
  var a = document.querySelector('#tabs-list .tab-item.active');
  var sc = document.getElementById('tabs-scroll');
  if (!a) return false;
  var r = a.getBoundingClientRect(), b = sc.getBoundingClientRect();
  return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
})()`;

const newButtonOnScreen = `(function () {
  var r = document.getElementById('btn-new-tab').getBoundingClientRect();
  return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
})()`;

const rowHeights = `(function () {
  var rows = document.querySelectorAll('#tabs-list .tab-item');
  var hs = Array.prototype.map.call(rows, function (e) { return e.getBoundingClientRect().height; });
  return { count: rows.length, min: Math.min.apply(null, hs), max: Math.max.apply(null, hs) };
})()`;

export default {
  title: 'tab overflow: tabs squeezed then scrolled, + stays, All tabs list, choose a row, Escape, palette, tall window',
  session: { notes },

  async run(s, t) {
    t.step('40 tabs do not fit: + stays on screen, All tabs shows, the column scrolls inside its own box');
    await s.waitFor("document.querySelectorAll('#tabs-list .tab-item').length === " + COUNT);
    await waitShown(s, 'btn-all-tabs');
    assert.equal(await s.ev(newButtonOnScreen), true, 'the + button is on screen');
    assert.equal(await s.ev("(function () { var e = document.getElementById('tabs-scroll'); return e.scrollHeight > e.clientHeight; })()"), true, 'the strip scrolls inside its own box');
    const squeezed = await s.ev(rowHeights);
    assert.equal(squeezed.min, 20, 'the tabs were squeezed to their least before the column scrolled: ' + JSON.stringify(squeezed));

    t.step('the list shows every tab, the open one marked');
    await click(s, 'btn-all-tabs');
    await waitShown(s, 'tab-list-panel');
    assert.equal(await s.ev("document.querySelectorAll('#tab-list-rows .tab-list-row').length"), COUNT, 'one row per tab');
    assert.equal(await s.ev("document.querySelectorAll('#tab-list-rows .tab-list-row.is-current').length"), 1, 'exactly one row is marked as the open tab');
    assert.equal(await s.ev("document.getElementById('btn-all-tabs').getAttribute('aria-expanded')"), 'true');
    await waitFocus(s, 'tab-list-rows');
    assert.equal(await s.ev("(function () { var p = document.getElementById('tab-list-panel').getBoundingClientRect(), a = document.getElementById('tab-index-left').getBoundingClientRect(); return p.left >= a.right && p.top >= 0 && p.bottom <= window.innerHeight; })()"), true, 'the list hangs beside the strip, inside the window');

    t.step('choose the last tab from the list');
    await s.key('End');
    await s.key('Enter');
    await waitHidden(s, 'tab-list-panel');
    const st = await s.state();
    assert.equal(st.activeTabId, st.tabs[COUNT - 1].id, 'the last tab is the open one');
    await s.waitFor(activeTabInStrip);
    assert.equal(await s.ev(newButtonOnScreen), true, 'the + button is still on screen');
    assert.equal(await s.ev("document.getElementById('btn-all-tabs').getAttribute('aria-expanded')"), 'false');

    t.step('a new tab from + is scrolled into view');
    await click(s, 'btn-new-tab');
    await s.waitFor(`window.__explore.state().tabs.length === ${COUNT + 1}`);
    await s.waitFor(activeTabInStrip);

    t.step('Escape closes the list and the focus goes back to its button');
    await click(s, 'btn-all-tabs');
    await waitShown(s, 'tab-list-panel');
    await s.key('Escape');
    await waitHidden(s, 'tab-list-panel');
    await waitFocus(s, 'btn-all-tabs');

    t.step('the palette opens the same list');
    await openPalette(s);
    await s.type(t.pick('all tabs', 'すべてのタブ'));
    await s.waitFor("document.querySelectorAll('#quick-pick-list .quick-pick-item').length > 0");
    await s.key('Enter');
    await waitShown(s, 'tab-list-panel');
    assert.equal(await s.ev("document.querySelectorAll('#tab-list-rows .tab-list-row').length"), COUNT + 1);
    await s.key('Escape');
    await waitHidden(s, 'tab-list-panel');

    t.step('a tall window fits all the tabs: the All tabs button goes away, and the tabs have their full height');
    await s.page.cdp.send('Emulation.setDeviceMetricsOverride', { width: s.viewport.w, height: 2400, deviceScaleFactor: 1, mobile: false });
    await waitHidden(s, 'btn-all-tabs');
    const roomy = await s.ev(rowHeights);
    assert.equal(roomy.min, 30, 'with room the tabs are 30px tall: ' + JSON.stringify(roomy));
    assert.equal(await s.ev("(function () { var e = document.getElementById('tabs-scroll'); return e.scrollHeight <= e.clientHeight + 1; })()"), true, 'and the column does not scroll');
    await s.page.cdp.send('Emulation.setDeviceMetricsOverride', { width: s.viewport.w, height: s.viewport.h, deviceScaleFactor: 1, mobile: false });
    await waitShown(s, 'btn-all-tabs');
    assert.equal(await shown(s, 'tab-list-panel'), false, 'and the list itself stayed closed');

    t.step('in between, the tabs are squeezed but the column does not scroll');
    const ids = (await s.state()).tabs.map((x) => x.id);
    await s.ev(`(async function () { var ids = ${JSON.stringify(ids)}; for (var i = 0; i < 16; i++) await window.__mdMemoRPC.closeTab(ids[i]); })()`);
    await s.waitFor("document.querySelectorAll('#tabs-list .tab-item').length === " + (COUNT + 1 - 16));
    await waitHidden(s, 'btn-all-tabs');
    const mid = await s.ev(rowHeights);
    assert.ok(mid.min > 20 && mid.max < 30, 'between their least and their full height: ' + JSON.stringify(mid));
    assert.equal(await s.ev("(function () { var e = document.getElementById('tabs-scroll'); return e.scrollHeight <= e.clientHeight + 1; })()"), true, 'and the column does not scroll');
  },
};
