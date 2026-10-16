// syki: the round "x" that leaves Zen mode and full screen. Both hide everything that could be pressed to leave them (the header, the
// buttons); the shortcut (Esc, Shift+F11, F11) is the only way out, and a person who does not know it is stuck. As in a browser's full
// screen, the pointer going to the top edge, near the middle, lowers a small round button from it; going away raises it again.
//
//   ImmersiveExit.inZone(x, y, width, shown)   whether the pointer is where the button is called (a wider place once it is down, so
//                                              that the pointer can travel to it without it going away)
//   ImmersiveExit.create({ document, window, isImmersive, onExit, label, setTimeout, clearTimeout })
//
// Drawn only while Zen mode or full screen is on (the script marks the button is-available; css/style.css, "Immersive exit"); the button is also reachable by keyboard
// (Tab), and shows itself while it has the focus.
(function (global) {
  'use strict';

  const CALL_HALF_WIDTH = 150; // px each side of the window's middle
  const CALL_HEIGHT = 40; // px from the top edge
  const HELD_HALF_WIDTH = 190;
  const HELD_HEIGHT = 96;
  const AWAY_DELAY_MS = 400;

  function inZone(x, y, width, shown) {
    const half = shown ? HELD_HALF_WIDTH : CALL_HALF_WIDTH;
    const height = shown ? HELD_HEIGHT : CALL_HEIGHT;
    return y >= 0 && y <= height && Math.abs(x - width / 2) <= half;
  }

  const X_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>';

  function create(opts) {
    const doc = opts.document;
    const win = opts.window;
    const setT = opts.setTimeout || global.setTimeout.bind(global);
    const clearT = opts.clearTimeout || global.clearTimeout.bind(global);
    let btn = null;
    let shown = false;
    let timer = null;

    function build() {
      btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'immersive-exit';
      btn.setAttribute('aria-label', opts.label);
      btn.title = opts.label;
      btn.innerHTML = X_ICON;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setShown(false);
        opts.onExit();
      });
      btn.addEventListener('focus', function () { setShown(true); });
      btn.addEventListener('blur', function () { setShown(false); });
      doc.body.appendChild(btn);
      syncAvailable();
    }

    // The button is there only while there is something to leave (css/style.css: is-available).
    function syncAvailable() {
      if (!btn) return;
      const on = !!opts.isImmersive();
      btn.classList.toggle('is-available', on);
      if (!on) setShown(false);
    }

    function setShown(on) {
      if (timer) { clearT(timer); timer = null; }
      if (on === shown) return;
      shown = on;
      if (btn) btn.classList.toggle('is-down', on);
    }

    function onMove(e) {
      if (!opts.isImmersive()) { if (shown) setShown(false); return; }
      if (!btn) build();
      if (!btn.classList.contains('is-available')) syncAvailable();
      if (inZone(e.clientX, e.clientY, win.innerWidth, shown)) {
        setShown(true);
      } else if (shown && !timer && doc.activeElement !== btn) {
        timer = setT(function () { timer = null; if (doc.activeElement !== btn) setShown(false); }, AWAY_DELAY_MS);
      }
    }

    win.addEventListener('pointermove', onMove, { passive: true });
    if (typeof opts.MutationObserver === 'function' || typeof global.MutationObserver === 'function') {
      const Observer = opts.MutationObserver || global.MutationObserver;
      new Observer(syncAvailable).observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    }
    doc.addEventListener('mouseleave', function () { if (shown && doc.activeElement !== btn) setShown(false); });
    // Tab reaches the button even before the pointer has called it (a keyboard user): it is built as soon as there is something to leave.
    return { onMove: onMove, isShown: function () { return shown; }, ensure: function () { if (!btn) build(); return btn; }, sync: syncAvailable };
  }

  const api = { inZone: inZone, create: create, AWAY_DELAY_MS: AWAY_DELAY_MS };
  global.ImmersiveExit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
