// syki::sok appearance (v2): the look of the window (ink = dark, paper = light), the accent colour and the editor font.
//
// Where it lives: config.appearance = { look: 'ink' | 'paper', accent: 'olive' | 'blue' | 'forest' | 'charcoal' | 'vermilion' |
// 'custom', accentCustom: '#rrggbb', editorFont: '', bars: 'solid' | 'light' | 'glass', autoHide: true | false,
// splitBoundary: 'dots' | 'shade' | 'line' }. Without it the app is what it always was: ink, Dark Olive, its own font (and the header and
// the status bar as v2 draws them: DEFAULT_BARS, auto-hide on, the divider between two pages with its dots).
// config.general.theme (the old accent setting) keeps working: it is the accent while config.appearance has none, and it is
// written back with every accent that an older version knows, so a downgrade keeps the colour.
//
// Cost model (this runs on every start-up, so it must stay out of the way):
//  * apply() writes to the DOM only what differs from what is there. The default look (ink, Dark Olive, no font) therefore
//    writes nothing: the page ships with that look in its markup (<body class="dark-theme theme-olive">).
//  * The colour maths of a self-chosen accent runs only when the person chose one (accent 'custom'); a font is applied only
//    when one is set. Nothing here listens to anything or keeps a timer.
//  * The colours themselves are CSS (css/tokens.css: body.look-paper, body.theme-*, body.look-paper.theme-*). This file only
//    sets classes and, for a self-chosen accent, a handful of custom properties on <body>. The bars' see-through-ness is one
//    attribute (<body data-bars>, read by css/chrome.css); auto-hide is not a page property at all (app.js hands it to
//    ChromeOverlay.configure, which listens to nothing while it is off). The divider between two pages is one more attribute
//    (<body data-boundary>, read by css/style.css), and the default (dots) is no attribute at all.
//
// No colour literal lives here (tests/css_tokens_test.mjs): the colours of the maths below are number triples.
(function (global) {
  'use strict';

  const LOOKS = ['ink', 'paper'];
  const LEGACY_THEMES = ['olive', 'blue', 'forest', 'charcoal']; // what general.theme can hold (older versions read it)
  const ACCENTS = LEGACY_THEMES.concat(['vermilion', 'custom']);
  // How see-through the header and the status bar are: 'solid' (opaque, as before v2), 'light' (tinted, 86% opaque, nothing blurred) or 'glass'
  // (62% opaque and blurred, css/chrome.css). THE DEFAULT IS ONE LINE: it was decided by the measurements of
  // tools/perf/v2-p2-translucency.md ('light' costs nothing measurable over 'solid'; 'glass' costs GPU memory and, without a GPU, twice the
  // GPU process' CPU time, so it is a choice and not the default). index.html ships <body data-bars="..."> with the same value, so the
  // default writes nothing at start-up (tests/chrome_bars_zen_test.mjs keeps the two equal).
  const BARS = ['solid', 'light', 'glass'];
  const DEFAULT_BARS = 'light';
  // The divider between two pages (css/style.css, <body data-boundary>): 'dots' (the gutter of a book: a shadow across it and dots that
  // fade towards both sides; the default, and the page carries no attribute for it), 'shade' (the shadow alone) or 'line' (a thin line).
  const BOUNDARIES = ['dots', 'shade', 'line'];
  const DEFAULT_BOUNDARY = 'dots';
  const DEFAULTS = Object.freeze({ look: 'ink', accent: 'olive', accentCustom: '', editorFont: '', bars: DEFAULT_BARS, autoHide: true, splitBoundary: DEFAULT_BOUNDARY });

  // The editor's own typeface list (css/style.css: #editor). A chosen font goes in front of it, so a glyph the font lacks
  // still falls back the way it always did. Tested against style.css.
  const EDITOR_STACK = '"Cascadia Code", "Consolas", "Fira Code", "Meiryo", "SF Mono", "Menlo", "Hiragino Sans", "Hiragino Kaku Gothic ProN", monospace';

  const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

  function isObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  // ---- the setting ------------------------------------------------------------------------------------------

  // "#abc", "#AABBCC", "aabbcc" -> "#aabbcc"; anything else -> ''.
  function normHex(v) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v == null ? '' : v).trim());
    if (!m) return '';
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h;
  }

  // A font name a person typed -> '"Name"' (safe to put in a font-family list), or '' when it is empty or not a plain name.
  // The name is only ever one family: quotes, braces, semicolons, brackets and backslashes are refused, not escaped.
  function safeFontFamily(name) {
    const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!s || s.length > 80) return '';
    if (/[\u0000-\u001f\u007f"'\\;{}()<>:,]/.test(s)) return '';
    return '"' + s + '"';
  }

  // The setting as the app uses it: every known key valid, every unknown key kept (later versions add their own to the same object).
  // `legacyTheme` is config.general.theme: the accent when the setting has none.
  function normalize(raw, legacyTheme) {
    const out = {};
    if (isObject(raw)) {
      for (const key of Object.keys(raw)) if (FORBIDDEN_KEYS.indexOf(key) < 0) out[key] = raw[key];
    }
    const fallbackAccent = LEGACY_THEMES.indexOf(legacyTheme) >= 0 ? legacyTheme : DEFAULTS.accent;
    out.look = LOOKS.indexOf(out.look) >= 0 ? out.look : DEFAULTS.look;
    out.accentCustom = normHex(out.accentCustom);
    let accent = ACCENTS.indexOf(out.accent) >= 0 ? out.accent : fallbackAccent;
    if (accent === 'custom' && !out.accentCustom) accent = fallbackAccent;
    out.accent = accent;
    const name = typeof out.editorFont === 'string' ? out.editorFont.replace(/\s+/g, ' ').trim() : '';
    out.editorFont = safeFontFamily(name) ? name : '';
    out.bars = BARS.indexOf(out.bars) >= 0 ? out.bars : DEFAULTS.bars;
    out.autoHide = typeof out.autoHide === 'boolean' ? out.autoHide : DEFAULTS.autoHide;
    out.splitBoundary = BOUNDARIES.indexOf(out.splitBoundary) >= 0 ? out.splitBoundary : DEFAULTS.splitBoundary;
    return out;
  }

  // The setting of a whole config object.
  function fromConfig(config) {
    return normalize(config && config.appearance, config && config.general && config.general.theme);
  }

  // What general.theme should hold for this accent: the accent itself when an older version knows it, else what was there.
  function legacyThemeFor(appearance, previous) {
    if (LEGACY_THEMES.indexOf(appearance && appearance.accent) >= 0) return appearance.accent;
    return LEGACY_THEMES.indexOf(previous) >= 0 ? previous : DEFAULTS.accent;
  }

  // The small text index.html's first script reads to put the look on the page before the first paint: "paper|blue", "ink|forest", "paper|".
  // '' (nothing to remember) for the default look (ink, Dark Olive) and for a colour of one's own (its properties are computed after the scripts have run).
  function markerFor(appearance) {
    const a = appearance || DEFAULTS;
    const accent = ['blue', 'forest', 'charcoal', 'vermilion'].indexOf(a.accent) >= 0 ? a.accent : '';
    if (a.look !== 'paper' && !accent) return '';
    return (a.look === 'paper' ? 'paper' : 'ink') + '|' + accent;
  }

  // A short text that is equal when two settings paint the same window (used to skip work that would change nothing).
  function signature(appearance) {
    const a = appearance || DEFAULTS;
    return [a.look, a.accent, a.accent === 'custom' ? a.accentCustom : '', a.editorFont, a.bars || DEFAULTS.bars, a.autoHide === false ? 'manual' : 'auto', BOUNDARIES.indexOf(a.splitBoundary) >= 0 ? a.splitBoundary : DEFAULT_BOUNDARY].join('|');
  }

  // ---- colour maths (only used for a self-chosen accent, and by the contrast tests) ----------------------------------

  const WHITE = [255, 255, 255];
  const NEAR_BLACK = [11, 12, 16];
  // The surfaces text and lines of the accent sit on (css/tokens.css). `light` is the brightest ink surface, `dark` the darkest paper one.
  const INK = { page: [30, 30, 30], sheet: [37, 37, 38], light: [60, 60, 60] };
  // The supporting text of ink (--text-muted) and the strength of a sticky note's tint on ink (--note-tint-a of css/tokens.css; tests/look_contrast_test.mjs
  // keeps both honest). A note's paper is the sheet with the accent laid over it at that strength.
  const INK_MUTED = [157, 157, 157];
  const NOTE_TINT_INK = 0.12;
  const PAPER = { page: [251, 251, 249], sheet: [255, 255, 255], dark: [217, 217, 211] };

  function hexToRgb(hex) {
    const h = normHex(hex);
    if (!h) return null;
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map((v) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');
  }

  function rgbToHsl(rgb) {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; } else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
    const m = l - c / 2;
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  function luminance(rgb) {
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  }

  // WCAG contrast ratio of two colours (hex strings or number triples).
  function contrast(a, b) {
    const ra = typeof a === 'string' ? hexToRgb(a) : a;
    const rb = typeof b === 'string' ? hexToRgb(b) : b;
    const la = luminance(ra), lb = luminance(rb);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // White or near-black, whichever reads better on `rgb` (at least 4.58:1 for any colour).
  function onColor(rgb) {
    return contrast(WHITE, rgb) >= contrast(NEAR_BLACK, rgb) ? WHITE : NEAR_BLACK;
  }

  // Walks the lightness of a hue in 1% steps (`dir` +1 lighter, -1 darker) from `l` until `ok(rgb)` holds. The colours tried are the
  // whole-number ones that end up in the page, so what was checked is what is shown.
  function tune(h, s, l, ok, dir) {
    let x = l;
    let rgb = hslToRgb(h, s, x).map(Math.round);
    for (let i = 0; i < 100; i++) {
      rgb = hslToRgb(h, s, x).map(Math.round);
      if (ok(rgb)) return rgb;
      const next = x + dir * 0.01;
      if ((dir < 0 && next < 0.02) || (dir > 0 && next > 0.98)) return rgb;
      x = next;
    }
    return rgb;
  }

  function blend(under, over, alpha) {
    return under.map((v, i) => v * (1 - alpha) + over[i] * alpha);
  }

  // How strong the accent's tint on a sticky note's paper may be on ink: a very bright accent (pure yellow, white) lifts the paper so far that the
  // supporting text on it falls under 4.5:1, so the tint is thinned, a percent at a time, until it holds (4.55:1: room for the rounding of 8-bit
  // colour). Returns NOTE_TINT_INK for every colour that needs nothing.
  function noteTintFor(accentRgb) {
    for (let a = NOTE_TINT_INK; a > 0.02; a = Math.round((a - 0.01) * 100) / 100) {
      if (contrast(INK_MUTED, blend(INK.sheet, accentRgb, a)) >= 4.55) return a;
    }
    return 0.02;
  }

  const chan = (rgb) => rgb.map((v) => Math.round(v)).join(' ');
  const rgbaOf = (rgb, a) => 'rgba(' + rgb.map((v) => Math.round(v)).join(', ') + ', ' + a + ')';

  // The custom properties a self-chosen accent gives <body> (the same ones css/tokens.css gives each built-in accent), computed for
  // the look. The chosen colour is the fill of buttons and switches as it is; every text, line and tint is derived from it so
  // that it reads on the look's surfaces (4.5:1 for text). Returns null when `hex` is not a colour.
  function customAccent(hex, look) {
    const base = hexToRgb(hex);
    if (!base) return null;
    const hsl = rgbToHsl(base);
    const h = hsl[0], s = hsl[1];
    const out = {};
    if (look === 'paper') {
      // The fill also draws text and lines on the paper (headings, links), so it must be dark enough for that.
      const fill = tune(h, s, hsl[2], (c) => contrast(c, PAPER.page) >= 4.5, -1);
      const fl = rgbToHsl(fill)[2];
      const hover = tune(h, s, Math.max(fl - 0.06, 0.05), (c) => contrast(c, PAPER.page) >= 4.5, -1);
      const label = tune(h, Math.min(s, 0.9), fl, (c) => contrast(c, PAPER.dark) >= 4.5, -1);
      const active = tune(h, Math.min(s * 0.55, 0.6), 0.9, (c) => contrast(NEAR_BLACK, c) >= 7, 1);
      const hoverBg = tune(h, Math.min(s * 0.55, 0.6), 0.93, (c) => contrast(NEAR_BLACK, c) >= 7, 1);
      const on = onColor(fill);
      out['--accent-color'] = rgbToHex(fill);
      out['--accent-hover'] = rgbToHex(hover);
      out['--accent-label'] = rgbToHex(label);
      out['--accent-active-bg'] = rgbToHex(active);
      out['--bg-context-hover'] = rgbToHex(hoverBg);
      out['--bg-preview'] = rgbToHex(blend(PAPER.sheet, fill, 0.04));
      out['--accent-rgb'] = chan(fill);
      out['--text-on-accent'] = rgbToHex(on);
      out['--text-badge'] = rgbToHex(on);
      out['--aura-gradient'] = 'radial-gradient(circle, ' + rgbaOf(fill, 0.12) + ' 0%, ' + rgbaOf(fill, 0.05) + ' 45%, ' + rgbaOf(fill, 0) + ' 75%)';
    } else {
      const on = onColor(base);
      const hover = tune(h, s, Math.min(hsl[2] + 0.08, 0.9), (c) => contrast(c, INK.page) >= 4.5, 1);
      const label = tune(h, Math.min(s, 0.7), 0.74, (c) => contrast(c, INK.light) >= 4.5, 1);
      const active = tune(h, Math.min(s * 0.5, 0.5), 0.26, (c) => contrast(WHITE, c) >= 7, -1);
      const activeL = rgbToHsl(active)[2];
      const bar = tune(h, Math.min(s * 0.45, 0.5), 0.2, (c) => contrast(WHITE, c) >= 7, -1);
      out['--accent-color'] = rgbToHex(base);
      out['--accent-hover'] = rgbToHex(hover);
      out['--accent-label'] = rgbToHex(label);
      out['--accent-active-bg'] = rgbToHex(active);
      out['--bg-context-hover'] = rgbToHex(hslToRgb(h, Math.min(s * 0.5, 0.5), Math.min(activeL + 0.03, 0.4)));
      out['--bg-statusbar'] = rgbToHex(bar);
      out['--bg-preview'] = rgbToHex(blend(INK.sheet, base, 0.1));
      out['--accent-rgb'] = chan(hover);
      out['--bar-bottom-rgb'] = chan(bar);
      out['--text-on-accent'] = rgbToHex(on);
      out['--text-badge'] = rgbToHex(on);
      // The selected index tab is filled with the lighter hover colour on ink (--accent-rgb above), so its text is chosen against that
      // one; on paper the fill is the accent itself and --text-on-accent already is it.
      out['--tab-ink-hi'] = rgbToHex(onColor(hover));
      // The tint of a sticky note's paper (see noteTintFor): set only for a colour that is bright enough to need it.
      const tint = noteTintFor(hover);
      if (tint !== NOTE_TINT_INK) out['--note-tint-a'] = String(tint);
      out['--aura-gradient'] = 'radial-gradient(circle, ' + rgbaOf(label, 0.15) + ' 0%, ' + rgbaOf(base, 0.07) + ' 45%, ' + rgbaOf(base, 0) + ' 75%)';
    }
    return out;
  }

  // ---- applying it ---------------------------------------------------------------------------------------------

  // What this page has set so far (a script sets these only when the setting asks for them, so the default sets none).
  const applied = { custom: [], font: '' };

  function toggleClass(el, name, on) {
    if (!el || !el.classList) return false;
    const has = el.classList.contains(name);
    if (on === has) return false;
    if (on) el.classList.add(name); else el.classList.remove(name);
    return true;
  }

  function currentAccent(body) {
    for (let i = 0; i < ACCENTS.length; i++) if (body.classList.contains('theme-' + ACCENTS[i])) return ACCENTS[i];
    return '';
  }

  // The look of the window chrome that the page cannot say in CSS: the meta tags that tell the engine what the page is (so form
  // controls, scrollbars and the canvas behind the page match). The paper colour is the page colour of css/tokens.css.
  function applyMeta(doc, look) {
    if (!doc.querySelector) return;
    const scheme = doc.querySelector('meta[name="color-scheme"]');
    const want = look === 'paper' ? 'light' : 'dark';
    if (scheme && scheme.getAttribute('content') !== want) scheme.setAttribute('content', want);
    const themeColor = doc.querySelector('meta[name="theme-color"]');
    if (themeColor && global.getComputedStyle && doc.body) {
      const v = String(global.getComputedStyle(doc.body).getPropertyValue('--canvas-bg') || '').trim();
      if (v && themeColor.getAttribute('content') !== v) themeColor.setAttribute('content', v);
    }
  }

  // Puts `appearance` (a normalized setting) on the document. Returns what changed: { look, accent, font, bars, boundary }.
  function apply(doc, appearance) {
    const body = doc.body;
    const root = doc.documentElement;
    const ap = appearance || DEFAULTS;
    const changed = { look: false, accent: false, font: false, bars: false, boundary: false };
    if (!body || !root) return changed;

    // The divider between two pages: one attribute that css/style.css reads. The default (dots) is the page without the attribute, so
    // the default writes nothing at start-up and a way back to it takes the attribute off.
    const boundary = BOUNDARIES.indexOf(ap.splitBoundary) >= 0 ? ap.splitBoundary : DEFAULT_BOUNDARY;
    if (typeof body.getAttribute === 'function') {
      const have = body.getAttribute('data-boundary');
      if (boundary === DEFAULT_BOUNDARY) {
        if (have !== null && typeof body.removeAttribute === 'function') {
          body.removeAttribute('data-boundary');
          changed.boundary = true;
        }
      } else if (have !== boundary && typeof body.setAttribute === 'function') {
        body.setAttribute('data-boundary', boundary);
        changed.boundary = true;
      }
    }

    // The header and the status bar: one attribute that css/chrome.css reads (the page ships with the default in its markup).
    const bars = BARS.indexOf(ap.bars) >= 0 ? ap.bars : DEFAULTS.bars;
    if (typeof body.getAttribute === 'function' && body.getAttribute('data-bars') !== bars) {
      body.setAttribute('data-bars', bars);
      changed.bars = true;
    }

    const paper = ap.look === 'paper';
    // The root carries the look as well: the canvas behind <body> is painted from :root (css/style.css: html, body).
    if (toggleClass(body, 'look-paper', paper)) changed.look = true;
    if (toggleClass(root, 'look-paper', paper)) changed.look = true;
    if (changed.look || paper) applyMeta(doc, ap.look); // paper: also when index.html's first script already put the class there

    const accent = ACCENTS.indexOf(ap.accent) >= 0 ? ap.accent : DEFAULTS.accent;
    if (currentAccent(body) !== accent) {
      for (let i = 0; i < ACCENTS.length; i++) toggleClass(body, 'theme-' + ACCENTS[i], ACCENTS[i] === accent);
      changed.accent = true;
    }

    // A self-chosen accent: the properties are computed and set (again after any change of colour or look); any other
    // accent takes them off again. A page that never used a custom accent has nothing to take off.
    const wantCustom = accent === 'custom' ? customAccent(ap.accentCustom, ap.look) : null;
    if (wantCustom) {
      const names = Object.keys(wantCustom);
      applied.custom.filter((n) => !(n in wantCustom)).forEach((n) => body.style.removeProperty(n));
      names.forEach((n) => body.style.setProperty(n, wantCustom[n]));
      applied.custom = names;
      changed.accent = true;
    } else if (applied.custom.length) {
      applied.custom.forEach((n) => body.style.removeProperty(n));
      applied.custom = [];
      changed.accent = true;
    }
    if (changed.look && accent !== 'custom') changed.accent = true; // the accent's colours differ per look

    const font = safeFontFamily(ap.editorFont) ? ap.editorFont : '';
    if (font !== applied.font) {
      if (font) root.style.setProperty('--editor-font-user', safeFontFamily(font) + ', ' + EDITOR_STACK);
      else root.style.removeProperty('--editor-font-user');
      applied.font = font;
      changed.font = true;
    }
    return changed;
  }

  global.Appearance = {
    LOOKS, ACCENTS, LEGACY_THEMES, BARS, DEFAULT_BARS, BOUNDARIES, DEFAULT_BOUNDARY, DEFAULTS, EDITOR_STACK,
    normalize, fromConfig, legacyThemeFor, signature, markerFor, normHex, safeFontFamily,
    customAccent, contrast, hexToRgb, rgbToHex, rgbToHsl, hslToRgb, luminance, apply
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.Appearance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
