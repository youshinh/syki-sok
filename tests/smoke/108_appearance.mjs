// Settings > Appearance (v2 P1b): the look, the accent and the editor font show at once while the dialog is open, Cancel puts the saved ones
// back, Save keeps them (the settings sent to the backend and the copy the WebView keeps), the old general.theme keeps the accent that
// an older version understands, and a colour of one's own is computed (and taken off again). Judged on the classes of <body> and the
// custom properties, not on a picture. Nothing persists across a page load in this harness (the mock seeds the storage again), so
// "the next start" is covered by tests/appearance_roundtrip_test.mjs and the real app.
import { assert, click, lastSavedConfig, backendCalls, liveConfig, waitHidden, waitShown } from './lib.mjs';

const body = (s) => s.ev(`({ cls: document.body.className, html: document.documentElement.className, bg: getComputedStyle(document.body).getPropertyValue('--bg-main').trim(),
  accent: getComputedStyle(document.body).getPropertyValue('--accent-color').trim(), inline: document.body.style.length,
  font: document.documentElement.style.getPropertyValue('--editor-font-user'), scheme: document.querySelector('meta[name="color-scheme"]').content })`);

// A change event on a control, the way the browser sends it when a person picks a value
const pick = (s, id, value) => s.ev(`(function () { var e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);

async function openSettings(s) {
  await s.key(',', { ctrl: true });
  await waitShown(s, 'settings-modal');
  await s.waitFor(`document.getElementById('cfg-look').getBoundingClientRect().width > 0`);
}

export default {
  title: 'settings > appearance: look, accent and font preview at once, Cancel restores, Save keeps them, a colour of one\'s own is computed',
  session: { notes: [{ title: 'a.md', content: 'text\n' }] },

  async run(s, t) {
    t.step('the page starts as ink and Dark Olive');
    const start = await body(s);
    assert.ok(/dark-theme/.test(start.cls) && /theme-olive/.test(start.cls) && !/look-paper/.test(start.cls) && !/look-paper/.test(start.html), 'ink + olive: ' + start.cls);
    assert.equal(start.scheme, 'dark');
    assert.equal(start.inline, 0, 'the default look writes no custom property on <body>');
    assert.equal(start.font, '', 'and no editor font');

    t.step('the section is there, with the controls that are used');
    await openSettings(s);
    for (const id of ['cfg-look', 'cfg-theme', 'cfg-accent-custom', 'cfg-accent-custom-hex', 'cfg-editor-font', 'btn-editor-font-default', 'accent-swatches']) {
      assert.equal(await s.ev(`!!document.getElementById('${id}')`), true, '#' + id + ' exists');
    }
    assert.equal(await s.ev("document.getElementById('cfg-look').value"), 'ink');
    assert.equal(await s.ev("document.getElementById('cfg-theme').value"), 'olive', 'the accent starts from general.theme');
    assert.equal(await s.ev("document.getElementById('accent-custom-row').classList.contains('hidden')"), true, 'the colour row is for a colour of one\'s own only');
    assert.equal(await s.ev("document.querySelectorAll('#accent-swatches .accent-swatch').length"), 6, 'five accents and "your own"');
    const savesBefore = (await backendCalls(s, 'saveConfig')).length;

    t.step('choose paper and vermilion: the window changes at once, nothing is saved');
    await pick(s, 'cfg-look', 'paper');
    await pick(s, 'cfg-theme', 'vermilion');
    const preview = await body(s);
    assert.ok(/look-paper/.test(preview.cls) && /look-paper/.test(preview.html), 'paper is on <body> and <html>: ' + preview.cls);
    assert.ok(/theme-vermilion/.test(preview.cls) && !/theme-olive/.test(preview.cls));
    assert.equal(preview.bg, '#fbfbf9', 'the paper page colour');
    assert.equal(preview.accent, '#b8472c', 'the vermilion accent');
    assert.equal(preview.scheme, 'light', 'the engine is told the page is light');
    assert.equal(await s.ev("document.querySelector('#accent-swatches .accent-swatch[aria-pressed=\"true\"]').dataset.accent"), 'vermilion', 'the pressed swatch follows');
    assert.equal((await liveConfig(s)).appearance, undefined, 'the config is not touched by a preview');
    assert.equal((await backendCalls(s, 'saveConfig')).length, savesBefore, 'nothing was saved');

    t.step('Cancel puts the saved look back');
    await click(s, 'btn-cancel-settings');
    await waitHidden(s, 'settings-modal');
    const cancelled = await body(s);
    assert.ok(!/look-paper/.test(cancelled.cls) && !/look-paper/.test(cancelled.html) && /theme-olive/.test(cancelled.cls), 'ink + olive again: ' + cancelled.cls);
    assert.equal(cancelled.bg, start.bg);
    assert.equal(cancelled.scheme, 'dark');
    assert.equal((await backendCalls(s, 'saveConfig')).length, savesBefore, 'Cancel saved nothing');

    t.step('a colour of one\'s own: computed on <body>, the swatch seeds it, and a built-in accent takes it off again');
    await openSettings(s);
    await click(s, 'accent-swatch-custom');
    assert.equal(await s.ev("document.getElementById('accent-custom-row').classList.contains('hidden')"), false, 'the colour row shows');
    const seed = await s.ev("document.getElementById('cfg-accent-custom-hex').value");
    assert.ok(/^#[0-9a-f]{6}$/.test(seed), 'it starts from the colour on screen: ' + seed);
    await s.ev("(function () { var h = document.getElementById('cfg-accent-custom-hex'); h.value = '#336699'; h.dispatchEvent(new Event('input', { bubbles: true })); })()");
    const custom = await body(s);
    assert.equal(custom.accent, '#336699', 'the chosen colour is the fill');
    assert.ok(custom.inline > 5, 'the derived colours are set on <body> (' + custom.inline + ' properties)');
    assert.ok(/theme-custom/.test(custom.cls));
    const label = await s.ev("getComputedStyle(document.body).getPropertyValue('--accent-label').trim()");
    assert.ok(/^#[0-9a-f]{6}$/.test(label) && label !== '#336699', 'the text colour of the accent is derived: ' + label);
    await s.ev("(function () { var h = document.getElementById('cfg-accent-custom-hex'); h.value = '#33'; h.dispatchEvent(new Event('input', { bubbles: true })); })()");
    assert.equal((await body(s)).accent, '#336699', 'half a colour is not previewed');
    await pick(s, 'cfg-theme', 'forest');
    const builtin = await body(s);
    assert.equal(builtin.inline, 0, 'a built-in accent leaves no custom property behind');
    assert.ok(/theme-forest/.test(builtin.cls) && !/theme-custom/.test(builtin.cls));

    t.step('the editor font: applied when settled, refused when it is not a plain name, default removes it');
    await pick(s, 'cfg-editor-font', 'Consolas');
    assert.ok((await body(s)).font.startsWith('"Consolas", '), 'the font goes in front of the editor\'s own list');
    const editorFont = await s.ev("getComputedStyle(document.getElementById('editor')).fontFamily");
    assert.ok(/Consolas/.test(editorFont), 'the editor uses it: ' + editorFont);
    await pick(s, 'cfg-editor-font', 'x"; } body { display: none');
    assert.equal((await body(s)).font, '', 'a name that could leave the quotes is not applied');
    await pick(s, 'cfg-editor-font', 'Menlo');
    await click(s, 'btn-editor-font-default');
    assert.equal(await s.ev("document.getElementById('cfg-editor-font').value"), '');
    assert.equal((await body(s)).font, '', 'Default takes the font off');

    t.step('Save keeps the look: the saved settings, the copy of the WebView, and general.theme for older versions');
    await pick(s, 'cfg-look', 'paper');
    await pick(s, 'cfg-theme', 'vermilion');
    await click(s, 'btn-save-settings');
    await waitHidden(s, 'settings-modal');
    await s.waitFor(`/look-paper/.test(document.body.className)`);
    const saved = await lastSavedConfig(s);
    assert.ok(saved && saved.appearance, 'the settings sent to be saved carry appearance');
    assert.equal(saved.appearance.look, 'paper');
    assert.equal(saved.appearance.accent, 'vermilion');
    assert.equal(saved.general.theme, 'olive', 'general.theme keeps the last accent an older version knows (vermilion is new)');
    const local = JSON.parse(await s.ev("localStorage.getItem('md_notepad_config_v3')"));
    assert.equal(local.appearance.look, 'paper', 'the copy the WebView keeps has it (it paints the next start before the backend answers)');
    assert.equal((await liveConfig(s)).appearance.accent, 'vermilion');
    const after = await body(s);
    assert.ok(/theme-vermilion/.test(after.cls) && after.bg === '#fbfbf9');

    t.step('the next time the dialog opens it shows the saved look; a built-in accent is also written to general.theme');
    await openSettings(s);
    assert.equal(await s.ev("document.getElementById('cfg-look').value"), 'paper');
    assert.equal(await s.ev("document.getElementById('cfg-theme').value"), 'vermilion');
    await pick(s, 'cfg-theme', 'blue');
    await click(s, 'btn-save-settings');
    await waitHidden(s, 'settings-modal');
    await s.waitFor(`/theme-blue/.test(document.body.className)`);
    const saved2 = await lastSavedConfig(s);
    assert.equal(saved2.appearance.accent, 'blue');
    assert.equal(saved2.general.theme, 'blue', 'a built-in accent is written to general.theme as well');
    assert.equal(saved2.appearance.look, 'paper', 'the look is kept');

    t.step('Escape closes the dialog and also puts an unsaved preview back');
    await openSettings(s);
    await pick(s, 'cfg-look', 'ink');
    assert.ok(!/look-paper/.test((await body(s)).cls), 'the preview is ink');
    await s.key('Escape');
    await waitHidden(s, 'settings-modal');
    assert.ok(/look-paper/.test((await body(s)).cls), 'Escape put the saved paper look back');
  }
};
