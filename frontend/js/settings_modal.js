/**
 * SykiSettingsModal — Settings dialog controller, tab orchestration,
 * live-preview snapshot/restore, and LLM provider detection.
 *
 * Extracted from app.js to isolate modal session state behind a clean
 * dependency port (`deps`) while keeping startup config loading in app.js.
 */
(function (global) {
  'use strict';

  function create(deps) {
    const doc = deps.document || global.document;
    const win = deps.window || global;

    let settingsTabTaskTimer = null;
    let modelTabInitialized = false;
    let syncTabInitialized = false;
    let agentTabInitialized = false;
    let providerDetectReqToken = 0;

    function resetTabInit() {
      modelTabInitialized = false;
      syncTabInitialized = false;
      agentTabInitialized = false;
    }

    function switchTab(tabName) {
      // Normalize legacy tab names
      if (tabName === 'text') tabName = 'general';
      if (tabName === 'autocomplete' || tabName === 'vision' || tabName === 'image') tabName = 'model';
      if (tabName === 'cli') tabName = 'agent';
      if (tabName === 'scraps') tabName = 'sync';
      if (tabName === 'keys') tabName = 'shortcuts';

      const els = deps.getElements ? deps.getElements() : {};
      const {
        settingsModal,
        tabBtnGeneral,
        tabBtnModel,
        tabBtnAgent,
        tabBtnSync,
        tabBtnShortcuts,
        paneGeneral,
        paneText,
        paneImage,
        paneModel,
        paneAgent,
        paneSync,
        paneShortcuts,
      } = els;

      // 0ms immediate UI switch: toggle tab highlight & pane visibility without blocking
      if (tabBtnGeneral) tabBtnGeneral.classList.toggle('active', tabName === 'general');
      if (tabBtnModel) tabBtnModel.classList.toggle('active', tabName === 'model');
      if (tabBtnAgent) tabBtnAgent.classList.toggle('active', tabName === 'agent');
      if (tabBtnSync) tabBtnSync.classList.toggle('active', tabName === 'sync');
      if (tabBtnShortcuts) tabBtnShortcuts.classList.toggle('active', tabName === 'shortcuts');

      if (paneGeneral) paneGeneral.classList.toggle('hidden', tabName !== 'general');
      if (paneText) paneText.classList.toggle('hidden', true);
      if (paneImage) paneImage.classList.toggle('hidden', true);
      if (paneModel) paneModel.classList.toggle('hidden', tabName !== 'model');
      if (paneAgent) paneAgent.classList.toggle('hidden', tabName !== 'agent');
      if (paneSync) paneSync.classList.toggle('hidden', tabName !== 'sync');
      if (paneShortcuts) paneShortcuts.classList.toggle('hidden', tabName !== 'shortcuts');

      const modalBody = settingsModal ? settingsModal.querySelector('.modal-body') : null;
      if (modalBody) {
        modalBody.classList.toggle('tab-shortcuts-active', tabName === 'shortcuts');
      }

      if (tabName !== 'shortcuts' && deps.getRecordingAction && deps.getRecordingAction()) {
        if (deps.clearRecordingAction) deps.clearRecordingAction();
      }

      // Shortcuts: once rendered, switching to it is purely a 0ms un-hide operation.
      if (tabName === 'shortcuts') {
        if (deps.isShortcutsDirtyOrUnrendered && deps.isShortcutsDirtyOrUnrendered()) {
          if (deps.renderShortcutsTable) deps.renderShortcutsTable();
        }
        return;
      }

      // Heavy IPC tasks deferred and initialized purely ON DEMAND (only on first tab visit)
      if (settingsTabTaskTimer) {
        clearTimeout(settingsTabTaskTimer);
        settingsTabTaskTimer = null;
      }
      settingsTabTaskTimer = setTimeout(() => {
        settingsTabTaskTimer = null;
        const config = deps.getConfig();
        if (tabName === 'model') {
          if (!modelTabInitialized) {
            modelTabInitialized = true;
            if (win.SpeechSettings) {
              win.SpeechSettings.init({ t: deps.t, backend: win.backend, doc: doc });
              win.SpeechSettings.load(config);
            }
            if (win.SemanticSettings) {
              win.SemanticSettings.init({
                t: deps.t,
                backend: win.backend,
                doc: doc,
                oneLine: deps.oneLineFailure,
              });
              win.SemanticSettings.load(config);
            }
          }
          const prov = (config.text && config.text.provider) || '';
          const url = (config.text && config.text.baseUrl) || '';
          if (prov === 'ollama' || url.includes('11434')) {
            if (deps.updateOllamaStatus) deps.updateOllamaStatus();
          }
        } else if (tabName === 'agent') {
          if (!agentTabInitialized) {
            agentTabInitialized = true;
            if (deps.checkActiveAgentsConfigStatus) deps.checkActiveAgentsConfigStatus();
          }
        } else if (tabName === 'sync') {
          if (!syncTabInitialized) {
            syncTabInitialized = true;
            if (deps.checkGitInstalledStatusUI) deps.checkGitInstalledStatusUI();
            const scrapDirInput = doc.getElementById('cfg-scrap-dir');
            if (scrapDirInput && deps.updateGitRepoStatusUI) {
              deps.updateGitRepoStatusUI(scrapDirInput.value.trim());
            }
          }
        }
      }, 20);
    }

    async function updateProviderDetection() {
      const lineEl = doc.getElementById('text-provider-detect-line');
      if (!lineEl) return;
      if (!(win.backend && win.backend.detectLLMProvider)) {
        if (deps.setLastDetectedProvider) deps.setLastDetectedProvider(null);
        lineEl.classList.add('hidden');
        return;
      }
      const baseUrlEl = doc.getElementById('cfg-base-url');
      const apiKeyEl = doc.getElementById('cfg-api-key');
      const baseUrl = baseUrlEl ? baseUrlEl.value.trim() : '';
      const apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
      if (!baseUrl) {
        if (deps.setLastDetectedProvider) deps.setLastDetectedProvider(null);
        lineEl.classList.add('hidden');
        return;
      }
      const myToken = ++providerDetectReqToken;
      try {
        const provider = await win.backend.detectLLMProvider(baseUrl, apiKey);
        if (myToken !== providerDetectReqToken) return; // stale response, URL changed since
        if (deps.setLastDetectedProvider) {
          deps.setLastDetectedProvider(provider == null ? '' : String(provider));
        }
        if (deps.renderProviderDetectLine) deps.renderProviderDetectLine();
        lineEl.classList.remove('hidden');
      } catch (e) {
        if (deps.setLastDetectedProvider) deps.setLastDetectedProvider(null);
        lineEl.classList.add('hidden');
      }
    }

    function open() {
      const els = deps.getElements ? deps.getElements() : {};
      const {
        settingsModal,
        contextMenu,
        tabBtnGeneral,
        tabBtnModel,
        tabBtnAgent,
        tabBtnSync,
        tabBtnShortcuts,
      } = els;

      if (contextMenu) contextMenu.classList.add('hidden');
      const refreshRequested = deps.consumeRefreshRequested ? deps.consumeRefreshRequested() : false;
      // A second open of a dialog that is already up (Ctrl+, again, the gear button) only brings the focus back: reading every field
      // from the config again would wipe what was typed, and the new snapshot would make Cancel keep a language or theme tried since.
      if (settingsModal && !settingsModal.classList.contains('hidden') && !refreshRequested) {
        if (tabBtnGeneral && !settingsModal.contains(doc.activeElement)) tabBtnGeneral.focus();
        return;
      }

      const config = deps.getConfig();
      let snap;
      try {
        snap = JSON.parse(JSON.stringify(config));
      } catch (e) {
        snap = Object.assign({}, config);
      }
      if (deps.setSnapshot) deps.setSnapshot(snap);

      const byId = (id) => doc.getElementById(id);
      const setVal = (id, val) => {
        const el = byId(id);
        if (el) el.value = val;
      };
      const setChecked = (id, val) => {
        const el = byId(id);
        if (el) el.checked = !!val;
      };

      setVal('cfg-base-url', (config.text && config.text.baseUrl) || '');
      setVal('cfg-model', (config.text && config.text.model) || '');
      setVal('cfg-api-key', (config.text && config.text.apiKey) || '');
      setVal('cfg-system-prompt', (config.text && config.text.systemPrompt) || '');

      setChecked('cfg-inherit-to-all', config.general ? (config.general.inheritTextConnection !== false) : true);
      setVal('cfg-rewrite-history-dir', (config.general && config.general.rewriteHistoryDir) || 'history');

      const tabDockEl = byId('cfg-tab-dock');
      if (tabDockEl) tabDockEl.checked = !(config.general && config.general.tabDock === false);
      const tabStripWidthEl = byId('cfg-tab-strip-width');
      if (tabStripWidthEl) {
        tabStripWidthEl.value = String(Math.max(12, Math.min(48, Math.round(Number(config.general && config.general.tabStripWidth) || 24))));
        const widthOut = byId('cfg-tab-strip-width-value');
        const showWidth = () => { if (widthOut) widthOut.textContent = tabStripWidthEl.value + 'px'; };
        showWidth();
        if (!tabStripWidthEl.dataset.wired) {
          tabStripWidthEl.dataset.wired = '1';
          tabStripWidthEl.addEventListener('input', showWidth);
        }
      }
      const tabDockOsEl = byId('cfg-tab-dock-follow-os');
      if (tabDockOsEl) tabDockOsEl.checked = !!(config.general && config.general.tabDockFollowOs);
      const tabDockStrengthEl = byId('cfg-tab-dock-strength');
      if (tabDockStrengthEl) {
        const strength = (config.general && Number(config.general.tabDockStrength)) || 100;
        tabDockStrengthEl.value = String(Math.max(20, Math.min(100, strength)));
        if (tabDockEl) tabDockStrengthEl.disabled = !tabDockEl.checked;
        if (tabDockOsEl && tabDockEl) tabDockOsEl.disabled = !tabDockEl.checked;
        const out = byId('cfg-tab-dock-strength-value');
        const show = () => { if (out) out.textContent = tabDockStrengthEl.value + '%'; };
        show();
        if (!tabDockStrengthEl.dataset.wired) {
          tabDockStrengthEl.dataset.wired = '1';
          tabDockStrengthEl.addEventListener('input', show);
          if (tabDockEl) {
            tabDockEl.addEventListener('change', () => {
              tabDockStrengthEl.disabled = !tabDockEl.checked;
              if (tabDockOsEl) tabDockOsEl.disabled = !tabDockEl.checked;
            });
          }
        }
      }
      setChecked('cfg-rewrite-history-link', config.general ? (config.general.rewriteHistoryLink !== false) : true);

      if (deps.syncTextProviderSelect) deps.syncTextProviderSelect();
      if (deps.updateApiKeyPlaceholders) deps.updateApiKeyPlaceholders();

      setChecked('cfg-auto-enabled', config.autocomplete && config.autocomplete.enabled);
      setVal('cfg-auto-base-url', (config.autocomplete && config.autocomplete.baseUrl) || 'http://localhost:11434');
      setVal('cfg-auto-model', (config.autocomplete && config.autocomplete.model) || 'qwen2.5:latest');
      setVal('cfg-auto-api-key', (config.autocomplete && config.autocomplete.apiKey) || '');
      setVal('cfg-auto-delay', (config.autocomplete && config.autocomplete.delayMs) || 500);
      setVal('cfg-auto-tokens', (config.autocomplete && config.autocomplete.maxTokens) || 30);

      setVal('cfg-vision-base-url', (config.vision && config.vision.baseUrl) || '');
      setVal('cfg-vision-model', (config.vision && config.vision.model) || 'gemini-flash-lite-latest');
      setVal('cfg-vision-api-key', (config.vision && config.vision.apiKey) || '');
      setVal('cfg-vision-prompt', (config.vision && config.vision.prompt) || '');

      [['-rt', 'realtime'], ['-bt', 'batch']].forEach(([sfx, name]) => {
        const prof = win.VoiceProfiles
          ? win.VoiceProfiles.resolve(config.voice, name)
          : { model: config.voice && config.voice.model, apiStyle: config.voice && config.voice.apiStyle };
        setVal('cfg-voice-model' + sfx, prof.model || 'gemini-3.5-transcribe');
        setVal('cfg-voice-api-style' + sfx, (prof.apiStyle === 'interactions' || prof.apiStyle === 'generateContent') ? prof.apiStyle : 'auto');
      });
      if (deps.listToText) {
        setVal('cfg-voice-language', deps.listToText(config.voice && config.voice.languageCodes, ', '));
        setVal('cfg-voice-vocabulary', deps.listToText(config.voice && config.voice.customVocabulary, '\n'));
      }
      setVal('cfg-voice-mode', (config.voice && config.voice.mode === 'verbatim') ? 'verbatim' : 'smart');
      setVal('cfg-voice-silence', (config.voice && config.voice.silence_timeout_sec) || 5);
      setChecked('cfg-bar-voice', !(config.general && config.general.barVoice === false));
      setVal('cfg-voice-bar-silence', (config.voice && config.voice.barSilenceSec) || 1.5);
      const voiceRefine = (config.voice && config.voice.refine) || {};
      setChecked('cfg-voice-refine-enabled', deps.voiceRefineEnabled ? deps.voiceRefineEnabled() : false);
      if (deps.initMeetingAudioSettings) deps.initMeetingAudioSettings();
      setVal('cfg-voice-refine-model', voiceRefine.model || 'gemini-flash-lite-latest');
      setVal('cfg-voice-refine-timeout', voiceRefine.timeoutSec || 5);
      setVal('cfg-voice-prompt', (config.voice && config.voice.prompt) || '');
      const voiceCredentialHintEl = byId('cfg-voice-credential-hint');
      if (voiceCredentialHintEl) {
        voiceCredentialHintEl.classList.toggle('hidden', !!(config.voice && config.voice.apiKey));
      }

      setVal('cfg-cli-model', (config.cli && config.cli.model) || '');
      setVal('cfg-cli-base-url', (config.cli && config.cli.baseUrl) || '');
      setVal('cfg-cli-api-key', (config.cli && config.cli.apiKey) || '');
      setVal('cfg-cli-system-prompt', (config.cli && config.cli.systemPrompt) || '');
      setChecked('cfg-cli-open-new-tab', config.cli ? (config.cli.openResultInNewTab !== false) : true);
      if (deps.cliResultPlacement) setVal('cfg-cli-result-placement', deps.cliResultPlacement());
      setChecked('cfg-cli-open-error-tab', config.cli ? (config.cli.openErrorInNewTab !== false) : true);

      setChecked('cfg-action-enabled', config.action ? (config.action.enabled !== false) : true);
      setChecked('cfg-action-manual-only', config.action ? !!config.action.manualOnly : false);
      setVal('cfg-action-delay', (config.action && typeof config.action.delaySec === 'number') ? config.action.delaySec : 1.5);
      setVal('cfg-action-base-url', (config.action && config.action.baseUrl) || '');
      setVal('cfg-action-model', (config.action && config.action.model) || '');
      setVal('cfg-action-api-key', (config.action && config.action.apiKey) || '');

      setVal('cfg-image-api-key', (config.image && config.image.apiKey) || '');
      const imgModelInput = byId('cfg-image-model');
      if (imgModelInput) {
        const rawModel = config.image && config.image.model;
        imgModelInput.value = rawModel ? rawModel.trim() : 'gemini-3.1-flash-lite-image';
      }
      setVal('cfg-image-aspect-ratio', (config.image && config.image.aspectRatio) || '16:9');
      setVal('cfg-image-resolution', (config.image && config.image.resolution) || '1024');

      if (deps.showAppearanceControls) {
        deps.showAppearanceControls(win.Appearance ? win.Appearance.fromConfig(config) : null);
      }
      const mermaidToneSelect = byId('cfg-mermaid-tone');
      if (mermaidToneSelect && win.MermaidTone) {
        mermaidToneSelect.value = win.MermaidTone.normalizeTone(config.general.mermaidTone);
      }
      setVal('cfg-diagram-detail', (config.general && config.general.diagramDetail) || 'balanced');
      setVal('cfg-diagram-style', (config.general && config.general.diagramStyle) || 'material');
      setVal('cfg-language', (config.general && config.general.language) || 'en');
      setChecked('cfg-restore-session', !config.general || config.general.restoreSession !== false);
      setChecked('cfg-autosave', !!(config.general && config.general.autoSave));
      setVal('cfg-default-note-dir', (config.general && config.general.defaultNoteDir) || '');
      setChecked('cfg-paste-image-ocr', !!(config.general && config.general.pasteImageOcr));
      setChecked('cfg-paste-html-md', !config.general || config.general.pasteHtmlAsMarkdown !== false);
      setChecked('cfg-ime-guardian', !!(config.general && config.general.imeGuardian));

      const hasRetype = !!(win.backend && win.backend.retypeWithImeAsync);
      const imeRetypeGroup = byId('ime-retype-group');
      if (imeRetypeGroup) imeRetypeGroup.classList.toggle('hidden', !hasRetype);
      const imeReverseGroup = byId('ime-reverse-group');
      if (imeReverseGroup) imeReverseGroup.classList.toggle('hidden', !hasRetype);
      setChecked('cfg-ime-reverse', !!(config.general && config.general.imeGuardianReverse));
      setChecked('cfg-ime-retype', !!(config.general && config.general.imeGuardianRetype));

      if (deps.updateImeGuardianCapabilityHint) deps.updateImeGuardianCapabilityHint();
      if (deps.applyTrayCapabilityUI) deps.applyTrayCapabilityUI();

      setChecked('cfg-ai-correction', !config.general || config.general.aiCorrection !== false);
      setChecked('cfg-cursor-aura', !config.general || config.general.cursorAura !== false);
      setVal('cfg-comment-style', (config.general && config.general.commentStyle === 'block') ? 'block' : 'line');
      setChecked('cfg-trim-webview', !config.general || config.general.trimWebViewWhenHidden !== false);
      setChecked('cfg-webview-inproc-gpu', !!(config.general && config.general.webViewInProcessGpu === true));
      setChecked('cfg-tray-resident', !config.general || config.general.trayResident !== false);
      setChecked('cfg-split-view-on-startup', !!(config.general && config.general.splitViewOnStartup));
      if (deps.updateCheckAtStartup) setChecked('cfg-check-updates', deps.updateCheckAtStartup());
      if (deps.renderCloudConsentRow) deps.renderCloudConsentRow();

      setVal('cfg-slot-timeout', config.timeout_seconds || 180);
      setVal('cfg-slot-ghost-diff-ms', config.ghost_diff_duration_ms || 4000);
      setChecked('cfg-slot-hover-peek', config.hover_peek_enabled !== false);
      setVal('cfg-default-agent', config.default_agent || 'claude-code');
      if (deps.checkActiveAgentsConfigStatus) deps.checkActiveAgentsConfigStatus();

      if (deps.getAutoSelectorConfig) {
        const autoSel = deps.getAutoSelectorConfig();
        setChecked('cfg-autosel-enabled', autoSel.enabled);
        setChecked('cfg-autosel-agent-confirm', autoSel.agentConfirm);
      }
      if (deps.updateAutoSelectorFieldStates) deps.updateAutoSelectorFieldStates();

      setVal('cfg-scrap-dir', (config.scraps && config.scraps.scrapDir) || config.scrap_dir || '~/Documents/syki-sok/scraps');
      setChecked('cfg-git-sync-enabled', config.scraps ? (config.scraps.gitSyncEnabled !== false) : (config.git_sync_enabled !== false));
      setVal('cfg-git-debounce', (config.scraps && config.scraps.gitSyncDebounceSeconds) || config.git_sync_debounce_seconds || 30);
      setVal('cfg-git-remote-branch', (config.scraps && config.scraps.gitRemoteBranch) || config.git_remote_branch || 'main');
      setVal('cfg-git-remote-url', (config.scraps && config.scraps.gitRemoteUrl) || '');
      setVal('cfg-max-pipe-size', (config.scraps && config.scraps.maxPipeSizeMB) || config.max_pipe_size_mb || 10);

      setChecked('cfg-cf-enabled', !!(config.cfBridge && config.cfBridge.enabled));
      setVal('cfg-cf-endpoint', (config.cfBridge && config.cfBridge.endpoint) || '');
      setVal('cfg-cf-token', (config.cfBridge && config.cfBridge.token) || '');
      setVal('cfg-cf-poll-interval', (config.cfBridge && config.cfBridge.pollIntervalSeconds) || 30);
      const cfHintEl = byId('cf-test-result-hint');
      if (cfHintEl) cfHintEl.textContent = '';
      if (deps.updateCFBridgeFieldStates) deps.updateCFBridgeFieldStates();

      setChecked('cfg-inbox-enabled', !!(config.inbox && config.inbox.enabled));
      setVal('cfg-inbox-dir', (config.inbox && config.inbox.dir) || '');
      const ocrOnDeviceEl = byId('cfg-ocr-on-device');
      if (ocrOnDeviceEl) {
        ocrOnDeviceEl.checked = !!(config.vision && config.vision.ocrMode === 'on-device');
        const ocrGroup = ocrOnDeviceEl.closest ? ocrOnDeviceEl.closest('.form-group') : null;
        const caps = deps.getPlatformCapabilities ? deps.getPlatformCapabilities() : {};
        const mac = deps.isMac ? deps.isMac() : false;
        if (ocrGroup && ocrGroup.classList) ocrGroup.classList.toggle('hidden', mac || caps.os === 'darwin');
      }

      switchTab('general');
      if (deps.updateQuickActionsFieldStates) deps.updateQuickActionsFieldStates();
      updateProviderDetection();
      if (win.SettingsCompact && win.SettingsCompact.refresh) {
        win.SettingsCompact.refresh(doc);
      }

      const mainKeyInput = byId('cfg-api-key');
      if (mainKeyInput && !mainKeyInput.dataset.inheritedPlaceholderWired && deps.updateApiKeyPlaceholders) {
        mainKeyInput.dataset.inheritedPlaceholderWired = '1';
        mainKeyInput.addEventListener('input', deps.updateApiKeyPlaceholders);
      }

      if (settingsModal) settingsModal.classList.remove('hidden');

      resetTabInit();

      setTimeout(() => {
        if (deps.refreshSendToStatus) deps.refreshSendToStatus();
        if (deps.refreshFileTypesStatus) deps.refreshFileTypesStatus();
        if (deps.updateShortcutLabels) deps.updateShortcutLabels();
      }, 20);
      setTimeout(() => {
        const shown = [tabBtnGeneral, tabBtnModel, tabBtnAgent, tabBtnSync, tabBtnShortcuts].find(
          (b) => b && b.classList && b.classList.contains('active')
        );
        const target = shown || tabBtnGeneral;
        if (target) target.focus();
      }, 50);
    }

    function close() {
      if (deps.clearRecordingAction) deps.clearRecordingAction();
      const els = deps.getElements ? deps.getElements() : {};
      if (els.settingsModal) els.settingsModal.classList.add('hidden');
      const editor = deps.getActiveEditor ? deps.getActiveEditor() : null;
      if (editor) editor.focus();
    }

    function restoreLiveConfigFromSnapshot() {
      const snap = deps.getSnapshot ? deps.getSnapshot() : null;
      if (!snap) return;
      const config = deps.getConfig();
      let languageChanged = false;
      let themeChanged = false;
      if (config.general && snap.general) {
        if (config.general.language !== snap.general.language) {
          config.general.language = snap.general.language;
          languageChanged = true;
        }
        if (config.general.theme !== snap.general.theme) {
          config.general.theme = snap.general.theme;
          themeChanged = true;
        }
      }
      if (config.default_agent !== snap.default_agent) {
        config.default_agent = snap.default_agent;
        if (win.SlotAgent && win.SlotAgent.updateConfig) {
          win.SlotAgent.updateConfig(config);
        }
      }
      if (snap.shortcuts && JSON.stringify(config.shortcuts) !== JSON.stringify(snap.shortcuts)) {
        config.shortcuts = Object.assign({}, snap.shortcuts);
        if (deps.clearShortcutParseCache) deps.clearShortcutParseCache();
        if (deps.updateShortcutLabels) deps.updateShortcutLabels();
      }
      let layoutChanged = false;
      if (config.general && snap.general) {
        for (const key of ['toolbarLayout', 'contextMenuLayout']) {
          if (JSON.stringify(config.general[key]) !== JSON.stringify(snap.general[key])) {
            config.general[key] = snap.general[key]
              ? JSON.parse(JSON.stringify(snap.general[key]))
              : { order: [], hidden: [] };
            layoutChanged = true;
          }
        }
      }
      if (config.general && snap.general && JSON.stringify(config.general.cloudConsent) !== JSON.stringify(snap.general.cloudConsent)) {
        config.general.cloudConsent = snap.general.cloudConsent ? JSON.parse(JSON.stringify(snap.general.cloudConsent)) : {};
      }
      if (languageChanged && deps.applyLanguage) deps.applyLanguage();
      const previewing = deps.getIsAppearancePreviewing ? deps.getIsAppearancePreviewing() : false;
      if ((themeChanged || previewing) && deps.applyTheme) deps.applyTheme();
      if (layoutChanged && deps.applyChromeLayout) deps.applyChromeLayout();
    }

    function cancel() {
      restoreLiveConfigFromSnapshot();
      close();
    }

    return {
      switchTab,
      open,
      close,
      restoreLiveConfigFromSnapshot,
      cancel,
      updateProviderDetection,
      resetTabInit,
    };
  }

  const KNOWN_PRESET_BASE_URLS = new Set([
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'https://generativelanguage.googleapis.com',
    'https://api.openai.com/v1',
    'https://openrouter.ai/api/v1',
    'https://api.deepseek.com/v1',
    'https://api.mistral.ai/v1',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    'https://api.typesafe.ai',
  ]);

  const LOCAL_EMBED_MODELS = new Set([
    'bge-m3',
    'nomic-embed-text',
    'mxbai-embed-large',
    'snowflake-arctic-embed',
  ]);

  const OPENROUTER_PREFIXES = [
    'google/',
    'openai/',
    'anthropic/',
    'meta-llama/',
    'deepseek/',
    'sakana/',
    'qwen/',
    'mistralai/',
  ];

  function inferBaseUrlForModel(model, opts) {
    const m = String(model == null ? '' : model).trim().toLowerCase();
    if (!m) return null;
    const kind = opts && opts.kind ? opts.kind : 'llm';

    if (!m.includes(':') && OPENROUTER_PREFIXES.some((p) => m.startsWith(p))) {
      return 'https://openrouter.ai/api/v1';
    }
    if (m.startsWith('gemini-')) {
      return 'https://generativelanguage.googleapis.com';
    }
    if (
      m.startsWith('gpt-') ||
      m.startsWith('o1-') ||
      m.startsWith('o3-') ||
      m.startsWith('o4-') ||
      m.startsWith('text-embedding-')
    ) {
      return 'https://api.openai.com/v1';
    }
    if (m.startsWith('deepseek-')) {
      return 'https://api.deepseek.com/v1';
    }
    if (m.startsWith('mistral-') || m.startsWith('codestral-')) {
      return 'https://api.mistral.ai/v1';
    }
    if (m.startsWith('qwen-') && !m.includes(':')) {
      return 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    }
    if (kind === 'action' && m.startsWith('jev-')) {
      return 'https://api.typesafe.ai';
    }
    if (m.includes(':') || LOCAL_EMBED_MODELS.has(m)) {
      return 'http://localhost:11434';
    }
    return null;
  }

  function shouldAutoFillBaseUrl(currentBaseUrl, inferredBaseUrl) {
    if (!inferredBaseUrl) return false;
    const current = String(currentBaseUrl == null ? '' : currentBaseUrl)
      .trim()
      .toLowerCase()
      .replace(/\/+$/, '');
    if (current === '') return true;
    if (
      inferredBaseUrl === 'http://localhost:11434' &&
      (current === 'http://localhost:1234/v1' || current === 'http://127.0.0.1:1234/v1')
    ) {
      return false;
    }
    return KNOWN_PRESET_BASE_URLS.has(current);
  }

  const api = { create, inferBaseUrlForModel, shouldAutoFillBaseUrl };
  global.SykiSettingsModal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
