// The overlay bars (v2 P2): the header and the status bar float over the text, the text runs under them, and they fade away while you
// write or scroll. Judged on the DOM and the geometry, with real key, mouse and wheel events:
//   * the bars are at the window's top and bottom, the editor runs the whole height, and the ghost text, the line numbers and the
//     result-block bars stay on the lines of the text (they share the textarea's padding);
//   * a real keystroke and an IME composition fade the bars (opacity 0, pointer-events none, still visible to the reading order); an
//     event made by script, a key press the IME has not turned into text, and typing in another input do not;
//   * the mouse (after a few px), the keyboard focus, F6 and a message in the status bar bring them back; a quiet message does not;
//   * a wheel scrolls them away, a scroll made by script (switching tabs) does not;
//   * auto-hide off: nothing is listening and typing leaves the bars alone.
import { assert, click, settle, waitFocus } from './lib.mjs';

const NOTE_A = ['# Overlay note', '', '[[ @llm go ]]', '<!-- md-memo:res ab12 -->', '- result', '<!-- /md-memo:res -->', '', ...Array.from({ length: 120 }, (_, i) => `Line ${i + 1} lorem ipsum dolor sit amet`)].join('\n') + '\n';
const NOTE_B = Array.from({ length: 120 }, (_, i) => `Row ${i + 1} second note`).join('\n') + '\n';

const css = (s, id, prop) => s.ev(`getComputedStyle(document.getElementById(${JSON.stringify(id)}))[${JSON.stringify(prop)}]`);
const px = async (s, id, prop) => parseFloat(await css(s, id, prop));

export default {
  title: 'overlay bars: text under them with ghost / numbers / result bars in step; typing, composing and scrolling fade them away, the mouse, focus, F6 and messages bring them back',
  session: { notes: [{ title: 'a.md', content: NOTE_A }, { title: 'b.md', content: NOTE_B }] },
  timeoutMs: 120000,

  async run(s, t) {
    const cdp = s.page.cdp;
    const faded = () => s.ev("document.body.classList.contains('chrome-faded')");
    const opacity = (id) => px(s, id, 'opacity');
    const rect = (id) => s.ev(`(function () { var r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }; })()`);
    const move = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    const overlay = (expr) => s.ev(`window.ChromeOverlay.current.${expr}`);
    const bringBack = async () => { await overlay('show()'); await s.waitFor("!document.body.classList.contains('chrome-faded')"); };
    const waitFaded = () => s.waitFor("document.body.classList.contains('chrome-faded') && parseFloat(getComputedStyle(document.getElementById('header')).opacity) < 0.05");
    const inBar = "!!document.activeElement && !!document.activeElement.closest && !!document.activeElement.closest('#header, #status-bar')";
    const snap = () => s.ev(`JSON.stringify({ faded: document.body.classList.contains('chrome-faded'), header: getComputedStyle(document.getElementById('header')).opacity, status: getComputedStyle(document.getElementById('status-bar')).opacity, pinHeader: document.getElementById('header').hasAttribute('data-pin'), pinStatus: document.getElementById('status-bar').hasAttribute('data-pin'), active: document.activeElement.id || document.activeElement.tagName })`);
    const wheel = (dy) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: 300, deltaX: 0, deltaY: dy });

    t.step('geometry: the header and the status bar float at the top and the bottom, the editor runs the whole window');
    const win = await s.ev('({ w: innerWidth, h: innerHeight })');
    const header = await rect('header');
    const status = await rect('status-bar');
    const editor = await rect('editor');
    assert.equal(await css(s, 'header', 'position'), 'absolute');
    assert.equal(await css(s, 'status-bar', 'position'), 'absolute');
    assert.ok(header.top === 0 && header.height === 38, `the header: ${JSON.stringify(header)}`);
    assert.ok(Math.abs(status.bottom - win.h) < 0.5 && status.height === 24, `the status bar: ${JSON.stringify(status)}`);
    assert.ok(editor.top === 0 && Math.abs(editor.height - win.h) < 0.5, `the editor runs the whole height: ${JSON.stringify(editor)}`);
    assert.equal((await rect('workspace')).height, win.h, 'and so does the workspace');

    t.step('the boxes of the lines share one padding: 38 + 12 above, 12 + 24 below; the numbers, the ghost text and the result bar are on the text');
    const pads = await s.ev(`['editor', 'ghost-overlay', 'line-numbers'].map(function (id) { var c = getComputedStyle(document.getElementById(id)); return [c.paddingTop, c.paddingBottom]; })`);
    assert.deepEqual(pads, [['50px', '36px'], ['50px', '36px'], ['50px', '36px']], 'the textarea, the ghost text overlay and the gutter');
    const gap = await s.ev('Math.abs(document.getElementById("editor").scrollHeight - document.getElementById("line-numbers").scrollHeight)');
    assert.ok(gap <= 2, `the gutter and the textarea scroll the same height (differ by ${gap})`);
    const digit = await s.ev(`(function () { var g = document.getElementById('line-numbers'); var w = document.createTreeWalker(g, NodeFilter.SHOW_TEXT); var n = w.nextNode(); var r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 1); return r.getBoundingClientRect().top; })()`);
    assert.ok(Math.abs(digit - 50) <= 5, `the number 1 starts where the first line of text does (${digit})`);
    const bar = await s.ev("(function () { var b = document.querySelector('.result-accent-open'); return b ? b.getBoundingClientRect().top : null; })()");
    assert.ok(bar !== null && Math.abs(bar - (50 + 3 * 22.4)) <= 4, `the result block's bar begins on its line, line 4 (${bar})`);
    assert.equal(await css(s, 'editor', 'scrollPaddingTop'), '38px');
    assert.equal(await css(s, 'editor', 'scrollPaddingBottom'), '32px');

    t.step('the ghost text sits on the row the caret is on');
    await s.ev("__docshot.ghost = ' and a little more'");
    await s.ev(`(function () { var e = document.getElementById('editor'); e.focus(); var end = e.value.length; e.setSelectionRange(end, end); e.scrollTop = e.scrollHeight; return 1; })()`);
    await s.type('ab');
    await s.waitFor("!!document.querySelector('#ghost-overlay .ghost-suggestion')", { timeout: 8000 });
    const ghost = await s.ev(`(function () { var e = document.getElementById('editor'); var g = document.querySelector('#ghost-overlay .ghost-suggestion').getBoundingClientRect(); var cs = getComputedStyle(e); return { ghostBottom: g.bottom, rowBottom: e.scrollHeight - parseFloat(cs.paddingBottom) - e.scrollTop }; })()`);
    assert.ok(Math.abs(ghost.ghostBottom - ghost.rowBottom) <= 7, `the ghost text is on the last row, not shifted by the room for the bars: ${JSON.stringify(ghost)}`);
    await s.key('Escape');

    t.step('a real keystroke fades the bars: opacity 0, pointer-events none, still visible to the reading order, the status line still a live region');
    await waitFaded();
    assert.equal(await css(s, 'header', 'pointerEvents'), 'none');
    assert.equal(await css(s, 'status-bar', 'pointerEvents'), 'none');
    assert.equal(await css(s, 'header', 'visibility'), 'visible', 'faded is not hidden');
    assert.equal(await css(s, 'status-bar', 'visibility'), 'visible');
    assert.equal(await css(s, 'status-bar', 'display'), 'flex');
    assert.equal(await s.ev("document.getElementById('stat-message').getAttribute('aria-live')"), 'polite', 'the status line is still announced');
    assert.deepEqual(await rect('header'), header, 'and the bar did not move: nothing was laid out again');

    t.step('the mouse brings them back after a few px, not before; the buttons are then clickable');
    await bringBack();
    await move(300, 300); // the renderer learns where the pointer is
    await s.ev("document.getElementById('editor').focus()");
    await s.type('c');
    await waitFaded();
    await move(302, 301); // a tremble
    await settle(150);
    assert.equal(await faded(), true, 'a 3px move is not a reason');
    await move(340, 301);
    await s.waitFor("!document.body.classList.contains('chrome-faded')");
    await s.waitFor("parseFloat(getComputedStyle(document.getElementById('header')).opacity) > 0.95");
    assert.equal(await css(s, 'header', 'pointerEvents'), 'auto');
    await click(s, 'btn-find');
    await s.waitFor("!document.getElementById('find-replace-bar').classList.contains('hidden')");
    assert.equal(await rect('find-replace-bar').then((r) => Math.round(r.top)), 46, 'the find bar sits 8px under the header bar');
    await s.key('Escape');
    await s.waitFor("document.getElementById('find-replace-bar').classList.contains('hidden')");

    t.step('what does not fade them: a script\'s input event, a key the IME has not made text, typing in another input; a composition does');
    await bringBack();
    await s.ev(`(function () { var e = document.getElementById('editor'); e.focus(); e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await settle(150);
    assert.equal(await faded(), false, 'a synthetic input event (an RPC write, a script) leaves the bars');
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'KeyA', windowsVirtualKeyCode: 229 });
    await settle(150);
    assert.equal(await faded(), false, 'key "Process" alone is not writing yet');
    await s.key('f', { ctrl: true });
    await s.waitFor("!document.getElementById('find-replace-bar').classList.contains('hidden')");
    await s.waitFor("document.activeElement && document.activeElement.id === 'find-input'");
    await s.type('Line');
    await settle(150);
    assert.equal(await faded(), false, 'typing in the find box is not writing in the note');
    await s.key('Escape');
    await s.waitFor("document.getElementById('find-replace-bar').classList.contains('hidden')");
    await s.ev("document.getElementById('editor').focus()");
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'KeyA', windowsVirtualKeyCode: 229 });
    await cdp.send('Input.imeSetComposition', { text: 'あ', selectionStart: 1, selectionEnd: 1 });
    await waitFaded();
    await cdp.send('Input.insertText', { text: '愛' });
    await settle(100);

    t.step('keyboard focus shows a faded bar: the focus leaving the note brings both back, focus in one bar shows that bar, F6 goes note -> header -> tab strip -> status bar -> note, Esc comes back');
    assert.equal(await faded(), true, 'still faded after the composition');
    await s.ev("document.getElementById('btn-find').focus()");
    await s.waitFor("!document.body.classList.contains('chrome-faded') && parseFloat(getComputedStyle(document.getElementById('header')).opacity) > 0.95");
    assert.ok(await opacity('status-bar') > 0.95, 'the focus left the note: both bars come back');
    await s.ev("document.activeElement.blur(); window.ChromeOverlay.current.away()"); // faded with the focus on the page body
    await waitFaded();
    await s.ev("document.getElementById('btn-find').focus()");
    await s.waitFor("parseFloat(getComputedStyle(document.getElementById('header')).opacity) > 0.95");
    assert.equal(await faded(), true, 'the class stays: it is the focus that shows the header (:focus-within)');
    assert.ok(await opacity('status-bar') < 0.05, 'and only the header');
    await s.ev("document.getElementById('editor').focus()");
    await s.type('d');
    await waitFaded();
    await s.key('F6');
    await s.waitFor(inBar);
    assert.equal(await faded(), false, 'F6 shows the bars');
    assert.equal(await s.ev("document.activeElement.closest('#header') !== null"), true, 'and goes to the header first');
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#tab-index-left')"); // the strip of the index tabs is between the header and the status bar
    assert.equal(await s.ev("document.activeElement.classList.contains('tab-item') && document.activeElement.classList.contains('active')"), true, 'on the selected tab');
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#status-bar')");
    await s.key('F6');
    await waitFocus(s, 'editor');
    await s.key('F6', { shift: true });
    await s.waitFor("!!document.activeElement.closest('#status-bar')");
    await s.key('F6', { shift: true });
    await s.waitFor("!!document.activeElement.closest('#tab-index-left')");
    await s.key('Escape');
    await waitFocus(s, 'editor');

    t.step('the status bar stays while it has something to say: a message, the AI popover; a quiet message does not');
    await s.type('e');
    await waitFaded();
    assert.ok(await opacity('status-bar') < 0.05);
    await s.ev("window.showMessage('Something to say', 6000, { quiet: true })");
    await settle(250);
    assert.ok(await opacity('status-bar') < 0.05, 'a quiet message (the automatic save) does not bring the status bar back');
    await s.ev("window.showMessage('Something to say', 6000)");
    await s.waitFor("parseFloat(getComputedStyle(document.getElementById('status-bar')).opacity) > 0.95");
    assert.ok(await opacity('header') < 0.05, 'the header stays away: ' + await snap());
    assert.equal(await s.ev("document.getElementById('status-bar').hasAttribute('data-pin')"), true);
    await s.ev("window.showMessage('', 1)");
    await s.waitFor("parseFloat(getComputedStyle(document.getElementById('status-bar')).opacity) < 0.05");
    // The AI popover's own mark (aria-expanded on its item) pins the status bar. Set by hand: opening the popover for real moves the focus
    // into it, and a focus that leaves the note brings both bars back anyway.
    await s.ev("document.getElementById('stat-ai').setAttribute('aria-expanded', 'true')");
    await s.waitFor("parseFloat(getComputedStyle(document.getElementById('status-bar')).opacity) > 0.95");
    assert.ok(await opacity('header') < 0.05, 'the header stays away: ' + await snap());
    await s.ev("document.getElementById('stat-ai').setAttribute('aria-expanded', 'false')");
    await s.waitFor("parseFloat(getComputedStyle(document.getElementById('status-bar')).opacity) < 0.05");
    assert.equal(await s.ev("document.activeElement.id"), 'editor', 'the note kept the focus all along');

    t.step('scrolling: a wheel fades the bars, a scroll made by script (switching tabs, a jump) does not');
    await bringBack();
    await s.ev("document.getElementById('editor').scrollTop = 400");
    await settle(250);
    assert.equal(await faded(), false, 'a scroll by script, with no wheel, key or press before it');
    const tabs = await s.ev("Array.from(document.querySelectorAll('#tabs-list .tab-item')).map(function (e) { return e.getAttribute('data-tab-id'); })");
    assert.ok(tabs.length >= 2, 'two notes are open');
    const second = await s.ev(`(function () { var e = document.querySelectorAll('#tabs-list .tab-item')[1]; var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await s.page.click(second.x, second.y);
    await s.waitFor("document.querySelector('#tabs-list .tab-item.active') === document.querySelectorAll('#tabs-list .tab-item')[1]");
    await settle(300);
    assert.equal(await faded(), false, 'clicking a tab (which scrolls the note by script) does not make the header disappear');
    await s.ev("document.getElementById('editor').focus()");
    await move(500, 300);
    await wheel(240);
    await waitFaded();
    await move(520, 300);
    await move(560, 300);
    await s.waitFor("!document.body.classList.contains('chrome-faded')");
    await s.ev("window.postMessage({ type: 'previewScroll', ratio: 0.3 }, '*')"); // an HTML page scrolling inside its iframe says so this way
    await waitFaded();
    await bringBack();

    t.step('split view: both pages run under the bars alike, and the right page\'s name band floats over the room they both keep free at the top');
    await click(s, 'btn-toggle-split');
    await s.waitFor("!document.getElementById('secondary-pane').classList.contains('hidden')");
    const strip = await rect('secondary-pane-header');
    assert.ok(Math.abs(strip.top - 38) <= 0.5 && Math.abs(strip.height - 28) <= 0.5, `the band: ${JSON.stringify(strip)}`);
    const splitPads = await s.ev(`['editor', 'ghost-overlay', 'line-numbers', 'editor-secondary', 'secondary-line-numbers'].map(function (id) { var c = getComputedStyle(document.getElementById(id)); return [c.paddingTop, c.paddingBottom]; })`);
    assert.deepEqual(splitPads, Array(5).fill(splitPads[0]), 'the two pages share one padding at the top and one at the bottom: the first lines are level');
    assert.equal(splitPads[0][1], '36px', 'the status bar\'s room at the bottom');
    assert.ok(parseFloat(splitPads[0][0]) >= strip.bottom, 'and at the top there is room for the header bar and the band: the text starts below the band');
    assert.deepEqual(await s.ev("window.ChromeOverlay.insets(document.getElementById('editor-secondary'))"), await s.ev("window.ChromeOverlay.insets(document.getElementById('editor'))"), 'under the same bars');
    assert.deepEqual(await s.ev("window.ChromeOverlay.insets(document.getElementById('editor'))"), { top: 38, bottom: 24 });
    await click(s, 'btn-toggle-split');
    await s.waitFor("document.getElementById('secondary-pane').classList.contains('hidden')");

    t.step('Zen mode (the old one in this step) widens the margin: the textarea, the ghost text and the numbers still share one padding');
    await s.ev("document.getElementById('editor').focus()");
    await s.key('F11', { shift: true });
    await s.waitFor("document.body.classList.contains('zen-mode')");
    assert.deepEqual(await s.ev(`['editor', 'ghost-overlay', 'line-numbers'].map(function (id) { var c = getComputedStyle(document.getElementById(id)); return [c.paddingTop, c.paddingBottom]; })`), [['24px', '24px'], ['24px', '24px'], ['24px', '24px']]);
    assert.deepEqual(await s.ev(`['editor', 'ghost-overlay'].map(function (id) { var c = getComputedStyle(document.getElementById(id)); return [c.paddingLeft, c.paddingRight]; })`), [['32px', '32px'], ['32px', '32px']]);
    await s.key('F11', { shift: true });
    await s.waitFor("!document.body.classList.contains('zen-mode')");
    assert.deepEqual(await s.ev("['editor', 'ghost-overlay', 'line-numbers'].map(function (id) { return getComputedStyle(document.getElementById(id)).paddingTop; })"), ['50px', '50px', '50px'], 'and back to the room for the header');

    t.step('auto-hide off: nothing is listening, typing leaves the bars alone; on again: it works as before');
    await overlay('configure({ autoHide: false })');
    assert.equal(await overlay('listenerCount()'), 0, 'no listener at all');
    await s.ev("document.getElementById('editor').focus()");
    await s.type('f');
    await settle(250);
    assert.equal(await faded(), false);
    assert.equal(await opacity('header'), 1);
    await overlay('configure({ autoHide: true })');
    assert.equal(await overlay('listenerCount()'), 7, 'the seven that listen for writing, scrolling and where the pointer is');
    await s.type('g');
    await waitFaded();
    assert.equal(await overlay('listenerCount()'), 3, 'faded: only the pointer, the touch and the focus are listened to');
  }
};
