// The index tabs open (v2 P3): a strip 6px wide with a 12px place to aim at on the window's edge widens to 200px over the text when the mouse
// rests on it or the keyboard is in it, and goes back; the text under it does not move (an overlay); passing by does not open it; Esc and a
// click elsewhere give the note its focus back; F6 stops at the strip, the arrows walk the tabs and Enter chooses; reduced motion has no wait.
// Judged on the boxes (getBoundingClientRect), the computed styles and the app state; no picture. (Real mouse events through CDP.)
import { assert, settle, waitFocus } from './lib.mjs';

const notes = [];
for (let i = 1; i <= 5; i++) notes.push({ title: `index-note-${i}.md`, content: `# note ${i}\n\n${'text of the note\n'.repeat(30)}` });

const stripWidth = "Math.round(document.getElementById('tab-index-left').getBoundingClientRect().width)";
const rowBox = (i) => `(function () { var r = document.querySelectorAll('#tabs-list .tab-item')[${i}].getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, h: r.height }; })()`;
const paneBox = "(function () { var r = document.getElementById('editor-pane').getBoundingClientRect(), e = document.getElementById('editor').getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height, e.left, e.width, document.getElementById('editor').clientWidth]); })()";
const active = (s) => s.ev("(function () { var a = document.querySelector('#tabs-list .tab-item.active'); return a ? a.dataset.tabId : null; })()");

export default {
  title: 'index tabs: 12px to aim at, widen to 200px over the text on rest or focus, go back, passing by does not open, F6 / arrows / Enter / Esc, Zen mode, reduced motion',
  session: { notes },

  async run(s, t) {
    const move = (x, y) => s.page.mouseMove(x, y);

    t.step('collapsed: the strip is 18px wide on the edge, its tabs are painted 12px, the names are not shown, and the text starts after it');
    await s.waitFor("document.querySelectorAll('#tabs-list .tab-item').length === 5");
    await s.waitFor("!!document.querySelector('#tabs-list .tab-item.active')");
    assert.equal(await s.ev(stripWidth), 18, 'the strip is --tab-hit-w wide');
    assert.equal(await s.ev("getComputedStyle(document.querySelector('#tabs-list .tab-item'), '::before').width"), '12px', 'and paints --tab-strip-w of it');
    assert.equal(await s.ev("getComputedStyle(document.querySelector('#tabs-list .tab-title')).opacity"), '0', 'no name is shown while it is collapsed');
    assert.equal(await s.ev("Math.round(document.querySelector('#tabs-list .tab-item').getBoundingClientRect().left)"), 0, 'on the edge of the window');
    assert.equal(await s.ev("getComputedStyle(document.getElementById('editor-pane')).paddingLeft"), '12px', 'the page leaves the painted width to the strip');
    assert.equal(await s.ev("document.getElementById('tab-index-left').parentElement.id"), 'workspace', 'it is in the workspace, over the text');
    const shaded = await s.ev("Array.from(document.querySelectorAll('#tabs-list .tab-item')).map(function (e) { return e.style.getPropertyValue('--d'); }).join(',')");
    const at = await s.ev("Array.from(document.querySelectorAll('#tabs-list .tab-item')).findIndex(function (e) { return e.classList.contains('active'); })");
    assert.equal(shaded, [0, 1, 2, 3, 4].map((i) => Math.abs(i - at)).join(','), 'each tab knows its distance from the selected one: ' + shaded);
    const before = await s.ev(paneBox);

    t.step('the real mouse rests on the strip: it widens to 200px, shows the names, and nothing under it is laid out again');
    await move(600, 400);
    const y = (await s.ev(rowBox(1))).y;
    await move(3, y);
    await s.waitFor(`${stripWidth} === 200`);
    await s.waitFor("getComputedStyle(document.querySelector('#tabs-list .tab-title')).opacity === '1'");
    await s.waitFor("Math.abs(parseFloat(getComputedStyle(document.querySelector('#tabs-list .tab-item'), '::before').width) - 200) < 0.5"); // the fill finishes widening with the strip: the open tab is painted its whole width
    assert.equal(await s.ev(paneBox), before, 'the editor pane and the text box have the size they had: the strip lies over them');
    assert.equal(await s.ev("getComputedStyle(document.getElementById('tab-index-left')).position"), 'absolute');
    assert.equal(await s.ev("Array.from(document.querySelectorAll('#tabs-list .tab-title')).map(function (e) { return e.getBoundingClientRect().width > 40; }).every(Boolean)"), true, 'the names have room');

    t.step('the pointer leaving the strip closes it; the empty length of the strip below its tabs is not the strip (the text can be pressed there)');
    await move(600, 400);
    await s.waitFor(`${stripWidth} === 12`);
    const below = await s.ev("Math.round(document.getElementById('btn-new-tab').getBoundingClientRect().bottom + 40)");
    const owner = (x, yy) => s.ev(`(function () { var e = document.elementFromPoint(${x}, ${yy}); return e ? (e.closest('.tab-index') ? 'strip' : (e.id || e.tagName)) : null; })()`);
    assert.equal(await owner(8, y), 'strip', 'the 12px the strip aims with reach 8px in, over the gutter, at the height of a tab');
    assert.notEqual(await owner(8, below), 'strip', 'below the last tab the same place belongs to the page: the strip takes no pointer where it has no tab');
    assert.notEqual(await owner(3, below), 'strip');
    assert.notEqual(await owner(14, y), 'strip', 'and past the 12px the page is the page again');

    t.step('passing by does not open it: the pointer has to rest (a wait before it widens)');
    await s.ev("document.documentElement.style.setProperty('--tab-open-delay', '700ms')");
    await move(600, 400);
    await move(3, y);
    await settle(150);
    await move(600, 400);
    await settle(900);
    assert.equal(await s.ev(stripWidth), 12, 'a visit shorter than the wait left it closed');
    await move(3, y);
    await s.waitFor(`${stripWidth} === 200`, { timeout: 4000 });
    assert.equal(await s.ev("getComputedStyle(document.getElementById('tab-index-left')).transitionDelay.split(',')[0].trim()"), '0.7s', 'the mouse waits (its delay, for the width)');
    await move(600, 400);
    await s.waitFor(`${stripWidth} === 12`);
    await s.ev("document.documentElement.style.removeProperty('--tab-open-delay')");

    t.step('a click on a collapsed tab chooses it (the 12px are enough to aim at)');
    const ids = await s.ev("Array.from(document.querySelectorAll('#tabs-list .tab-item')).map(function (e) { return e.dataset.tabId; })");
    const third = await s.ev(rowBox(2));
    await s.page.click(3, third.y);
    await s.waitFor(`document.querySelector('#tabs-list .tab-item.active').dataset.tabId === ${JSON.stringify(ids[2])}`);
    await waitFocus(s, 'editor');
    await move(600, 400);

    t.step('keyboard: F6 goes note, header, the strip (on the selected tab), then the status bar; the strip opens at once, with a ring');
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#header')");
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#tab-index-left')");
    assert.equal(await s.ev("document.activeElement.classList.contains('active') && document.activeElement.getAttribute('tabindex')"), '0', 'the selected tab is the tab stop');
    await s.waitFor(`${stripWidth} === 200`);
    assert.equal(await s.ev("getComputedStyle(document.getElementById('tab-index-left')).transitionDelay.split(',')[0].trim()"), '0s', 'the keyboard does not wait');
    assert.equal(await s.ev("getComputedStyle(document.activeElement).outlineStyle"), 'solid', 'the tab with the keyboard has a ring');
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#status-bar')");
    await s.key('F6', { shift: true });
    await s.waitFor("!!document.activeElement.closest('#tab-index-left')");

    t.step('the arrows walk along the tabs without choosing, Home and End jump, Enter chooses and gives the note its focus');
    const selected = await active(s);
    const stripTab = (i) => `document.activeElement === document.querySelectorAll('#tabs-list .tab-item')[${i}]`;
    const sel = await s.ev("Array.from(document.querySelectorAll('#tabs-list .tab-item')).findIndex(function (e) { return e.classList.contains('active'); })");
    await s.key('ArrowDown');
    await s.waitFor(stripTab((sel + 1) % 5));
    assert.equal(await active(s), selected, 'moving along chose nothing');
    await s.key('End');
    await s.waitFor(stripTab(4));
    await s.key('Home');
    await s.waitFor(stripTab(0));
    await s.key('ArrowUp');
    await s.waitFor(stripTab(4));
    await s.key('Enter');
    await s.waitFor(`document.querySelector('#tabs-list .tab-item.active').dataset.tabId === ${JSON.stringify(ids[4])}`);
    await waitFocus(s, 'editor');
    await s.waitFor(`${stripWidth} === 12`);

    t.step('Esc in the strip takes the focus back to the note, and the strip closes');
    await s.key('F6');
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#tab-index-left')");
    await s.waitFor(`${stripWidth} === 200`);
    await s.key('Escape');
    await waitFocus(s, 'editor');
    await s.waitFor(`${stripWidth} === 12`);

    t.step('Zen mode: the strip is away like the bars (nothing to see, nothing to aim at), the mouse does not open it, F6 brings it back, and it closes again');
    await s.key('F11', { shift: true });
    await s.waitFor("document.body.classList.contains('zen-mode')");
    await s.waitFor("getComputedStyle(document.getElementById('tab-index-left')).opacity === '0'");
    assert.equal(await s.ev("getComputedStyle(document.querySelector('#tabs-list .tab-item')).pointerEvents"), 'none', 'its tabs take no pointer');
    assert.equal(await s.ev("getComputedStyle(document.getElementById('btn-new-tab')).pointerEvents"), 'none', 'nor does "+"');
    await move(3, y);
    await settle(400);
    assert.equal(await s.ev(stripWidth), 12, 'the mouse on its place does not open it');
    await move(600, 400);
    await s.key('F6');
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#tab-index-left')");
    await s.waitFor("getComputedStyle(document.getElementById('tab-index-left')).opacity === '1'");
    await s.waitFor(`${stripWidth} === 200`);
    assert.equal(await s.ev("getComputedStyle(document.querySelector('#tabs-list .tab-item')).pointerEvents"), 'auto', 'with the keyboard in it the strip is a strip again');
    await s.key('Escape');
    await waitFocus(s, 'editor');
    await s.waitFor("getComputedStyle(document.getElementById('tab-index-left')).opacity === '0'");
    await s.key('F11', { shift: true });
    await s.waitFor("!document.body.classList.contains('zen-mode')");
    await s.waitFor("getComputedStyle(document.getElementById('tab-index-left')).opacity === '1'");

    t.step('reduced motion: no wait and no animation (a widening that is there on the next frame)');
    await s.page.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await s.ev("getComputedStyle(document.documentElement).getPropertyValue('--tab-open-delay').trim()"), '0ms', 'the wait is 0');
    await move(3, y);
    await s.waitFor(`${stripWidth} === 200`, { timeout: 600 });
    assert.equal(await s.ev("getComputedStyle(document.getElementById('tab-index-left')).transitionDuration.split(',')[0].trim()"), '0s');
    await move(600, 400);
    await s.waitFor(`${stripWidth} === 12`, { timeout: 600 });
    await s.page.cdp.send('Emulation.setEmulatedMedia', { features: [] });
  },
};
