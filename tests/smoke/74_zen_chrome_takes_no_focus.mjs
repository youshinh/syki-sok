// The header and the status bar and the keyboard (accessibility session C13-03).
//   * The permanent Zen mode used to hide them with zero height and zero opacity; Tab walked through the buttons in them and Enter on
//     "Autosave" there switched the setting off with nothing on screen to show it. The rule that came out of it: whatever is out of
//     sight must not change anything silently. v2 keeps the bars in the reading order (opacity only) and makes the bar that gets the
//     focus SHOW (:focus-within), in Zen mode too; Esc takes the focus back to the note and the bar goes again.
//   * The auto-hide while writing (v2: body.chrome-faded) only fades them: a faded bar is still in the reading order and takes Tab, and the
//     moment the focus is in it, it shows. (It replaces the old typing dimmer; the check is the same one: what is merely faint stays reachable.)
import { assert } from './lib.mjs';

const IN_CHROME = `(function () { var a = document.activeElement; return !!a && !!a.closest && !!a.closest('#header, #status-bar'); })()`;
const blurAll = `(function () { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return document.activeElement === document.body; })()`;
const vis = (id) => `getComputedStyle(document.getElementById('${id}')).visibility`;
const opacity = (id) => `parseFloat(getComputedStyle(document.getElementById('${id}')).opacity)`;

// Presses Tab (or Shift+Tab) up to `max` times from the page body and says whether focus ever landed in the header / status bar.
async function walkReachesChrome(s, max, shift) {
  assert.ok(await s.ev(blurAll), 'focus starts on the page body');
  const trail = [];
  for (let i = 0; i < max; i++) {
    await s.key('Tab', shift ? { shift: true } : {});
    trail.push(await s.ev(`(function () { var a = document.activeElement; return a ? a.tagName + (a.id ? '#' + a.id : '') : 'nothing'; })()`));
    if (await s.ev(IN_CHROME)) return { reached: true, trail };
  }
  return { reached: false, trail };
}

export default {
  title: 'chrome and the keyboard: the bars faded by writing or by Zen mode still take focus, and show when they have it',
  session: { notes: [{ title: 'a.md', content: 'text\n' }] },
  timeoutMs: 90000,

  async run(s, t) {
    t.step('baseline: without Zen mode, Tab does reach the chrome (so the later check is not vacuous)');
    const baseline = await walkReachesChrome(s, 40, false);
    assert.ok(baseline.reached, `Tab never reached the header or the status bar in 40 presses: ${baseline.trail.join(' > ')}`);

    t.step('typing fades the chrome (chrome-faded) but it stays visible to the reading order, focusable, and shows when the focus is in it');
    await s.ev(`document.getElementById('editor').focus()`);
    await s.type('x');
    await s.waitFor(`document.body.classList.contains('chrome-faded')`);
    await s.waitFor(`${opacity('status-bar')} < 0.05 && ${opacity('header')} < 0.05`);
    assert.equal(await s.ev(vis('status-bar')), 'visible', 'the faded status bar is still visible to the accessibility tree and Tab');
    assert.equal(await s.ev(vis('header')), 'visible');
    await s.ev(`document.getElementById('stat-autosave').focus()`);
    assert.equal(await s.ev('document.activeElement.id'), 'stat-autosave', 'a faded control still takes focus');
    await s.waitFor(`!document.body.classList.contains('chrome-faded') && ${opacity('status-bar')} > 0.95 && ${opacity('header')} > 0.95`); // the focus left the note: the bars return
    // The bars faded while the focus is not in the note (the page was scrolled, say): the bar that gets the focus shows, the other stays away
    await s.ev(`(function () { document.activeElement.blur(); window.ChromeOverlay.current.away(); return 1; })()`);
    await s.waitFor(`document.body.classList.contains('chrome-faded') && ${opacity('header')} < 0.05 && ${opacity('status-bar')} < 0.05`);
    await s.ev(`document.getElementById('btn-find').focus()`);
    await s.waitFor(`${opacity('header')} > 0.95`);
    assert.ok(await s.ev(opacity('status-bar')) < 0.05, 'only the bar the focus is in comes back (:focus-within)');
    assert.equal(await s.ev(`document.body.classList.contains('chrome-faded')`), true);
    // Tab walks into the faded chrome from the page body, and the bar shows on arrival
    await s.ev(`document.body.focus && document.activeElement && document.activeElement.blur()`);
    await s.ev(`window.ChromeOverlay.current.away()`);
    await s.waitFor(`${opacity('header')} < 0.05 && ${opacity('status-bar')} < 0.05`);
    const faded = await walkReachesChrome(s, 40, false);
    assert.ok(faded.reached, `Tab did not reach the faded chrome: ${faded.trail.join(' > ')}`);
    await s.waitFor(`${opacity('header')} > 0.95 || ${opacity('status-bar')} > 0.95`);

    t.step('Shift+F11: Zen mode keeps the bars away; a control that takes the focus shows its bar, so nothing changes out of sight');
    await s.ev(`document.getElementById('editor').focus()`);
    await s.key('F11', { shift: true });
    await s.waitFor(`document.body.classList.contains('zen-mode')`);
    await s.waitFor(`${opacity('header')} < 0.05 && ${opacity('status-bar')} < 0.05`);
    assert.equal(await s.ev(vis('header')), 'visible', 'in Zen mode the bars are still in the reading order');
    assert.equal(await s.ev(vis('status-bar')), 'visible');
    await s.ev(`document.getElementById('stat-autosave').focus()`);
    assert.equal(await s.ev('document.activeElement.id'), 'stat-autosave', 'a control in the away status bar takes the focus...');
    await s.waitFor(`${opacity('status-bar')} > 0.95`);
    assert.ok(await s.ev(opacity('header')) < 0.05, '...and its bar shows, only that one');
    assert.equal(await s.ev(`document.body.classList.contains('zen-mode')`), true, 'still Zen mode');
    await s.key('Escape');
    await s.waitFor(`document.activeElement.id === 'editor'`);
    await s.waitFor(`${opacity('status-bar')} < 0.05`);
    assert.equal(await s.ev(`document.body.classList.contains('zen-mode')`), true, 'the first Esc takes the focus out of the bar and does not leave Zen mode');
    const forward = await walkReachesChrome(s, 40, false);
    assert.ok(forward.reached, `Tab did not reach the away chrome in Zen mode: ${forward.trail.join(' > ')}`);
    await s.waitFor(`${opacity('header')} > 0.95 || ${opacity('status-bar')} > 0.95`);

    t.step('Shift+F11 again: out of Zen mode the bars are back at once and reachable');
    await s.ev(`document.getElementById('editor').focus()`);
    await s.key('F11', { shift: true });
    await s.waitFor(`!document.body.classList.contains('zen-mode')`);
    await s.waitFor(`${opacity('header')} > 0.95 && ${opacity('status-bar')} > 0.95`);
    assert.equal(await s.ev(vis('status-bar')), 'visible');
    assert.equal(await s.ev(vis('header')), 'visible');
    await s.ev(`document.getElementById('stat-autosave').focus()`);
    assert.equal(await s.ev('document.activeElement.id'), 'stat-autosave', 'out of Zen mode the control takes focus again');
  },
};
