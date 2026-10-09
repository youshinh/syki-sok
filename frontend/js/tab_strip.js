// syki::sok index tabs (v2, docs/design/v2-plan-P3.md): the pure parts of the thin strip of tabs on the window's edge.
//
// What is here touches no document and starts nothing when it loads, so Node can test all of it (frontend/js/tab_strip_test.js):
//   stripsFor(state)              which strips the four views show: one page / a book (left + right) / preview beside the note / preview only
//   distanceOf(index, selected)   how far a tab is from the selected one (the CSS shades by it: --d)
//   mixFor(distance, ...)         how much accent a tab is filled with at that distance (what css `--tab-o` computes; the tests share the numbers)
//   keyMove(key, index, count)    arrow keys, Home and End inside a strip (a vertical tablist: Up/Down, wraps around)
//   dropTarget(rects, y, id)      where a tab dragged to height `y` would land
//   reorder(ids, from, to, after) the new order of ids after that drop
//   pinnedWidth(raw)              the width a pinned strip takes for a dragged width: clamped, or 'unpin' when dragged past the least that holds its buttons
//   reconcile(listEl, items, cache, hooks)
//                                 keyed update of the tabs: an element per tab that is made once, kept in `cache`, and only written when
//                                 something about its tab changed. Needs nothing of the DOM but `children`, `appendChild` and `innerHTML = ''`
//                                 (the test doubles of the app have no more), and does no work at all for a render that changes nothing.
//
// Cost model: nothing runs per keystroke. The app calls reconcile() when the tab bar is drawn; a draw that changed nothing compares
// N values and writes nothing.
(function (global) {
  'use strict';

  // The shading of a tab by its distance from the selected one: `max(floor, base - step * distance)`, the selected tab being 1. The
  // same three numbers are the CSS variables --tab-mix-floor / --tab-mix-base / --tab-mix-step (css/style.css); a test compares them.
  const MIX_FLOOR = 0.2;
  const MIX_BASE = 0.68;
  const MIX_STEP = 0.12;
  // A tab further away than this is shaded like this one, so moving the selection rewrites only the tabs near it.
  const MAX_DISTANCE = 12;

  // ---- which strips a view shows ------------------------------------------------------------------------------------------------

  // state: { isPreviewMode, isSplitMode, secondaryViewMode }. The views (docs/design/v2-visual-2026-10.md 4.2):
  //   'left'  one page, or the note with its preview beside it (the preview follows the left page, so there is nothing to pick on the right)
  //   'both'  two note pages: each has its own strip
  //   'none'  the preview alone
  function stripsFor(state) {
    const s = state || {};
    if (s.isPreviewMode) return { mode: 'none', left: false, right: false };
    if (s.isSplitMode && s.secondaryViewMode === 'editor') return { mode: 'both', left: true, right: true };
    return { mode: 'left', left: true, right: false };
  }

  // ---- shading ------------------------------------------------------------------------------------------------------------------

  // The index distance of a tab from the selected one; a strip with no selected tab is "far" for every tab.
  function distanceOf(index, selectedIndex) {
    if (!(selectedIndex >= 0) || !(index >= 0)) return MAX_DISTANCE;
    return Math.min(Math.abs(index - selectedIndex), MAX_DISTANCE);
  }

  function mixFor(distance, floor, base, step) {
    const d = Number(distance);
    if (!(d > 0)) return 1;
    const f = floor === undefined ? MIX_FLOOR : floor;
    const b = base === undefined ? MIX_BASE : base;
    const s = step === undefined ? MIX_STEP : step;
    return Math.max(f, b - s * d);
  }

  // ---- keys ---------------------------------------------------------------------------------------------------------------------

  // The index a key moves the focus to inside a strip of `count` tabs from `index`, or -1 when the key is not a movement. Up/Down walk
  // (and wrap), Left/Right do the same so a strip also answers to the arrows of a horizontal tablist; Home and End jump.
  function keyMove(key, index, count) {
    if (!(count > 0)) return -1;
    const at = index >= 0 && index < count ? index : 0;
    switch (key) {
      case 'ArrowDown': case 'ArrowRight': return (at + 1) % count;
      case 'ArrowUp': case 'ArrowLeft': return (at - 1 + count) % count;
      case 'Home': return 0;
      case 'End': return count - 1;
      default: return -1;
    }
  }

  // ---- reordering ---------------------------------------------------------------------------------------------------------------

  // rects: [{ id, top, bottom }] in strip order (the tabs' boxes), y: the pointer's height, draggedId: the tab being dragged (never its
  // own target). The tab the pointer is over takes the dragged one before it (upper half) or after it (lower half); above the first or
  // below the last tab the dragged one goes to that end. null when nothing is a target (the pointer is over the dragged tab itself).
  function dropTarget(rects, y, draggedId) {
    const list = Array.isArray(rects) ? rects : [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.id === draggedId) continue;
      if (y >= r.top && y <= r.bottom) return { id: r.id, after: y > r.top + (r.bottom - r.top) / 2 };
    }
    if (list.length > 1) {
      const first = list[0];
      const last = list[list.length - 1];
      if (y < first.top && first.id !== draggedId) return { id: first.id, after: false };
      if (y > last.bottom && last.id !== draggedId) return { id: last.id, after: true };
    }
    return null;
  }

  // ids: the tabs' ids in order. Moves `fromId` next to `toId` (after it when `after`). Returns the new order, or null when nothing
  // would change (unknown ids, dropped on itself, or already there).
  function reorder(ids, fromId, toId, after) {
    const list = Array.isArray(ids) ? ids.slice() : [];
    const from = list.indexOf(fromId);
    if (from < 0 || fromId === toId || list.indexOf(toId) < 0) return null;
    list.splice(from, 1);
    let to = list.indexOf(toId);
    if (after) to++;
    list.splice(to, 0, fromId);
    for (let i = 0; i < list.length; i++) if (list[i] !== ids[i]) return list;
    return null;
  }

  // ---- keyed update -------------------------------------------------------------------------------------------------------------

  // Makes listEl hold one element per item, in the items' order.
  //   items   the tabs, in order
  //   cache   Map key -> element, owned by the caller; entries are added for new items and dropped for items that are gone
  //   hooks   { keyOf(item), make(item, index) -> a new element, update(el, item, index) }
  // Every element is made once and written only by update() (which is told about every item, every time, and writes only what changed).
  // listEl is touched only when the elements it holds are not already the first ones of the list in order: new ones at the end are
  // appended, anything else (a tab closed or moved, in the middle) empties the list and appends the kept elements again.
  // Returns { structural, created, removed } so the caller knows whether the DOM changed shape (the focus may have been lost then).
  function reconcile(listEl, items, cache, hooks) {
    const want = [];
    const seen = new Set();
    let created = 0;
    let removed = 0;
    for (let i = 0; i < items.length; i++) {
      const key = hooks.keyOf(items[i]);
      let el = cache.get(key);
      if (!el) {
        el = hooks.make(items[i], i);
        cache.set(key, el);
        created++;
      }
      hooks.update(el, items[i], i);
      want.push(el);
      seen.add(key);
    }
    if (cache.size > want.length) {
      Array.from(cache.keys()).forEach((key) => {
        if (!seen.has(key)) { cache.delete(key); removed++; }
      });
    }
    const have = listEl.children || [];
    let structural = false;
    let prefix = true; // the list holds the first elements of `want`, in order (an extra element at the end counts as a mismatch with undefined)
    for (let i = 0; prefix && i < have.length; i++) if (have[i] !== want[i]) prefix = false;
    if (prefix) {
      for (let i = have.length; i < want.length; i++) listEl.appendChild(want[i]);
    } else {
      structural = true;
      listEl.innerHTML = '';
      for (let i = 0; i < want.length; i++) listEl.appendChild(want[i]);
    }
    return { structural, created, removed };
  }

  // ---- the width of a pinned strip ----------------------------------------------------------------------------------------------

  // The strip's foot holds three buttons (four while the All tabs button shows); PINNED_MIN is the least width that keeps them whole (about
  // 24px each). Dragged further than PINNED_UNPIN the strip is let go: it stops being pinned, and the next pin starts from the last width.
  const PINNED_DEFAULT = 200;
  const PINNED_MIN = 96;
  const PINNED_MAX = 480;
  const PINNED_UNPIN = 72;

  // raw: the width the pointer asks for, in px. -> { width, unpin }: width is the clamped one, unpin is true past PINNED_UNPIN.
  function pinnedWidth(raw) {
    const n = Number(raw);
    if (!isFinite(n)) return { width: PINNED_DEFAULT, unpin: false };
    return { width: Math.round(Math.min(PINNED_MAX, Math.max(PINNED_MIN, n))), unpin: n < PINNED_UNPIN };
  }

  const api = {
    MIX_FLOOR, MIX_BASE, MIX_STEP, MAX_DISTANCE,
    PINNED_DEFAULT, PINNED_MIN, PINNED_MAX, PINNED_UNPIN,
    stripsFor, distanceOf, mixFor, keyMove, dropTarget, reorder, reconcile, pinnedWidth
  };
  global.TabStrip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
