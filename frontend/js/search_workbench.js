// Scraps Search, Meaning Search, and Deep Search workbench module (Editor Canvas Ring 1).
// Encapsulates modal state, debounce/staleness guards, tag filters, semantic search, and Deep Search planning.
(function (global) {
  'use strict';

  function create(deps) {
    const t = deps.t;
    const getConfig = deps.getConfig;
    const escapeHtml = deps.escapeHtml;
    const showMessage = deps.showMessage;
    const oneLineFailure = deps.oneLineFailure;
    const backendErrorCode = deps.backendErrorCode;
    const getActiveEditor = deps.getActiveEditor;
    const getActiveTab = deps.getActiveTab;
    const getSearchSeed = deps.getSearchSeed;
    const insertTextWithUndo = deps.insertTextWithUndo;
    const onEditorInput = deps.onEditorInput;
    const findTabByPath = deps.findTabByPath;
    const createTab = deps.createTab;
    const selectTab = deps.selectTab;
    const showTab = deps.showTab;
    const renderTabs = deps.renderTabs;
    const saveSessionDebounced = deps.saveSessionDebounced;
    const gotoLineNumber = deps.gotoLineNumber;
    const flashEditorLine = deps.flashEditorLine;
    const openAiModelsSettings = deps.openAiModelsSettings;
    const rememberCloudConsent = deps.rememberCloudConsent;
    const onDeepDialogChange = deps.onDeepDialogChange || function () {};
    const dom = deps.dom || {};
    const scrapsSearchModal = dom.scrapsSearchModal || null;
    const scrapsSearchInput = dom.scrapsSearchInput || null;
    const scrapsSearchResults = dom.scrapsSearchResults || null;
    const btnSearchScraps = dom.btnSearchScraps || null;

    function setDeepDialogOpen(v) {
      deepDialogOpen = !!v;
      onDeepDialogChange(deepDialogOpen);
    }

    // --- Feature 4: Ultra-fast Scraps In-Memory Search Modal (Ctrl+Shift+F) ---
    let scrapsSearchDebounceTimer = null;
    let scrapsSearchFlattened = [];
    let scrapsSearchSelectedIndex = 0;
    // The editor that had the caret when the search opened: Tab quotes the chosen line into it.
    let scrapsSearchTarget = null;
    // Numbers the searches, so a slow answer to an earlier query never replaces a newer one.
    let scrapsSearchSeq = 0;
    // True from an edit of the query until the answer for it is shown: the list on screen answers an older query, so Enter / Tab
    // must not open one of its lines (the query box says something else).
    let scrapsSearchStale = false;
    // Meaning search and Deep search (docs/design/deep-search-2026-10.md): all inert until Settings > Semantic search is on. The markup
    // stays hidden and nothing is wired until the panel first opens with it on (wireScrapsSemanticUi).
    const SCRAPS_MODE_KEY = 'syki_scraps_search_mode'; // sessionStorage: the choice lasts for this session only
    const SCRAPS_MORE_LIMIT = 30;       // "Show more" asks for this many notes (the first ask is 10)
    const DEEP_CONFIRM_GUARD_MS = 350;  // an Enter this soon after the dialog appeared is the key that raised it, not an answer
    let scrapsSemanticWired = false;
    let scrapsSearchMode = 'exact';     // 'exact' | 'meaning'
    let scrapsSearchModeLoaded = false;
    let scrapsSearchLimit = 10;         // how many notes the meaning search asks for: 10, then SCRAPS_MORE_LIMIT
    let scrapsStatusShown = false;
    let deepSearchToken = 0;            // counts the Deep search plans: one that comes back after the panel closed or the text changed is dropped
    let deepSearchPlanning = false;     // a plan is being prepared (the button says so and waits)
    let deepDialogOpen = false;
    let deepDialogShownAt = 0;
    let deepDialogHeld = null;          // { plan, query, needsConsent, key } of the dialog on screen
    // The filter row (a period and tags that narrow every search; frontend/js/scraps_filter.js). Nothing of it is built until it is opened.
    const scrapsFilterBox = typeof document !== 'undefined' ? document.getElementById('scraps-filter') : null;
    let scrapsFilterState = null;       // { period, tags }: made when the row first shows, kept while the app is open (not saved)
    let scrapsFilterWired = false;
    let scrapsFilterAreaOpen = false;
    let scrapsFilterLoad = { status: 'idle', options: null, message: '' }; // the tag list of this opening of the panel
    let scrapsFilterLoadSeq = 0;
    let scrapsSearchFilterSent = null;  // the filter (object, or null) the list on screen was searched with
    let deepPlanFilter = null;          // the filter of the Deep search being prepared: a plan that expired is prepared again with it

    function runScrapsSearch(q) {
      if (scrapsMeaningMode()) { runScrapsSemanticSearch(q); return; }
      const seq = ++scrapsSearchSeq;
      if (!(window.backend && window.backend.searchScraps)) return;
      Promise.resolve(window.backend.searchScraps(q, 100, scrapsFilterForSearch())).then((results) => {
        if (seq === scrapsSearchSeq) renderScrapsSearchResults(results || []);
      }).catch((err) => {
        console.error('searchScraps failed:', err);
        if (seq === scrapsSearchSeq) scrapsSearchStale = false;
      });
    }

    // The query or the filter was changed: the list on screen answers something else until the answer for the new one is shown. It is asked for
    // once the changing has paused (the meaning search embeds the text first, so it waits a little longer).
    function queueScrapsSearch(q) {
      scrapsSearchStale = true;
      if (scrapsSemanticWired) scrapsSearchTyped();
      clearTimeout(scrapsSearchDebounceTimer);
      scrapsSearchDebounceTimer = setTimeout(() => runScrapsSearch(q), scrapsMeaningMode() ? 400 : 150);
    }

    // Also the toolbar button's click handler, so it takes no argument.
    function openScrapsSearchModal() {
      if (!scrapsSearchModal) return;
      // Before focus moves into the search box: the selection, or the word before the caret, is the first query.
      const seed = getSearchSeed(true);
      scrapsSearchTarget = getActiveEditor();
      scrapsSearchModal.classList.remove('hidden');
      scrapsSearchSelectedIndex = 0;
      scrapsSearchFlattened = [];
      clearTimeout(scrapsSearchDebounceTimer);
      scrapsSearchSeq++;
      openScrapsSearchExtras();
      openScrapsFilterRow();
      if (scrapsSearchInput) {
        scrapsSearchInput.value = seed;
        setTimeout(() => {
          scrapsSearchInput.focus();
          scrapsSearchInput.select();
        }, 40);
      }
      renderScrapsSearchResults([]);
      if (seed) runScrapsSearch(seed);
    }

    // Tab in the search: put the chosen line into the note at the caret (replacing a selection, like a paste,
    // and undoable with Ctrl+Z) instead of opening its file.
    function quoteScrapLine(item) {
      const text = window.ScrapQuote.quoteText(item && item.match);
      if (!text) return;
      const editor = scrapsSearchTarget;
      // The preview covering the editor: there is no visible caret to insert at.
      if (!editor || editor.getClientRects().length === 0) {
        showMessage(t('scrapsSearchNoEditor'), 3000);
        return;
      }
      closeScrapsSearchModal();
      insertTextWithUndo(text, editor);
      const tab = getActiveTab();
      if (tab) onEditorInput(editor, tab, true);
    }

    function closeScrapsSearchModal() {
      if (!scrapsSearchModal) return;
      if (scrapsSemanticWired) closeScrapsSearchExtras();
      scrapsSearchModal.classList.add('hidden');
      const editor = getActiveEditor();
      if (editor) editor.focus();
    }

    if (scrapsSearchModal) {
      scrapsSearchModal.addEventListener('click', (e) => {
        if (e.target === scrapsSearchModal) {
          closeScrapsSearchModal();
        }
      });
    }

    if (btnSearchScraps) {
      btnSearchScraps.onclick = openScrapsSearchModal;
    }

    if (scrapsSearchInput) {
      scrapsSearchInput.addEventListener('input', () => {
        const q = scrapsSearchInput.value.trim();
        clearTimeout(scrapsSearchDebounceTimer);
        if (!q) {
          scrapsSearchFlattened = [];
          if (scrapsMeaningMode()) scrapsSearchSeq++; // a slow meaning answer to the text that was just erased must not bring its list back
          if (scrapsSemanticWired) scrapsSearchTyped();
          renderScrapsSearchResults([]);
          return;
        }
        queueScrapsSearch(q);
      });

      scrapsSearchInput.addEventListener('keydown', (e) => {
        // While an IME composition is open, Enter / Tab / arrows / Esc belong to the IME (confirming a
        // conversion must neither jump to a result nor insert one).
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation(); // one Esc closes one panel (see the ask bar)
          closeScrapsSearchModal();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (scrapsSearchFlattened.length > 0) {
            scrapsSearchSelectedIndex = (scrapsSearchSelectedIndex + 1) % scrapsSearchFlattened.length;
            updateScrapsSearchSelection();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (scrapsSearchFlattened.length > 0) {
            scrapsSearchSelectedIndex = (scrapsSearchSelectedIndex - 1 + scrapsSearchFlattened.length) % scrapsSearchFlattened.length;
            updateScrapsSearchSelection();
          }
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey && scrapsMeaningMode()) {
          // Meaning mode only: Ctrl+Enter is Deep search (everywhere else it opens the note, like Enter)
          e.preventDefault();
          e.stopPropagation();
          startDeepSearch();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (!scrapsSearchStale && scrapsSearchFlattened.length > 0 && scrapsSearchFlattened[scrapsSearchSelectedIndex]) {
            const item = scrapsSearchFlattened[scrapsSearchSelectedIndex];
            jumpToScrap(item.filePath, item.fileName, item.match.lineNumber);
            closeScrapsSearchModal();
          }
        } else if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && e.shiftKey)) {
          // Tab (or Shift+Enter): quote the chosen line into the note. Shift+Tab keeps its usual meaning.
          // stopPropagation: focus moves to the editor below, and the key must not then reach the
          // document-level key handlers as if it had been pressed there (Shift+Enter would add a line break).
          e.preventDefault();
          e.stopPropagation();
          if (!scrapsSearchStale && scrapsSearchFlattened.length > 0 && scrapsSearchFlattened[scrapsSearchSelectedIndex]) {
            quoteScrapLine(scrapsSearchFlattened[scrapsSearchSelectedIndex]);
          }
        }
      });
    }

    // view (the meaning search only): { notes: [the backend's sentences], truncated, limit }. The same list is drawn; the notes go above it as
    // quiet lines, a match shows the lines it spans, and "Show more" ends it when the backend had more. A score is never shown.
    function renderScrapsSearchResults(results, view) {
      scrapsSearchFlattened = [];
      scrapsSearchSelectedIndex = 0;
      scrapsSearchStale = false;

      results.forEach(res => {
        if (res.matches) {
          res.matches.forEach(m => {
            scrapsSearchFlattened.push({
              filePath: res.filePath,
              fileName: res.fileName,
              match: m
            });
          });
        }
      });
      if (scrapsSemanticWired) updateScrapsDeepButton();

      if (!scrapsSearchResults) return;
      // Meaning search: the counts the backend sends as numbers are said here, in the UI language; its own notes (English: what has no
      // count, such as why the model could not answer) follow them.
      const noteTexts = [];
      if (view) {
        if (view.semantic === false) noteTexts.push(t('scrapsSearchWordsFallback'));
        if (view.pending > 0) noteTexts.push(t('scrapsSearchPending', { n: view.pending }));
        if (view.leftOut > 0) noteTexts.push(t('scrapsSearchLeftOut', { n: view.leftOut }));
        (view.notes || []).forEach((n) => noteTexts.push(n));
      }
      const notesHtml = noteTexts.map((n) => `<div class="scraps-search-note">${escapeHtml(n)}</div>`).join('');

      if (scrapsSearchFlattened.length === 0) {
        const q = scrapsSearchInput ? scrapsSearchInput.value.trim() : '';
        // With a filter chosen the list is empty because of it: say so (the key is the filter module's decision)
        const emptyKey = window.ScrapsFilter ? window.ScrapsFilter.emptyMessageKey(scrapsSearchFilterSent, !!q) : q ? 'scrapsSearchNoResults' : 'scrapsSearchEmpty';
        scrapsSearchResults.innerHTML = `${notesHtml}<div class="scraps-search-empty">${escapeHtml(t(emptyKey))}</div>`;
        return;
      }

      scrapsSearchResults.innerHTML = scrapsSearchFlattened.map((item, idx) => {
        const isSelected = idx === 0 ? 'active' : '';
        const previewText = item.match.snippet || item.match.lineText;
        const endLine = item.match.endLine;
        const lines = view && endLine > item.match.lineNumber ? `${item.match.lineNumber}–${endLine}` : String(item.match.lineNumber);
        const heading = view && item.match.heading ? ` title="${escapeHtml(item.match.heading)}"` : '';
        return `
          <div class="scraps-match-item ${isSelected}" data-idx="${idx}"${heading}>
            <div class="scraps-match-header">
              <span class="scraps-match-file">${escapeHtml(item.fileName)}</span>
              <span class="scraps-match-line">Ln ${lines}</span>
            </div>
            <div class="scraps-match-snippet">${escapeHtml(previewText)}</div>
          </div>
        `;
      }).join('');

      if (view) {
        // Meaning search: its own notes (cut-off count, a switch to words, files not indexed yet) instead of the word search's label
        if (notesHtml) scrapsSearchResults.insertAdjacentHTML('afterbegin', notesHtml);
        if (view.truncated && view.limit < SCRAPS_MORE_LIMIT) {
          scrapsSearchResults.insertAdjacentHTML('beforeend',
            `<div class="scraps-search-more"><button type="button" id="btn-scraps-more" class="btn-secondary">${escapeHtml(t('scrapsSearchMore'))}</button></div>`);
          const more = document.getElementById('btn-scraps-more');
          if (more) more.onclick = showMoreScrapsMeaning;
        }
      }

      // No line holds the whole text: the backend listed the notes that hold its words, best first (a match then carries a score).
      // Say so, so that the list is not read as "lines that contain what I typed".
      if (!view && scrapsSearchFlattened.some((item) => item.match && item.match.score > 0)) {
        const everyOnePartial = scrapsSearchFlattened.every((item) => item.match && item.match.partial);
        scrapsSearchResults.insertAdjacentHTML('afterbegin',
          `<div class="scraps-search-note">${escapeHtml(t(everyOnePartial ? 'scrapsSearchPartialNote' : 'scrapsSearchRankedNote'))}</div>`);
      }

      scrapsSearchResults.querySelectorAll('.scraps-match-item').forEach(el => {
        el.onclick = () => {
          const idx = parseInt(el.getAttribute('data-idx'), 10);
          if (!isNaN(idx) && scrapsSearchFlattened[idx]) {
            const item = scrapsSearchFlattened[idx];
            jumpToScrap(item.filePath, item.fileName, item.match.lineNumber);
            closeScrapsSearchModal();
          }
        };
      });
    }

    function updateScrapsSearchSelection() {
      if (!scrapsSearchResults) return;
      const items = scrapsSearchResults.querySelectorAll('.scraps-match-item');
      items.forEach((el, idx) => {
        const isActive = idx === scrapsSearchSelectedIndex;
        el.classList.toggle('active', isActive);
        if (isActive) {
          el.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    // ---- The filter row (docs/design/tag-filter-2026-10.md section 5) ----------------------------------------------------------------
    // A period and tags that narrow the exact search, the meaning search and the Deep search alike. The row is there when the backend can list
    // the tags (an older one has no scrapFilterOptions: no row, every search goes as it always did). The area under it is built and the tags
    // are asked for when the person opens it, at most once per opening of the panel; a person who never opens it pays one click handler.

    function scrapsFilterSupported() {
      return !!(window.ScrapsFilter && scrapsFilterBox && window.backend && typeof window.backend.scrapFilterOptions === 'function');
    }

    // The filter of the search that is starting: an object, or null when nothing is chosen. Remembered as what the list on screen is for, so
    // that Deep search and the empty-list sentence speak of the same filter (the period is worked out now, from the clock).
    function scrapsFilterForSearch() {
      scrapsSearchFilterSent = scrapsFilterState ? window.ScrapsFilter.toRequest(scrapsFilterState, new Date()) : null;
      return scrapsSearchFilterSent;
    }

    // Each time the panel opens: the row shows (or not), the area starts closed, and the tags are asked for again if it is opened.
    function openScrapsFilterRow() {
      scrapsSearchFilterSent = null;
      scrapsFilterLoadSeq++; // an answer to an earlier opening is not wanted
      scrapsFilterLoad = { status: 'idle', options: null, message: '' };
      scrapsFilterAreaOpen = false;
      if (!scrapsFilterSupported()) {
        scrapsFilterState = null;
        if (scrapsFilterBox) scrapsFilterBox.classList.add('hidden');
        return;
      }
      if (!scrapsFilterState) scrapsFilterState = window.ScrapsFilter.create();
      if (!scrapsFilterWired) {
        scrapsFilterWired = true;
        scrapsFilterBox.addEventListener('click', onScrapsFilterClick);
      }
      scrapsFilterBox.classList.remove('hidden');
      paintScrapsFilter();
    }

    // The button (its count, lit while something is chosen, open or closed) and the area, brought in step with the state.
    function paintScrapsFilter() {
      const F = window.ScrapsFilter;
      const label = F.countLabel(scrapsFilterState);
      const btn = document.getElementById('btn-scraps-filter');
      if (btn) {
        btn.classList.toggle('on', label !== '');
        btn.setAttribute('aria-expanded', scrapsFilterAreaOpen ? 'true' : 'false');
      }
      const count = document.getElementById('scraps-filter-count');
      if (count) count.textContent = label;
      const area = document.getElementById('scraps-filter-area');
      if (!area) return;
      area.classList.toggle('hidden', !scrapsFilterAreaOpen);
      if (scrapsFilterAreaOpen) {
        area.innerHTML = F.areaHtml({ state: scrapsFilterState, status: scrapsFilterLoad.status, options: scrapsFilterLoad.options, message: scrapsFilterLoad.message }, t);
      }
    }

    function toggleScrapsFilterArea() {
      scrapsFilterAreaOpen = !scrapsFilterAreaOpen;
      if (scrapsFilterAreaOpen && scrapsFilterLoad.status === 'idle') loadScrapsFilterOptions();
      else paintScrapsFilter();
    }

    // {tags: [{tag, files, entries}], files, undated} from the backend, once per opening of the panel (a failure stays until the next one).
    function loadScrapsFilterOptions() {
      const seq = ++scrapsFilterLoadSeq;
      scrapsFilterLoad = { status: 'loading', options: null, message: '' };
      paintScrapsFilter();
      let call;
      try {
        call = Promise.resolve(window.backend.scrapFilterOptions());
      } catch (err) {
        call = Promise.reject(err);
      }
      call.then((raw) => {
        if (seq !== scrapsFilterLoadSeq) return;
        let answer = raw;
        if (typeof answer === 'string') {
          try { answer = JSON.parse(answer); } catch (e) { answer = null; }
        }
        scrapsFilterLoad = { status: 'ready', options: window.ScrapsFilter.normalizeOptions(answer), message: '' };
        paintScrapsFilter();
      }, (err) => {
        if (seq !== scrapsFilterLoadSeq) return;
        scrapsFilterLoad = { status: 'failed', options: null, message: oneLineFailure(err, false) };
        paintScrapsFilter();
      });
    }

    // One handler for the whole row and area. The buttons are out of the Tab order (Tab in the box quotes the line) and take no keys, so after
    // any click the caret goes back to the box, where Tab, Enter and Esc mean what they always did.
    function onScrapsFilterClick(e) {
      const el = e.target && e.target.closest ? e.target.closest('[data-filter-toggle],[data-filter-period],[data-filter-tag],[data-filter-clear]') : null;
      if (scrapsSearchInput) scrapsSearchInput.focus();
      if (!el || el.disabled) return;
      if (el.hasAttribute('data-filter-toggle')) {
        toggleScrapsFilterArea();
        return;
      }
      const F = window.ScrapsFilter;
      const before = scrapsFilterState;
      if (el.hasAttribute('data-filter-period')) scrapsFilterState = F.setPeriod(before, el.getAttribute('data-filter-period'));
      else if (el.hasAttribute('data-filter-tag')) scrapsFilterState = F.toggleTag(before, el.getAttribute('data-filter-tag'));
      else if (F.isActive(before)) scrapsFilterState = F.clear();
      if (scrapsFilterState !== before) onScrapsFilterChanged();
    }

    // The filter changed: search again, by the same road as typing.
    function onScrapsFilterChanged() {
      paintScrapsFilter();
      const q = scrapsSearchInput ? scrapsSearchInput.value.trim() : '';
      if (!q) return;
      scrapsSearchSeq++; // an answer still on its way was searched with the old filter
      queueScrapsSearch(q);
    }

    // ---- Meaning search ("Exact | Meaning" in the notes search) -------------------------------------------------------------------

    function scrapsSemanticEnabled() {
      return !!(getConfig().semantic && getConfig().semantic.enabled === true);
    }

    // True while the panel searches by meaning. For a person who never turned the feature on this is one comparison.
    function scrapsMeaningMode() {
      return scrapsSearchMode === 'meaning' && scrapsSemanticEnabled();
    }

    // Called each time the panel opens. With Semantic search off it reads one setting and shows nothing.
    function openScrapsSearchExtras() {
      scrapsSearchLimit = 10;
      if (!scrapsSemanticEnabled()) {
        if (scrapsSemanticWired) { // it was on and has been turned off: the plain panel again
          scrapsSearchMode = 'exact';
          paintScrapsSearchMode();
        }
        return;
      }
      wireScrapsSemanticUi();
      if (!scrapsSearchModeLoaded) {
        scrapsSearchModeLoaded = true;
        try {
          if (sessionStorage.getItem(SCRAPS_MODE_KEY) === 'meaning') scrapsSearchMode = 'meaning';
        } catch (e) { /* no storage: the panel starts in Exact, as it always does */ }
      }
      invalidateDeepPlan();
      setScrapsSearchStatus('');
      paintScrapsSearchMode();
    }

    function closeScrapsSearchExtras() {
      invalidateDeepPlan();
      setScrapsSearchStatus('');
      if (deepDialogOpen) closeDeepSearchDialog(false);
    }

    function wireScrapsSemanticUi() {
      if (scrapsSemanticWired) return;
      scrapsSemanticWired = true;
      const on = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
      };
      on('scraps-mode-exact', () => setScrapsSearchMode('exact'));
      on('scraps-mode-meaning', () => setScrapsSearchMode('meaning'));
      on('btn-scraps-deep', () => startDeepSearch());
      on('deep-search-cancel', cancelDeepSearchDialog);
      on('deep-search-close', cancelDeepSearchDialog);
      on('deep-search-run', confirmDeepSearchDialog);
      const modal = document.getElementById('deep-search-modal');
      if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) cancelDeepSearchDialog(e); });
      // Esc on one of the panel's buttons (the switch, Deep search, Show more) closes the panel, as it does in the box (which handles
      // it itself and stops it there)
      if (scrapsSearchModal) {
        scrapsSearchModal.addEventListener('keydown', (e) => {
          if (e.key !== 'Escape' || e.isComposing) return;
          e.preventDefault();
          e.stopPropagation();
          closeScrapsSearchModal();
        });
      }
    }

    // Shows or hides the switch, and brings the label, hint, placeholder and button in step with the mode.
    function paintScrapsSearchMode() {
      const bar = document.getElementById('scraps-search-mode');
      if (!bar) return;
      const enabled = scrapsSemanticEnabled();
      const meaning = enabled && scrapsSearchMode === 'meaning';
      const mod = isMac ? 'Cmd' : 'Ctrl';
      bar.classList.toggle('hidden', !enabled);
      bar.setAttribute('aria-label', t('scrapsModeLabel'));
      [['scraps-mode-exact', !meaning], ['scraps-mode-meaning', meaning]].forEach(([id, active]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      if (scrapsSearchInput) scrapsSearchInput.placeholder = t(meaning ? 'scrapsSearchPlaceholderMeaning' : 'scrapsSearchPlaceholder');
      const hint = document.getElementById('scraps-search-hint');
      if (hint) hint.textContent = meaning ? t('scrapsSearchHintMeaning', { mod: mod }) : t('scrapsSearchHint');
      const deep = document.getElementById('btn-scraps-deep');
      if (deep) deep.title = t('deepSearchButtonTitle', { mod: mod });
      updateScrapsDeepButton();
    }

    function setScrapsSearchMode(mode) {
      const next = mode === 'meaning' ? 'meaning' : 'exact';
      if (scrapsSearchInput) scrapsSearchInput.focus();
      if (next === scrapsSearchMode) return;
      scrapsSearchMode = next;
      try {
        sessionStorage.setItem(SCRAPS_MODE_KEY, next);
      } catch (e) { /* the choice is just not remembered */ }
      scrapsSearchLimit = 10;
      clearTimeout(scrapsSearchDebounceTimer);
      scrapsSearchSeq++; // an answer still on its way belongs to the other kind of search
      invalidateDeepPlan();
      setScrapsSearchStatus('');
      paintScrapsSearchMode();
      scrapsSearchFlattened = [];
      scrapsSearchSelectedIndex = 0;
      const q = scrapsSearchInput ? scrapsSearchInput.value.trim() : '';
      if (!q) {
        renderScrapsSearchResults([]);
        return;
      }
      if (scrapsSearchResults) scrapsSearchResults.innerHTML = ''; // the other kind's list (and its "Show more") must not stay
      scrapsSearchStale = true;
      updateScrapsDeepButton();
      runScrapsSearch(q);
    }

    // The query was edited: what was prepared for the old text is dropped, and the button waits for the new list.
    function scrapsSearchTyped() {
      scrapsSearchLimit = 10;
      invalidateDeepPlan();
      setScrapsSearchStatus('');
      updateScrapsDeepButton();
    }

    // The quiet line under the header: a failure of Deep search, or the way to set the AI model up (action: { label, run }). '' clears it.
    function setScrapsSearchStatus(text, action) {
      if (!text && !scrapsStatusShown) return;
      const box = document.getElementById('scraps-search-status');
      if (!box) return;
      const label = document.getElementById('scraps-search-status-text');
      const btn = document.getElementById('btn-scraps-status-action');
      scrapsStatusShown = !!text;
      if (label) label.textContent = text || '';
      box.classList.toggle('hidden', !text);
      if (btn) {
        btn.classList.toggle('hidden', !(text && action));
        btn.textContent = text && action ? action.label : '';
        btn.onclick = text && action ? action.run : null;
      }
    }

    function runScrapsSemanticSearch(q) {
      const seq = ++scrapsSearchSeq;
      const limit = scrapsSearchLimit;
      if (!(window.backend && window.backend.searchScrapsSemantic)) {
        showScrapsMeaningFailure(t('scrapsSearchMeaningUnavailable'));
        return;
      }
      // Embedding the text takes a moment: with no list on screen yet, say what is going on (an older list stays, flagged stale)
      if (scrapsSearchResults && scrapsSearchFlattened.length === 0) {
        scrapsSearchResults.innerHTML = `<div class="scraps-search-empty">${escapeHtml(t('scrapsSearchBusy'))}</div>`;
      }
      let call;
      try {
        call = Promise.resolve(window.backend.searchScrapsSemantic(q, limit, scrapsFilterForSearch()));
      } catch (err) {
        call = Promise.reject(err);
      }
      call.then((raw) => {
        if (seq !== scrapsSearchSeq) return;
        let answer = raw;
        if (typeof answer === 'string') {
          try { answer = JSON.parse(answer); } catch (e) { answer = null; }
        }
        if (!answer || typeof answer !== 'object') answer = {};
        renderScrapsSearchResults(Array.isArray(answer.results) ? answer.results : [], {
          notes: (Array.isArray(answer.notes) ? answer.notes : []).filter((n) => typeof n === 'string' && n.trim() !== ''),
          truncated: answer.truncated === true,
          semantic: answer.semantic !== false,
          pending: Number(answer.pending) || 0,
          leftOut: Number(answer.leftOut) || 0,
          limit: limit
        });
      }).catch((err) => {
        if (seq !== scrapsSearchSeq) return;
        // "superseded": the backend dropped this search for a newer one, whose answer is the one to show. No sentence for that.
        if (backendErrorCode(err) === 'superseded') return;
        showScrapsMeaningFailure(t('scrapsSearchMeaningFailed', { message: oneLineFailure(err, false) }));
      });
    }

    // The meaning search could not answer (the feature is off, a cloud host is not allowed, no model ...): the message on one line in
    // place of the list. The switch stays, so the person can go back to Exact.
    function showScrapsMeaningFailure(text) {
      scrapsSearchFlattened = [];
      scrapsSearchSelectedIndex = 0;
      scrapsSearchStale = false;
      updateScrapsDeepButton();
      if (scrapsSearchResults) {
        scrapsSearchResults.innerHTML = `<div class="scraps-search-empty scraps-search-error" role="alert">${escapeHtml(text)}</div>`;
      }
    }

    function showMoreScrapsMeaning() {
      const q = scrapsSearchInput ? scrapsSearchInput.value.trim() : '';
      if (!q || !scrapsMeaningMode()) return;
      scrapsSearchLimit = SCRAPS_MORE_LIMIT;
      scrapsSearchStale = true; // the list on screen is the shorter one until the longer one arrives
      updateScrapsDeepButton();
      if (scrapsSearchInput) scrapsSearchInput.focus();
      runScrapsSemanticSearch(q);
    }

    // ---- Deep search: excerpts of the hits go to the AI, the answer with source links goes into a NEW note --------------------------

    function populateDeepSearchModelSelect() {
      const sel = document.getElementById('scraps-deep-model');
      if (!sel) return;
      const baseModel = (getConfig().text && getConfig().text.model) ? String(getConfig().text.model).trim() : '';
      const baseUrl = (getConfig().text && getConfig().text.baseUrl) ? String(getConfig().text.baseUrl).trim() : '';
      let prov = 'gemini';
      if (baseUrl.includes('openrouter.ai')) prov = 'openrouter';
      else if (baseUrl.includes('openai.com')) prov = 'openai';
      else if (baseUrl.includes('11434')) prov = 'ollama';
      else if (baseUrl.includes('1234')) prov = 'lmstudio';
      else if (baseUrl.includes('groq.com')) prov = 'groq';
      else if (baseUrl.includes('deepseek.com')) prov = 'deepseek';
      else if (baseUrl.includes('dashscope')) prov = 'qwen';

      const opts = [];
      const seen = new Set();
      const addOpt = (val, label) => {
        if (seen.has(val)) return;
        seen.add(val);
        opts.push({ val, label });
      };
      addOpt('', baseModel ? `Default (${baseModel})` : 'Default (Settings)');
      const preset = (typeof TEXT_PROVIDER_PRESETS !== 'undefined' && TEXT_PROVIDER_PRESETS[prov]) ? TEXT_PROVIDER_PRESETS[prov] : null;
      if (preset && Array.isArray(preset.models)) {
        preset.models.forEach((m) => addOpt(m.id, m.id));
      }
      if (prov === 'gemini' || !baseUrl) {
        addOpt('gemini-4-argon', 'gemini-4-argon');
        addOpt('gemini-4-hydrogen', 'gemini-4-hydrogen');
        addOpt('gemini-3.8-flash', 'gemini-3.8-flash');
      }

      let saved = '';
      try { saved = localStorage.getItem('syki_deep_model') || ''; } catch (_) {}
      if (saved && !seen.has(saved)) addOpt(saved, saved);

      sel.textContent = '';
      opts.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.val;
        opt.textContent = o.label;
        sel.appendChild(opt);
      });
      sel.value = saved;
      if (!sel.dataset.wired) {
        sel.dataset.wired = '1';
        sel.addEventListener('change', () => {
          try { localStorage.setItem('syki_deep_model', sel.value || ''); } catch (_) {}
        });
      }
    }

    function getSelectedDeepModel() {
      const sel = document.getElementById('scraps-deep-model');
      return sel ? String(sel.value || '').trim() : '';
    }

    function isDeepSkipConfirmEnabled() {
      const chk = document.getElementById('chk-deep-skip-confirm');
      return !!(chk && chk.checked);
    }

    function getSelectedDeepLength() {
      const grp = document.getElementById('scraps-deep-length');
      if (!grp) return 'standard';
      const active = grp.querySelector('.scraps-mode-btn.active');
      const v = active ? String(active.getAttribute('data-length') || '') : '';
      return (v === 'short' || v === 'long') ? v : 'standard';
    }

    function syncDeepLengthButtons() {
      const grp = document.getElementById('scraps-deep-length');
      if (!grp) return;
      let saved = 'standard';
      try {
        const s = localStorage.getItem('syki_deep_length');
        if (s === 'short' || s === 'standard' || s === 'long') saved = s;
      } catch (_) {}
      const btns = grp.querySelectorAll('.scraps-mode-btn[data-length]');
      btns.forEach((b) => {
        const on = b.getAttribute('data-length') === saved;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (!grp.dataset.wired) {
        grp.dataset.wired = '1';
        btns.forEach((b) => {
          b.addEventListener('click', () => {
            const val = b.getAttribute('data-length') || 'standard';
            try { localStorage.setItem('syki_deep_length', val); } catch (_) {}
            btns.forEach((x) => {
              const on = x === b;
              x.classList.toggle('active', on);
              x.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
          });
        });
      }
    }

    // The button is for a fresh meaning list that has at least one hit.
    function updateScrapsDeepButton() {
      const btn = document.getElementById('btn-scraps-deep');
      if (!btn) return;
      const visible = !!(scrapsMeaningMode() && !scrapsSearchStale && scrapsSearchFlattened.length > 0);
      btn.classList.toggle('hidden', !visible);
      btn.disabled = deepSearchPlanning;
      btn.textContent = t(deepSearchPlanning ? 'deepSearchPreparing' : 'deepSearchButton');

      const sel = document.getElementById('scraps-deep-model');
      if (sel) {
        if (visible) populateDeepSearchModelSelect();
        sel.classList.toggle('hidden', !visible);
        sel.disabled = deepSearchPlanning;
      }
      const lenGrp = document.getElementById('scraps-deep-length');
      if (lenGrp) {
        if (visible) syncDeepLengthButtons();
        lenGrp.classList.toggle('hidden', !visible);
      }
      const skipWrap = document.getElementById('scraps-deep-skip-wrap');
      const skipChk = document.getElementById('chk-deep-skip-confirm');
      if (skipWrap && skipChk) {
        if (!skipChk.dataset.wired) {
          skipChk.dataset.wired = '1';
          try { skipChk.checked = localStorage.getItem('syki_deep_skip_confirm') === '1'; } catch (_) {}
          skipChk.addEventListener('change', () => {
            try { localStorage.setItem('syki_deep_skip_confirm', skipChk.checked ? '1' : '0'); } catch (_) {}
          });
        }
        skipWrap.classList.toggle('hidden', !visible);
      }
    }

    // Whatever is being prepared is no longer wanted (the panel closed, the mode or the text changed): its answer will be dropped.
    function invalidateDeepPlan() {
      deepSearchToken++;
      if (deepSearchPlanning) {
        deepSearchPlanning = false;
        updateScrapsDeepButton();
      }
    }

    // Button / Ctrl+Enter: ask the backend for the plan (it searches and builds the excerpts; nothing is sent to the AI yet), then
    // show what would be sent and to whom.
    async function startDeepSearch() {
      if (deepSearchPlanning || deepDialogOpen || !scrapsMeaningMode() || scrapsSearchStale || scrapsSearchFlattened.length === 0) return;
      const q = scrapsSearchInput ? scrapsSearchInput.value.trim() : '';
      if (!q || !(window.backend && window.backend.deepSearchPlan)) return;
      const token = ++deepSearchToken;
      deepSearchPlanning = true;
      setScrapsSearchStatus('');
      updateScrapsDeepButton();
      const limit = scrapsSearchLimit;
      deepPlanFilter = scrapsSearchFilterSent; // the filter the list on screen was searched with: the excerpts come from the same notes
      const got = await fetchDeepPlan(q, limit, deepPlanFilter);
      if (token !== deepSearchToken) return; // the panel was closed or the text edited meanwhile: nobody waits for this plan any more
      deepSearchPlanning = false;
      updateScrapsDeepButton();
      // (the button was disabled while the plan was prepared, which takes the focus from it: it goes back to the box)
      if (scrapsSearchInput && (got.failure || deepPlanBlocker(got.plan))) scrapsSearchInput.focus();
      if (got.failure) {
        setScrapsSearchStatus(t('deepSearchFailed', { message: got.failure }));
        return;
      }
      const blocker = deepPlanBlocker(got.plan);
      if (blocker === 'model') {
        // The same words and the same way out as the ask bar when no model is set up
        setScrapsSearchStatus(t('askSetupNeeded'), {
          label: t('askSetupButton'),
          run: () => { closeScrapsSearchModal(); openAiModelsSettings('text'); }
        });
        return;
      }
      if (blocker === 'none') {
        setScrapsSearchStatus(t('deepSearchNoSources'));
        return;
      }
      const selectedModel = getSelectedDeepModel();
      const selectedLength = getSelectedDeepLength();
      const dest = got.plan.destination || {};
      const cloud = dest.local !== true;
      const alreadyApproved = !cloud || dest.consent_given === true;
      if (isDeepSkipConfirmEnabled() && alreadyApproved) {
        runDeepSearch(got.plan, q, limit, selectedModel, selectedLength);
        return;
      }
      showDeepSearchDialog(got.plan, q, false, limit, selectedModel, selectedLength);
    }

    // The plan from the backend: { plan } or { failure: the reason in one line }.
    async function fetchDeepPlan(query, limit, filter) {
      try {
        let plan = await window.backend.deepSearchPlan(query, limit, filter || null);
        if (typeof plan === 'string') plan = JSON.parse(plan);
        return plan && typeof plan === 'object' ? { plan: plan } : { failure: '?' };
      } catch (err) {
        return { failure: oneLineFailure(err, false) || '?' };
      }
    }

    // Why a plan cannot be run: 'model' (no text model is set up), 'none' (no note to send: the backend then gives plan_id "" and no sources), or ''.
    function deepPlanBlocker(plan) {
      if (plan.model_configured === false) return 'model';
      if (!plan.plan_id || !Array.isArray(plan.sources) || plan.sources.length === 0) return 'none';
      return '';
    }

    // The confirmation: how many notes and characters, to which model and host, what was left out, the sources (folded), and for a
    // cloud host that is not allowed yet the question itself. Cancel has the focus; an Enter right after it appeared is ignored.
    function showDeepSearchDialog(plan, query, forceConsent, limit, modelOverride, lengthOverride) {
      const modal = document.getElementById('deep-search-modal');
      if (!modal) return;
      const dest = plan.destination || {};
      const effectiveModel = String(modelOverride || dest.model || '');
      const stats = plan.stats || {};
      const sources = plan.sources || [];
      const ja = (getConfig().general && getConfig().general.language) === 'ja';
      const fmt = (n) => (Number(n) || 0).toLocaleString(ja ? 'ja-JP' : 'en-US');
      const cloud = dest.local !== true;
      const needsConsent = cloud && (dest.consent_given !== true || forceConsent === true);
      const key = String(dest.consent_key || dest.host || '');
      const host = String(dest.host || dest.consent_key || '');
      const el = (id) => document.getElementById(id);

      const chars = Number(stats.total_chars) > 0 ? stats.total_chars : sources.reduce((sum, s) => sum + (Number(s.chars) || 0), 0);
      const destText = cloud
        ? t('deepSearchDestCloud', { model: effectiveModel, host: host })
        : t('deepSearchDestLocal', { model: effectiveModel });
      const summary = el('deep-search-summary');
      summary.textContent = t('deepSearchSummary', { count: fmt(sources.length), chars: fmt(chars), dest: destText });
      summary.setAttribute('data-kind', cloud ? 'cloud' : 'local');
      const q = String(query || '').replace(/\s+/g, ' ').trim();
      el('deep-search-query').textContent = t('deepSearchQuery', { query: q.length > 160 ? q.substring(0, 160) + '…' : q });

      el('deep-search-sources-summary').textContent = t('deepSearchSources', { count: fmt(sources.length) });
      const list = el('deep-search-source-list');
      list.textContent = '';
      sources.forEach((src) => {
        const li = document.createElement('li');
        const label = String(src.label || src.rel || '');
        const date = src.date && label.indexOf(String(src.date)) === -1 ? String(src.date) : '';
        li.appendChild(document.createTextNode(label));
        const meta = document.createElement('span');
        meta.className = 'deep-search-source-meta';
        meta.textContent = ' · ' + (date ? date + ' · ' : '') + t('deepSearchSourceChars', { chars: fmt(src.chars) });
        li.appendChild(meta);
        list.appendChild(li);
      });
      el('deep-search-sources').open = false;

      const facts = [];
      if (Number(stats.masked) > 0) facts.push(t('deepSearchMasked', { n: fmt(stats.masked) }));
      const left = [];
      [['ignored', 'deepSearchLeftIgnored'], ['ai', 'deepSearchLeftAi'], ['unreadable', 'deepSearchLeftUnreadable'], ['budget', 'deepSearchLeftBudget']].forEach(([field, textKey]) => {
        if (Number(stats[field]) > 0) left.push(t(textKey, { n: fmt(stats[field]) }));
      });
      if (left.length) facts.push(t('deepSearchLeftOut', { list: left.join(ja ? '、' : ', ') }));
      if (plan.semantic === false) facts.push(t('deepSearchWordsOnly'));
      if (Number(plan.est_tokens) > 0) facts.push(t('deepSearchTokens', { tokens: fmt(plan.est_tokens) }));
      (Array.isArray(plan.notes) ? plan.notes : []).forEach((n) => { if (typeof n === 'string' && n.trim()) facts.push(n); });
      const factsBox = el('deep-search-facts');
      factsBox.textContent = '';
      facts.forEach((text) => {
        const line = document.createElement('div');
        line.textContent = text;
        factsBox.appendChild(line);
      });

      const consent = el('deep-search-consent');
      consent.classList.toggle('hidden', !needsConsent);
      consent.textContent = needsConsent ? t('deepSearchConsent', { host: host }) : '';
      const run = el('deep-search-run');
      run.textContent = t(needsConsent ? 'deepSearchAllowRun' : 'deepSearchRun');
      run.disabled = false;

      deepDialogHeld = { plan: plan, query: query, limit: limit, needsConsent: needsConsent, key: key, modelOverride: modelOverride || '', lengthOverride: lengthOverride || '' };
      deepDialogShownAt = Date.now();
      setDeepDialogOpen(true);
      modal.classList.remove('hidden');
      document.addEventListener('keydown', deepSearchKeydown, true);
      el('deep-search-cancel').focus();
    }

    // While the dialog is up (added when it opens, removed when it closes): Esc cancels, and an Enter that arrives within the guard
    // time is swallowed (a key still held from the shortcut that raised the dialog must not answer it).
    function deepSearchKeydown(e) {
      if (!deepDialogOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeDeepSearchDialog(true);
      } else if (e.key === 'Enter' && Date.now() - deepDialogShownAt < DEEP_CONFIRM_GUARD_MS) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    // refocus: put the caret back in the search box (the panel is still there), or in the note when the panel has gone.
    function closeDeepSearchDialog(refocus) {
      const modal = document.getElementById('deep-search-modal');
      if (modal) modal.classList.add('hidden');
      document.removeEventListener('keydown', deepSearchKeydown, true);
      setDeepDialogOpen(false);
      deepDialogHeld = null;
      if (!refocus) return;
      if (scrapsSearchModal && !scrapsSearchModal.classList.contains('hidden') && scrapsSearchInput) {
        scrapsSearchInput.focus();
      } else {
        const editor = getActiveEditor();
        if (editor) editor.focus();
      }
    }

    function cancelDeepSearchDialog(evt) {
      if (!deepDialogOpen) return;
      if (evt && evt.detail === 0 && Date.now() - deepDialogShownAt < DEEP_CONFIRM_GUARD_MS) return;
      closeDeepSearchDialog(true);
    }

    async function confirmDeepSearchDialog(evt) {
      if (!deepDialogOpen || !deepDialogHeld) return;
      if (evt && evt.detail === 0 && Date.now() - deepDialogShownAt < DEEP_CONFIRM_GUARD_MS) return;
      const held = deepDialogHeld;
      if (held.needsConsent) {
        // "Allow and run": the host is remembered like an answer in the ask bar (general.cloudConsent), and the answer is in getConfig().json
        // before the run asks the backend, which reads it from there and refuses (consent_required) otherwise.
        const run = document.getElementById('deep-search-run');
        if (run) run.disabled = true;
        let saved = true;
        if (held.key) {
          try {
            saved = (await rememberCloudConsent(held.key)) !== false;
          } catch (e) {
            saved = false;
          }
        }
        if (!deepDialogOpen || deepDialogHeld !== held) return; // cancelled while it was being saved
        if (!saved) {
          // getConfig().json could not be written (the save has said so): the backend would refuse, so nothing is sent. The dialog stays.
          if (run) run.disabled = false;
          return;
        }
      }
      closeDeepSearchDialog(false);
      runDeepSearch(held.plan, held.query, held.limit, held.modelOverride || '', held.lengthOverride || '');
    }

    // The tab's name: the backend's title without characters a file name cannot hold, ".md" added.
    function deepSearchTabTitle(title) {
      const base = String(title || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.md$/i, '').substring(0, 80).trim();
      return (base || t('deepSearchDefaultTitle')) + '.md';
    }

    // The run: a background task (listed in the task panel, cancellable) that ends in ONE new, unsaved tab holding the answer. The
    // search panel gives way at once, since the AI may take a while; nothing is created when it is cancelled or fails.
    global.__onSemanticIdleProgress = function (p) {
      if (!p || !scrapsSearchModal || scrapsSearchModal.classList.contains('hidden')) return;
      if (!scrapsMeaningMode()) return;
      if (p.running) {
        setScrapsSearchStatus(t('semanticIdleProgress', { files: String(p.filesDone || 0), filesTotal: String(p.filesTotal || 0) }));
      } else if (scrapsSearchStatusText && scrapsSearchStatusText.textContent && scrapsSearchStatusText.textContent.indexOf('/') !== -1) {
        setScrapsSearchStatus('');
      }
    };

    function runDeepSearch(plan, query, limit, modelOverride, lengthOverride) {
      const planId = String(plan.plan_id);
      const taskId = genReqId('deepsearch_');
      const lang = (getConfig().general && getConfig().general.language) === 'ja' ? 'ja' : 'en';
      const state = { canceled: false };
      const effectiveModel = String(modelOverride || (plan.destination && plan.destination.model) || '');
      const srcCount = Array.isArray(plan.sources) ? plan.sources.length : 0;
      const finish = (status, error) => {
        if (window.__onDeepSearchProgress === onProgress) window.__onDeepSearchProgress = null;
        if (window.TaskManager && window.TaskManager.updateTask) window.TaskManager.updateTask(taskId, { status: status, error: error });
      };
      const onProgress = (p) => {
        if (state.canceled || !p) return;
        const msg = t('deepSearchProgress', {
          model: String(p.model || effectiveModel || ''),
          sec: String(p.elapsedSec || 0),
          sources: String(p.sources || srcCount)
        });
        showMessage(msg, 2500);
        if (window.TaskManager && window.TaskManager.updateTask) {
          window.TaskManager.updateTask(taskId, { instruction: msg });
        }
      };
      window.__onDeepSearchProgress = onProgress;
      if (window.TaskManager && window.TaskManager.addTask) {
        window.TaskManager.addTask({
          id: taskId,
          type: 'deepsearch',
          agent: t('deepSearchButton'),
          instruction: String(query || '').replace(/\s+/g, ' ').trim().substring(0, 80),
          onCancel: () => {
            state.canceled = true;
            try {
              const stopped = window.backend.cancelDeepSearch(planId);
              if (stopped && typeof stopped.catch === 'function') stopped.catch(() => {});
            } catch (e) { /* nothing left to stop */ }
          }
        });
      }
      closeScrapsSearchModal();
      onProgress({ elapsedSec: 0, sources: srcCount, model: effectiveModel });

      let call;
      try {
        call = Promise.resolve(window.backend.deepSearchRun(planId, lang, modelOverride || '', lengthOverride || ''));
      } catch (err) {
        call = Promise.reject(err);
      }
      call.then((res) => {
        if (state.canceled) return; // cancelled in the task list: the answer is thrown away
        const markdown = res && typeof res.markdown === 'string' ? res.markdown : '';
        if (!markdown.trim()) throw new Error(t('llmEmptyAnswer'));
        const tab = createTab(deepSearchTabTitle(res.title), markdown, '', undefined, true);
        tab.cursorPos = 0; // the answer is read from its top
        tab.isDirty = true; // not a file yet: closing it asks first, and the person chooses where it is saved
        showTab(tab.id);
        renderTabs();
        saveSessionDebounced();
        finish('completed');
        showMessage(t('deepSearchDone'), 5000);
      }).catch((err) => {
        if (state.canceled) return;
        const code = backendErrorCode(err);
        if (code === 'cancelled' || code === 'canceled') {
          finish('canceled');
          return;
        }
        if (code === 'consent_required') {
          // Nothing was sent: the backend has no answer for that host. Ask again, in the dialog.
          finish('failed', t('deepSearchConsent', { host: String((plan.destination && (plan.destination.host || plan.destination.consent_key)) || '') }));
          showDeepSearchDialog(plan, query, true, limit);
          return;
        }
        if (code === 'plan_expired') {
          finish('failed', t('deepSearchExpired'));
          replanDeepSearch(query, limit);
          return;
        }
        if (code === 'model_not_configured') {
          finish('failed', t('askLlmNotConfigured'));
          showMessage(t('askLlmNotConfigured'), 6000);
          return;
        }
        const line = oneLineFailure(err, true);
        finish('failed', line);
        showMessage(t('deepSearchFailed', { message: line }), 8000, { important: true });
      });
    }

    // The plan went stale (it lives 15 minutes, and a run uses it up): prepare it again from the same text and ask again.
    async function replanDeepSearch(query, limit) {
      showMessage(t('deepSearchExpired'), 4000);
      const got = await fetchDeepPlan(query, limit || 10, deepPlanFilter);
      if (deepDialogOpen) return;
      if (got.failure) {
        showMessage(t('deepSearchFailed', { message: got.failure }), 8000, { important: true });
        return;
      }
      const blocker = deepPlanBlocker(got.plan);
      if (blocker) {
        showMessage(t(blocker === 'model' ? 'askLlmNotConfigured' : 'deepSearchNoSources'), 6000);
        return;
      }
      showDeepSearchDialog(got.plan, query, false, limit);
    }

    async function jumpToScrap(filePath, fileName, lineNumber) {
      // The tab that shows THIS file (same path), never another note that only has the same name: the date-named scrap exists in every folder.
      let targetTab = findTabByPath(filePath);
      if (!targetTab) {
        let content = '';
        if (window.backend && window.backend.readFileByPath) {
          try {
            const res = await window.backend.readFileByPath(filePath);
            if (res) content = res.content;
          } catch (e) {
            console.warn('Failed to read scrap file:', e);
          }
        }
        targetTab = createTab(fileName, content, filePath);
        targetTab.isAutoTitle = false;
        targetTab.isScrap = true;
      }
      selectTab(targetTab.id);

      setTimeout(() => {
        gotoLineNumber(lineNumber);
        flashEditorLine(lineNumber);
      }, 60);
    }

    return {
      open: openScrapsSearchModal,
      close: closeScrapsSearchModal,
      setMode: setScrapsSearchMode,
      isDeepDialogOpen: function () { return !!deepDialogOpen; },
      jumpToScrap: jumpToScrap
    };
  }

  const api = { create: create };
  global.SykiSearchWorkbench = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
