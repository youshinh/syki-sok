package main

import "strings"

// binder is the subset of webview2.WebView (Windows) and webview.WebView (macOS) that
// bindCommonBackend needs. Both concrete types already implement Bind(name string, f
// interface{}) error with this exact signature, so no adapter is required on either side.
type binder interface {
	Bind(name string, f interface{}) error
}

// bindCommonBackend wires every backend_X -> app.Y bind that is byte-identical (same JS name,
// same Go method value) on both Windows (window_windows.go) and macOS (window_darwin.go). It
// exists purely to avoid maintaining ~90 duplicate lines in two files; each platform file still
// binds its own platform-specific and inline-closure entries directly after calling this.
//
// Errors are discarded here exactly as they were at each call site before this extraction:
// webview2 and webview_go's Bind only fails for a duplicate name or an unsupported Go value, both
// of which are programming errors caught by platform_bridge_parity_test.go, not something to
// handle at runtime.
func bindCommonBackend(w binder, app *App) {
	_ = w.Bind("backend_getAppVersion", app.GetAppVersion)
	_ = w.Bind("backend_getAppInfo", app.GetAppInfo)
	_ = w.Bind("backend_getPlatformCapabilities", app.GetPlatformCapabilities)
	_ = w.Bind("backend_getConfig", app.GetConfig)
	_ = w.Bind("backend_saveConfig", app.SaveConfig)
	_ = w.Bind("backend_exportConfig", app.ExportConfig)
	_ = w.Bind("backend_importConfig", app.ImportConfig)
	_ = w.Bind("backend_packListExportable", app.PackListExportable)
	_ = w.Bind("backend_packExport", app.PackExport)
	_ = w.Bind("backend_packInspect", app.PackInspect)
	_ = w.Bind("backend_packImport", app.PackImport)
	_ = w.Bind("backend_runCommandFilter", app.RunCommandFilter)
	_ = w.Bind("backend_runCommandFilterAsync", app.RunCommandFilterAsync)
	_ = w.Bind("backend_generateCliCommandAsync", app.GenerateCliCommandAsync)
	_ = w.Bind("backend_validateCliCommand", app.ValidateCliCommand)
	_ = w.Bind("backend_cancelCommandFilter", app.CancelCommandFilter)
	_ = w.Bind("backend_getSession", app.GetSession)
	_ = w.Bind("backend_saveSession", app.SaveSession)
	_ = w.Bind("backend_saveSessionAsync", app.SaveSessionAsync)
	_ = w.Bind("backend_getStartupFile", app.GetStartupFile)
	_ = w.Bind("backend_openFile", app.OpenFile)
	_ = w.Bind("backend_resolveDroppedFile", app.ResolveDroppedFile)
	_ = w.Bind("backend_createNoteInFolder", app.CreateNoteInFolder)
	_ = w.Bind("backend_createNoteInFolderAsync", app.CreateNoteInFolderAsync)
	_ = w.Bind("backend_processDroppedMedia", app.ProcessDroppedMedia)
	_ = w.Bind("backend_saveFile", app.SaveFile)
	_ = w.Bind("backend_saveFileAsync", app.SaveFileAsync)
	_ = w.Bind("backend_saveFileChecked", app.SaveFileChecked)
	_ = w.Bind("backend_saveFileCheckedAsync", app.SaveFileCheckedAsync)
	_ = w.Bind("backend_saveFileAs", app.SaveFileAs)
	_ = w.Bind("backend_exportPlainTextAs", app.ExportPlainTextAs)
	_ = w.Bind("backend_openFolder", app.OpenFolder)
	_ = w.Bind("backend_scanFolderFiles", app.ScanFolderFiles)
	_ = w.Bind("backend_readFileByPath", app.ReadFileByPath)
	_ = w.Bind("backend_queryLLMAsync", app.QueryLLMAsync)
	_ = w.Bind("backend_queryVisionAsync", app.QueryVisionAsync)
	_ = w.Bind("backend_generateImageAsync", app.GenerateImageAsync)
	_ = w.Bind("backend_autocompleteAsync", app.AutocompleteAsync)
	_ = w.Bind("backend_trimMemory", app.TrimMemory)
	_ = w.Bind("backend_copyPNGToClipboard", app.CopyPNGToClipboard)
	_ = w.Bind("backend_uiReady", app.MarkUIReady)
	_ = w.Bind("backend_closeWindow", app.CloseWindow)
	_ = w.Bind("backend_updateGlobalShortcut", app.UpdateGlobalShortcut)
	_ = w.Bind("backend_searchScraps", app.SearchScraps)
	_ = w.Bind("backend_getScrapDir", app.GetScrapDir)
	_ = w.Bind("backend_searchScrapsAsync", app.SearchScrapsAsync)
	_ = w.Bind("backend_searchScrapsSemanticAsync", app.SearchScrapsSemanticAsync)
	_ = w.Bind("backend_scrapFilterOptionsAsync", app.ScrapFilterOptionsAsync)
	_ = w.Bind("backend_tagEditAsync", app.TagEditAsync)
	_ = w.Bind("backend_deepSearchPlanAsync", app.DeepSearchPlanAsync)
	_ = w.Bind("backend_deepSearchRunAsync", app.DeepSearchRunAsync)
	_ = w.Bind("backend_deepSearchRunWithModelAsync", app.DeepSearchRunWithModelAsync)
	_ = w.Bind("backend_cancelDeepSearch", app.CancelDeepSearch)
	_ = w.Bind("backend_lessonPlanAsync", app.LessonPlanAsync)
	_ = w.Bind("backend_lessonRunAsync", app.LessonRunAsync)
	_ = w.Bind("backend_cancelLesson", app.CancelLesson)
	_ = w.Bind("backend_lessonSaveAsync", app.LessonSaveAsync)
	_ = w.Bind("backend_lessonsInfoAsync", app.LessonsInfoAsync)
	_ = w.Bind("backend_semanticStatusAsync", app.SemanticStatusAsync)
	_ = w.Bind("backend_semanticUpdateAsync", app.SemanticUpdateAsync)
	_ = w.Bind("backend_cancelSemanticUpdate", app.CancelSemanticUpdate)
	_ = w.Bind("backend_printPreviewAsync", app.PrintPreviewAsync)
	_ = w.Bind("backend_printPickPdfPath", app.PrintPickPdfPath)
	_ = w.Bind("backend_printSavePdfAsync", app.PrintSavePdfAsync)
	_ = w.Bind("backend_printPreviewClose", app.PrintPreviewClose)
	_ = w.Bind("backend_triggerGitSync", app.TriggerGitSync)
	_ = w.Bind("backend_getGitRepoStatus", app.GetGitRepoStatus)
	_ = w.Bind("backend_setupGitRemote", app.SetupGitRemote)
	_ = w.Bind("backend_checkGitInstalled", app.CheckGitInstalled)
	_ = w.Bind("backend_testGitRemote", app.TestGitRemote)
	_ = w.Bind("backend_testCFBridgeConnection", app.TestCFBridgeConnection)
	_ = w.Bind("backend_getCFBridgePairingQR", app.GetCFBridgePairingQR)
	_ = w.Bind("backend_pollCFBridgeNow", app.PollCFBridgeNow)
	_ = w.Bind("backend_reportRPCResult", app.ReportRPCResult)
	_ = w.Bind("backend_parseSlotsRPC", app.ParseSlotsRPC)
	_ = w.Bind("backend_runSlotAgentAsync", app.RunSlotAgentAsync)
	_ = w.Bind("backend_cancelSlotAgent", app.CancelSlotAgent)
	_ = w.Bind("backend_getSlotHoverPeek", app.GetSlotHoverPeek)
	_ = w.Bind("backend_watchActiveFile", app.WatchActiveFile)
	_ = w.Bind("backend_unwatchActiveFile", app.UnwatchActiveFile)
	_ = w.Bind("backend_getDefaultAgentsConfigYAML", app.GetDefaultAgentsConfigYAML)
	_ = w.Bind("backend_getDefaultAgentsConfigMarkdown", app.GetDefaultAgentsConfigMarkdown)
	_ = w.Bind("backend_getActiveAgentsConfigStatus", app.GetActiveAgentsConfigStatus)
	_ = w.Bind("backend_getActiveSlotConfigJSON", app.GetActiveSlotConfigJSON)
	_ = w.Bind("backend_checkAgentAvailability", app.CheckAgentAvailability)
	_ = w.Bind("backend_detectLLMProvider", app.DetectLLMProvider)
	_ = w.Bind("backend_updateActiveAgentsConfigDefaultAgent", app.UpdateActiveAgentsConfigDefaultAgent)
	_ = w.Bind("backend_exportAgentsConfigFile", app.ExportAgentsConfigFile)
	_ = w.Bind("backend_importAgentsConfigFile", app.ImportAgentsConfigFile)
	_ = w.Bind("backend_openAgentsConfigFile", app.OpenAgentsConfigFile)
	_ = w.Bind("backend_jevPredict", app.JevPredict)
	_ = w.Bind("backend_jevPredictAsync", app.JevPredictAsync)
	_ = w.Bind("backend_jevExecute", app.JevExecute)
	_ = w.Bind("backend_jevExecuteAsync", app.JevExecuteAsync)
	_ = w.Bind("backend_jevVerify", app.JevVerify)
	_ = w.Bind("backend_jevDispatchAgent", app.JevDispatchAgent)
	_ = w.Bind("backend_jevPruneContext", app.JevPruneContext)
	_ = w.Bind("backend_startMobileDrop", app.StartMobileDrop)
	_ = w.Bind("backend_startMobileDropWithVoice", app.StartMobileDropWithVoice)
	_ = w.Bind("backend_setMobileDropSharedText", app.SetMobileDropSharedText)
	_ = w.Bind("backend_cancelMobileDrop", app.CancelMobileDrop)
	_ = w.Bind("backend_requestMobileDropTunnelAsync", app.RequestMobileDropTunnelAsync)
	_ = w.Bind("backend_saveAsset", app.SaveAsset)
	_ = w.Bind("backend_importAssetFile", app.ImportAssetFile)
	_ = w.Bind("backend_openPath", app.OpenPath)
	_ = w.Bind("backend_revealPath", app.RevealPath)
	_ = w.Bind("backend_transcribeAudioAsync", app.TranscribeAudioAsync)
	_ = w.Bind("backend_meetingRecordingSupported", app.MeetingRecordingSupported)
	_ = w.Bind("backend_checkMeetingAudioAsync", app.CheckMeetingAudioAsync)
	_ = w.Bind("backend_retypeWithImeAsync", app.RetypeWithImeAsync)
	_ = w.Bind("backend_startMeetingRecording", app.StartMeetingRecording)
	_ = w.Bind("backend_stopMeetingRecordingAsync", app.StopMeetingRecordingAsync)
	_ = w.Bind("backend_abortMeetingRecording", app.AbortMeetingRecording)
	_ = w.Bind("backend_getSpeechStatus", app.GetSpeechStatus)
	_ = w.Bind("backend_installSpeechPartAsync", app.InstallSpeechPartAsync)
	_ = w.Bind("backend_cancelSpeechInstall", app.CancelSpeechInstall)
	_ = w.Bind("backend_removeSpeechPart", app.RemoveSpeechPart)
	_ = w.Bind("backend_ensureSpeechServer", app.EnsureSpeechServer)
	_ = w.Bind("backend_validateWhisperModelFile", app.ValidateWhisperModelFile)
	_ = w.Bind("backend_pickFilePath", app.PickFilePath)
	_ = w.Bind("backend_openInboxFolder", app.OpenInboxFolder)
	_ = w.Bind("backend_retryVoiceCacheAsync", app.RetryVoiceCacheAsync)
	_ = w.Bind("backend_keepVoiceCache", app.KeepVoiceCache)
	_ = w.Bind("backend_discardVoiceCache", app.DiscardVoiceCache)
	_ = w.Bind("backend_listVoiceCaches", app.ListVoiceCaches)
	_ = w.Bind("backend_discardAllVoiceCaches", app.DiscardAllVoiceCaches)
	_ = w.Bind("backend_transcribeVoiceCache", app.TranscribeVoiceCache)
	_ = w.Bind("backend_openExternal", app.OpenExternal)
	_ = w.Bind("backend_showInFileExplorer", app.ShowInFileExplorer)
	_ = w.Bind("backend_checkOllamaRunning", app.CheckOllamaRunning)
	_ = w.Bind("backend_startOllamaService", app.StartOllamaService)
	_ = w.Bind("backend_stopOllamaService", app.StopOllamaService)
	_ = w.Bind("backend_setupOllamaGemma4Async", app.SetupOllamaGemma4Async)
	_ = w.Bind("backend_cancelOllamaSetup", app.CancelOllamaSetup)
	_ = w.Bind("backend_getSkillInstruction", app.GetSkillInstruction)
	_ = w.Bind("backend_getAvailableSkillsJSON", app.GetAvailableSkillsJSON)
}

// buildCommonBridgeInitJS returns the shared WebView Init JS that sets up the async RPC
// settlement helpers, signals backend_uiReady, and populates window.backend with every
// cross-platform method plus any platform-specific entries passed in extraMethodsJS.
func buildCommonBridgeInitJS(extraMethodsJS []string) string {
	var extras strings.Builder
	for _, entry := range extraMethodsJS {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" {
			continue
		}
		trimmed = strings.TrimSuffix(trimmed, ",")
		extras.WriteString(",\n\t\t\t")
		extras.WriteString(trimmed)
	}

	return `
		// --- Async bridge -------------------------------------------------------------
		// Some backend calls (Jev prediction, scrap search) used to be synchronous binds,
		// which run INLINE ON THE UI THREAD and froze the window for the duration of the
		// call. They are now started with a backend_xxxAsync(reqID, ...) bind and completed
		// by a window.__onXxxResult(reqID, result, errMsg) callback. This helper keeps the
		// frontend-facing API identical: window.backend.<fn>(args) still returns a Promise
		// that resolves to the same shape and rejects on error. Pending entries are always
		// removed on resolve, reject, or the safety timeout, so the map cannot leak.
		window.__sykiPending = window.__sykiPending || {};
		window.__sykiSeq = 0;
		window.__sykiSettle = function (reqID, result, errMsg) {
			var p = window.__sykiPending[reqID];
			if (!p) { return; }
			delete window.__sykiPending[reqID];
			if (p.timer) { clearTimeout(p.timer); }
			if (errMsg) { p.reject(new Error(errMsg)); } else { p.resolve(result); }
		};
		window.__sykiAsync = function (prefix, timeoutMs, invoke) {
			var reqID = prefix + (++window.__sykiSeq) + '_' + Date.now();
			return new Promise(function (resolve, reject) {
				var entry = { resolve: resolve, reject: reject, timer: null };
				var fail = function (e) {
					if (!window.__sykiPending[reqID]) { return; }
					delete window.__sykiPending[reqID];
					if (entry.timer) { clearTimeout(entry.timer); }
					reject(e);
				};
				entry.timer = setTimeout(function () {
					fail(new Error(prefix + 'request timed out'));
				}, timeoutMs);
				window.__sykiPending[reqID] = entry;
				var r;
				try {
					r = invoke(reqID);
				} catch (e) {
					fail(e);
					return;
				}
				if (r && typeof r.catch === 'function') { r.catch(fail); }
			});
		};
		window.__onJevPredictResult = function (reqID, result, errMsg) {
			window.__sykiSettle(reqID, result, errMsg);
		};
		window.__onSearchScrapsResult = function (reqID, result, errMsg) {
			window.__sykiSettle(reqID, result, errMsg);
		};
		// the semantic search panel, the deep search plan and its run all answer here
		window.__onDeepSearchResult = function (reqID, result, errMsg) {
			window.__sykiSettle(reqID, result, errMsg);
		};
		// the print panel: the preview PDF and the saved PDF answer here
		window.__onPrintPdfResult = function (reqID, result, errMsg) {
			window.__sykiSettle(reqID, result, errMsg);
		};

		// Tell Go the document is loaded. A cold boot with piped stdin waits for this
		// signal (with a short fallback timeout) before appending the scrap, instead of
		// guessing with a fixed sleep. backend_uiReady is idempotent, so signalling from
		// both events is harmless.
		(function () {
			var signalReady = function () {
				try { window.backend_uiReady(); } catch (e) { /* binding not ready yet */ }
			};
			if (document.readyState === 'complete' || document.readyState === 'interactive') {
				signalReady();
			} else {
				document.addEventListener('DOMContentLoaded', signalReady, { once: true });
				window.addEventListener('load', signalReady, { once: true });
			}
		})();

		window.backend = {
			getAppVersion: () => window.backend_getAppVersion(),
			getAppInfo: () => window.backend_getAppInfo(),
			getPlatformCapabilities: () => window.backend_getPlatformCapabilities(),
			getConfig: () => window.backend_getConfig(),
			saveConfig: (configJson) => window.backend_saveConfig(configJson),
			exportConfig: (configJson) => window.backend_exportConfig(configJson),
			importConfig: () => window.backend_importConfig(),
			packListExportable: (projectHint) => window.backend_packListExportable(projectHint || ""),
			packExport: (selectionJson, configJson) => window.backend_packExport(selectionJson || "", configJson || ""),
			packInspect: (projectHint) => window.backend_packInspect(projectHint || ""),
			packImport: (packPath, selectionJson, projectHint) => window.backend_packImport(packPath || "", selectionJson || "", projectHint || ""),
			runCommandFilter: (cmdStr, input) => window.backend_runCommandFilter(cmdStr, input),
			runCommandFilterAsync: (reqID, cmdStr, input) => window.backend_runCommandFilterAsync(reqID, cmdStr, input),
			cancelCommandFilter: (reqID) => window.backend_cancelCommandFilter(reqID),
			getSession: () => window.backend_getSession(),
			saveSession: (sessionJson) => window.__sykiAsync('saveSession_', 30000, (reqID) => window.backend_saveSessionAsync(reqID, sessionJson)),
			saveSessionSync: (sessionJson) => window.backend_saveSession(sessionJson),
			getStartupFile: () => window.backend_getStartupFile(),
			openFile: () => window.backend_openFile(),
			openFolder: () => window.backend_openFolder(),
			scanFolderFiles: (rootPath) => window.backend_scanFolderFiles(rootPath),
			readFileByPath: (path) => window.backend_readFileByPath(path),
			saveFile: (path, content, enc) => window.__sykiAsync('saveFile_', 30000, (reqID) => window.backend_saveFileAsync(reqID, path, content, enc)),
			saveFileSync: (path, content, enc) => window.backend_saveFile(path, content, enc),
			saveFileChecked: (path, content, enc, expectSig) => window.backend_saveFileChecked(path, content, enc, expectSig || ""),
			saveFileCheckedAsync: (path, content, enc, expectSig) => window.__sykiAsync('saveFileChecked_', 30000, (reqID) => window.backend_saveFileCheckedAsync(reqID, path, content, enc, expectSig || "")),
			saveFileAs: (content, enc, defaultName) => window.backend_saveFileAs(content, enc, defaultName || ""),
			resolveDroppedFile: (name, size, modifiedMs, hintDirs) => window.backend_resolveDroppedFile(name || "", size || 0, modifiedMs || 0, hintDirs || ""),
			createNoteInFolder: (content, enc, name, dir) => window.__sykiAsync('createNote_', 30000, (reqID) => window.backend_createNoteInFolderAsync(reqID, content || "", enc || "UTF-8", name || "", dir || "")),
			createNoteInFolderSync: (content, enc, name, dir) => window.backend_createNoteInFolder(content || "", enc || "UTF-8", name || "", dir || ""),
			processDroppedMedia: (reqID, name, mimeType, dataBase64, visionJson, voiceJson) => window.backend_processDroppedMedia(reqID, name || "", mimeType || "", dataBase64 || "", visionJson || "", voiceJson || ""),
			exportPlainTextAs: (content, enc, defaultName) => window.backend_exportPlainTextAs(content, enc, defaultName || ""),
			queryLLMAsync: (reqID, prompt, configJson) => window.backend_queryLLMAsync(reqID, prompt, configJson),
			queryVisionAsync: (reqID, prompt, imageBase64, mimeType, configJson) => window.backend_queryVisionAsync(reqID, prompt, imageBase64, mimeType, configJson),
			generateImageAsync: (reqID, prompt, configJson, notePath) => window.backend_generateImageAsync(reqID, prompt, configJson, notePath || ""),
			autocompleteAsync: (reqID, prefix, suffix, configJson) => window.backend_autocompleteAsync(reqID, prefix, suffix, configJson),
			trimMemory: () => window.backend_trimMemory(),
			copyPNGToClipboard: (dataUrl) => window.backend_copyPNGToClipboard(dataUrl),
			closeWindow: () => window.backend_closeWindow(),
			minimizeWindow: () => window.backend_minimizeWindow(),
			toggleFullscreen: () => window.backend_toggleFullscreen(),
			toggleMaximize: () => window.backend_toggleMaximize(),
			forceQuit: () => window.backend_forceQuit(),
			openExternal: (url) => window.backend_openExternal(url),
			showInFileExplorer: (filePath) => window.backend_showInFileExplorer(filePath || ""),
			getScrapDir: () => window.backend_getScrapDir(),
			setIMEMode: (enableJapanese) => window.backend_setIMEMode(!!enableJapanese),
			updateGlobalShortcut: (sc) => window.backend_updateGlobalShortcut(sc || ""),
			checkOllamaRunning: () => window.backend_checkOllamaRunning(),
			startOllamaService: () => window.backend_startOllamaService(),
			stopOllamaService: () => window.backend_stopOllamaService(),
			setupOllamaGemma4Async: (reqID) => window.backend_setupOllamaGemma4Async(reqID),
			cancelOllamaSetup: (reqID) => window.backend_cancelOllamaSetup(reqID),
			generateCliCommandAsync: (reqID, prompt, configJson, contextJson) => window.backend_generateCliCommandAsync(reqID, prompt, configJson, contextJson || ""),
			validateCliCommand: (cmdStr) => window.backend_validateCliCommand(cmdStr),
			searchScraps: (query, maxResults, filter) => { var f = filter ? JSON.stringify(filter) : ''; return window.__sykiAsync('searchScraps_', 30000, (reqID) => window.backend_searchScrapsAsync(reqID, query, maxResults || 100, f)); },
			searchScrapsSemantic: (query, limit, filter) => { var f = filter ? JSON.stringify(filter) : ''; return window.__sykiAsync('searchScrapsSemantic_', 30000, (reqID) => window.backend_searchScrapsSemanticAsync(reqID, query, limit || 10, f)); },
			deepSearchPlan: (query, limit, filter) => { var f = filter ? JSON.stringify(filter) : ''; return window.__sykiAsync('deepSearchPlan_', 30000, (reqID) => window.backend_deepSearchPlanAsync(reqID, query, limit || 10, f)); },
			scrapFilterOptions: () => window.__sykiAsync('scrapFilterOptions_', 30000, (reqID) => window.backend_scrapFilterOptionsAsync(reqID)),
			tagEdit: (request) => window.__sykiAsync('tagEdit_', 30000, (reqID) => window.backend_tagEditAsync(reqID, JSON.stringify(request || {}))),
			deepSearchRun: (planId, lang, model, length) => window.__sykiAsync('deepSearchRun_', 600000, (reqID) => ((model || length) ? window.backend_deepSearchRunWithModelAsync(reqID, planId, lang || '', model || '', length || '') : window.backend_deepSearchRunAsync(reqID, planId, lang || ''))),
			cancelDeepSearch: (planId) => window.backend_cancelDeepSearch(planId),
			lessonPlan: (request) => window.__sykiAsync('lessonPlan_', 30000, (reqID) => window.backend_lessonPlanAsync(reqID, JSON.stringify(request || {}))),
			lessonRun: (planId) => window.__sykiAsync('lessonRun_', 120000, (reqID) => window.backend_lessonRunAsync(reqID, planId || '')),
			cancelLesson: (planId) => window.backend_cancelLesson(planId || ''),
			lessonSave: (request) => window.__sykiAsync('lessonSave_', 30000, (reqID) => window.backend_lessonSaveAsync(reqID, JSON.stringify(request || {}))),
			lessonsInfo: (agent) => window.__sykiAsync('lessonsInfo_', 30000, (reqID) => window.backend_lessonsInfoAsync(reqID, agent || '')),
			semanticStatus: (section) => window.__sykiAsync('semanticStatus_', 60000, (reqID) => window.backend_semanticStatusAsync(reqID, section ? JSON.stringify(section) : '')),
			semanticUpdate: (section, rebuild, yes) => window.__sykiAsync('semanticUpdate_', 3600000, (reqID) => window.backend_semanticUpdateAsync(reqID, section ? JSON.stringify(section) : '', !!rebuild, !!yes)),
			cancelSemanticUpdate: () => window.backend_cancelSemanticUpdate(),
			printPreview: (opts) => window.__sykiAsync('printPreview_', 120000, (reqID) => window.backend_printPreviewAsync(reqID, JSON.stringify(opts || {}))),
			printPickPdfPath: (name) => window.backend_printPickPdfPath(name || ''),
			printSavePdf: (opts, path) => window.__sykiAsync('printSavePdf_', 120000, (reqID) => window.backend_printSavePdfAsync(reqID, JSON.stringify(opts || {}), path || '')),
			printPreviewClose: () => window.backend_printPreviewClose(),
			triggerGitSync: () => window.backend_triggerGitSync(),
			getGitRepoStatus: (dir) => window.backend_getGitRepoStatus(dir || ""),
			setupGitRemote: (dir, remoteUrl, branch) => window.backend_setupGitRemote(dir || "", remoteUrl || "", branch || ""),
			checkGitInstalled: () => window.backend_checkGitInstalled(),
			testGitRemote: (remoteUrl) => window.backend_testGitRemote(remoteUrl || ""),
			testCFBridgeConnection: (endpoint, token) => window.backend_testCFBridgeConnection(endpoint || "", token || ""),
			getCFBridgePairingQR: (endpoint, token) => window.backend_getCFBridgePairingQR(endpoint || "", token || ""),
			pollCFBridgeNow: () => window.backend_pollCFBridgeNow(),
			parseSlotsRPC: (fullText, cursorOffset, configJson) => window.backend_parseSlotsRPC(fullText, cursorOffset, configJson),
			runSlotAgentAsync: (reqID, filePath, fullText, cursorOffset, configJson) => window.backend_runSlotAgentAsync(reqID, filePath, fullText, cursorOffset, configJson),
			cancelSlotAgent: (reqID) => window.backend_cancelSlotAgent(reqID),
			getSlotHoverPeek: (reqID) => window.backend_getSlotHoverPeek(reqID),
			watchActiveFile: (filePath) => window.backend_watchActiveFile(filePath),
			unwatchActiveFile: () => window.backend_unwatchActiveFile(),
			getDefaultAgentsConfigYAML: () => window.backend_getDefaultAgentsConfigYAML(),
			getDefaultAgentsConfigMarkdown: () => window.backend_getDefaultAgentsConfigMarkdown(),
			getActiveAgentsConfigStatus: (scrapDir) => window.backend_getActiveAgentsConfigStatus(scrapDir || ""),
			getActiveSlotConfigJSON: () => window.backend_getActiveSlotConfigJSON(),
			checkAgentAvailability: (agentName) => window.backend_checkAgentAvailability(agentName || ""),
			detectLLMProvider: (baseUrl, apiKey) => window.backend_detectLLMProvider(baseUrl || "", apiKey || ""),
			updateActiveAgentsConfigDefaultAgent: (scrapDir, agentName) => window.backend_updateActiveAgentsConfigDefaultAgent(scrapDir || "", agentName || ""),
			exportAgentsConfigFile: (format) => window.backend_exportAgentsConfigFile(format || "yaml"),
			importAgentsConfigFile: () => window.backend_importAgentsConfigFile(),
			openAgentsConfigFile: (scrapDir) => window.backend_openAgentsConfigFile(scrapDir || ""),
			jevPredict: (contextText, cursorOffset) => window.__sykiAsync('jevPredict_', 15000, (reqID) => window.backend_jevPredictAsync(reqID, contextText, cursorOffset || 0)),
			jevExecute: (candidateJson, contextText) => window.backend_jevExecute(candidateJson, contextText || ""),
			jevExecuteAsync: (reqID, candidateJson, contextText) => window.backend_jevExecuteAsync(reqID, candidateJson, contextText || ""),
			jevVerify: (cmdStr) => window.backend_jevVerify(cmdStr),
			jevDispatchAgent: (input) => window.backend_jevDispatchAgent(input || ""),
			jevPruneContext: (rawMarkdown, query) => window.backend_jevPruneContext(rawMarkdown || "", query || ""),
			startMobileDrop: (visionConfigJson) => window.backend_startMobileDrop(visionConfigJson || ""),
			startMobileDropWithVoice: (visionConfigJson, voiceConfigJson) => window.backend_startMobileDropWithVoice(visionConfigJson || "", voiceConfigJson || ""),
			setMobileDropSharedText: (text) => window.backend_setMobileDropSharedText(text || ""),
			cancelMobileDrop: () => window.backend_cancelMobileDrop(),
			requestMobileDropTunnel: () => window.backend_requestMobileDropTunnelAsync(),
			saveAsset: (baseDir, ext, dataBase64) => window.backend_saveAsset(baseDir || "", ext || "", dataBase64 || ""),
			importAssetFile: (baseDir, fileName, dataBase64) => window.backend_importAssetFile(baseDir || "", fileName || "", dataBase64 || ""),
			openPath: (target, baseDir) => window.backend_openPath(target || "", baseDir || ""),
			revealPath: (target, baseDir) => window.backend_revealPath(target || "", baseDir || ""),
			transcribeAudioAsync: (reqID, audioBase64, mimeType, voiceConfigJson) => window.backend_transcribeAudioAsync(reqID, audioBase64 || "", mimeType || "", voiceConfigJson || ""),
			meetingRecordingSupported: () => window.backend_meetingRecordingSupported(),
			checkMeetingAudioAsync: (reqID) => window.backend_checkMeetingAudioAsync(reqID || ""),
			startMeetingRecording: (reqID, includeMic) => window.backend_startMeetingRecording(reqID || "", !!includeMic),
			stopMeetingRecordingAsync: (reqID, voiceConfigJson) => window.backend_stopMeetingRecordingAsync(reqID || "", voiceConfigJson || ""),
			abortMeetingRecording: (reqID) => window.backend_abortMeetingRecording(reqID || ""),
			getSpeechStatus: (voiceConfigJson) => window.backend_getSpeechStatus(voiceConfigJson || ""),
			installSpeechPartAsync: (reqID, which, voiceConfigJson) => window.backend_installSpeechPartAsync(reqID, which || "", voiceConfigJson || ""),
			cancelSpeechInstall: (reqID) => window.backend_cancelSpeechInstall(reqID),
			removeSpeechPart: (which, voiceConfigJson) => window.backend_removeSpeechPart(which || "", voiceConfigJson || ""),
			ensureSpeechServer: (voiceConfigJson) => window.backend_ensureSpeechServer(voiceConfigJson || ""),
			validateWhisperModelFile: (path) => window.backend_validateWhisperModelFile(path || ""),
			pickFilePath: (title) => window.backend_pickFilePath(title || ""),
			openInboxFolder: () => window.backend_openInboxFolder(),
			retryVoiceCacheAsync: (reqID, cachePath, voiceConfigJson) => window.backend_retryVoiceCacheAsync(reqID, cachePath || "", voiceConfigJson || ""),
			keepVoiceCache: (cachePath, baseDir) => window.backend_keepVoiceCache(cachePath || "", baseDir || ""),
			discardVoiceCache: (cachePath) => window.backend_discardVoiceCache(cachePath || ""),
			listVoiceCaches: () => window.backend_listVoiceCaches(),
			discardAllVoiceCaches: () => window.backend_discardAllVoiceCaches(),
			transcribeVoiceCache: (cachePath, voiceConfigJson) => window.backend_transcribeVoiceCache(cachePath || "", voiceConfigJson || "")` + extras.String() + `
		};
	`
}
