// Where the floating panels stand now that the header and the status bar float over the text (v2 P5, docs/design/panel-template.md):
//   * the ask / rewrite bar and the command bar are 16px under the header bar, centred on the window, 560px wide (the window less 32px when it is narrower);
//     for a target at the very top of the note they go to the bottom edge, 16px above the status bar; the bar's own `top` decides that, not a literal;
//   * the palette and the notes search are 53px from the top of the window (15px under the header bar), centred;
//   * the Quick Actions panel is a child of the workspace like the bars, centred on the WINDOW (with two pages open too, whichever page has the keyboard),
//     16px above the status bar, and it does not move into an editor's box when it opens;
//   * the AI popover opens upwards from its item, just above the status bar;
//   * in a narrow window every panel keeps 16px at both sides.
// Judged on the geometry the rules promise, not on a picture.
import { assert, openAsk, openPalette, selectInEditor, waitFocus, waitHidden, waitShown } from './lib.mjs';

const LONG = '# Title\n\n' + Array.from({ length: 60 }, (_, i) => `line ${i + 1} of a long note that has some words in it`).join('\n') + '\n';
const q = (x) => JSON.stringify(x);
const rect = (s, sel) => s.ev(`(function () { var e = document.querySelector(${q(sel)}); if (!e) return null; var r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
// a panel that fades in slides 4px for 120ms: measure it once it has stopped
const still = (s, sel) => s.waitFor(`(function () { var e = document.querySelector(${q(sel)}); return !!e && e.getAnimations().length === 0; })()`);
const STUBS = `window.backend.jevPredict = function () { return Promise.resolve({ candidates: [
  { command: 'wc -l', action_type: 'sh', label: 'count', confidence: 0.9 },
  { command: 'date', action_type: 'sh', label: 'date', confidence: 0.5 } ] }); };`;

export default {
  title: 'panel places: the bars 16px under the header bar (or 16px above the status bar for a target at the top), the palette and the search at 53px, the Quick Actions panel in the workspace and centred on the window, the AI popover above the status bar, 16px at both sides when narrow',
  session: { notes: [{ title: 'long.md', content: LONG }, { title: 'two.md', content: '# Two\n\nthe second note\n' }] },
  timeoutMs: 90000,

  async run(s, t) {
    const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
    const W = s.viewport.w, H = s.viewport.h;
    const cdp = s.page.cdp;
    const head = await rect(s, '#header'), foot = await rect(s, '#status-bar');
    near(head.t, 0, 0.5, 'the header bar is at the top of the window');
    near(foot.b, H, 0.5, 'and the status bar at the bottom');
    const topGap = head.b + 16, bottomGap = foot.t - 16; // where a bar's top edge, and its bottom edge at the other end, are meant to be
    const centred = (r, what) => near(r.l, W - r.r, 1, `${what} is centred on the window`);
    await s.ev(STUBS);

    t.step('the ask bar: 16px under the header bar, 560px wide, centred, a child of the workspace');
    await selectInEditor(s, 'line 40', { caretOnly: true });
    await openAsk(s);
    await still(s, '#inline-prompt-bar');
    let ask = await rect(s, '#inline-prompt-bar');
    near(ask.t, topGap, 0.5, 'the ask bar\'s top edge');
    near(ask.w, 560, 0.5, 'its width');
    centred(ask, 'the ask bar');
    assert.equal(await s.ev("document.getElementById('inline-prompt-bar').parentElement.id"), 'workspace');
    assert.ok(!(await s.ev("document.getElementById('inline-prompt-bar').classList.contains('panel-dock-bottom')")), 'a target far from the top leaves the bar at the top');
    await s.key('Escape');
    await waitHidden(s, 'inline-prompt-bar');

    t.step('a target at the top of the note sends the bar to the bottom edge: its bottom edge is 16px above the status bar, not under the header bar');
    await s.ev("(function () { var e = document.getElementById('editor'); e.scrollTop = 0; e.focus(); e.setSelectionRange(2, 7); })()");
    await s.key('k', { ctrl: true });
    await waitShown(s, 'inline-prompt-bar');
    await waitFocus(s, 'inline-prompt-input');
    await s.waitFor("document.getElementById('inline-prompt-bar').classList.contains('panel-dock-bottom')");
    await still(s, '#inline-prompt-bar');
    ask = await rect(s, '#inline-prompt-bar');
    near(ask.b, bottomGap, 0.5, 'the rewrite bar\'s bottom edge (16px above the status bar)');
    centred(ask, 'the rewrite bar at the bottom');
    await s.key('Escape');
    await waitHidden(s, 'inline-prompt-bar');

    t.step('the command bar: the same place as the ask bar');
    await selectInEditor(s, 'line 40', { caretOnly: true });
    await s.key('e', { ctrl: true });
    await waitShown(s, 'cli-filter-bar');
    await still(s, '#cli-filter-bar');
    const cli = await rect(s, '#cli-filter-bar');
    near(cli.t, topGap, 0.5, 'the command bar\'s top edge');
    near(cli.w, 560, 0.5, 'its width');
    centred(cli, 'the command bar');
    assert.equal(await s.ev("document.getElementById('cli-filter-bar').parentElement.id"), 'workspace');
    await s.key('Escape');
    await waitHidden(s, 'cli-filter-bar');

    t.step('the palette and the notes search: 53px from the top of the window (15px under the header bar), 560px wide, centred');
    await openPalette(s);
    await still(s, '#quick-pick-modal .quick-pick-modal');
    const pal = await rect(s, '#quick-pick-modal .quick-pick-modal');
    near(pal.t, head.b + 15, 0.5, 'the palette\'s top edge');
    near(pal.w, 560, 0.5, 'its width');
    centred(pal, 'the palette');
    await s.key('Escape');
    await waitHidden(s, 'quick-pick-modal');
    await s.key('f', { ctrl: true, shift: true });
    await waitShown(s, 'scraps-search-modal');
    await waitFocus(s, 'scraps-search-input');
    await still(s, '#scraps-search-modal .quick-pick-modal');
    const sr = await rect(s, '#scraps-search-modal .quick-pick-modal');
    near(sr.t, head.b + 15, 0.5, 'the search\'s top edge');
    near(sr.w, 560, 0.5, 'its width');
    await s.key('Escape');
    await waitHidden(s, 'scraps-search-modal');

    t.step('the Quick Actions panel: a child of the workspace, centred on the window, 16px above the status bar');
    await selectInEditor(s, 'line 5', { caretOnly: true });
    await s.key('j', { ctrl: true });
    await s.waitFor("!document.getElementById('jev-action-panel').classList.contains('hidden') && document.querySelectorAll('.jev-slot-card').length >= 1", { timeout: 8000 });
    assert.equal(await s.ev("document.getElementById('jev-action-panel').parentElement.id"), 'workspace', 'a child of the workspace, like the bars');
    await still(s, '#jev-action-panel');
    let jev = await rect(s, '#jev-action-panel');
    near(jev.w, 560, 0.5, 'its width');
    centred(jev, 'the Quick Actions panel');
    near(jev.b, bottomGap, 0.5, 'its bottom edge (a caret near the top leaves the bottom free)');
    await s.key('Escape');
    await waitHidden(s, 'jev-action-panel');

    t.step('with two pages open the panel is still centred on the WINDOW, whichever page has the keyboard, and does not move into a page\'s box');
    await s.ev("window.__sykiRPC.setUiState({ split: true })");
    await s.waitFor("document.body.dataset.view === 'pair'");
    for (const id of ['editor-secondary', 'editor']) {
      await s.ev(`(function () { var e = document.getElementById(${q(id)}); e.focus(); e.setSelectionRange(8, 8); })()`);
      await s.key('j', { ctrl: true });
      await s.waitFor("!document.getElementById('jev-action-panel').classList.contains('hidden') && document.querySelectorAll('.jev-slot-card').length >= 1", { timeout: 8000 });
      assert.equal(await s.ev("document.getElementById('jev-action-panel').parentElement.id"), 'workspace', `a child of the workspace with the keyboard in #${id}`);
      jev = await rect(s, '#jev-action-panel');
      centred(jev, `the Quick Actions panel with the keyboard in #${id}`);
      await s.key('Escape');
      await waitHidden(s, 'jev-action-panel');
    }
    await s.ev("window.__sykiRPC.setUiState({ split: false })");
    await s.waitFor("document.body.dataset.view === 'page'");

    t.step('the AI popover opens upwards from its item, just above the status bar');
    await s.ev("document.getElementById('stat-ai').click()");
    await s.waitFor("!!document.getElementById('status-ai-pop') && !document.getElementById('status-ai-pop').classList.contains('hidden')");
    await still(s, '#status-ai-pop');
    const pop = await rect(s, '#status-ai-pop');
    assert.ok(foot.t - pop.b >= 0 && foot.t - pop.b <= 14, `the popover ends just above the status bar: ${foot.t - pop.b}px`);
    assert.ok(pop.r <= W, 'inside the window');
    await s.key('Escape');
    await s.waitFor("document.getElementById('status-ai-pop').classList.contains('hidden')");

    t.step('a narrow window: every panel keeps 16px at both sides');
    const resize = (w) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: H, deviceScaleFactor: 1, mobile: false });
    await resize(420);
    try {
      await s.waitFor('window.innerWidth === 420');
      await selectInEditor(s, 'line 40', { caretOnly: true });
      await openAsk(s);
      await still(s, '#inline-prompt-bar');
      let n = await rect(s, '#inline-prompt-bar');
      near(n.l, 16, 0.5, 'the ask bar keeps 16px at the left');
      near(420 - n.r, 16, 0.5, 'and at the right');
      await s.key('Escape');
      await waitHidden(s, 'inline-prompt-bar');
      await openPalette(s);
      await still(s, '#quick-pick-modal .quick-pick-modal');
      n = await rect(s, '#quick-pick-modal .quick-pick-modal');
      near(n.l, 16, 0.5, 'the palette keeps 16px at the left');
      near(420 - n.r, 16, 0.5, 'and at the right');
      await s.key('Escape');
      await waitHidden(s, 'quick-pick-modal');
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride');
    }
  }
};
