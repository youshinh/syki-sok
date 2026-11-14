// Ring 0 (Stream Kernel) JSON-RPC bridge for the Editor Canvas (Ring 1).
// Exposes SykiRpcBridge.create(port) which builds the window.__sykiRPC dispatch object
// against a narrow EditorCanvasPort seam so RPC behavior can be tested without loading app.js.
(function (global) {
  'use strict';

  function rpcFail(kind, message) {
    const err = new Error('[' + kind + '] ' + message);
    err.rpcKind = kind;
    throw err;
  }

  function rpcHash(text) {
    const H = global.NoteHash || (typeof globalThis !== 'undefined' && globalThis.NoteHash) || (typeof require === 'function' ? require('./note_hash.js') : null);
    if (!H || typeof H.hash16 !== 'function') {
      throw new Error('note_hash.js is not loaded');
    }
    return H.hash16(text);
  }

  function lfText(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  }

  function countNewlines(s, before) {
    let n = 0;
    for (let i = 0; i < before; i++) {
      if (s.charCodeAt(i) === 10) n++;
    }
    return n;
  }

  function rpcLineCol(text, offset) {
    const at = Math.max(0, Math.min(offset, text.length));
    const lastNewline = at > 0 ? text.lastIndexOf('\n', at - 1) : -1;
    return { line: 1 + countNewlines(text, at), col: at - lastNewline };
  }

  function rpcCaretOf(tab, text, editorForTab) {
    const editor = editorForTab(tab.id);
    let start;
    let end;
    if (editor) {
      start = editor.selectionStart;
      end = editor.selectionEnd;
    } else {
      start = end = Number.isFinite(tab.cursorPos) ? tab.cursorPos : text.length;
    }
    start = Math.max(0, Math.min(start, text.length));
    end = Math.max(start, Math.min(end, text.length));
    return { start: start, end: end };
  }

  function create(port) {
    if (!port || typeof port !== 'object') {
      throw new Error('SykiRpcBridge.create requires an EditorCanvasPort');
    }

    const resolveTab = port.resolveTab;
    const getTab = port.getTab;
    const getTabText = port.getTabText;
    const writeTabText = port.writeTabText;
    const editorForTab = port.editorForTab;

    return {
      getBuffer: function (tabId) {
        const targetTab = resolveTab(tabId);
        const content = getTabText(targetTab.id) || '';
        const lines = content.split('\n');
        const state = port.getViewState();
        return {
          tabId: targetTab.id,
          title: targetTab.title || 'Untitled',
          path: targetTab.path || '',
          content: content,
          length: content.length,
          lineCount: lines.length,
          isActive: targetTab.id === state.activeTabId,
          isModified: !!targetTab.isDirty
        };
      },

      writeText: function (req) {
        req = req || {};
        const tab = resolveTab(req.tabId);
        const previousHash = rpcHash(getTabText(tab.id));
        if (req.expectedHash && req.expectedHash !== previousHash) {
          rpcFail('conflict', 'conflict: expected hash ' + req.expectedHash + ' but buffer is at ' + previousHash);
        }
        if (req.expectedGeneration > 0 && req.expectedGeneration !== req.currentGeneration) {
          rpcFail('conflict', 'conflict: expected generation ' + req.expectedGeneration + ' but buffer is at ' + req.currentGeneration);
        }
        writeTabText(tab, req.content, req.mode, req.range);
        return { tab_id: tab.id, previous_hash: previousHash, hash: rpcHash(getTabText(tab.id)) };
      },

      setBuffer: function (text, tabId) {
        writeTabText(resolveTab(tabId), text, 'set');
        return true;
      },

      appendBuffer: function (text, tabId) {
        writeTabText(resolveTab(tabId), text, 'append');
        return true;
      },

      replaceRange: function (startLine, startCol, endLine, endCol, text, tabId) {
        writeTabText(resolveTab(tabId), text, 'replace', {
          startLine: startLine,
          startCol: startCol,
          endLine: endLine,
          endCol: endCol
        });
        return true;
      },

      getTabs: function () {
        const state = port.getViewState();
        return port.getTabs().map(function (t) {
          return {
            id: t.id,
            title: t.title || 'Untitled',
            path: t.path || '',
            isActive: t.id === state.activeTabId,
            isModified: !!t.isDirty,
            encoding: t.encoding || 'utf-8',
            eol: t.eol === 'crlf' ? 'crlf' : 'lf',
            diskConflict: !!t.diskConflict,
            isScrap: !!t.isScrap,
            pane: t.id === state.activeTabId ? 'primary' : (state.isSplitMode && state.secondaryTabId === t.id ? 'secondary' : null)
          };
        });
      },

      switchTab: function (tabId) {
        port.selectTab(resolveTab(tabId).id);
        return true;
      },

      getNoteDir: function () {
        return port.getNoteDir();
      },

      getNoteDirForEditor: function (editor) {
        return port.getNoteDir(getTab(port.getTabIdForEditor(editor)));
      },

      newTab: function (title, content, path) {
        port.createTab(title, content, path);
        return true;
      },

      openTab: function (spec) {
        spec = spec || {};
        const background = !!spec.background;
        const existing = spec.path ? port.findTabByPath(spec.path) : null;
        if (existing) {
          port.adoptDiskText(existing, typeof spec.content === 'string' ? lfText(spec.content) : undefined, spec.content);
          if (!background) port.showTab(existing.id);
          return { id: existing.id, title: existing.title || '', path: existing.path || '', existing: true };
        }
        const tab = port.createTab(
          spec.title || undefined,
          typeof spec.content === 'string' ? lfText(spec.content) : undefined,
          spec.path || '',
          spec.encoding || undefined,
          background
        );
        if (spec.path && typeof spec.content === 'string') {
          port.rememberDiskText(tab, lfText(spec.content), spec.content);
        }
        return { id: tab.id, title: tab.title || '', path: tab.path || '', existing: false };
      },

      closeTab: function (tabId) {
        const state = port.getViewState();
        port.closeTab(tabId || state.activeTabId);
        return true;
      },

      closeTabChecked: function (tabId, ifSaved) {
        return port.closeTabForRpc(tabId, !!ifSaved);
      },

      prepareSave: function (tabId) {
        const tab = resolveTab(tabId);
        const content = getTabText(tab.id);
        return {
          tab_id: tab.id,
          content: content,
          hash: rpcHash(content),
          path: tab.path || '',
          encoding: tab.encoding || 'UTF-8',
          title: tab.title || '',
          eol: tab.eol || '',
          disk_sig: tab.diskSig || ''
        };
      },

      commitSave: function (tabId, info) {
        info = info || {};
        const tab = getTab(tabId);
        if (!tab) rpcFail('not_found', 'no such tab: ' + tabId + ' (it was closed while saving; the file was written)');
        if (rpcHash(getTabText(tab.id)) !== info.hash) {
          rpcFail('conflict', 'the note was edited while it was being saved (the file holds the earlier text)');
        }
        return port.commitSaveForTab(tab, info);
      },

      toggleSplit: async function () {
        return port.toggleSplit();
      },

      getSelection: function (tabId) {
        return port.getSelection(tabId);
      },

      replaceSelection: function (text, tabId, expectedStart, expectedEnd) {
        return port.replaceSelection(text, tabId, expectedStart, expectedEnd);
      },

      getCursor: function (tabId) {
        const tab = resolveTab(tabId);
        const text = getTabText(tab.id) || '';
        const caret = rpcCaretOf(tab, text, editorForTab);
        const from = rpcLineCol(text, caret.start);
        const to = caret.end === caret.start ? from : rpcLineCol(text, caret.end);
        return {
          tabId: tab.id,
          start: caret.start,
          end: caret.end,
          hasSelection: caret.end > caret.start,
          line: from.line,
          col: from.col,
          endLine: to.line,
          endCol: to.col,
          length: text.length
        };
      },

      setCursor: function (tabId, start, end, opts) {
        const tab = resolveTab(tabId);
        opts = opts && typeof opts === 'object' ? opts : {};
        const asOffset = function (value, name) {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            rpcFail('invalid_params', name + ' must be a number');
          }
          return Math.trunc(value);
        };
        const text = getTabText(tab.id) || '';
        const clamp = function (n) { return Math.max(0, Math.min(n, text.length)); };
        let a = clamp(asOffset(start, 'start'));
        let b = end === undefined || end === null ? a : clamp(asOffset(end, 'end'));
        if (a > b) {
          const swap = a;
          a = b;
          b = swap;
        }
        return port.setCursorForTab(tab, text, a, b, opts, rpcLineCol);
      },

      getUiState: function () {
        return port.rpcUiState();
      },

      setUiState: function (spec) {
        return port.setUiStateForRpc(spec);
      },

      printPdf: function (tabId, settings, outPath) {
        return port.printPdfForRpc(tabId, settings, outPath);
      },

      openPanel: function (name, opts) {
        return port.openPanelForRpc(name, opts);
      },

      getTasks: function () {
        const manager = global.TaskManager;
        return manager && typeof manager.snapshot === 'function' ? manager.snapshot() : { running: [], recent: [] };
      },

      cancelTask: function (id) {
        if (typeof id !== 'string' || id === '') rpcFail('invalid_params', 'task id is required');
        const manager = global.TaskManager;
        if (!manager || typeof manager.snapshot !== 'function') return { cancelled: false, reason: 'not_found' };
        const before = manager.snapshot();
        const task = before.running.find(function (x) { return x.id === id; });
        if (!task) return { cancelled: false, reason: before.recent.some(function (x) { return x.id === id; }) ? 'not_running' : 'not_found' };
        if (!task.cancellable) return { cancelled: false, reason: 'not_cancellable' };
        manager.cancelTask(id);
        return manager.snapshot().running.some(function (x) { return x.id === id; })
          ? { cancelled: false, reason: 'not_cancellable' }
          : { cancelled: true };
      }
    };
  }

  const api = {
    create: create,
    rpcFail: rpcFail,
    rpcHash: rpcHash,
    lfText: lfText,
    rpcLineCol: rpcLineCol,
    rpcCaretOf: rpcCaretOf
  };

  global.SykiRpcBridge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
