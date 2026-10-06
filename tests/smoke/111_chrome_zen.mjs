// Zen mode and the bars' settings (v2 P2b), judged on the DOM and the geometry with real mouse, key and wheel events:
//   * Settings > Appearance: the tint of the bars (solid / light / glass) and "hide while writing" show at once, Cancel restores, Save keeps
//     them (the settings sent to the backend and the live config); switched off, nothing listens;
//   * Zen mode (Shift+F11): the margins stay (the textarea, its ghost text and the line numbers share the wider padding, no column is folded,
//     the numbers fade to 30%), the bars are away and the mouse moving does NOT bring them back;
//   * the top edge (150 ms) calls the header, the bottom edge the status bar; they go when the pointer has left; a pass through the band
//     calls nothing;
//   * an ordinary message is not shown (the text stays in the live region), a failure (a save that fails, for real) calls the status bar;
//   * F6 and Tab show the bar they go into, Esc takes the focus back to the note and only then leaves Zen mode;
//   * the RPC state follows (ui.state.zen) and the tool that sets it (ui.set_view { zen }) works in both directions.
import { assert, click, lastSavedConfig, backendCalls, liveConfig, rpc, settle, waitHidden, waitShown } from './lib.mjs';

const NOTE = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of the note, calm text`).join('\n') + '\n';
const PATH = 'C:\\notes\\zen.md';

const pick = (s, id, value) => s.ev(`(function () { var e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);
const tick = (s, id, on) => s.ev(`(function () { var e = document.getElementById(${JSON.stringify(id)}); e.checked = ${on ? 'true' : 'false'}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.checked; })()`);

export default {
  title: 'Zen mode: the margins stay, the bars stay away from the mouse and come back at the top / bottom edge, F6 or a failure; the bars\' settings',
  session: { notes: [{ title: 'zen.md', content: NOTE, path: PATH }] },
  timeoutMs: 120000,

  async run(s, t) {
    const cdp = s.page.cdp;
    const opacity = (id) => s.ev(`parseFloat(getComputedStyle(document.getElementById(${JSON.stringify(id)})).opacity)`);
    const away = (id) => s.waitFor(`parseFloat(getComputedStyle(document.getElementById(${JSON.stringify(id)})).opacity) < 0.05`);
    const back = (id) => s.waitFor(`parseFloat(getComputedStyle(document.getElementById(${JSON.stringify(id)})).opacity) > 0.95`);
    const move = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    const overlay = (expr) => s.ev(`window.ChromeOverlay.current.${expr}`);
    const win = await s.ev('({ w: innerWidth, h: innerHeight })');

    // ---- Settings ----
    t.step('Settings > Appearance: the bars select (solid, light, glass) and the auto-hide switch, as the page starts');
    assert.equal(await s.ev("document.body.getAttribute('data-bars')"), 'light', 'the default tint ships in the markup');
    await s.key(',', { ctrl: true });
    await waitShown(s, 'settings-modal');
    await s.waitFor("document.getElementById('cfg-bars').getBoundingClientRect().width > 0");
    assert.deepEqual(await s.ev("Array.from(document.getElementById('cfg-bars').options).map(function (o) { return o.value; })"), ['solid', 'light', 'glass']);
    assert.equal(await s.ev("document.getElementById('cfg-bars').value"), 'light');
    assert.equal(await s.ev("document.getElementById('cfg-auto-hide').checked"), true);
    assert.equal(await overlay('listenerCount()'), 7, 'auto-hide is listening');
    const savesBefore = (await backendCalls(s, 'saveConfig')).length;

    t.step('frosted glass and auto-hide off show at once (a blur behind the bars; no listener), the config is not touched; Cancel puts them back');
    await pick(s, 'cfg-bars', 'glass');
    await tick(s, 'cfg-auto-hide', false);
    assert.equal(await s.ev("document.body.getAttribute('data-bars')"), 'glass');
    assert.ok(/blur/.test(await s.ev("getComputedStyle(document.getElementById('header')).backdropFilter")), 'the header blurs what is behind it');
    assert.ok(/blur/.test(await s.ev("getComputedStyle(document.getElementById('status-bar')).backdropFilter")));
    assert.equal(await overlay('listenerCount()'), 0, 'auto-hide off: nothing is listening');
    assert.equal(await overlay('isEnabled()'), false);
    assert.equal((await liveConfig(s)).appearance, undefined, 'a preview does not touch the config');
    await click(s, 'btn-cancel-settings');
    await waitHidden(s, 'settings-modal');
    assert.equal(await s.ev("document.body.getAttribute('data-bars')"), 'light');
    assert.equal(await overlay('listenerCount()'), 7, 'Cancel: auto-hide listens again');
    assert.equal((await backendCalls(s, 'saveConfig')).length, savesBefore, 'Cancel saved nothing');

    t.step('Save keeps solid + auto-hide off: opaque bars, the settings sent to the backend, nothing listening, typing leaves the bars');
    await s.key(',', { ctrl: true });
    await waitShown(s, 'settings-modal');
    await pick(s, 'cfg-bars', 'solid');
    await tick(s, 'cfg-auto-hide', false);
    await click(s, 'btn-save-settings');
    await waitHidden(s, 'settings-modal');
    const saved = await lastSavedConfig(s);
    assert.equal(saved.appearance.bars, 'solid');
    assert.equal(saved.appearance.autoHide, false);
    assert.equal(saved.appearance.look, 'ink', 'the rest of the setting came along');
    assert.equal((await liveConfig(s)).appearance.bars, 'solid');
    await s.waitFor("getComputedStyle(document.getElementById('header')).backgroundColor === 'rgb(18, 20, 30)'"); // solid: the opaque bar colour (after its short colour fade)
    assert.equal(await overlay('listenerCount()'), 0);
    await s.ev("document.getElementById('editor').focus()");
    await s.type('a');
    await settle(250);
    assert.equal(await opacity('header'), 1, 'auto-hide off: typing leaves the bars');
    // back to the defaults for the rest
    await s.key(',', { ctrl: true });
    await waitShown(s, 'settings-modal');
    await pick(s, 'cfg-bars', 'light');
    await tick(s, 'cfg-auto-hide', true);
    await click(s, 'btn-save-settings');
    await waitHidden(s, 'settings-modal');
    assert.equal(await overlay('listenerCount()'), 7);

    // ---- Zen mode ----
    t.step('Shift+F11: the bars go, the margins stay (wider sides, the three boxes of the lines share one padding), the numbers fade to 30%');
    await s.ev("document.getElementById('editor').focus()");
    await s.key('F11', { shift: true });
    await s.waitFor("document.body.classList.contains('zen-mode')");
    await away('header');
    await away('status-bar');
    assert.deepEqual(await s.ev(`['editor', 'ghost-overlay', 'line-numbers'].map(function (id) { var c = getComputedStyle(document.getElementById(id)); return [c.paddingTop, c.paddingBottom]; })`), [['24px', '24px'], ['24px', '24px'], ['24px', '24px']], 'Zen takes no room for the bars and keeps its own top margin');
    assert.deepEqual(await s.ev(`['editor', 'ghost-overlay'].map(function (id) { var c = getComputedStyle(document.getElementById(id)); return [c.paddingLeft, c.paddingRight]; })`), [['32px', '32px'], ['32px', '32px']], 'the sides are wider, as they always were');
    assert.ok(await s.ev("document.getElementById('line-numbers').getBoundingClientRect().width >= 44"), 'the number column is not folded');
    assert.ok(/0\.3\)$/.test(await s.ev("getComputedStyle(document.getElementById('line-numbers')).color")), 'the numbers at 30%');
    assert.equal(await s.ev("getComputedStyle(document.getElementById('line-numbers')).backgroundColor"), 'rgba(0, 0, 0, 0)', 'no panel behind the numbers');
    assert.equal(await s.ev("getComputedStyle(document.getElementById('line-numbers')).borderRightWidth"), '0px');
    assert.equal(await overlay('listenerCount()'), 2, 'only the pointer is listened to in Zen mode');

    t.step('the mouse moving about does not bring the bars back');
    for (const [x, y] of [[300, 300], [320, 330], [700, 400], [200, 250], [650, 200], [100, 500]]) await move(x, y);
    await settle(400);
    assert.equal(await opacity('header'), 0);
    assert.equal(await opacity('status-bar'), 0);
    assert.equal(await s.ev("document.getElementById('header').hasAttribute('data-pin') || document.getElementById('status-bar').hasAttribute('data-pin')"), false);

    t.step('the top edge, 150 ms: the header comes back (not the status bar), stays under the pointer, goes 700 ms after it left');
    await move(500, 2);
    assert.ok(await opacity('header') < 0.05, 'not at once');
    await back('header');
    assert.ok(await opacity('status-bar') < 0.05, 'the status bar is not called by the top edge');
    await move(500, 30);
    await settle(900);
    assert.equal(await opacity('header'), 1, 'it stays while the pointer is on it (below the band)');
    await move(500, 300);
    await away('header');

    t.step('a pass through the band calls nothing; the bottom edge calls the status bar');
    await move(500, 2);
    await move(500, 200);
    await settle(400);
    assert.equal(await opacity('header'), 0);
    await move(500, win.h - 2);
    await back('status-bar');
    assert.ok(await opacity('header') < 0.05, 'the header is not called by the bottom edge');
    await move(500, 300);
    await away('status-bar');

    t.step('an ordinary message is not shown (it stays in the live region); a failure calls the status bar');
    await s.ev("window.showMessage('An ordinary message', 5000)");
    await settle(300);
    assert.equal(await opacity('status-bar'), 0, 'not shown');
    assert.equal(await s.ev("document.getElementById('stat-message').textContent"), 'An ordinary message', 'but it is there for a screen reader and for the page');
    assert.equal(await s.ev("document.getElementById('stat-message').getAttribute('aria-live')"), 'polite');
    assert.ok(await s.ev("document.getElementById('stat-message').getBoundingClientRect().width <= 1"), 'one pixel wide');
    await s.ev("window.showMessage('', 1)");
    await s.setBackend({ saveFile: { fail: 'disk full' } });
    await s.key('s', { ctrl: true });
    await back('status-bar');
    assert.equal(await s.ev("document.getElementById('stat-message').hasAttribute('data-important')"), true, 'the failure is marked');
    assert.ok(await s.ev("document.getElementById('stat-message').getBoundingClientRect().width > 50"), 'and shown, not squeezed to a pixel');
    assert.ok(/disk full/.test(await s.ev("document.getElementById('stat-message').textContent")));
    assert.ok(await opacity('header') < 0.05, 'the header stays away');
    await away('status-bar');
    await s.setBackend({ saveFile: null });
    await s.ev("window.showMessage('', 1)");

    t.step('a recording calls the status bar, a running task does not');
    await s.ev("document.getElementById('stat-tasks').classList.remove('hidden')");
    await settle(300);
    assert.equal(await opacity('status-bar'), 0, 'a running task is not for Zen mode');
    await s.ev("document.getElementById('stat-tasks').classList.add('hidden')");
    await s.ev("document.getElementById('stat-recording').classList.remove('hidden')");
    await back('status-bar');
    await s.ev("document.getElementById('stat-recording').classList.add('hidden')");
    await away('status-bar');

    t.step('F6 shows the bar it goes into; Esc takes the focus back to the note and Zen mode stays; the next Esc leaves it');
    await s.ev("document.getElementById('editor').focus()");
    await s.key('F6');
    await s.waitFor("!!document.activeElement.closest('#header')");
    await back('header');
    assert.ok(await opacity('status-bar') < 0.05);
    assert.equal(await s.ev("document.body.classList.contains('zen-mode')"), true);
    await s.key('Escape');
    await s.waitFor("document.activeElement.id === 'editor'");
    await away('header');
    assert.equal(await s.ev("document.body.classList.contains('zen-mode')"), true, 'the first Esc was for the bar');
    assert.equal((await rpc(s, 'getUiState()')).ok.zen, true, 'ui.state.zen');
    await s.key('Escape');
    await s.waitFor("!document.body.classList.contains('zen-mode')");
    await back('header');
    await back('status-bar');
    assert.deepEqual(await s.ev("['editor', 'ghost-overlay', 'line-numbers'].map(function (id) { return getComputedStyle(document.getElementById(id)).paddingTop; })"), ['50px', '50px', '50px'], 'the room for the bars is back');
    assert.equal(await s.ev("getComputedStyle(document.getElementById('editor')).paddingLeft"), '14px');
    assert.equal(await overlay('listenerCount()'), 7, 'auto-hide listens again');

    t.step('the tool that sets it (ui.set_view { zen }) works both ways, and an ordinary message is shown again');
    await rpc(s, 'setUiState({ zen: true })');
    await s.waitFor("document.body.classList.contains('zen-mode')");
    await away('header');
    await rpc(s, 'setUiState({ zen: false })');
    await s.waitFor("!document.body.classList.contains('zen-mode')");
    await s.ev("window.showMessage('Visible again', 5000)");
    await s.waitFor("document.getElementById('stat-message').getBoundingClientRect().width > 50");
  }
};
