// The divider between two pages (v2 P4): a separator that F6 reaches (Tab is the editors') and the arrow keys move, as well as the mouse. It had no keyboard
// operation at all before. The pages are measured in a real browser: at half and half they are EQUAL (the left page leaves out the divider's
// own 24px, so "50:50" is not a left page of half the window), the keys give the ratios the module computes, a key during the editor's work
// is not taken by the divider, a drag follows the pointer, the double click and Enter go back to half and half, and beside a preview the
// divider is only a 6px grip with the pages still equal.
import { assert, focusEditor, rpc, waitFocus, waitShown } from './lib.mjs';

const NOTE = '# One\n\nthe first note\n';
const widths = (s) => s.ev(`(function () {
  var r = function (id) { return document.getElementById(id).getBoundingClientRect(); };
  var e = r('editor-pane'), d = r('pane-resizer'), p = r('secondary-pane'), w = r('workspace');
  return { left: e.width, divider: d.width, right: p.width, whole: w.width, dividerLeft: d.left };
})()`);
// the editors keep Tab for indenting, so the keyboard gets to the divider with F6 (the note -> the header -> the strips -> the divider -> the status bar)
async function f6ToDivider(s) {
  await focusEditor(s);
  for (let i = 0; i < 6; i++) {
    await s.key('F6');
    if (await s.ev("document.activeElement && document.activeElement.id === 'pane-resizer'")) return;
  }
  await waitFocus(s, 'pane-resizer');
}
const valuenow = (s) => s.ev("document.getElementById('pane-resizer').getAttribute('aria-valuenow')");

export default {
  title: 'the divider between two pages: F6 reaches it, arrows / Home / End / Enter move it, pages are equal at half and half, the mouse drags it, double click resets, a grip beside a preview',
  session: { notes: [{ title: 'one.md', content: NOTE }, { title: 'two.md', content: '# Two\n\nthe second note\n' }] },
  timeoutMs: 60000,

  async run(s, t) {
    const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

    t.step('on one page there is no divider; it is a vertical separator with its range in the page');
    assert.equal(await s.ev("getComputedStyle(document.getElementById('pane-resizer')).display"), 'none');
    assert.deepEqual(await s.ev("['role', 'aria-orientation', 'tabindex', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map(function (a) { return document.getElementById('pane-resizer').getAttribute(a); })"), ['separator', 'vertical', '0', '15', '85', '50']);
    assert.ok(/\S/.test(await s.ev("document.getElementById('pane-resizer').title")), 'and a name (its tooltip)');

    t.step('two editors: the gutter is --gutter-w wide and the two pages are the same width');
    await focusEditor(s);
    await s.key('\\', { ctrl: true });
    await waitShown(s, 'secondary-pane');
    let w = await widths(s);
    const gutter = await s.ev("parseFloat(getComputedStyle(document.body).getPropertyValue('--gutter-w'))");
    near(w.divider, gutter, 0.5, 'the divider is as wide as --gutter-w');
    assert.ok(w.divider > 10, 'a gutter, not a hairline');
    near(w.left, w.right, 1, 'the pages are equal at half and half');
    near(w.left + w.divider + w.right, w.whole, 1, 'and the three fill the window');

    t.step('F6 from the editor reaches the divider (Tab belongs to the editor: it indents), and the divider shows its accent line');
    await f6ToDivider(s);
    await s.waitFor("getComputedStyle(document.getElementById('pane-resizer'), '::after').opacity === '1'"); // (it fades in over 0.15 s)

    t.step('ArrowRight / ArrowLeft: two points, Shift ten; aria-valuenow follows and the pages move');
    await s.key('ArrowRight');
    assert.equal(await valuenow(s), '52');
    let w2 = await widths(s);
    near(w2.left / (w2.whole - w2.divider), 0.52, 0.002, 'the left page is 52% of what the divider leaves');
    assert.ok(w2.left > w.left && w2.right < w.right, 'and the right page gave way');
    await s.key('ArrowLeft', { shift: true });
    assert.equal(await valuenow(s), '42');
    w2 = await widths(s);
    near(w2.left / (w2.whole - w2.divider), 0.42, 0.002, 'ten points to the left');

    t.step('Home / End: the narrowest and the widest left page, and they stop there');
    await s.key('Home');
    assert.equal(await valuenow(s), '15');
    w2 = await widths(s);
    near(w2.left / (w2.whole - w2.divider), 0.15, 0.002, 'Home: 15%');
    await s.key('ArrowLeft', { shift: true });
    assert.equal(await valuenow(s), '15', 'no further');
    await s.key('End');
    assert.equal(await valuenow(s), '85');
    w2 = await widths(s);
    near(w2.left / (w2.whole - w2.divider), 0.85, 0.002, 'End: 85%');

    t.step('Enter: back to half and half; the keys belong to the divider (the note is untouched, the focus stays)');
    await s.key('Enter');
    assert.equal(await valuenow(s), '50');
    w2 = await widths(s);
    near(w2.left, w2.right, 1, 'equal again');
    await s.key('a');
    await s.key('ArrowUp');
    assert.equal(await s.ev("document.getElementById('editor').value"), NOTE, 'a letter typed on the divider goes nowhere');
    assert.equal(await s.ev('document.activeElement.id'), 'pane-resizer');
    await s.key('Escape');
    await s.waitFor("document.activeElement && (document.activeElement.id === 'editor' || document.activeElement.id === 'editor-secondary')");
    await f6ToDivider(s);

    t.step('the mouse: pick the divider up and drag it 120px to the right; the left page follows the pointer exactly');
    const before = await widths(s);
    const x = before.dividerLeft + before.divider / 2, y = 300;
    const mouse = (type, px, buttons) => s.page.cdp.send('Input.dispatchMouseEvent', { type, x: px, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' });
    await mouse('mouseMoved', x, 0);
    await mouse('mousePressed', x, 1);
    for (let i = 1; i <= 12; i++) await mouse('mouseMoved', x + i * 10, 1);
    await mouse('mouseReleased', x + 120, 0);
    const dragged = await widths(s);
    near(dragged.left, before.left + 120, 1.5, 'the left page grew by the distance dragged');
    near(dragged.left + dragged.divider + dragged.right, dragged.whole, 1, 'and the pages still fill the window');
    assert.ok(Number(await valuenow(s)) > 55, 'aria-valuenow follows the mouse as well: ' + (await valuenow(s)));
    // a drag out of the window stops at 85%
    await mouse('mouseMoved', x + 120, 0);
    await mouse('mousePressed', x + 120, 1);
    await mouse('mouseMoved', 5000, 1);
    await mouse('mouseReleased', 5000, 0);
    assert.equal(await valuenow(s), '85', 'and cannot go further than 85%');

    t.step('the double click goes back to half and half');
    const c = await widths(s);
    const cx = c.dividerLeft + c.divider / 2;
    for (const n of [1, 2]) {
      await mouse('mouseMoved', cx, 0);
      await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y, button: 'left', buttons: 1, clickCount: n, pointerType: 'mouse' });
      await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y, button: 'left', buttons: 0, clickCount: n, pointerType: 'mouse' });
    }
    await s.waitFor("document.getElementById('pane-resizer').getAttribute('aria-valuenow') === '50'");
    w2 = await widths(s);
    near(w2.left, w2.right, 1, 'equal after the double click');

    t.step('the preview beside the editor: the divider is only a grip, 6px, invisible, and the pages are still equal');
    assert.equal((await rpc(s, 'setUiState({ preview: "side" })')).ok.preview, 'side');
    await s.waitFor("document.body.dataset.view === 'side' && !document.getElementById('secondary-preview-pane').classList.contains('hidden')");
    w = await widths(s);
    const grip = await s.ev("parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grip-w')) || parseFloat(getComputedStyle(document.body).getPropertyValue('--grip-w'))");
    near(w.divider, grip, 0.5, 'the grip is --grip-w wide');
    assert.ok(w.divider < 10, 'and thin');
    near(w.left, w.right, 1, 'equal');
    assert.equal(await s.ev("getComputedStyle(document.getElementById('pane-resizer')).backgroundImage"), 'none', 'and has no look of its own: the step between the page and the desk is the divider');
    await f6ToDivider(s);
    await s.key('ArrowRight');
    assert.equal(await valuenow(s), '52', 'the keys work beside a preview too');
    w = await widths(s);
    near(w.left / (w.whole - w.divider), 0.52, 0.002, 'and move the pages');
    assert.equal((await rpc(s, 'setUiState({ preview: "off" })')).ok.preview, 'off');
    await s.waitFor("document.getElementById('secondary-pane').classList.contains('hidden')");
    assert.equal(await s.ev("getComputedStyle(document.getElementById('pane-resizer')).display"), 'none', 'closed with the second page');
  }
};
