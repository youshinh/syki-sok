// syki::sok Settings dialog, compact & smart view. The dialog lists every option syki::sok has (about 80 fields and 50 lines of
// explanation) and a first-time user only needs a handful of them. This module makes it approachable without removing
// anything:
//   * every section that a beginner does not need is folded into a <details> that starts closed (the sections marked
//     data-basic on their header stay open; data-plain leaves a section as it is). The "Show advanced" switch in the
//     dialog header opens them all and is remembered;
//   * the explanatory <small> under a field is hidden behind a small "?" button next to that field. Status and warning
//     lines are never hidden: a <small> that has an id (the code writes to it), starts hidden, or says data-keep stays;
//   * each section header shows a live ON/OFF/model status badge, AI connection overrides fold neatly when inherited,
//     and the cross-tab search bar filters & auto-expands matching fields across every tab.
//
// It only moves and hides nodes that already exist (no node is cloned or rebuilt), so every id, listener and
// data-i18n keeps working, and a value is read or saved the same whether its section is open or closed.
(function (global) {
  'use strict';

  const STORE_KEY = 'syki_settings_show_advanced';

  const SECTION_TOGGLES = {
    sectionAutocomplete: 'cfg-auto-enabled',
    sectionVisionOCR: 'cfg-paste-image-ocr',
    sectionSemantic: 'cfg-semantic-enabled',
    sectionAutoSelector: 'cfg-autosel-enabled',
    sectionAgentSuggestions: 'cfg-action-enabled',
    sectionGitHub: 'cfg-git-sync-enabled',
    sectionCFBridge: 'cfg-cf-enabled',
    sectionInbox: 'cfg-inbox-enabled'
  };

  const DEFAULT_OVERRIDE_VALUES = new Set([
    'http://localhost:11434',
    'https://openrouter.ai/api/v1',
    'gemini-decision-1',
    'jev-latest',
    'bge-m3',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite-image'
  ]);

  // ---- pure helpers (exported for Node tests) -----------------------------------------------

  // nodes: the children of a pane, as { header, basic, plain }. Returns one entry per section header:
  // { start, end (exclusive), basic, plain } - the nodes after a header, up to the next one, belong to its section.
  // Nodes before the first header (the fields that need no heading) belong to no section and are left alone.
  function planSections(nodes) {
    const heads = [];
    nodes.forEach(function (n, i) { if (n.header) heads.push(i); });
    return heads.map(function (start, k) {
      return {
        start: start,
        end: k + 1 < heads.length ? heads[k + 1] : nodes.length,
        basic: !!nodes[start].basic,
        plain: !!nodes[start].plain
      };
    });
  }

  // True for an explanation that goes behind the "?" button. info: { id, startsHidden, keep, dataHint, text }.
  function isHelpHint(info) {
    if (!info || !String(info.text || '').trim()) return false;
    if (info.dataHint) return true;                 // marked as a plain hint even though it has an id
    if (info.keep || info.startsHidden) return false; // meant to be seen, or shown by code when it applies
    return !info.id;                                // an id means the code writes a status into it
  }

  function matchesTerms(haystack, terms) {
    if (!terms || terms.length === 0) return true;
    const lower = String(haystack || '').toLowerCase();
    return terms.every(function (term) { return lower.indexOf(term) !== -1; });
  }

  function tLabel(doc, key, fallback) {
    try {
      const lang = (doc && doc.documentElement && doc.documentElement.lang) || 'en';
      const dict = global.I18N && (global.I18N[lang] || global.I18N.en);
      if (dict && dict[key]) return dict[key];
    } catch (e) { /* ignore */ }
    return fallback;
  }

  // ---- DOM ----------------------------------------------------------------------------------

  function wrapSections(pane, doc) {
    const kids = Array.prototype.slice.call(pane.children);
    const plan = planSections(kids.map(function (k) {
      return {
        header: k.classList.contains('settings-section-header'),
        basic: k.hasAttribute('data-basic'),
        plain: k.hasAttribute('data-plain')
      };
    }));
    plan.forEach(function (g) {
      if (g.plain) return;
      const header = kids[g.start];
      const details = doc.createElement('details');
      details.className = 'settings-section' + (g.basic ? ' is-basic' : '');
      details.open = g.basic;
      const summary = doc.createElement('summary');
      pane.insertBefore(details, header);
      summary.appendChild(header);
      details.appendChild(summary);
      const body = doc.createElement('div');
      body.className = 'settings-section-body';
      for (let i = g.start + 1; i < g.end; i++) body.appendChild(kids[i]);
      details.appendChild(body);
    });
  }

  function collapseHints(pane, doc) {
    const groups = [];
    pane.querySelectorAll('small').forEach(function (small) {
      const info = {
        id: small.id,
        startsHidden: small.classList.contains('hidden'),
        keep: small.hasAttribute('data-keep'),
        dataHint: small.hasAttribute('data-hint'),
        text: small.textContent
      };
      if (!isHelpHint(info)) return;
      const group = small.closest('.form-group') || small.parentElement;
      if (!group) return;
      small.classList.add('hint-collapsed');
      if (groups.indexOf(group) === -1) groups.push(group);
    });
    groups.forEach(function (group) {
      group.classList.add('has-hint');
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'hint-toggle';
      btn.setAttribute('aria-expanded', 'false');
      const mark = doc.createElement('span');
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = '?';
      const sr = doc.createElement('span');
      sr.className = 'visually-hidden';
      sr.setAttribute('data-i18n', 'settingsHelpToggle');
      sr.textContent = 'Show help';
      btn.appendChild(mark);
      btn.appendChild(sr);
      btn.addEventListener('click', function () {
        const open = group.classList.toggle('hint-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      group.appendChild(btn);
    });
  }

  function isOverrideCustomized(box) {
    const inputs = box.querySelectorAll('input[type="text"], input[type="password"]');
    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i];
      const val = String(el.value || '').trim();
      if (!val) continue;
      if (el.type === 'password') return true;
      if (!DEFAULT_OVERRIDE_VALUES.has(val)) return true;
    }
    return false;
  }

  function refreshOverrideBoxes(root, doc, syncOpen) {
    root.querySelectorAll('details.ai-override-box').forEach(function (box) {
      const customized = isOverrideCustomized(box);
      const badge = box.querySelector('.ai-override-badge');
      if (badge) {
        badge.textContent = customized ? tLabel(doc, 'badgeCustom', 'Custom') : tLabel(doc, 'badgeInherited', 'Inherited');
        badge.classList.toggle('is-custom', customized);
      }
      if (syncOpen) {
        box.open = customized;
      }
    });
  }

  function refreshSectionBadges(root, doc) {
    root.querySelectorAll('details.settings-section').forEach(function (sec) {
      const header = sec.querySelector('.settings-section-header');
      const h4 = header && header.querySelector('h4[data-i18n]');
      if (!header || !h4) return;
      const key = h4.getAttribute('data-i18n');
      let badge = header.querySelector('.section-status-badge');
      if (!badge) {
        badge = doc.createElement('span');
        badge.className = 'section-status-badge';
        header.appendChild(badge);
      }
      const toggleId = SECTION_TOGGLES[key];
      if (toggleId) {
        const cb = doc.getElementById(toggleId);
        if (cb) {
          const on = !!cb.checked;
          badge.textContent = on ? tLabel(doc, 'badgeOn', 'ON') : tLabel(doc, 'badgeOff', 'OFF');
          badge.classList.toggle('is-on', on);
          badge.classList.toggle('is-off', !on);
          badge.classList.remove('hidden');
          return;
        }
      }
      if (key === 'sectionTextLLM') {
        const modelEl = doc.getElementById('cfg-model');
        const modelName = modelEl ? String(modelEl.value || '').trim() : '';
        if (modelName) {
          badge.textContent = modelName.length > 26 ? modelName.slice(0, 24) + '...' : modelName;
          badge.classList.add('is-on');
          badge.classList.remove('is-off', 'hidden');
          return;
        }
      }
      badge.classList.add('hidden');
    });
  }

  function readShowAdvanced() {
    try { return global.localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; }
  }

  function saveShowAdvanced(on) {
    try { global.localStorage.setItem(STORE_KEY, on ? '1' : '0'); } catch (e) { /* not remembered: still works */ }
  }

  // Opens every section (on) or returns to the default: only the basic ones open (off).
  function applyShowAdvanced(root, on) {
    root.querySelectorAll('details.settings-section').forEach(function (d) {
      d.open = on || d.classList.contains('is-basic');
    });
  }

  function textOfGroup(el) {
    let txt = el.textContent || '';
    el.querySelectorAll('input, textarea, select').forEach(function (inp) {
      if (inp.placeholder) txt += ' ' + inp.placeholder;
      if (inp.type !== 'password' && inp.value) txt += ' ' + inp.value;
    });
    return txt;
  }

  function applySearchFilter(root, doc, rawQuery) {
    const query = String(rawQuery || '').trim().toLowerCase();
    const terms = query ? query.split(/\s+/).filter(Boolean) : [];
    const panes = root.querySelectorAll('.settings-pane');
    const tabCounts = {};
    let firstMatchingTabId = null;

    root.querySelectorAll('.settings-search-miss').forEach(function (el) { el.classList.remove('settings-search-miss'); });
    root.querySelectorAll('.settings-search-hit').forEach(function (el) { el.classList.remove('settings-search-hit'); });

    if (terms.length === 0) {
      root.querySelectorAll('.settings-tab-btn').forEach(function (btn) {
        btn.removeAttribute('data-match-count');
      });
      const toggle = doc.getElementById('cfg-show-advanced');
      applyShowAdvanced(root, !!(toggle && toggle.checked));
      refreshOverrideBoxes(root, doc, true);
      return;
    }

    panes.forEach(function (pane) {
      const paneId = pane.id; // e.g. pane-model
      const tabId = paneId.replace(/^pane-/, 'tab-btn-');
      let paneHits = 0;

      if (paneId === 'pane-shortcuts') {
        const scText = pane.textContent || '';
        if (matchesTerms(scText, terms)) {
          paneHits = 1;
        }
        tabCounts[tabId] = paneHits;
        if (paneHits > 0 && !firstMatchingTabId) firstMatchingTabId = tabId;
        return;
      }

      pane.querySelectorAll('details.settings-section').forEach(function (sec) {
        const h4 = sec.querySelector('.settings-section-header h4');
        const headerMatches = h4 && matchesTerms(h4.textContent, terms);
        const groups = sec.querySelectorAll('.settings-section-body > .form-group, .settings-section-body > .form-row, .settings-section-body > .agent-config-card, .settings-section-body > .voice-profile, .settings-section-body > details.ai-override-box');
        let secHits = 0;

        groups.forEach(function (grp) {
          if (headerMatches || matchesTerms(textOfGroup(grp), terms)) {
            grp.classList.add('settings-search-hit');
            secHits++;
            if (grp.classList.contains('ai-override-box')) {
              grp.open = true;
            }
          } else {
            grp.classList.add('settings-search-miss');
          }
        });

        if (secHits > 0 || headerMatches) {
          sec.open = true;
          paneHits += Math.max(1, secHits);
        } else {
          sec.classList.add('settings-search-miss');
        }
      });

      tabCounts[tabId] = paneHits;
      if (paneHits > 0 && !firstMatchingTabId) firstMatchingTabId = tabId;
    });

    let activeTabId = null;
    root.querySelectorAll('.settings-tab-btn').forEach(function (btn) {
      const cnt = tabCounts[btn.id] || 0;
      if (cnt > 0) {
        btn.setAttribute('data-match-count', String(cnt));
      } else {
        btn.removeAttribute('data-match-count');
      }
      if (btn.classList.contains('active')) activeTabId = btn.id;
    });

    if (activeTabId && (tabCounts[activeTabId] || 0) === 0 && firstMatchingTabId) {
      const nextBtn = doc.getElementById(firstMatchingTabId);
      if (nextBtn) nextBtn.click();
    }
  }

  function refresh(doc) {
    doc = doc || global.document;
    if (!doc) return;
    const firstPane = doc.getElementById('pane-general');
    const root = firstPane && firstPane.closest('.modal-card');
    if (!root) return;
    const searchEl = doc.getElementById('cfg-settings-search');
    if (searchEl && searchEl.value) {
      searchEl.value = '';
      applySearchFilter(root, doc, '');
    } else {
      refreshOverrideBoxes(root, doc, true);
    }
    refreshSectionBadges(root, doc);
  }

  function init(doc) {
    doc = doc || global.document;
    if (!doc) return;
    const firstPane = doc.getElementById('pane-general');
    const root = firstPane && firstPane.closest('.modal-card');
    if (!root || root.getAttribute('data-compact') === '1') return;
    root.setAttribute('data-compact', '1');
    root.querySelectorAll('.settings-pane').forEach(function (pane) {
      wrapSections(pane, doc);
      collapseHints(pane, doc);
    });
    const toggle = doc.getElementById('cfg-show-advanced');
    if (toggle) {
      toggle.checked = readShowAdvanced();
      applyShowAdvanced(root, toggle.checked);
      toggle.addEventListener('change', function () {
        saveShowAdvanced(toggle.checked);
        applyShowAdvanced(root, toggle.checked);
      });
    }

    const searchEl = doc.getElementById('cfg-settings-search');
    if (searchEl && !searchEl.dataset.wired) {
      searchEl.dataset.wired = '1';
      searchEl.addEventListener('input', function () {
        applySearchFilter(root, doc, searchEl.value);
      });
    }

    root.addEventListener('change', function () {
      refreshSectionBadges(root, doc);
      refreshOverrideBoxes(root, doc, false);
    });
    root.addEventListener('input', function (e) {
      if (e.target && e.target.id !== 'cfg-settings-search') {
        refreshSectionBadges(root, doc);
        refreshOverrideBoxes(root, doc, false);
      }
    });

    refreshOverrideBoxes(root, doc, true);
    refreshSectionBadges(root, doc);
  }

  const api = {
    planSections: planSections,
    isHelpHint: isHelpHint,
    matchesTerms: matchesTerms,
    isOverrideCustomized: isOverrideCustomized,
    init: init,
    refresh: refresh
  };
  global.SettingsCompact = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof document !== 'undefined') {
    init(document);
  }
})(typeof window !== 'undefined' ? window : globalThis);
