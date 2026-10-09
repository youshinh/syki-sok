// syki::sok index tabs, the Dock's magnification (docs/design/v2-plan-P3.md; css/style.css, .dock-live).
//
// While the mouse is over an index strip, every tab comes out to a resting width (BASE_W: the names can be read) and the tab under the pointer
// comes out the furthest, to the full open width; its neighbours follow on a bell curve, so a wave of tabs rises under the pointer and follows
// it up and down the strip, and it is a little taller too. When the mouse leaves, the strip eases back to its thin edge. Nothing is shaded.
//
// Cost model: this file is loaded the first time the mouse reaches a strip, never at start-up. Nothing runs while the mouse is elsewhere.
// While it is over a strip:
//  * the rows' positions are read once when the pointer arrives (and again only when the column scrolls, the window is resized or the number
//    of tabs changes), never inside a frame: a read after the previous frame's writes would force a second layout every frame;
//  * a frame writes only the values of the rows that moved (a row far from the pointer holds still and costs nothing);
//  * the loop sleeps as soon as everything has settled (a pointer that rests costs no frames) and a pointer move wakes it;
//  * the easing is by elapsed time, so it runs the same at 60 and 120 Hz and does not stutter when a frame is late;
//  * when everything has gone back to the thin edge every inline value is removed, so the plain CSS state is back.
//
// The pure functions at the top touch no DOM and are tested by Node (tests/tab_dock_test.mjs).
(function (global) {
  'use strict';

  const BASE_W = 90;       // the width every tab has while the mouse is over the strip (px)
  const SIGMA = 62;        // the bell's width in px of distance from the pointer: about two tabs on each side
  const TAU_ROW = 60;      // ms: the time a tab takes to cover about two thirds of the way to its target
  const TAU_ALL = 95;      // ms: the same for the strip as a whole coming out / going back (about a quarter of a second to arrive)
  const MAX_DT = 50;       // ms: a frame later than this counts as this (a stalled page must not jump)
  const TEXT_FROM = 50;    // the width at which a name starts to show, and
  const TEXT_SPAN = 40;    // the width span over which it fades in
  const EXTRA_H = 12;      // how much taller the tab under the pointer gets (px)

  // The share (0..1) of the full magnification a row whose centre is `centre` gets with the pointer at `y`.
  function bell(centre, y, sigma) {
    const d = (centre - y) / (sigma || SIGMA);
    return Math.exp(-d * d);
  }

  // The width of a row: `hit` while collapsed (hover 0, m 0), `base` with the mouse over the strip (hover 1, m 0), `full` under the pointer (m 1).
  function rowWidth(hit, base, full, hover, m) {
    const b = Math.min(base, full);
    return hit + (b - hit) * hover + (full - b) * m;
  }

  // How much of its name a row of width w shows (0..1).
  function textShare(w) {
    return Math.max(0, Math.min(1, (w - TEXT_FROM) / TEXT_SPAN));
  }

  // The strength the person set (Settings), kept where the dock still looks right: below MIN_STRENGTH the wave is too small to see, and the
  // widest tab cannot pass the strip's own width, so there is no strength above 100.
  const MIN_STRENGTH = 20;
  function strengthOf(v) {
    const n = Number(v);
    if (!isFinite(n)) return 100;
    return Math.max(MIN_STRENGTH, Math.min(100, Math.round(n)));
  }

  // How much of a row the base colour covers: none while the row is a thin edge, all of it a few pixels further out.
  function fillShare(w, hit) {
    return Math.max(0, Math.min(1, (w - hit) / 20));
  }

  // The share of the way to its target a value moves in `dt` ms with time constant `tau` ms (1 when there is no easing).
  function easeShare(dt, tau) {
    if (!(tau > 0)) return 1;
    return 1 - Math.exp(-Math.min(Math.max(dt, 0), MAX_DT) / tau);
  }

  // ---- DOM ----------------------------------------------------------------------------------------------------------------------

  // opts: { strips: [{ el, listEl, footEl?, scrollEl? }], hitWidth, fullWidth(): px, strength?(): 20..100 (the share of the full magnification,
  // default 100), instant?(): true when the system asks for less motion: the tabs then take their size at once instead of easing to it }.
  // Returns { destroy, enter }.
  function create(opts) {
    const win = global;
    const states = opts.strips.map((s) => ({
      s, hover: false, h: 0, y: 0, m: new WeakMap(), written: new WeakMap(), styled: new Set(), live: false,
      centres: null, count: -1, prevTs: 0
    }));
    let raf = 0;

    function rowsOf(st) {
      const rows = Array.prototype.slice.call(st.s.listEl.children);
      if (st.s.footEl) rows.push(st.s.footEl);
      return rows;
    }

    function clear(st) {
      st.styled.forEach((r) => {
        r.style.removeProperty('--rw');
        r.style.removeProperty('--st');
        r.style.removeProperty('--bgs');
        r.style.removeProperty('--rx');
      });
      st.styled.clear();
      st.written = new WeakMap();
      st.centres = null;
      st.prevTs = 0;
      st.h = 0;
      if (st.live) { st.s.el.classList.remove('dock-live'); st.live = false; }
    }

    // The centre of every row as it would stand without magnification (a taller row pushes the ones below it down, and a pointer that is held
    // still must not see them move under it), in the window's coordinates: the one read of positions, and it takes the height the rows have
    // added so far out of what it reads.
    function measure(st, rows, extraH) {
      let above = 0;
      return rows.map((r) => {
        const b = r.getBoundingClientRect();
        const extra = extraH * (st.m.get(r) || 0);
        const c = b.top + b.height / 2 - above - extra / 2;
        above += extra;
        return c;
      });
    }

    function put(r, st, name, text) {
      let w = st.written.get(r);
      if (!w) { w = {}; st.written.set(r, w); }
      if (w[name] === text) return;
      w[name] = text;
      r.style.setProperty(name, text);
    }

    function frame(ts) {
      raf = 0;
      let busy = false;
      const k = strengthOf(opts.strength ? opts.strength() : 100) / 100;
      const instant = !!(opts.instant && opts.instant());
      const open = Math.max(opts.hitWidth, opts.fullWidth());
      const full = Math.min(open, BASE_W) + (open - Math.min(open, BASE_W)) * k; // how far the tab under the pointer comes out
      const extraH = EXTRA_H * k;
      states.forEach((st) => {
        if (!st.live) return;
        const dt = st.prevTs ? ts - st.prevTs : 16.7;
        st.prevTs = ts;
        const easeAll = instant ? 1 : easeShare(dt, TAU_ALL);
        const easeRow = instant ? 1 : easeShare(dt, TAU_ROW);
        const rows = rowsOf(st);
        if (!st.centres || st.count !== rows.length) { st.centres = measure(st, rows, extraH); st.count = rows.length; }
        const hTarget = st.hover ? 1 : 0;
        st.h += (hTarget - st.h) * easeAll;
        if (Math.abs(hTarget - st.h) < 0.002) st.h = hTarget; else busy = true;
        rows.forEach((r, i) => {
          const target = st.hover ? bell(st.centres[i], st.y) : 0;
          let m = st.m.get(r) || 0;
          if (m === target && st.h === hTarget && st.written.has(r)) return; // this row has settled: nothing to compute or write
          m += (target - m) * easeRow;
          if (Math.abs(target - m) < 0.002) m = target; else busy = true;
          st.m.set(r, m);
          const w = rowWidth(opts.hitWidth, BASE_W, full, st.h, m);
          put(r, st, '--rw', w.toFixed(1) + 'px');
          put(r, st, '--st', textShare(w).toFixed(2));
          put(r, st, '--bgs', fillShare(w, opts.hitWidth).toFixed(2));
          put(r, st, '--rx', (extraH * m).toFixed(1) + 'px');
          st.styled.add(r);
        });
        if (!st.hover && st.h === 0 && !busy) clear(st);
      });
      if (busy) raf = win.requestAnimationFrame(frame);
    }

    function kick() { if (!raf) raf = win.requestAnimationFrame(frame); }

    function begin(st, e) {
      st.hover = true;
      st.y = e.clientY;
      if (!st.live) { st.s.el.classList.add('dock-live'); st.live = true; st.centres = null; }
      kick();
    }

    const listeners = [];
    function on(el, type, fn, o) { el.addEventListener(type, fn, o); listeners.push([el, type, fn, o]); }
    states.forEach((st) => {
      on(st.s.el, 'pointerenter', (e) => { if (e.pointerType !== 'touch') begin(st, e); });
      on(st.s.el, 'pointermove', (e) => { if (e.pointerType !== 'touch') begin(st, e); });
      on(st.s.el, 'pointerleave', () => { st.hover = false; kick(); });
      // The column scrolling (the wheel) moves every row: measure again at the next frame.
      const scroller = st.s.scrollEl || st.s.listEl.parentNode;
      if (scroller) on(scroller, 'scroll', () => { st.centres = null; kick(); }, { passive: true });
    });
    on(win, 'resize', () => { states.forEach((st) => { st.centres = null; }); });

    return {
      // the pointer event that reached a strip before this file was loaded
      enter(el, e) { const st = states.find((x) => x.s.el === el); if (st) begin(st, e); },
      destroy() {
        listeners.forEach(([el, type, fn, o]) => el.removeEventListener(type, fn, o));
        if (raf) win.cancelAnimationFrame(raf);
        raf = 0;
        states.forEach(clear);
      }
    };
  }

  const api = { BASE_W, SIGMA, EXTRA_H, MIN_STRENGTH, strengthOf, bell, rowWidth, textShare, fillShare, easeShare, create };
  global.TabDock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
