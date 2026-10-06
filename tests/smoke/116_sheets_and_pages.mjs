// The four displays in a real browser (v2 P4): one page, two editors, the editor with its preview beside it, the preview alone. Judged on the
// geometry the rules promise, not on a picture:
//   * the preview is a sheet of paper on a desk: centred and 800px wide at most, the whole height of the window, a shadow, no frame, the desk
//     (--wall) behind it; its first line starts below the header bar; the tag and the printer button stand on the sheet; the wheel over the desk
//     scrolls the sheet; an HTML note fills the window;
//   * beside the editor the sheet has the desk's margin on both sides and the height of the page, the right page's name band floats under the
//     header bar and holds the printer button, and the first lines of both pages clear it;
//   * two editors: the same room at the top for both, the band, the strip of tabs under the band, the accent line on the page that has the
//     keyboard (and on that one only), a gutter with a shadow and dots;
//   * a narrow window has the narrower gutter and desk; forced colours draw lines instead of tints and shadows; on the paper look the
//     sheet is the paper colour.
import { assert, click, rpc, waitShown } from './lib.mjs';

const para = (n) => `Paragraph ${n}: ` + 'some words that make a line of text, '.repeat(6) + '\n\n';
const NOTE = '# The title\n\n' + Array.from({ length: 70 }, (_, i) => para(i + 1)).join('');
const HTML = '<!doctype html><html><body><h1>A web page</h1><p>It scrolls by itself.</p></body></html>';
const q = (x) => JSON.stringify(x);

const rect = (s, sel) => s.ev(`(function () { var e = document.querySelector(${q(sel)}); if (!e) return null; var r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
const css = (s, sel, prop, pseudo) => s.ev(`getComputedStyle(document.querySelector(${q(sel)}), ${pseudo ? q(pseudo) : 'null'})[${q(prop)}]`);
// what a token is worth now (a colour as the browser resolves it)
const token = (s, name) => s.ev(`(function () { var d = document.createElement('div'); d.style.background = 'var(${name})'; document.body.appendChild(d); var c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);
const setView = async (s, spec, view) => {
  await rpc(s, `setUiState(${JSON.stringify(spec)})`);
  await s.waitFor(`document.body.dataset.view === ${q(view)}`);
};

export default {
  title: 'the four displays: a sheet on a desk (alone and beside the editor), the right page\'s band, equal room at the top, the accent line of the focused page, the narrow window, forced colours, the paper look',
  session: { notes: [{ title: 'long.md', content: NOTE }, { title: 'second.md', content: '# Second\n\nthe second note\n' }, { title: 'page.html', content: HTML }] },
  timeoutMs: 90000,

  async run(s, t) {
    const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
    const W = s.viewport.w, H = s.viewport.h;
    const ids = (await s.state()).tabs.map((x) => x.id);
    const longId = ids[0];
    const wall = await token(s, '--wall'), sheet = await token(s, '--sheet'), page = await token(s, '--page');
    const deskMargin = await s.ev("parseFloat(getComputedStyle(document.body).getPropertyValue('--desk-margin'))");
    assert.equal(deskMargin, 34, 'the desk\'s margin is 34px (a window wider than 900px)');

    t.step('one page: the display says so, and the page is the page colour');
    assert.equal(await s.ev('document.body.dataset.view'), 'page');
    assert.equal(await css(s, '#editor-pane', 'backgroundColor'), page);
    assert.equal(await css(s, '#workspace', 'backgroundColor'), 'rgba(0, 0, 0, 0)', 'no desk behind a page');

    // a wheel listener makes every wheel event go to the main thread (a hit test of the whole tree: 6 ms in the preview of a long note), so the page
    // has one only while the pointer is over the desk. The DevTools protocol can list a node's listeners: ask it, not the app.
    const wheelListeners = async () => {
      const { result } = await s.page.cdp.send('Runtime.evaluate', { expression: "document.getElementById('workspace')" });
      const { listeners } = await s.page.cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      return listeners.filter((l) => l.type === 'wheel').length;
    };
    const point = (x, y) => s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse' });
    const wheel = async (x, y, dy) => {
      await point(x, y);
      await s.page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse' });
    };

    t.step('the preview alone: a sheet, centred, 800px at most, the whole height, with a shadow, no frame, on the desk');
    assert.equal((await rpc(s, `switchTab(${q(longId)})`)).ok !== undefined, true);
    await point(W / 2, 20); // the pointer rests on the header bar, not on the desk
    assert.equal(await wheelListeners(), 0, 'on one page the page listens to no wheel');
    await setView(s, { preview: 'full' }, 'preview');
    await s.waitFor("document.querySelector('#preview-pane h1') && !!document.querySelector('#preview-pane h1').textContent");
    assert.equal(await wheelListeners(), 0, 'and the display that has a desk opens without a wheel listener too: the pointer is not on the desk yet');
    const sh = await rect(s, '#preview-pane');
    near(sh.w, Math.min(800, W - 68), 1, 'the sheet is --sheet-max wide');
    near(sh.l, W - sh.r, 1, 'and centred: the desk is as wide on both sides');
    near(sh.t, 0, 0.5, 'the sheet starts at the top of the window (the text scrolls under the header bar)');
    near(sh.b, H, 0.5, 'and runs to the bottom');
    assert.equal(await css(s, '#preview-pane', 'backgroundColor'), sheet);
    assert.equal(await css(s, '#workspace', 'backgroundColor'), wall, 'on the desk');
    assert.notEqual(await css(s, '#preview-pane', 'boxShadow'), 'none', 'with a shadow');
    assert.equal(await css(s, '#preview-pane', 'borderTopWidth'), '0px', 'and no frame');
    const h1 = await rect(s, '#preview-pane h1');
    assert.ok(h1.t >= 38, `the first line starts below the header bar: ${h1.t}`);
    assert.equal(await s.ev("document.getElementById('preview-pane').parentElement.id"), 'workspace', 'the sheet is the preview box itself, a direct child of the workspace');
    const bar = (id) => s.ev(`(function () { var e = document.getElementById(${q(id)}); return e.offsetWidth - e.clientWidth; })()`);
    const nativeBar = await s.ev("(function () { var p = document.createElement('div'); p.style.cssText = 'position:absolute;visibility:hidden;width:100px;height:100px;overflow:scroll'; document.body.appendChild(p); var w = p.offsetWidth - p.clientWidth; p.remove(); return w; })()");
    const sheetBar = await bar('preview-pane');
    assert.ok(sheetBar > 0 && sheetBar < nativeBar, `its scrollbar is the thin one (${sheetBar}px against the ${nativeBar}px of a box that is not a sheet), at the sheet's right edge`);

    t.step('the tag and the printer button stand on the sheet, at its top right, below the header bar');
    const badge = await rect(s, '#preview-badge'), pr = await rect(s, '#btn-preview-print');
    near(sh.r - badge.r, 24, 1.5, 'the tag is 24px in from the sheet\'s right edge');
    assert.ok(pr.r <= badge.l && pr.l > sh.l, 'the printer button is left of the tag, on the sheet');
    assert.ok(badge.t >= 38 && pr.t >= 38, 'both below the header bar');

    t.step('the wheel over the desk scrolls the sheet; over the sheet it scrolls too; and there is a wheel listener on the page only while the pointer is over the desk');
    await s.ev("document.getElementById('preview-pane').scrollTop = 0");
    await point(W / 2, 300);
    assert.equal(await wheelListeners(), 0, 'no wheel listener while the pointer is over the sheet');
    await point(20, 300);
    assert.equal(await wheelListeners(), 1, 'one while it is over the desk');
    await point(W / 2, 300);
    assert.equal(await wheelListeners(), 0, 'and none again once it is back over the sheet');
    await wheel(20, 300, 200);
    await s.waitFor("document.getElementById('preview-pane').scrollTop >= 150");
    const afterDesk = await s.ev("document.getElementById('preview-pane').scrollTop");
    near(afterDesk, 200, 1, 'a wheel of 200 over the desk moved the sheet by 200');
    await wheel(W / 2, 300, 200);
    await s.waitFor(`document.getElementById('preview-pane').scrollTop > ${afterDesk + 100}`);

    t.step('an HTML note is a page of its own: it fills the window, no desk, no shadow, no tag');
    await setView(s, { preview: 'off' }, 'page');
    assert.equal((await rpc(s, `switchTab(${q(ids[2])})`)).ok !== undefined, true);
    await setView(s, { preview: 'full' }, 'preview');
    await s.waitFor("document.getElementById('preview-pane').classList.contains('html-mode')");
    const hp = await rect(s, '#preview-pane');
    near(hp.w, W, 1, 'the page is as wide as the window');
    assert.equal(await css(s, '#preview-pane', 'boxShadow'), 'none');
    assert.equal(await css(s, '#preview-badge', 'display'), 'none');
    await setView(s, { preview: 'off' }, 'page');
    assert.equal((await rpc(s, `switchTab(${q(longId)})`)).ok !== undefined, true);

    t.step('the preview beside the editor: the desk\'s margin on both sides, the height of the page, the editor on the page colour');
    await setView(s, { preview: 'side' }, 'side');
    await s.waitFor("document.querySelector('#secondary-preview-pane h1') && !!document.querySelector('#secondary-preview-pane h1').textContent");
    const pane = await rect(s, '#secondary-pane'), sheetSide = await rect(s, '#secondary-preview-pane');
    near(sheetSide.l - pane.l, deskMargin, 1, 'the desk\'s margin on the left of the sheet');
    near(pane.r - sheetSide.r, deskMargin, 1, 'and on its right');
    near(sheetSide.t, pane.t, 0.5, 'the sheet starts at the top of the page');
    near(sheetSide.b, pane.b, 0.5, 'and runs to the bottom');
    assert.equal(await css(s, '#secondary-preview-pane', 'backgroundColor'), sheet);
    assert.notEqual(await css(s, '#secondary-preview-pane', 'boxShadow'), 'none');
    assert.equal(await css(s, '#workspace', 'backgroundColor'), wall, 'the desk is behind both the grip and the margins');
    assert.equal(await css(s, '#secondary-pane', 'backgroundColor'), 'rgba(0, 0, 0, 0)', 'the right page lets it show');
    assert.equal(await css(s, '#editor-pane', 'backgroundColor'), page, 'the editor stays on the page colour');
    assert.equal(await bar('secondary-preview-pane'), sheetBar, 'the sheet beside the editor has the same thin scrollbar');

    t.step('the right page\'s band floats under the header bar, holds the printer button, and the first lines of both pages clear it');
    const band = await rect(s, '#secondary-pane-header'), btn = await rect(s, '#btn-secondary-print');
    near(band.t, 38, 0.5, 'the band is under the header bar');
    near(band.h, 28, 0.5, 'and 28px high');
    assert.ok(btn.l >= band.l - 0.5 && btn.r <= band.r + 0.5 && btn.t >= band.t - 0.5 && btn.b <= band.b + 0.5, 'the printer button is inside it');
    assert.ok(band.r < sheetSide.r - 10, 'left of the sheet\'s scrollbar');
    const sh1 = await rect(s, '#secondary-preview-pane h1');
    assert.ok(sh1.t >= band.b, `the sheet\'s first line clears the band: ${sh1.t} vs ${band.b}`);
    assert.equal(await css(s, '#editor', 'paddingTop'), '78px', 'the editor keeps 38 + 12 + 28px at its top: its first line clears the band too');
    assert.equal(await css(s, '#secondary-preview-pane', 'paddingTop'), '90px', 'the sheet 38 + 24 + 28px');

    t.step('the page that has the keyboard has a 2px accent line along its top edge (the editor beside a preview), and the sheet\'s side does not');
    const line = async (sel) => ({ content: await css(s, sel, 'content', '::before'), h: await css(s, sel, 'height', '::before'), top: await css(s, sel, 'top', '::before') });
    let l1 = await line('#editor-pane'), l2 = await line('#secondary-pane');
    assert.ok(l1.content !== 'none' && l1.h === '2px' && l1.top === '0px', `the editor's line: ${JSON.stringify(l1)}`);
    assert.equal(l2.content, 'none', 'and none on the other page');

    t.step('the wheel over the desk beside the sheet scrolls the sheet; over the editor it does not');
    await s.ev("document.getElementById('secondary-preview-pane').scrollTop = 0");
    await point(pane.r - 10, 300);
    assert.equal(await wheelListeners(), 1, 'the desk beside the sheet has the wheel listener on while the pointer is there');
    await wheel(pane.r - 10, 300, 150);
    await s.waitFor("document.getElementById('secondary-preview-pane').scrollTop >= 100");
    await point(300, 300);
    assert.equal(await wheelListeners(), 0, 'and over the editor beside it there is none: the browser alone has its wheel');
    await s.ev("document.getElementById('editor').scrollTop = 0; 1");
    await wheel(300, 300, 100);
    await s.waitFor("document.getElementById('editor').scrollTop > 0");

    t.step('two editors: both pages keep the same room at the top, the strip of the right page starts under the band, the line is on the focused page only');
    await setView(s, { preview: 'off' }, 'page');
    await setView(s, { split: true }, 'pair');
    await waitShown(s, 'secondary-pane');
    const pads = await s.ev("['editor', 'ghost-overlay', 'line-numbers', 'editor-secondary', 'secondary-line-numbers'].map(function (id) { return getComputedStyle(document.getElementById(id)).paddingTop; })");
    assert.deepEqual(pads, Array(5).fill('78px'), 'the first lines of the two pages are level');
    const band2 = await rect(s, '#secondary-pane-header'), strip = await rect(s, '#tab-index-right');
    near(band2.t, 38, 0.5, 'the band');
    near(strip.t, band2.b, 1, 'the right strip starts where the band ends');
    assert.ok(parseFloat(await css(s, '#editor-secondary', 'paddingRight')) >= 27, 'the right text keeps off the strip, which a page without a scrollbar has nothing to hold back');
    l1 = await line('#editor-pane'); l2 = await line('#secondary-pane');
    assert.equal(l2.h, '2px', 'the right page has the keyboard (opening a split puts it there) and the line');
    assert.equal(l1.content, 'none', 'the left page has none');
    await s.page.click(300, 400);
    await s.waitFor("document.getElementById('editor-pane').classList.contains('pane-focused')");
    l1 = await line('#editor-pane'); l2 = await line('#secondary-pane');
    assert.equal(l1.h, '2px', 'a click in the left page moves the line there');
    assert.equal(l2.content, 'none');

    t.step('the gutter: a shadow across its middle and dots, no border, as wide as --gutter-w; nothing animates in it');
    const g = await rect(s, '#pane-resizer');
    near(g.w, 24, 0.5, 'the gutter');
    assert.ok(/linear-gradient/.test(await css(s, '#pane-resizer', 'backgroundImage')), 'a shadow across its middle');
    assert.ok(/radial-gradient/.test(await css(s, '#pane-resizer', 'backgroundImage', '::before')), 'and dots');
    assert.equal(await css(s, '#pane-resizer', 'borderLeftWidth'), '0px', 'no line');
    assert.ok(/linear-gradient/.test(await s.ev("(function () { var c = getComputedStyle(document.getElementById('pane-resizer'), '::before'); return c.webkitMaskImage || c.maskImage; })()")), 'the dots fade towards both sides');

    t.step('<body data-boundary>: the shadow alone has no dots, the thin line is 5px with a hairline');
    await s.ev("document.body.setAttribute('data-boundary', 'shade'); 1");
    assert.equal(await css(s, '#pane-resizer', 'display', '::before'), 'none');
    near((await rect(s, '#pane-resizer')).w, 24, 0.5, 'still a gutter');
    await s.ev("document.body.setAttribute('data-boundary', 'line'); 1");
    near((await rect(s, '#pane-resizer')).w, 5, 0.5, 'the thin look is 5px');
    assert.equal(await css(s, '#pane-resizer', 'borderLeftWidth'), '1px');
    assert.equal(await css(s, '#pane-resizer', 'backgroundImage'), 'none');
    const pe = await rect(s, '#editor-pane'), ps = await rect(s, '#secondary-pane');
    near(pe.w, ps.w, 1, 'and the pages are still equal');
    await s.ev("document.body.removeAttribute('data-boundary'); 1");

    t.step('a narrow window (600px): a 12px gutter, a 12px desk beside a sheet, and the pages still equal');
    const cdp = s.page.cdp;
    const resize = (w) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: H, deviceScaleFactor: 1, mobile: false });
    await resize(600);
    try {
      await s.waitFor("parseFloat(getComputedStyle(document.body).getPropertyValue('--gutter-w')) === 12");
      const gn = await rect(s, '#pane-resizer'), en = await rect(s, '#editor-pane'), sn = await rect(s, '#secondary-pane');
      near(gn.w, 12, 0.5, 'the gutter');
      near(en.w, sn.w, 1, 'equal pages');
      assert.ok(en.w >= 150 && sn.w >= 150, 'neither page is under 150px');
      await setView(s, { preview: 'side' }, 'side');
      const pn = await rect(s, '#secondary-pane'), sn2 = await rect(s, '#secondary-preview-pane');
      near(sn2.l - pn.l, 12, 1, 'the desk beside the sheet');
      near(pn.r - sn2.r, 12, 1);
      await setView(s, { preview: 'full' }, 'preview');
      const fn = await rect(s, '#preview-pane');
      near(fn.l, 12, 1, 'the preview alone fills the window less the desk');
      near(600 - fn.r, 12, 1);
    } finally {
      await resize(W);
    }

    t.step('forced colours: the divider is a line, a sheet has a border instead of a shadow, the desk and the sheet are both Canvas');
    await setView(s, { preview: 'side' }, 'side');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    try {
      await s.waitFor("matchMedia('(forced-colors: active)').matches");
      assert.equal(await css(s, '#secondary-preview-pane', 'borderLeftWidth'), '1px', 'the sheet has a border');
      assert.equal(await css(s, '#secondary-preview-pane', 'boxShadow'), 'none');
      assert.equal(await css(s, '#pane-resizer', 'borderLeftWidth'), '1px', 'the divider is a line');
      assert.equal(await css(s, '#pane-resizer', 'display', '::after'), 'none', 'with no accent line (the outline of the focus replaces it)');
      assert.equal(await css(s, '#workspace', 'backgroundColor'), await css(s, '#secondary-preview-pane', 'backgroundColor'), 'desk and sheet are the same Canvas: the lines tell them apart');
    } finally {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    }

    t.step('the paper look: the sheet is the paper colour, whiter than the page, on a warm desk');
    await s.ev("window.Appearance.apply(document, { look: 'paper', accent: 'olive', bars: 'light', autoHide: true }); 1");
    await s.waitFor("document.body.classList.contains('look-paper')");
    const paperSheet = await token(s, '--sheet'), paperPage = await token(s, '--page'), paperWall = await token(s, '--wall');
    assert.equal(await css(s, '#secondary-preview-pane', 'backgroundColor'), paperSheet);
    assert.equal(paperSheet, 'rgb(255, 255, 255)');
    assert.notEqual(paperSheet, paperPage);
    assert.equal(await css(s, '#workspace', 'backgroundColor'), paperWall);
    assert.notEqual(await css(s, '#secondary-preview-pane', 'boxShadow'), 'none');
    await setView(s, { preview: 'off' }, 'page');
    await s.ev("window.Appearance.apply(document, { look: 'ink', accent: 'olive', bars: 'light', autoHide: true }); 1");
  }
};
