// syki::sok Mermaid diagram tone. Diagrams were always drawn with Mermaid's "dark" theme on the dark
// preview, and some of them are unreadable that way (a mindmap's root and first branch come out
// near-black with black text). The tone is a setting (Settings > General, general.mermaidTone) and a
// one-click flip on every diagram: dark, or one of three light tones drawn on a white card.
//
// Nothing here costs anything until a note has a diagram: app.js calls it while rendering one.
(function (global) {
  'use strict';

  // 'auto' (the default) follows the look of the window: the dark tone on ink, the light tone on paper. The other four are
  // fixed, whatever the look is.
  const TONES = ['auto', 'dark', 'light', 'neutral', 'forest'];
  const DEFAULT_TONE = 'auto';

  // Mermaid theme behind each tone.
  const THEME = { dark: 'dark', light: 'default', neutral: 'neutral', forest: 'forest' };

  function normalizeTone(value) {
    return TONES.indexOf(value) >= 0 ? value : DEFAULT_TONE;
  }

  // The tone that is drawn: 'auto' resolved with the look ('ink' | 'paper'; anything else counts as ink).
  function resolveTone(value, look) {
    const t = normalizeTone(value);
    if (t !== 'auto') return t;
    return look === 'paper' ? 'light' : 'dark';
  }

  // The one-click switch: dark <-> light (of the tone that is drawn now). The other two tones are picked in Settings.
  function flipTone(value, look) {
    return resolveTone(value, look) === 'dark' ? 'light' : 'dark';
  }

  // The tone to save when the Settings dialog is saved. Every config saved before 'auto' existed holds 'dark' (it was the default that
  // a save wrote), so a saved 'dark' cannot be told from a choice. When the look goes from ink to paper in the same save and the tone
  // select was left as it was ('dark'), the tone becomes 'auto' (a light diagram on paper); a person who wants dark diagrams on paper
  // picks Dark after that. Anything else is what the select says.
  function toneToSave(selected, previous, previousLook, newLook) {
    const chosen = normalizeTone(selected);
    if (chosen === 'dark' && previous === 'dark' && previousLook === 'ink' && newLook === 'paper') return 'auto';
    return chosen;
  }

  // What mermaid.initialize() gets. The dark tone is the configuration the app has always used; its three colours are the
  // card's tokens (css/tokens.css: --bg-mermaid-dark, --mermaid-primary, --text-mermaid-dark), read by the caller from the page,
  // because Mermaid parses colours itself (it derives lighter and darker shades) and cannot take var(). Without `palette`
  // (a caller that has no page) the dark tone leaves them to Mermaid's own dark theme.
  function mermaidConfig(tone, palette, look) {
    const t = resolveTone(tone, look);
    const cfg = { startOnLoad: false, securityLevel: 'strict', theme: THEME[t] };
    if (t === 'dark') {
      cfg.themeVariables = { darkMode: true };
      if (palette && palette.background) cfg.themeVariables.background = palette.background;
      if (palette && palette.primary) cfg.themeVariables.primaryColor = palette.primary;
      if (palette && palette.text) cfg.themeVariables.textColor = palette.text;
    }
    return cfg;
  }

  // CSS classes for the card a diagram sits in (style.css: .mermaid-card / .tone-*).
  function cardClasses(tone, look) {
    return ['mermaid-card', 'tone-' + resolveTone(tone, look)];
  }

  const TONE_ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>';

  const COPY_ICON =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
    '</svg>';

  const SAVE_ICON =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="7 10 12 15 17 10"/>' +
    '<line x1="12" y1="15" x2="12" y2="3"/>' +
    '</svg>';

  // Turns the <pre> that held the diagram source into the diagram's card and gives it action buttons.
  // extraActions: { copyTitle, onCopy, saveTitle, onSave }
  function decorate(container, tone, title, onFlip, look, extraActions) {
    if (!container) return;
    container.classList.remove('tone-dark', 'tone-light', 'tone-neutral', 'tone-forest');
    cardClasses(tone, look).forEach(function (c) { container.classList.add(c); });
    const doc = container.ownerDocument;

    const toneBtn = doc.createElement('button');
    toneBtn.type = 'button';
    toneBtn.className = 'mermaid-tone-btn' + (extraActions ? ' mermaid-action-btn' : '');
    toneBtn.title = title;
    toneBtn.setAttribute('aria-label', title);
    toneBtn.innerHTML = TONE_ICON;
    toneBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onFlip();
    });

    if (extraActions && (extraActions.onCopy || extraActions.onSave)) {
      if (typeof container.querySelector === 'function') {
        const oldActions = container.querySelector('.mermaid-card-actions');
        if (oldActions && typeof oldActions.remove === 'function') oldActions.remove();
      }

      const actionsBar = doc.createElement('div');
      actionsBar.className = 'mermaid-card-actions';

      if (extraActions.onCopy) {
        const copyBtn = doc.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'mermaid-action-btn';
        copyBtn.title = extraActions.copyTitle || 'Copy as image';
        copyBtn.setAttribute('aria-label', copyBtn.title);
        copyBtn.innerHTML = COPY_ICON;
        copyBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          extraActions.onCopy();
        });
        actionsBar.appendChild(copyBtn);
      }

      if (extraActions.onSave) {
        const saveBtn = doc.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'mermaid-action-btn';
        saveBtn.title = extraActions.saveTitle || 'Save as image';
        saveBtn.setAttribute('aria-label', saveBtn.title);
        saveBtn.innerHTML = SAVE_ICON;
        saveBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          extraActions.onSave();
        });
        actionsBar.appendChild(saveBtn);
      }

      actionsBar.appendChild(toneBtn);
      container.appendChild(actionsBar);
    } else {
      container.appendChild(toneBtn);
    }
  }

  global.MermaidTone = {
    TONES: TONES,
    normalizeTone: normalizeTone,
    resolveTone: resolveTone,
    toneToSave: toneToSave,
    flipTone: flipTone,
    mermaidConfig: mermaidConfig,
    cardClasses: cardClasses,
    decorate: decorate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.MermaidTone;
  }
})(typeof window !== 'undefined' ? window : globalThis);
