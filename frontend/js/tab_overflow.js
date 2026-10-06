// syki::sok tab strip overflow (docs/design/ux-review-2026-09.md, B2; the strips are v2, docs/design/v2-plan-P3.md).
//
// The tabs stand in a column on the window's edge, one column for each page that shows notes (the left page's, and the right page's when
// two note pages are on screen). With more tabs than fit, a column scrolls by itself (no scrollbar), "+" and the "All tabs" button stay put
// at the foot of the left strip, the edge where tabs are cut off fades, the tab each strip marks is scrolled into view when it changes
// (switch, create, close) and when the window is resized, and "All tabs" lists every tab (the open one marked, unsaved ones with their dot)
// in a panel that hangs beside the strip.
//
// Cost model (this file loads on every start):
//  * With tabs that fit, nothing is drawn: the button stays hidden, no fade, no list. The only work is one measuring pass
//    after the first render, plus a ResizeObserver that fires when the window or the tab heights change.
//  * The pure helpers below (measure, scrollTargetFor, rowsFor, stepIndex, panelPosition) touch no DOM, so Node tests cover them.
//  * The list is built on first use and rebuilt only while it is open.
//  * Nothing runs per keystroke: the app calls update() when the tab bar is rendered, and update() returns at once when neither
//    the focused tab nor the number of tabs changed.
(function (global) {
  'use strict';

  const EDGE = 1;          // px of slack when deciding "is there more to scroll to"
  const PEEK = 24;         // px of the neighbouring tab left in view after revealing one (it sits under the edge fade, which is 24px)
  const PANEL_WIDTH = 320; // the list, like the other small panels (docs/design/panel-template.md), 8px radius, 36px rows
  const PANEL_MARGIN = 8;

  const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  // ---- pure helpers ----------------------------------------------------------------------------------

  // view: { scrollTop, clientHeight, scrollHeight } of a scrolling column of tabs.
  function measure(view) {
    const max = Math.max(0, view.scrollHeight - view.clientHeight);
    return {
      overflowing: max > EDGE,
      canScrollUp: view.scrollTop > EDGE,
      canScrollDown: view.scrollTop < max - EDGE
    };
  }

  // The scrollTop that brings a tab into view, leaving `peek` px of its neighbours visible. The current value when the
  // tab is already in view. tab: { top, height } measured inside the scrolling content (not the viewport).
  function scrollTargetFor(view, tab, peek) {
    const max = Math.max(0, view.scrollHeight - view.clientHeight);
    if (max <= 0) return 0;
    const p = peek === undefined ? PEEK : peek;
    const top = tab.top - p;
    const bottom = tab.top + tab.height + p;
    let target = view.scrollTop;
    if (tab.height + 2 * p > view.clientHeight || top < target) target = top; // taller than the view: show its start
    else if (bottom > target + view.clientHeight) target = bottom - view.clientHeight;
    return Math.max(0, Math.min(max, Math.round(target)));
  }

  // The list rows for the "All tabs" panel.
  function rowsFor(tabs, activeId) {
    const list = Array.isArray(tabs) ? tabs : [];
    return list.map((tab, index) => ({
      id: tab.id,
      index,
      title: String((tab && tab.title) || ''),
      path: String((tab && tab.path) || ''),
      dirty: !!(tab && tab.isDirty),
      active: tab.id === activeId
    }));
  }

  // Arrow-key movement inside the list: wraps around; `count` 0 has no position.
  function stepIndex(index, delta, count) {
    if (!(count > 0)) return -1;
    const from = index < 0 ? (delta > 0 ? -1 : 0) : index;
    return (((from + delta) % count) + count) % count;
  }

  // Where the list sits, kept inside the window. By default under its button with the right edges aligned (anchor: the button's box).
  // placement 'side': beside the strip it belongs to, to its right, top edges aligned (anchor: the strip's box).
  function panelPosition(anchor, viewport, placement) {
    const width = Math.max(200, Math.min(PANEL_WIDTH, viewport.width - 2 * PANEL_MARGIN));
    if (placement === 'side') {
      const left = Math.max(PANEL_MARGIN, Math.min(anchor.right + 4, viewport.width - width - PANEL_MARGIN));
      const top = Math.round(Math.max(PANEL_MARGIN, Math.min(anchor.top, viewport.height - 140 - PANEL_MARGIN)));
      return { left: Math.round(left), top, width, maxHeight: Math.max(140, Math.round(viewport.height - top - PANEL_MARGIN)) };
    }
    const left = Math.max(PANEL_MARGIN, Math.min(anchor.right - width, viewport.width - width - PANEL_MARGIN));
    const top = Math.round(anchor.bottom + 4);
    return { left: Math.round(left), top, width, maxHeight: Math.max(140, Math.round(viewport.height - top - PANEL_MARGIN)) };
  }

  // ---- controller ------------------------------------------------------------------------------------

  // opts: { doc, win, scrollEl, listEl, newBtn, allBtn, getTabs(), getActiveId(), onSelect(id), label(key),
  //         focusFallback() (where the keyboard goes when the All tabs button hides while it has focus: the editor),
  //         strips: [{ scrollEl, listEl, getActiveId() }, ...] (the strips of one list of tabs; default: the one scrollEl / listEl pair),
  //         panelPlacement: 'below' (default: under the All tabs button) or 'side' (beside the strip), panelAnchor() -> the element 'side' hangs from }
  function create(opts) {
    const doc = opts.doc || global.document;
    const win = opts.win || global.window || global;
    const allBtn = opts.allBtn;
    const strips = (Array.isArray(opts.strips) && opts.strips.length ? opts.strips : [{ scrollEl: opts.scrollEl, listEl: opts.listEl, getActiveId: opts.getActiveId }])
      .filter((st) => st && st.scrollEl && st.listEl)
      .map((st) => ({ scrollEl: st.scrollEl, listEl: st.listEl, getActiveId: st.getActiveId || opts.getActiveId || (() => null), focusedId: null, reveal: false }));
    if (!doc || !strips.length) return null;
    const scrollEl = strips[0].scrollEl;

    const label = opts.label || ((key) => key);
    const getTabs = opts.getTabs || (() => []);
    const getActiveId = opts.getActiveId || (() => null); // the tab the list marks as the open one
    const onSelect = opts.onSelect || (() => {});
    const raf = opts.raf || (win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : (fn) => setTimeout(fn, 16));
    const FADE_START = 'tabs-fade-top';
    const FADE_END = 'tabs-fade-bottom';

    const state = { count: -1, queued: false, open: false, cursor: -1, panel: null, rows: null, countEl: null, badgeEl: null, hintEl: null, rowEls: [] };

    // ---- the strips ----
    function viewOf(st) {
      const e = st.scrollEl;
      return { scrollTop: e.scrollTop, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight };
    }

    function revealFocused(st) {
      const id = st.focusedId;
      if (id === null || id === undefined) return;
      let tabEl = null;
      const items = st.listEl.children || [];
      for (let i = 0; i < items.length; i++) {
        const d = items[i].dataset;
        if (d && d.tabId === id) { tabEl = items[i]; break; }
      }
      if (!tabEl) return;
      const s = st.scrollEl.getBoundingClientRect();
      const r = tabEl.getBoundingClientRect();
      const target = scrollTargetFor(viewOf(st), { top: r.top - s.top + st.scrollEl.scrollTop, height: r.height });
      if (target !== st.scrollEl.scrollTop) st.scrollEl.scrollTop = target;
    }

    function run() {
      state.queued = false;
      let ms = strips.map((st) => measure(viewOf(st)));
      const showButton = ms.some((m) => m.overflowing) || state.open;
      if (allBtn && allBtn.classList.contains('hidden') === showButton) {
        // A button that goes away cannot keep the keyboard focus: the page would get it (Esc in the list opened from the palette, with
        // tabs that fit, put the focus on the button and then hid it). It goes to the caller's fallback, the editor.
        const losesFocus = !showButton && doc.activeElement === allBtn;
        allBtn.classList.toggle('hidden', !showButton);
        if (losesFocus && opts.focusFallback) opts.focusFallback();
        ms = strips.map((st) => measure(viewOf(st))); // the button took some of the strip's room
      }
      strips.forEach((st, i) => {
        let m = ms[i];
        if (st.reveal) {
          st.reveal = false;
          if (m.overflowing) { revealFocused(st); m = measure(viewOf(st)); }
          else if (st.scrollEl.scrollTop !== 0) { st.scrollEl.scrollTop = 0; m = measure(viewOf(st)); }
        }
        st.scrollEl.classList.toggle(FADE_START, m.canScrollUp);
        st.scrollEl.classList.toggle(FADE_END, m.canScrollDown);
      });
    }

    function schedule() {
      if (state.queued) return;
      state.queued = true;
      raf(run);
    }

    // Called after the tab bar was rendered (or its focused tab changed). Returns at once when nothing that matters changed.
    // info: { focusedId, count } (the first strip's tab) or { focusedIds: [id of strip 0, id of strip 1, ...], count }.
    function update(info) {
      const count = info ? info.count : getTabs().length;
      const countChanged = count !== state.count;
      let changed = countChanged;
      strips.forEach((st, i) => {
        let id;
        if (info && Array.isArray(info.focusedIds)) id = info.focusedIds[i];
        else if (info) id = i === 0 ? info.focusedId : st.focusedId;
        else id = st.getActiveId();
        if (id !== st.focusedId || countChanged) { st.focusedId = id; st.reveal = true; changed = true; }
      });
      if (changed) {
        state.count = count;
        schedule();
      }
      if (state.open) renderRows();
    }

    // A column scrolls with the wheel by itself (its scrollbar is hidden, the wheel and the fade are what show there is more).
    strips.forEach((st) => st.scrollEl.addEventListener('scroll', schedule, { passive: true }));

    let observer = null;
    const RO = opts.ResizeObserver || win.ResizeObserver || global.ResizeObserver;
    if (typeof RO === 'function') {
      observer = new RO((entries) => {
        strips.forEach((st) => { if (entries.some((entry) => entry.target === st.scrollEl)) st.reveal = true; });
        schedule();
      });
      strips.forEach((st) => { observer.observe(st.scrollEl); observer.observe(st.listEl); });
    }

    // ---- the list ----
    function el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function buildPanel() {
      const panel = el('div', 'tab-list-panel hidden');
      panel.id = 'tab-list-panel';
      panel.setAttribute('role', 'dialog');

      const head = el('div', 'tab-list-head');
      const badge = el('div', 'inline-prompt-badge');
      head.appendChild(badge);
      const count = el('span', 'tab-list-count');
      head.appendChild(count);
      panel.appendChild(head);

      const rows = el('div', 'tab-list-rows');
      rows.id = 'tab-list-rows';
      rows.setAttribute('role', 'listbox');
      rows.setAttribute('tabindex', '-1');
      panel.appendChild(rows);

      const hint = el('div', 'scraps-search-hint tab-list-hint');
      panel.appendChild(hint);

      // A click on a row must not take focus from the list first (that would close it before the click lands).
      panel.addEventListener('mousedown', (e) => { if (e.preventDefault) e.preventDefault(); });
      rows.addEventListener('keydown', onListKey);
      rows.addEventListener('focusout', (e) => {
        const next = e.relatedTarget;
        if (next && panel.contains && panel.contains(next)) return;
        closeList(false);
      });

      state.panel = panel;
      state.rows = rows;
      state.countEl = count;
      state.badgeEl = badge;
      state.hintEl = hint;
      (doc.body || doc.documentElement).appendChild(panel);
      return panel;
    }

    // The words follow the UI language, which may have changed since the list was built.
    function applyLabels() {
      state.panel.setAttribute('aria-label', label('allTabsTitle'));
      state.rows.setAttribute('aria-label', label('allTabsTitle'));
      state.badgeEl.textContent = label('allTabsHead');
      state.hintEl.textContent = label('allTabsHint');
    }

    function setCursor(index, scroll) {
      const rowEls = state.rowEls;
      if (state.cursor >= 0 && rowEls[state.cursor]) rowEls[state.cursor].classList.remove('is-cursor');
      state.cursor = index;
      const row = rowEls[index];
      if (!row) return;
      row.classList.add('is-cursor');
      if (state.rows) state.rows.setAttribute('aria-activedescendant', row.id);
      if (scroll && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }

    function renderRows() {
      const rows = rowsFor(getTabs(), getActiveId());
      state.rowEls = [];
      state.rows.textContent = '';
      state.countEl.textContent = String(rows.length);
      let current = -1;
      rows.forEach((row) => {
        const item = el('div', 'tab-list-row' + (row.active ? ' is-current' : ''));
        item.id = 'tab-list-row-' + row.index;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', row.active ? 'true' : 'false');
        item.dataset.tabId = row.id;
        item.title = row.path || row.title;
        const mark = el('span', 'tab-list-check');
        if (row.active) mark.innerHTML = CHECK_SVG;
        item.appendChild(mark);
        item.appendChild(el('span', 'tab-list-title', row.title));
        if (row.dirty) {
          const dot = el('span', 'tab-dirty-dot tab-list-dot', '●');
          dot.title = label('allTabsUnsaved');
          dot.setAttribute('role', 'img');
          dot.setAttribute('aria-label', label('allTabsUnsaved'));
          item.appendChild(dot);
        }
        item.addEventListener('click', () => choose(row.index));
        item.addEventListener('mousemove', () => { if (state.cursor !== row.index) setCursor(row.index, false); });
        state.rows.appendChild(item);
        state.rowEls.push(item);
        if (row.active) current = row.index;
      });
      const keep = state.cursor >= 0 && state.cursor < rows.length ? state.cursor : current;
      state.cursor = -1;
      setCursor(keep >= 0 ? keep : 0, true);
    }

    function choose(index) {
      const item = state.rowEls[index];
      if (!item) return;
      const id = item.dataset.tabId;
      closeList(false);
      onSelect(id);
    }

    function onListKey(e) {
      const count = state.rowEls.length;
      let handled = true;
      switch (e.key) {
        case 'ArrowDown': setCursor(stepIndex(state.cursor, 1, count), true); break;
        case 'ArrowUp': setCursor(stepIndex(state.cursor, -1, count), true); break;
        case 'Home': setCursor(0, true); break;
        case 'End': setCursor(count - 1, true); break;
        case 'PageDown': setCursor(Math.min(count - 1, Math.max(0, state.cursor) + 8), true); break;
        case 'PageUp': setCursor(Math.max(0, state.cursor - 8), true); break;
        case 'Enter': case ' ': choose(state.cursor); break;
        case 'Escape': closeList(true); break;
        // The list hangs at the end of the page: Tab from it went to the top (Shift+Tab to the bottom). Focus goes back to the button
        // and the Tab is left to the browser, which then moves on from the button.
        case 'Tab': closeList(true); handled = false; break;
        default: handled = false;
      }
      if (handled) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
      }
    }

    function onOutsideDown(e) {
      const target = e.target;
      const inside = state.panel && state.panel.contains && state.panel.contains(target);
      const onButton = !!(allBtn && allBtn.contains && allBtn.contains(target)); // its own click toggles the list
      if (!inside && !onButton) closeList(false);
    }

    function openList() {
      if (state.open) return;
      const panel = state.panel || buildPanel();
      state.open = true;
      state.cursor = -1;
      applyLabels();
      // The list hangs from its button, which is shown while the list is open (the palette opens it even when the tabs fit).
      if (allBtn) allBtn.classList.remove('hidden');
      if (allBtn) { allBtn.setAttribute('aria-expanded', 'true'); allBtn.classList.add('active'); }
      panel.classList.remove('hidden'); // shown before the rows are drawn: scrolling the current row into view needs a layout
      const beside = opts.panelPlacement === 'side';
      let anchorEl = (allBtn && allBtn.getBoundingClientRect().width > 0) ? allBtn : (opts.newBtn || scrollEl);
      if (beside) anchorEl = (typeof opts.panelAnchor === 'function' && opts.panelAnchor()) || scrollEl;
      const pos = panelPosition(anchorEl.getBoundingClientRect(), { width: win.innerWidth || 1120, height: win.innerHeight || 720 }, beside ? 'side' : undefined);
      panel.style.left = pos.left + 'px';
      panel.style.top = pos.top + 'px';
      panel.style.width = pos.width + 'px';
      panel.style.maxHeight = pos.maxHeight + 'px';
      renderRows();
      doc.addEventListener('mousedown', onOutsideDown, true);
      win.addEventListener('resize', onWindowResize);
      if (state.rows.focus) state.rows.focus();
      schedule();
    }

    function onWindowResize() { closeList(false); }

    // restoreFocus: put focus back on the button (Esc); a chosen tab or an outside click moves focus itself.
    function closeList(restoreFocus) {
      if (!state.open) return;
      state.open = false;
      if (state.panel) state.panel.classList.add('hidden');
      if (allBtn) { allBtn.setAttribute('aria-expanded', 'false'); allBtn.classList.remove('active'); }
      doc.removeEventListener('mousedown', onOutsideDown, true);
      win.removeEventListener('resize', onWindowResize);
      if (restoreFocus && allBtn && allBtn.focus && allBtn.getBoundingClientRect().width > 0) allBtn.focus();
      schedule(); // the button may hide again
    }

    function toggleList() { if (state.open) closeList(true); else openList(); }

    if (allBtn) allBtn.addEventListener('click', toggleList);

    return {
      update,
      openList,
      closeList,
      toggleList,
      isListOpen: () => state.open,
      // for tests
      _run: run,
      _state: state
    };
  }

  const api = { measure, scrollTargetFor, rowsFor, stepIndex, panelPosition, create, PEEK, PANEL_WIDTH };
  global.TabOverflow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
