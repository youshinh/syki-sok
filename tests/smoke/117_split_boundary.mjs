// Settings > Appearance > "Divider between two pages" (v2 P4b: appearance.splitBoundary): dots (the default: no attribute on <body>), shade (the
// shadow alone) and line (a thin 5px divider) show at once while the dialog is open, Cancel puts the saved one back, Save keeps it (the
// settings sent to the backend and the copy the WebView keeps). Judged on the attribute, the measured pages and the computed style of the
// divider in a real browser: the three looks, the pages staying equal at half and half whatever the divider's width, the keys still moving
// the divider with each look, and beside a preview, where the divider is a grip and "line" adds only its hairline. Nothing persists across a
// page load in this harness, so "the next start" is covered by tests/appearance_roundtrip_test.mjs and the real app.
import { assert, click, focusEditor, lastSavedConfig, backendCalls, liveConfig, rpc, waitFocus, waitHidden, waitShown } from './lib.mjs';

const pick = (s, id, value) => s.ev(`(function () { var e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);

const attr = (s) => s.ev("document.body.getAttribute('data-boundary')");
// the divider as the page draws it, and the two pages
const look = (s) => s.ev(`(function () {
  var d = document.getElementById('pane-resizer'), cs = getComputedStyle(d), dots = getComputedStyle(d, '::before');
  var r = function (id) { return document.getElementById(id).getBoundingClientRect(); };
  var e = r('editor-pane'), p = r('secondary-pane'), x = d.getBoundingClientRect(), w = r('workspace');
  return { attr: document.body.getAttribute('data-boundary'), divider: x.width, left: e.width, right: p.width, whole: w.width,
    shade: cs.backgroundImage !== 'none', dots: dots.display !== 'none', borderLeft: parseFloat(cs.borderLeftWidth) };
})()`);

async function openSettings(s) {
  await s.key(',', { ctrl: true });
  await waitShown(s, 'settings-modal');
  await s.waitFor("document.getElementById('cfg-split-boundary').getBoundingClientRect().width > 0");
}

export default {
  title: 'settings > appearance > divider between two pages: dots / shade / line show at once, Cancel restores, Save keeps it, the pages stay equal and the keys keep working',
  session: { notes: [{ title: 'one.md', content: '# One\n\nthe first note\n' }, { title: 'two.md', content: '# Two\n\nthe second note\n' }] },
  timeoutMs: 60000,

  async run(s, t) {
    const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

    t.step('the page starts with the dots: no data-boundary, and two pages are split by a 24px gutter with its shadow and its dots');
    assert.equal(await attr(s), null, 'the default is no attribute at all');
    await focusEditor(s);
    await s.key('\\', { ctrl: true });
    await waitShown(s, 'secondary-pane');
    const gutter = await s.ev("parseFloat(getComputedStyle(document.body).getPropertyValue('--gutter-w'))");
    let v = await look(s);
    near(v.divider, gutter, 0.5, 'the dots gutter is --gutter-w wide');
    assert.ok(v.shade && v.dots, 'with its shadow and its dots');
    near(v.left, v.right, 1, 'the pages are equal');
    const dotsLeft = v.left;

    t.step('the control: three values in the Appearance section, the saved one selected');
    await openSettings(s);
    assert.deepEqual(await s.ev("Array.from(document.getElementById('cfg-split-boundary').options).map(function (o) { return o.value; })"), ['dots', 'shade', 'line']);
    assert.equal(await s.ev("document.getElementById('cfg-split-boundary').value"), 'dots');
    assert.equal(await s.ev("document.getElementById('cfg-split-boundary').closest('#pane-general') !== null"), true, 'it sits in the general pane with the other Appearance controls');
    const savesBefore = (await backendCalls(s, 'saveConfig')).length;

    t.step('shade: the shadow alone (no dots, same width); nothing is saved');
    assert.equal(await pick(s, 'cfg-split-boundary', 'shade'), 'shade');
    v = await look(s);
    assert.equal(v.attr, 'shade');
    near(v.divider, gutter, 0.5, 'as wide as the gutter');
    assert.ok(v.shade && !v.dots, 'the shadow stays, the dots go');
    near(v.left, v.right, 1, 'equal');
    assert.equal((await liveConfig(s)).appearance, undefined, 'a preview does not touch the config');
    assert.equal((await backendCalls(s, 'saveConfig')).length, savesBefore, 'nothing was saved');

    t.step('line: a thin 5px divider with a hairline, no shadow, no dots; the pages take the width the gutter gave up and are still equal');
    assert.equal(await pick(s, 'cfg-split-boundary', 'line'), 'line');
    await s.waitFor("document.getElementById('pane-resizer').getBoundingClientRect().width < 6");
    v = await look(s);
    assert.equal(v.attr, 'line');
    near(v.divider, 5, 0.5, 'the thin divider is 5px');
    assert.ok(!v.shade && !v.dots, 'neither a shadow nor dots');
    assert.equal(v.borderLeft, 1, 'a 1px line');
    near(v.left, v.right, 1, 'the pages are equal at half and half');
    assert.ok(v.left > dotsLeft + 8, 'and each page gave back about half of the 19px (' + dotsLeft + ' -> ' + v.left + ')');
    near(v.left + v.divider + v.right, v.whole, 1, 'the three fill the window');

    t.step('Cancel puts the dots back (the attribute goes), and the pages go back to their widths');
    await click(s, 'btn-cancel-settings');
    await waitHidden(s, 'settings-modal');
    assert.equal(await attr(s), null, 'Cancel took the attribute off');
    v = await look(s);
    near(v.divider, gutter, 0.5);
    assert.ok(v.shade && v.dots);
    near(v.left, dotsLeft, 1, 'the pages are as before');
    assert.equal((await backendCalls(s, 'saveConfig')).length, savesBefore, 'Cancel saved nothing');

    t.step('Escape also puts an unsaved preview back');
    await openSettings(s);
    assert.equal(await s.ev("document.getElementById('cfg-split-boundary').value"), 'dots', 'the dialog shows the saved look again, not the line that was cancelled');
    await pick(s, 'cfg-split-boundary', 'line');
    assert.equal(await attr(s), 'line');
    await s.key('Escape');
    await waitHidden(s, 'settings-modal');
    assert.equal(await attr(s), null, 'Escape put the dots back');

    t.step('Save keeps the thin line: the settings sent to the backend, the copy the WebView keeps, the live config, and the page');
    await openSettings(s);
    await pick(s, 'cfg-split-boundary', 'line');
    await click(s, 'btn-save-settings');
    await waitHidden(s, 'settings-modal');
    const saved = await lastSavedConfig(s);
    assert.ok(saved && saved.appearance, 'the settings sent to be saved carry appearance');
    assert.equal(saved.appearance.splitBoundary, 'line');
    assert.equal(saved.appearance.look, 'ink', 'the rest of the setting came along');
    const local = JSON.parse(await s.ev("localStorage.getItem('md_notepad_config_v3')"));
    assert.equal(local.appearance.splitBoundary, 'line', 'the copy the WebView keeps has it (it paints the next start)');
    assert.equal((await liveConfig(s)).appearance.splitBoundary, 'line');
    assert.equal(await attr(s), 'line');
    near((await look(s)).divider, 5, 0.5, 'and the divider is thin');

    t.step('the keys still move the divider when it is a line: F6 reaches it, an arrow gives 52 and the pages stay in step');
    await focusEditor(s);
    let reached = false;
    for (let i = 0; i < 6 && !reached; i++) {
      await s.key('F6');
      reached = await s.ev("document.activeElement && document.activeElement.id === 'pane-resizer'");
    }
    if (!reached) await waitFocus(s, 'pane-resizer');
    await s.key('ArrowRight');
    assert.equal(await s.ev("document.getElementById('pane-resizer').getAttribute('aria-valuenow')"), '52');
    v = await look(s);
    near(v.left / (v.whole - v.divider), 0.52, 0.002, 'the left page is 52% of what the divider leaves');
    await s.key('Enter');
    v = await look(s);
    near(v.left, v.right, 1, 'Enter: equal again, with a 5px divider too');

    t.step('beside a preview the divider is only a grip: "line" adds its hairline there and nothing else');
    assert.equal((await rpc(s, 'setUiState({ preview: "side" })')).ok.preview, 'side');
    await s.waitFor("document.body.dataset.view === 'side' && !document.getElementById('secondary-preview-pane').classList.contains('hidden')");
    const grip = await s.ev("parseFloat(getComputedStyle(document.body).getPropertyValue('--grip-w'))");
    v = await look(s);
    near(v.divider, grip, 0.5, 'a grip (the thin line does not widen it: only a pair does)');
    assert.equal(v.borderLeft, 1, 'with the hairline the setting asks for');
    assert.ok(!v.shade && !v.dots, 'no shadow, no dots beside a preview');
    near(v.left, v.right, 1, 'the pages are equal');

    t.step('back to the dots with Save: the attribute goes and the setting says dots');
    await openSettings(s);
    assert.equal(await s.ev("document.getElementById('cfg-split-boundary').value"), 'line', 'the dialog shows the saved look');
    await pick(s, 'cfg-split-boundary', 'dots');
    assert.equal(await attr(s), null, 'the preview of the dots takes the attribute off');
    await click(s, 'btn-save-settings');
    await waitHidden(s, 'settings-modal');
    assert.equal((await lastSavedConfig(s)).appearance.splitBoundary, 'dots');
    assert.equal(await attr(s), null);
    assert.equal((await rpc(s, 'setUiState({ preview: "off" })')).ok.preview, 'off');
    await s.waitFor("document.getElementById('secondary-pane').classList.contains('hidden')");
  }
};
