// syki: the two places a dragged file can be dropped, shown while it is dragged over the window.
//
//   open   the file becomes a note (wide: it is what a drop does most of the time)
//   link   a link to the file is put into the note being edited (only when an editor is on screen)
//
// Until now the choice was invisible: a drop on the text opened a link and a drop on anything else opened the file, so
// the only way to learn it was to get it wrong. The two zones are frosted glass over the window (the same blur as the glass bars and panels,
// css/style.css, "drop zones"); the one under the pointer lights up. A drop reports its zone through zoneOf(), and app.js does the
// rest. Nothing is drawn for a drag that carries no file (text dragged inside the editor).
//
//   DropZones.hasFiles(dataTransfer)      true when the drag carries files
//   DropZones.create({ document, tr, canLink, setTimeout, clearTimeout })
//     .onDragOver(event)   shows the zones (call for every dragover with files), lights the zone under the pointer
//     .zoneOf(event)       'open' | 'link' | '' for a drop event
//     .hide()              takes them away (drop, dragend, or no dragover for a moment: the drag left the window)
(function (global) {
  'use strict';

  const HIDE_AFTER_MS = 250; // dragover repeats every ~50 ms while a drag is over the window; silence means it left
  const LINK_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17H7a5 5 0 0 1 0-10h2"></path>' +
    '<path d="M15 7h2a5 5 0 0 1 0 10h-2"></path><line x1="8" y1="12" x2="16" y2="12"></line></svg>';
  const OPEN_ICON = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path>' +
    '<polyline points="14 3 14 8 19 8"></polyline><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="13" y2="17"></line></svg>';

  function hasFiles(dt) {
    if (!dt || !dt.types) return false;
    return Array.prototype.indexOf.call(dt.types, 'Files') !== -1;
  }

  function create(opts) {
    const doc = opts.document;
    const tr = opts.tr || function (key) { return key; };
    const setT = opts.setTimeout || global.setTimeout.bind(global);
    const clearT = opts.clearTimeout || global.clearTimeout.bind(global);
    let overlay = null;
    let zoneEls = {};
    let timer = null;
    let hot = '';

    function zone(name, icon, titleKey, subKey) {
      const el = doc.createElement('div');
      el.className = 'drop-zone drop-zone-' + name;
      el.setAttribute('data-drop-zone', name);
      el.innerHTML = '<span class="drop-zone-icon">' + icon + '</span>' +
        '<span class="drop-zone-title">' + tr(titleKey) + '</span>' +
        '<span class="drop-zone-sub">' + tr(subKey) + '</span>';
      return el;
    }

    function build() {
      overlay = doc.createElement('div');
      overlay.className = 'drop-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      zoneEls = {
        open: zone('open', OPEN_ICON, 'dropZoneOpenTitle', 'dropZoneOpenSub'),
        link: zone('link', LINK_ICON, 'dropZoneLinkTitle', 'dropZoneLinkSub')
      };
      overlay.appendChild(zoneEls.open);
      overlay.appendChild(zoneEls.link);
      doc.body.appendChild(overlay);
    }

    function setHot(name) {
      if (name === hot) return;
      hot = name;
      Object.keys(zoneEls).forEach(function (k) { zoneEls[k].classList.toggle('is-hot', k === name); });
    }

    function hide() {
      if (timer) { clearT(timer); timer = null; }
      hot = '';
      if (!overlay) return;
      overlay.classList.remove('is-on');
      Object.keys(zoneEls).forEach(function (k) { zoneEls[k].classList.remove('is-hot'); });
    }

    function zoneOf(event) {
      const t = event && event.target;
      const el = t && typeof t.closest === 'function' ? t.closest('[data-drop-zone]') : null;
      return el ? el.getAttribute('data-drop-zone') : '';
    }

    function onDragOver(event) {
      if (!overlay) build();
      if (!overlay.classList.contains('is-on')) {
        // The link zone is there only when there is an editor to put the link in; without one the open zone has the whole window.
        zoneEls.link.classList.toggle('is-gone', !opts.canLink());
        const items = event.dataTransfer && event.dataTransfer.items;
        const n = items && items.length ? items.length : 0;
        zoneEls.open.querySelector('.drop-zone-sub').textContent = n > 1 ? tr('dropZoneOpenSubMany', { n: n }) : tr('dropZoneOpenSub');
        overlay.classList.add('is-on');
      }
      setHot(zoneOf(event));
      if (timer) clearT(timer);
      timer = setT(hide, HIDE_AFTER_MS);
    }

    return { onDragOver: onDragOver, zoneOf: zoneOf, hide: hide };
  }

  const api = { hasFiles: hasFiles, create: create, HIDE_AFTER_MS: HIDE_AFTER_MS };
  global.DropZones = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
