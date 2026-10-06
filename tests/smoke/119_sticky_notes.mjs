// The face of the floating panels in a real browser (v2 P5): every panel is a STICKY NOTE and every dialog a plain SHEET. Judged on the computed
// styles the rules promise (the pixel check is a person looking at the real app and at docshots):
//   * the root of a note is transparent, square, borderless, carries the lifted shadow, keeps a 14px band at the bottom that no child reaches, and
//     nothing clips, filters or blurs it; its paper is the ::before layer (the sheet colour under the accent tint under an adhesive strip, the corner
//     cut by a clip-path), its flap is the ::after triangle in the corner; the paper is behind the content and out of the pointer's way
//   * the strip is the accent at 35% while nothing in the note has focus and the solid focus colour while focus is inside it; it is the only thing
//     that shows focus (no border) and it follows the look and the accent (paper, a self-chosen accent that thins the tint on ink)
//   * a dialog is the sheet colour with no border, no radius, a shadow, and no strip or fold; a modal note dims the page less than a dialog does
//   * forced colours: a note is a 1px line with no shadow, no paper layer and no flap, focus is a 2px outline; reduced motion: no slide
import { assert, openAsk, openPalette, rpc, selectInEditor, waitFocus, waitHidden, waitShown } from './lib.mjs';

const NOTE = '# Title\n\n' + Array.from({ length: 50 }, (_, i) => `line ${i + 1} of a note that has some words in it`).join('\n') + '\n';
const q = (x) => JSON.stringify(x);
const STUBS = `window.backend.jevPredict = function () { return Promise.resolve({ candidates: [
  { command: 'wc -l', action_type: 'sh', label: 'count', confidence: 0.9 },
  { command: 'date', action_type: 'sh', label: 'date', confidence: 0.5 } ] }); };`;

const css = (s, sel, prop, pseudo) => s.ev(`getComputedStyle(document.querySelector(${q(sel)}), ${pseudo ? q(pseudo) : 'null'})[${q(prop)}]`);
// what a token is worth now, as the browser resolves a colour
const token = (s, name) => s.ev(`(function () { var d = document.createElement('div'); d.style.background = 'var(${name})'; document.body.appendChild(d); var c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);
// a panel that fades in slides 4px for 120ms: judge it once it has stopped
const still = (s, sel) => s.waitFor(`(function () { var e = document.querySelector(${q(sel)}); return !!e && e.getAnimations().length === 0; })()`);
// the colours of the layers of a ::before: the first rgb()/rgba() of each linear-gradient in the computed background-image
const layerColours = async (s, sel) => {
  const bg = await css(s, sel, 'backgroundImage', '::before');
  return [...String(bg).matchAll(/linear-gradient\((rgba?\([^)]*\))/g)].map((m) => m[1].replace(/\s+/g, ' '));
};
const norm = (c) => String(c).replace(/\s+/g, ' ').replace(/rgba\((\d+), (\d+), (\d+), 1\)/, 'rgb($1, $2, $3)');
const alphaOf = (c) => { const m = /rgba\(\d+, \d+, \d+, ([\d.]+)\)/.exec(c); return m ? parseFloat(m[1]) : 1; };

export default {
  title: 'sticky notes: every panel is a transparent square root with the note shadow and a fold band over a paper layer (strip, tint, sheet) cut at the corner; the strip turns solid on focus; dialogs are a plain sheet; paper look, a self-chosen accent, forced colours and reduced motion',
  session: { notes: [{ title: 'long.md', content: NOTE }, { title: 'two.md', content: '# Two\n\nthe second note\n' }] },
  timeoutMs: 120000,

  async run(s, t) {
    await s.ev(STUBS);
    const cdp = s.page.cdp;
    const sheet = await token(s, '--sheet'), tape = await token(s, '--note-tape'), tapeFocus = await token(s, '--note-tape-focus'), tint = await token(s, '--note-tint');
    const fold = parseFloat(await s.ev("getComputedStyle(document.body).getPropertyValue('--note-fold')"));
    assert.equal(fold, 14, 'the fold is 14px');

    // The seven things every note says about itself, checked on the element that matches `sel`
    const face = async (sel, name, { focusInside = null } = {}) => {
      const rootStyle = (prop) => css(s, sel, prop);
      assert.equal(await rootStyle('backgroundColor'), 'rgba(0, 0, 0, 0)', `${name}: the root is transparent (the paper is its ::before layer)`);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) assert.equal(await rootStyle(`border${side}Width`), '0px', `${name}: no border (${side})`);
      for (const corner of ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft']) assert.equal(await rootStyle(`border${corner}Radius`), '0px', `${name}: square (${corner})`);
      assert.notEqual(await rootStyle('boxShadow'), 'none', `${name}: the lifted shadow`);
      assert.equal(await rootStyle('paddingBottom'), `${fold}px`, `${name}: a ${fold}px band under everything, for the fold`);
      for (const prop of ['clipPath', 'filter', 'backdropFilter']) assert.equal(await rootStyle(prop), 'none', `${name}: ${prop} is none on the root (it would clip the shadow / grey the text / cost a repaint)`);
      assert.equal(await rootStyle('willChange'), 'auto', `${name}: no will-change`);
      assert.equal(await rootStyle('opacity'), '1', `${name}: the fade owns the opacity, and it is 1 while the note is open`);
      // the paper layer
      assert.equal(await css(s, sel, 'content', '::before'), '""', `${name}: the paper layer exists`);
      assert.equal(await css(s, sel, 'position', '::before'), 'absolute');
      assert.equal(await css(s, sel, 'zIndex', '::before'), '-1', `${name}: the paper is behind the content`);
      assert.equal(await css(s, sel, 'pointerEvents', '::before'), 'none');
      assert.ok(/^polygon\(/.test(await css(s, sel, 'clipPath', '::before')), `${name}: the corner is cut from the paper layer`);
      assert.equal(await css(s, sel, 'backgroundColor', '::before'), sheet, `${name}: the paper is the sheet colour under everything`);
      const layers = await layerColours(s, sel);
      assert.equal(layers.length, 2, `${name}: the strip and the tint are the two gradients over the sheet: ${JSON.stringify(layers)}`);
      assert.equal(norm(layers[1]), norm(tint), `${name}: the tint is --note-tint`);
      assert.match(await css(s, sel, 'backgroundSize', '::before'), /100% 6px/, `${name}: the strip is 6px high and as wide as the note`);
      if (focusInside !== null) assert.equal(norm(layers[0]), norm(focusInside ? tapeFocus : tape), `${name}: the strip is ${focusInside ? 'solid (focus is inside)' : 'the quiet tape (nothing in the note has focus)'}`);
      // the flap
      assert.equal(await css(s, sel, 'content', '::after'), '""', `${name}: the flap exists`);
      assert.equal(await css(s, sel, 'width', '::after'), `${fold}px`);
      assert.equal(await css(s, sel, 'height', '::after'), `${fold}px`);
      assert.match(await css(s, sel, 'backgroundImage', '::after'), /linear-gradient/, `${name}: a triangle`);
      // nothing is laid out in the band that holds the fold: every direct child ends at least `fold` px above the bottom of the note
      const gap = await s.ev(`(function () { var root = document.querySelector(${q(sel)}); var rb = root.getBoundingClientRect().bottom; var low = 0; Array.prototype.forEach.call(root.children, function (c) { var r = c.getBoundingClientRect(); if (r.height > 0) low = Math.max(low, r.bottom); }); return rb - low; })()`);
      assert.ok(gap >= fold - 0.5, `${name}: the last row ends ${gap}px above the bottom edge, so the fold (${fold}px) touches nothing`);
    };

    t.step('the ask bar: the face, and the strip is solid while the field has focus and quiet when focus is elsewhere');
    await selectInEditor(s, 'line 20', { caretOnly: true });
    await openAsk(s);
    await still(s, '#inline-prompt-bar');
    await face('#inline-prompt-bar', 'the ask bar', { focusInside: true });
    await s.ev("document.getElementById('inline-prompt-input').blur()");
    assert.equal(norm((await layerColours(s, '#inline-prompt-bar'))[0]), norm(tape), 'focus left: the strip is the quiet tape');
    await s.ev("document.getElementById('inline-prompt-input').focus()");
    assert.equal(norm((await layerColours(s, '#inline-prompt-bar'))[0]), norm(tapeFocus), 'focus back: solid again');
    assert.equal(await css(s, '#inline-prompt-bar', 'borderTopColor'), await css(s, '#inline-prompt-bar', 'borderBottomColor'), 'the border does not change with focus');
    await s.key('Escape');
    await waitHidden(s, 'inline-prompt-bar');

    t.step('the command bar, the palette, the notes search');
    await s.key('e', { ctrl: true });
    await waitShown(s, 'cli-filter-bar');
    await still(s, '#cli-filter-bar');
    await face('#cli-filter-bar', 'the command bar', { focusInside: true });
    await s.key('Escape');
    await waitHidden(s, 'cli-filter-bar');
    await openPalette(s);
    await still(s, '#quick-pick-modal .quick-pick-modal');
    await face('#quick-pick-modal .quick-pick-modal', 'the palette', { focusInside: true });
    // a modal note dims the page less than a dialog does
    const noteScrim = alphaOf(await css(s, '#quick-pick-modal', 'backgroundColor'));
    await s.key('Escape');
    await waitHidden(s, 'quick-pick-modal');
    await s.key('f', { ctrl: true, shift: true });
    await waitShown(s, 'scraps-search-modal');
    await waitFocus(s, 'scraps-search-input');
    await still(s, '#scraps-search-modal .quick-pick-modal');
    await face('#scraps-search-modal .quick-pick-modal', 'the notes search', { focusInside: true });
    await s.key('Escape');
    await waitHidden(s, 'scraps-search-modal');

    t.step('the tag picker (a palette command): the same shell as the palette');
    await selectInEditor(s, 'line 20', { caretOnly: true });
    await openPalette(s);
    await s.type(t.pick('tag', 'タグ'));
    await s.waitFor("document.querySelectorAll('#quick-pick-list .quick-pick-item').length > 0");
    await s.key('Enter');
    await waitShown(s, 'tag-pick-modal');
    await waitFocus(s, 'tag-pick-input');
    await still(s, '#tag-pick-card');
    await face('#tag-pick-card', 'the tag picker', { focusInside: true });
    assert.equal(alphaOf(await css(s, '#tag-pick-modal', 'backgroundColor')), noteScrim, 'it dims the page as the palette does');
    await s.key('Escape');
    await waitHidden(s, 'tag-pick-modal');

    t.step('Quick Actions: the editor has the keyboard, so the strip stays the quiet tape');
    await selectInEditor(s, 'line 5', { caretOnly: true });
    await s.key('j', { ctrl: true });
    await s.waitFor("!document.getElementById('jev-action-panel').classList.contains('hidden') && document.querySelectorAll('.jev-slot-card').length >= 1", { timeout: 8000 });
    await still(s, '#jev-action-panel');
    await face('#jev-action-panel', 'the Quick Actions panel', { focusInside: false });
    await s.key('Escape');
    await waitHidden(s, 'jev-action-panel');

    t.step('the snippet list, the All tabs list and the AI popover');
    assert.equal((await rpc(s, 'openPanel("snippets")')).err, undefined);
    await waitShown(s, 'slot-quick-selector');
    await still(s, '#slot-quick-selector');
    await face('#slot-quick-selector', 'the snippet list');
    await s.key('Escape');
    await waitHidden(s, 'slot-quick-selector');
    assert.equal((await rpc(s, 'openPanel("all_tabs")')).err, undefined);
    await waitShown(s, 'tab-list-panel');
    await still(s, '#tab-list-panel');
    await face('#tab-list-panel', 'the All tabs list', { focusInside: true });
    await s.key('Escape');
    await waitHidden(s, 'tab-list-panel');
    await s.ev("document.getElementById('stat-ai').click()");
    await s.waitFor("!!document.getElementById('status-ai-pop') && !document.getElementById('status-ai-pop').classList.contains('hidden')");
    await still(s, '#status-ai-pop');
    await face('#status-ai-pop', 'the AI popover');
    await s.key('Escape');
    await s.waitFor("document.getElementById('status-ai-pop').classList.contains('hidden')");

    t.step('the dialogs are a plain sheet: the sheet colour, no border, square, a shadow, no strip and no fold; they dim the page more than a note does');
    await s.key(',', { ctrl: true });
    await waitShown(s, 'settings-modal');
    for (const [sel, name] of [['#settings-modal .modal-card', 'Settings']]) {
      assert.equal(await css(s, sel, 'backgroundColor'), sheet, `${name}: the sheet colour`);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) assert.equal(await css(s, sel, `border${side}Width`), '0px', `${name}: no border`);
      assert.equal(await css(s, sel, 'borderTopLeftRadius'), '0px', `${name}: square`);
      assert.notEqual(await css(s, sel, 'boxShadow'), 'none', `${name}: lifted by its shadow`);
      assert.equal(await css(s, sel, 'content', '::before'), 'none', `${name}: no strip, no paper layer`);
      assert.equal(await css(s, sel, 'content', '::after'), 'none', `${name}: no flap`);
    }
    const dialogScrim = alphaOf(await css(s, '#settings-modal', 'backgroundColor'));
    assert.ok(noteScrim < dialogScrim, `a note dims the page (${noteScrim}) less than a dialog does (${dialogScrim})`);
    await s.key('Escape');
    await waitHidden(s, 'settings-modal');
    assert.equal((await rpc(s, 'openPanel("about")')).err, undefined);
    await waitShown(s, 'about-modal');
    assert.equal(await css(s, '#about-modal .modal-card', 'backgroundColor'), sheet, 'About is the same sheet');
    assert.equal(await css(s, '#about-modal .modal-card', 'borderTopWidth'), '0px');
    assert.equal(await css(s, '#about-modal .modal-card', 'boxShadow'), await css(s, '#settings-modal .modal-card', 'boxShadow'), 'with the same shadow as Settings');
    await s.key('Escape');
    await waitHidden(s, 'about-modal');

    t.step('the paper look: the sheet colour is white, the tint and the strip follow the paper accent');
    await s.ev("Appearance.apply(document, Object.assign({}, Appearance.DEFAULTS, { look: 'paper', accent: 'olive' })); 1");
    const paperSheet = await token(s, '--sheet'), paperTint = await token(s, '--note-tint'), paperFocus = await token(s, '--note-tape-focus');
    assert.equal(paperSheet, 'rgb(255, 255, 255)');
    assert.notEqual(paperFocus, tapeFocus, 'the strip colour is the paper\'s');
    await selectInEditor(s, 'line 20', { caretOnly: true });
    await openAsk(s);
    await still(s, '#inline-prompt-bar');
    assert.equal(await css(s, '#inline-prompt-bar', 'backgroundColor', '::before'), paperSheet);
    const pl = await layerColours(s, '#inline-prompt-bar');
    assert.equal(norm(pl[1]), norm(paperTint));
    assert.equal(norm(pl[0]), norm(paperFocus));
    await s.key('Escape');
    await waitHidden(s, 'inline-prompt-bar');

    t.step('a self-chosen accent: the note takes its colour by itself; a very bright one thins the tint on ink so the text still reads');
    await s.ev("Appearance.apply(document, Object.assign({}, Appearance.DEFAULTS, { look: 'ink', accent: 'custom', accentCustom: '#ffffff' })); 1");
    assert.ok(parseFloat(await s.ev("getComputedStyle(document.body).getPropertyValue('--note-tint-a')")) < 0.12, 'a white accent thins the tint');
    await openAsk(s);
    await still(s, '#inline-prompt-bar');
    const cl = await layerColours(s, '#inline-prompt-bar');
    assert.ok(alphaOf(cl[1]) < 0.12 && alphaOf(cl[1]) > 0, `the tint of the note on ink is thinner than the style sheet's: ${cl[1]}`);
    await s.key('Escape');
    await waitHidden(s, 'inline-prompt-bar');
    await s.ev("Appearance.apply(document, Object.assign({}, Appearance.DEFAULTS, { look: 'ink', accent: 'olive' })); 1");
    assert.equal(await s.ev("getComputedStyle(document.body).getPropertyValue('--note-tint-a').trim()"), '0.12', 'back to the style sheet\'s tint');

    t.step('forced colours: a note is a 1px line (no shadow, no paper layer, no flap, no fold band), focus is a 2px outline; a dialog has its line');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    try {
      await s.waitFor("matchMedia('(forced-colors: active)').matches");
      await openAsk(s);
      await still(s, '#inline-prompt-bar');
      assert.equal(await css(s, '#inline-prompt-bar', 'borderTopWidth'), '1px');
      assert.equal(await css(s, '#inline-prompt-bar', 'borderTopStyle'), 'solid');
      assert.equal(await css(s, '#inline-prompt-bar', 'boxShadow'), 'none');
      assert.equal(await css(s, '#inline-prompt-bar', 'paddingBottom'), '0px');
      assert.equal(await css(s, '#inline-prompt-bar', 'display', '::before'), 'none', 'no paper layer');
      assert.equal(await css(s, '#inline-prompt-bar', 'display', '::after'), 'none', 'no flap');
      assert.equal(await css(s, '#inline-prompt-bar', 'outlineWidth'), '2px', 'focus inside shows as an outline');
      assert.equal(await css(s, '#inline-prompt-bar', 'outlineStyle'), 'solid');
      await s.key('Escape');
      await waitHidden(s, 'inline-prompt-bar');
      await s.key(',', { ctrl: true });
      await waitShown(s, 'settings-modal');
      assert.equal(await css(s, '#settings-modal .modal-card', 'borderTopWidth'), '1px', 'a dialog has its line');
      assert.equal(await css(s, '#settings-modal .modal-card', 'boxShadow'), 'none');
      await s.key('Escape');
      await waitHidden(s, 'settings-modal');
    } finally {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    }

    t.step('reduced motion: the note does not slide in, and the fade-out takes no time');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await s.waitFor("matchMedia('(prefers-reduced-motion: reduce)').matches");
      await openAsk(s);
      assert.ok(parseFloat(await css(s, '#inline-prompt-bar', 'animationDuration')) < 0.001, `the slide-in lasts no time: ${await css(s, '#inline-prompt-bar', 'animationDuration')}`);
      await s.ev("document.getElementById('inline-prompt-bar').classList.add('panel-fading')");
      assert.equal(await css(s, '#inline-prompt-bar', 'transitionDuration'), '0s', 'and so does the fade-out');
      await s.ev("document.getElementById('inline-prompt-bar').classList.remove('panel-fading')");
      await s.key('Escape');
      await waitHidden(s, 'inline-prompt-bar');
    } finally {
      await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    }
  }
};
