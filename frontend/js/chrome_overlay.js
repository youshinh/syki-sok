// The header and the status bar are overlays: they sit over the top and the bottom of the window and the text scrolls under them
// (css/chrome.css; docs/design/v2-plan-P2.md). This module is the small part of that which needs script.
//
// Auto-hide. While you write or scroll the bars fade away (body.chrome-faded: opacity 0 and pointer-events none, nothing else -
// no layout, no visibility change, so they stay in the reading order and a screen reader still reads the status line); a mouse
// move brings them back. Two states, no timer:
//   SHOWN  the bars are there. Listening: a trusted `input` or `compositionstart` in a note editor (Japanese IME keydowns say
//          key "Process", so keydown is no use), a scroll the person caused (see below), and where the pointer is (two numbers).
//   AWAY   body.chrome-faded. Listening: the mouse moving more than a few px, a touch, focus leaving the note for something else
//          (the ask bar, a dialog). Not listening to typing or scrolling any more.
//   The bars stay visible in AWAY while keyboard focus is inside them (:focus-within, in CSS), while a menu of the header is open,
//   and while the status bar has something to say (data-pin, set here from FOOTER_PINS / HEADER_PINS).
// A scroll hides the bars only after a wheel, a navigation key or a press on the text or on its scrollbar (INTENT_MS): switching
// tabs or jumping to a search hit scrolls the text by script, and that must not make the header you just clicked disappear.
// Switched off (autoHide false) or never configured, nothing is listening at all.
//
// Zen mode (setZen; body.zen-mode is the permanent switch, Shift+F11) is the same away state made permanent, with a narrower way
// back: the mouse moving does NOT bring the bars back. A bar comes back (data-pin, so it fades in like any other) when the pointer
// stays HOT_DWELL_MS in the 6px band at the top (the header) or at the bottom (the status bar) edge of the window, and goes
// HOT_LEAVE_MS after the pointer left the bar again; when focus is inside it (F6 / Tab, CSS :focus-within); while a failure is
// on the status line (a message shown with showMessage's { important: true }); while something is being recorded; and while a
// menu of the bar is open. The two timers exist only inside Zen mode. Zen needs no autoHide: it brings its own listeners.
//
//   insets(el)   how much of the top and of the bottom of `el` the two bars cover, in px, read from where the bars really are. The
//                code that places things by hand (a panel docked under the header, the line a search jumps to, the Jev panel) asks
//                this instead of knowing the bars' heights: an element that starts below the header (the second pane's own strip)
//                gets 0 at the top, and a bar that is hidden by Zen mode (height 0) covers nothing. Without the bars (a page that
//                does not have them, a test) it answers 0 and 0.
(function (global) {
  'use strict';

  const DEAD_ZONE = 6; // px the mouse has to travel, from where it was when the bars went away, to bring them back
  const HOT_ZONE = 6; // Zen mode: px of the window's top and bottom edge that call a bar
  const HOT_DWELL_MS = 150; // Zen mode: how long the pointer has to stay in that band
  const HOT_LEAVE_MS = 700; // Zen mode: how long after the pointer left the bar before the bar goes
  const INTENT_MS = 300; // a scroll this soon after a wheel / navigation key / press is the person's
  const AWAY_CLASS = 'chrome-faded';
  // What keeps the status bar in view while the rest is away: something is being said, running or recorded, or its popover is open.
  // A quiet message (the automatic "Saved") does not count.
  const FOOTER_PINS = [
    '#stat-message:not(:empty):not([data-quiet])',
    '#stat-llm-indicator:not(.hidden)',
    '#stat-tasks:not(.hidden)',
    '#stat-recording:not(.hidden)',
    '#stat-ai[aria-expanded="true"]'
  ];
  // In Zen mode the status line stays away for everything but a failure (a message shown with { important: true }), a recording and its
  // own open popover: a running task or AI request, an ordinary message and the like do not call it back.
  const ZEN_FOOTER_PINS = [
    '#stat-message[data-important]:not(:empty)',
    '#stat-recording:not(.hidden)',
    '#stat-ai[aria-expanded="true"]'
  ];
  // The header stays while one of its menus (Help, All tabs) is open.
  const HEADER_PINS = ['[aria-expanded="true"]'];
  const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];

  // ---- pure parts (exported for Node tests) -------------------------------------------------------------------------------

  function rectOf(el) {
    return el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  }

  // The part of `box`'s top and bottom edge that is under `header` / `footer` (all rectangles in the same viewport coordinates).
  function coverage(box, header, footer) {
    if (!box) return { top: 0, bottom: 0 };
    const top = header ? Math.max(0, Math.min(header.bottom, box.bottom) - box.top) : 0;
    const bottom = footer ? Math.max(0, box.bottom - Math.max(footer.top, box.top)) : 0;
    return { top: Math.round(top), bottom: Math.round(bottom) };
  }

  function insets(el, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || typeof d.getElementById !== 'function') return { top: 0, bottom: 0 };
    try {
      return coverage(rectOf(el), rectOf(d.getElementById('header')), rectOf(d.getElementById('status-bar')));
    } catch (e) {
      return { top: 0, bottom: 0 };
    }
  }

  // Which edge band of a window `height` px tall is the pointer at `y` in? 'top', 'bottom' or null.
  function hotZoneOf(y, height, zone) {
    const z = zone === undefined ? HOT_ZONE : zone;
    if (typeof y !== 'number' || !(y >= 0)) return null;
    if (y < z) return 'top';
    if (height > 0 && y >= height - z && y <= height) return 'bottom';
    return null;
  }

  // Has the pointer left the dead zone around `anchor` ({x, y})? A mouse that only trembles, or a synthetic move to the same
  // spot, stays inside.
  function movedFar(anchor, x, y, zone) {
    if (!anchor) return false;
    return Math.abs(x - anchor.x) + Math.abs(y - anchor.y) >= (zone === undefined ? DEAD_ZONE : zone);
  }

  // A key that scrolls the text by itself. Ctrl+Home / Ctrl+End too; Alt and Cmd chords are commands, not scrolling.
  function isNavigationKey(e) {
    if (!e || e.altKey || e.metaKey) return false;
    if (NAV_KEYS.indexOf(e.key) === -1) return false;
    if (e.ctrlKey && e.key !== 'Home' && e.key !== 'End') return false;
    return true;
  }

  // ---- the controller -----------------------------------------------------------------------------------------------------

  // create(opts) -> controller
  //   opts.isEditor(node)    is `node` one of the note editors (the textareas)?
  //   opts.scrollers()       the elements whose scrolling counts: the editors and the two previews
  //   opts.focusNote()       put the focus back in the note (F6 round trip, Esc from a bar)
  //   opts.strips()          the strips of the index tabs (docs/design/v2-plan-P3.md) that F6 stops at between the header and the status bar,
  //                          left page first: elements, or nothing for a strip that is not there
  //   opts.footerPins / opts.headerPins   selector lists (default: FOOTER_PINS / HEADER_PINS)
  //   opts.doc / opts.win / opts.setTimeout / opts.MutationObserver   test seams
  // Nothing is listened to until configure({ autoHide: true }).
  function create(opts) {
    const o = opts || {};
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    const win = o.win || (typeof window !== 'undefined' ? window : null);
    const body = o.body || (doc && doc.body);
    const header = o.header || (doc && doc.getElementById('header'));
    const footer = o.footer || (doc && doc.getElementById('status-bar'));
    const footerPins = o.footerPins || FOOTER_PINS;
    const zenFooterPins = o.zenFooterPins || ZEN_FOOTER_PINS;
    const headerPins = o.headerPins || HEADER_PINS;
    const later = o.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const unlater = o.clearTimeout || ((id) => clearTimeout(id));
    const Observer = o.MutationObserver || (win && win.MutationObserver) || null;
    const isEditor = typeof o.isEditor === 'function' ? o.isEditor : () => false;
    const scrollersOf = typeof o.scrollers === 'function' ? o.scrollers : () => [];

    let enabled = false;
    let away = false;
    let intentAt = -Infinity; // timeStamp of the last wheel / navigation key / press on the text
    let lastX = null; // where the pointer was last seen while the bars were shown
    let lastY = null;
    let anchor = null; // where it was when the bars went away
    let shownSet = [];
    let awaySet = [];
    let zenSet = [];
    let attached = 0;
    let observer = null;
    // Zen mode: the permanent away state, and the bar the pointer has called back (peek) with where that bar ends (the pointer is
    // still "on" it above/below that line).
    let zen = false;
    const peek = { top: false, bottom: false };
    const peekEdge = { top: 0, bottom: 0 };
    let dwellZone = null; // the edge band the pointer is in now, while it is not yet called a bar
    let dwellTimer = null;
    let leaveTimer = null;

    function trusted(e) { return !!e && e.isTrusted !== false; }

    function inScroller(node) {
      const list = scrollersOf();
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (el && (el === node || (typeof el.contains === 'function' && el.contains(node)))) return true;
      }
      return false;
    }

    // ---- listeners: one set while the bars are shown, another while they are away; never both ----

    function listen(list, type, fn) {
      if (!doc || typeof doc.addEventListener !== 'function') return;
      doc.addEventListener(type, fn, { capture: true, passive: true });
      list.push([type, fn]);
      attached++;
    }

    function unlisten(list) {
      for (let i = 0; i < list.length; i++) {
        doc.removeEventListener(list[i][0], list[i][1], { capture: true });
        attached--;
      }
      list.length = 0;
    }

    function onInput(e) {
      if (trusted(e) && isEditor(e.target)) goAway();
    }

    function onWheel(e) {
      if (trusted(e) && inScroller(e.target)) intentAt = e.timeStamp;
    }

    function onKey(e) {
      if (!trusted(e) || !isNavigationKey(e)) return;
      if (inScroller(e.target) || e.target === doc.body || e.target === doc.documentElement) intentAt = e.timeStamp;
    }

    // A press on the text, or on its scrollbar (the scrollbar belongs to the scrolling box, so the press lands on it).
    function onPointerDown(e) {
      if (trusted(e) && inScroller(e.target)) intentAt = e.timeStamp;
    }

    function onScroll(e) {
      const target = e.target;
      if (!target || e.timeStamp - intentAt > INTENT_MS) return;
      const list = scrollersOf();
      for (let i = 0; i < list.length; i++) {
        if (list[i] === target) { goAway(); return; }
      }
    }

    // While the bars are shown the pointer's position is only noted (two numbers per move, no work); when the bars have gone away that
    // spot is the anchor, and the mouse has to leave it by a few px to bring them back. A pointer that has not been seen at all (the
    // first move since the page opened, a mouse that jumps in from elsewhere) is a real move: the bars come back at once. The moves
    // the browser makes itself after a scroll or a layout change stay on the spot and do nothing.
    function onPointerNote(e) {
      lastX = e.clientX;
      lastY = e.clientY;
    }

    function onPointerMove(e) {
      if (!trusted(e)) return;
      if (!anchor) {
        if (lastX === null) { onPointerNote(e); goShown(); return; }
        anchor = { x: lastX, y: lastY };
      }
      if (movedFar(anchor, e.clientX, e.clientY)) {
        onPointerNote(e); // the move that brings the bars back is where the pointer is now
        goShown();
      }
    }

    // A finger or a pen that touches the screen has no moves before it: the bars come back for the touch itself.
    function onPointerDownAway(e) {
      if (trusted(e) && e.pointerType && e.pointerType !== 'mouse') goShown();
    }

    // Focus left a note editor: if it did not go to the other pane, the person is doing something else (the ask bar, a dialog).
    function onFocusOut(e) {
      if (!isEditor(e.target)) return;
      later(() => {
        if (away && doc && !isEditor(doc.activeElement)) goShown();
      }, 0);
    }

    function attachShown() {
      listen(shownSet, 'input', onInput);
      listen(shownSet, 'compositionstart', onInput);
      listen(shownSet, 'wheel', onWheel);
      listen(shownSet, 'keydown', onKey);
      listen(shownSet, 'pointerdown', onPointerDown);
      listen(shownSet, 'scroll', onScroll);
      listen(shownSet, 'pointermove', onPointerNote);
    }

    function attachAway() {
      anchor = null; // made from the last spot seen at the first move
      listen(awaySet, 'pointermove', onPointerMove);
      listen(awaySet, 'pointerdown', onPointerDownAway);
      listen(awaySet, 'focusout', onFocusOut);
      watchPins();
    }

    // ---- what keeps a bar in view (data-pin), kept up to date only while the bars are away ----

    function anyMatch(root, selectors) {
      if (!root || typeof root.querySelector !== 'function') return false;
      for (let i = 0; i < selectors.length; i++) {
        if (root.querySelector(selectors[i])) return true;
      }
      return false;
    }

    function setPin(el, on) {
      if (!el || typeof el.setAttribute !== 'function') return;
      if (on) {
        if (!el.hasAttribute('data-pin')) el.setAttribute('data-pin', '');
      } else if (el.hasAttribute('data-pin')) {
        el.removeAttribute('data-pin');
      }
    }

    function syncPins() {
      setPin(footer, (zen && peek.bottom) || anyMatch(footer, zen ? zenFooterPins : footerPins));
      setPin(header, (zen && peek.top) || anyMatch(header, headerPins));
    }

    function watchPins() {
      syncPins();
      if (!Observer || observer) return;
      try {
        observer = new Observer(syncPins);
        if (header) observer.observe(header, { attributes: true, attributeFilter: ['aria-expanded'], subtree: true });
        if (footer) {
          observer.observe(footer, { attributes: true, attributeFilter: ['class', 'aria-expanded', 'data-quiet', 'data-important'], subtree: true });
          const message = footer.querySelector && footer.querySelector('#stat-message');
          if (message) observer.observe(message, { childList: true, characterData: true, subtree: true });
        }
      } catch (e) {
        observer = null; // no pins: the bars simply stay away until the mouse moves
      }
    }

    function unwatchPins() {
      if (observer) { observer.disconnect(); observer = null; }
      setPin(footer, false);
      setPin(header, false);
    }

    // ---- the two transitions ----

    function goAway() {
      if (!enabled || away || !body) return;
      away = true;
      unlisten(shownSet);
      body.classList.add(AWAY_CLASS);
      attachAway();
    }

    function goShown() {
      if (!away || zen) return; // Zen mode is left with setZen(false), not by the mouse or by show()
      away = false;
      unlisten(awaySet);
      unwatchPins();
      if (body) body.classList.remove(AWAY_CLASS);
      intentAt = -Infinity;
      if (enabled) attachShown();
    }

    // ---- Zen mode: away for good; a bar is called back by the pointer waiting at its edge, by focus, or by a failure ----

    function cancelDwell() {
      if (dwellTimer !== null) { unlater(dwellTimer); dwellTimer = null; }
    }

    function cancelLeave() {
      if (leaveTimer !== null) { unlater(leaveTimer); leaveTimer = null; }
    }

    function peekAway() {
      peek.top = false;
      peek.bottom = false;
      syncPins();
    }

    function startLeave() {
      if (leaveTimer !== null) return;
      leaveTimer = later(() => { leaveTimer = null; if (zen) peekAway(); }, HOT_LEAVE_MS);
    }

    // Call the bar of this edge back. Where it ends is read once now (it keeps its place while it is away, only its opacity is 0).
    function revealEdge(zone) {
      dwellTimer = null;
      if (!zen || peek[zone]) return;
      const r = rectOf(zone === 'top' ? header : footer);
      peekEdge[zone] = r ? (zone === 'top' ? r.bottom : r.top) : (zone === 'top' ? 0 : Infinity);
      peek[zone] = true;
      cancelLeave();
      syncPins();
    }

    function zenMove(e) {
      if (!trusted(e)) return;
      const y = e.clientY;
      const height = win && win.innerHeight ? win.innerHeight : (doc.documentElement && doc.documentElement.clientHeight) || 0;
      const zone = hotZoneOf(y, height);
      if (zone !== dwellZone) {
        cancelDwell();
        dwellZone = zone;
        if (zone && !peek[zone]) dwellTimer = later(() => revealEdge(zone), HOT_DWELL_MS);
      }
      if (peek.top || peek.bottom) {
        const onBar = zone !== null || (peek.top && y < peekEdge.top) || (peek.bottom && y >= peekEdge.bottom);
        if (onBar) cancelLeave(); else startLeave();
      }
    }

    // The pointer left the window: it is nowhere near a bar any more.
    function zenOut(e) {
      if (e.relatedTarget) return;
      cancelDwell();
      dwellZone = null;
      if (peek.top || peek.bottom) startLeave();
    }

    function setZen(on) {
      const want = !!on;
      if (want === zen || !body) return;
      zen = want;
      cancelDwell();
      cancelLeave();
      dwellZone = null;
      peek.top = false;
      peek.bottom = false;
      if (zen) {
        if (away) {
          unlisten(awaySet);
        } else {
          unlisten(shownSet);
          away = true;
          body.classList.add(AWAY_CLASS);
        }
        unwatchPins();
        listen(zenSet, 'pointermove', zenMove);
        listen(zenSet, 'pointerout', zenOut);
        watchPins();
      } else {
        unlisten(zenSet);
        unwatchPins();
        away = false;
        body.classList.remove(AWAY_CLASS);
        intentAt = -Infinity;
        if (enabled) attachShown();
      }
    }

    // ---- the controller ----

    function configure(settings) {
      const want = !!(settings && settings.autoHide);
      if (want === enabled) return;
      enabled = want;
      if (enabled) {
        if (!away) attachShown();
      } else {
        goShown();
        unlisten(shownSet);
      }
    }

    function isIn(bar, node) {
      return !!(bar && node && bar.contains && bar.contains(node));
    }

    // The strips of the index tabs that can be stopped at now.
    function stripEls() {
      const list = typeof o.strips === 'function' ? o.strips() : [];
      return Array.isArray(list) ? list.filter(Boolean) : [];
    }

    // Is keyboard focus inside one of the bars or one of the strips?
    function focusInBar() {
      const a = doc && doc.activeElement;
      return isIn(header, a) || isIn(footer, a) || stripEls().some((strip) => isIn(strip, a));
    }

    function visible(el) {
      return !!el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0));
    }

    // The first control of a bar that takes the focus (a hidden or disabled one, or one that cannot be focused, is passed over). A stop that is
    // itself a roving tab stop (the divider between two pages: tabindex="0", nothing inside) takes the focus itself.
    function focusFirstIn(bar) {
      if (bar && typeof bar.getAttribute === 'function' && bar.getAttribute('tabindex') === '0' && visible(bar) && typeof bar.focus === 'function') {
        bar.focus();
        return doc.activeElement === bar;
      }
      if (!bar || typeof bar.querySelectorAll !== 'function') return false;
      const all = bar.querySelectorAll('button, [tabindex="0"]');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.disabled || !visible(el) || typeof el.focus !== 'function') continue;
        el.focus();
        if (doc.activeElement === el) return true;
      }
      return false;
    }

    // The name a stop of the round goes by in what focusBar returns: 'strip-left' / 'strip-right' (by data-side), else its data-stop (the
    // divider between two pages is 'divider'), else 'strip'.
    function stripName(strip) {
      const get = (k) => (strip && typeof strip.getAttribute === 'function' ? strip.getAttribute(k) : null);
      const side = get('data-side');
      return side ? 'strip-' + side : get('data-stop') || 'strip';
    }

    // F6 / Shift+F6: the note -> the header -> the strips of the index tabs (the left page's, then the right page's, when there are two)
    // -> the divider between the two pages (when there are two; the editors keep Tab for indenting, so F6 is how the keyboard gets to it)
    // -> the status bar -> the note. The bars come back for it; a stop that cannot take the focus (a strip that is hidden, a bar with
    // nothing in it) is passed over.
    function focusBar(direction) {
      const step = direction < 0 ? -1 : 1;
      const a = doc && doc.activeElement;
      const strips = stripEls();
      const stops = [{ name: 'note' }, { name: 'header', el: header }]
        .concat(strips.map((el) => ({ name: stripName(el), el })))
        .concat([{ name: 'footer', el: footer }]);
      let at = 0;
      for (let i = 1; i < stops.length; i++) if (isIn(stops[i].el, a)) { at = i; break; }
      goShown();
      for (let n = 1; n <= stops.length; n++) {
        const stop = stops[(((at + step * n) % stops.length) + stops.length) % stops.length];
        if (stop.name === 'note') {
          if (typeof o.focusNote === 'function') o.focusNote();
          return 'note';
        }
        if (focusFirstIn(stop.el)) return stop.name;
      }
      return null;
    }

    // Esc in a bar: back to the note. True when it did something (the caller then stops handling Esc).
    function leaveBar() {
      if (!focusInBar()) return false;
      if (typeof o.focusNote === 'function') o.focusNote();
      return true;
    }

    const controller = {
      configure: configure,
      setZen: setZen,
      isZen: () => zen,
      show: goShown,
      away: goAway,
      isAway: () => away,
      isEnabled: () => enabled,
      focusBar: focusBar,
      focusInBar: focusInBar,
      leaveBar: leaveBar,
      // An HTML page in the preview scrolls inside its iframe, where no event reaches this page: app.js tells it so.
      scrolled: goAway,
      listenerCount: () => attached,
      footerPins: footerPins,
      zenFooterPins: zenFooterPins,
      headerPins: headerPins
    };
    api.current = controller;
    return controller;
  }

  const api = {
    DEAD_ZONE: DEAD_ZONE,
    HOT_ZONE: HOT_ZONE,
    HOT_DWELL_MS: HOT_DWELL_MS,
    HOT_LEAVE_MS: HOT_LEAVE_MS,
    INTENT_MS: INTENT_MS,
    AWAY_CLASS: AWAY_CLASS,
    FOOTER_PINS: FOOTER_PINS,
    ZEN_FOOTER_PINS: ZEN_FOOTER_PINS,
    HEADER_PINS: HEADER_PINS,
    coverage: coverage,
    insets: insets,
    hotZoneOf: hotZoneOf,
    movedFar: movedFar,
    isNavigationKey: isNavigationKey,
    create: create,
    current: null
  };
  global.ChromeOverlay = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
