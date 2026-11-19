package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"syki-sok/pkg/llm"
	"syki-sok/pkg/textsig"
)

type stressMockWebView struct {
	mu    sync.Mutex
	evals []string
}

func (m *stressMockWebView) Dispatch(fn func()) { fn() }

func (m *stressMockWebView) Eval(js string) {
	m.mu.Lock()
	m.evals = append(m.evals, js)
	m.mu.Unlock()
}

func (m *stressMockWebView) countContaining(substr string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, e := range m.evals {
		if strings.Contains(e, substr) {
			n++
		}
	}
	return n
}

func (m *stressMockWebView) waitCountAll(t *testing.T, fnPrefix string, ids []string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		missing := 0
		dups := 0
		for _, id := range ids {
			needle := fmt.Sprintf(`%s(%q`, fnPrefix, id)
			c := m.countContaining(needle)
			if c == 0 {
				missing++
			} else if c > 1 {
				dups++
			}
		}
		if dups > 0 {
			t.Fatalf("duplicate callback delivery detected for %s (dups=%d)", fnPrefix, dups)
		}
		if missing == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s callbacks: %d/%d missing", fnPrefix, missing, len(ids))
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestAppStress_ConcurrentSubsystems(t *testing.T) {
	cfgDir := sessionDir(t)
	scrapDir := t.TempDir()
	filesDir := t.TempDir()

	scrapCount := 150
	if os.Getenv("SYKI_STRESS") == "1" {
		scrapCount = 800
	}
	for i := 0; i < scrapCount; i++ {
		name := fmt.Sprintf("2026-%02d-%02d_%04d.md", (i/28)%12+1, (i%28)+1, i)
		var body strings.Builder
		body.WriteString(fmt.Sprintf("# Note %d\n", i))
		if i%10 == 0 {
			body.WriteString("SYKI_APP_STRESS target hit\n")
		}
		for l := 0; l < 13; l++ {
			body.WriteString("regular line for concurrent subsystem stress testing\n")
		}
		if err := os.WriteFile(filepath.Join(scrapDir, name), []byte(body.String()), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	notePaths := make([]string, 10)
	for i := 0; i < 10; i++ {
		p := filepath.Join(filesDir, fmt.Sprintf("note-%d.md", i))
		if err := os.WriteFile(p, []byte(fmt.Sprintf("initial %d\n", i)), 0o644); err != nil {
			t.Fatal(err)
		}
		notePaths[i] = p
	}

	conflictPath := filepath.Join(filesDir, "conflict.md")
	initialConflict := "initial\n"
	if err := os.WriteFile(conflictPath, []byte(initialConflict), 0o644); err != nil {
		t.Fatal(err)
	}
	conflictSig := textsig.Sum(initialConflict)
	if err := os.WriteFile(conflictPath, []byte("external editor update\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Build a ~1.5MB valid session JSON spanning 50 tabs
	type sessTab struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	tabs := make([]sessTab, 50)
	chunk30k := strings.Repeat("0123456789abcdef0123456789abcd\n", 1000)
	for i := range tabs {
		tabs[i] = sessTab{
			ID:      fmt.Sprintf("tab_%d", i),
			Title:   fmt.Sprintf("tab_%d.md", i),
			Content: fmt.Sprintf("# Tab %d\n%s", i, chunk30k),
		}
	}
	sessBytes, err := json.Marshal(map[string]interface{}{
		"activeTabId": "tab_0",
		"tabCounter":  50,
		"tabs":        tabs,
	})
	if err != nil {
		t.Fatal(err)
	}
	hugeSessionJSON := string(sessBytes)

	mock := &stressMockWebView{}
	app := &App{w: mock, scrapDir: scrapDir}

	runtime.GC()
	baseGoroutines := runtime.NumGoroutine()

	var wg sync.WaitGroup
	var errCount int64
	var errMsgs sync.Mutex
	var firstErr string
	recordErr := func(msg string) {
		atomic.AddInt64(&errCount, 1)
		errMsgs.Lock()
		if firstErr == "" {
			firstErr = msg
		}
		errMsgs.Unlock()
	}

	// 1. Search storm (40 rapid Async calls)
	const searchCalls = 40
	searchIDs := make([]string, searchCalls)
	for i := 0; i < searchCalls; i++ {
		searchIDs[i] = fmt.Sprintf("stress-search-%02d", i)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for _, id := range searchIDs {
			app.SearchScrapsAsync(id, "SYKI_APP_STRESS", 50, "")
		}
	}()

	// 2. Concurrent huge session saves (15 goroutines)
	const sessCalls = 15
	sessIDs := make([]string, sessCalls)
	for i := 0; i < sessCalls; i++ {
		sessIDs[i] = fmt.Sprintf("stress-sess-%02d", i)
		wg.Add(1)
		go func(reqID string) {
			defer wg.Done()
			app.SaveSessionAsync(reqID, hugeSessionJSON)
		}(sessIDs[i])
	}

	// 3. Concurrent file saves/reads + checked conflict guard
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			want := fmt.Sprintf("updated content %d\n", idx)
			res, err := app.SaveFile(notePaths[idx], want, "UTF-8")
			if err != nil || res == nil || !res.Success {
				recordErr(fmt.Sprintf("SaveFile(%d): res=%+v err=%v", idx, res, err))
				return
			}
			readRes, err := app.ReadFileByPath(notePaths[idx])
			if err != nil || readRes == nil || readRes.Content != want {
				recordErr(fmt.Sprintf("ReadFileByPath(%d): got=%+v err=%v", idx, readRes, err))
			}
		}(i)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		res, err := app.SaveFileChecked(conflictPath, "stale overwrite attempt\n", "UTF-8", conflictSig)
		if err != nil {
			recordErr(fmt.Sprintf("SaveFileChecked err=%v", err))
			return
		}
		if res == nil || !res.Conflict || res.Success {
			recordErr(fmt.Sprintf("SaveFileChecked expected conflict, got %+v", res))
		}
	}()

	// 4. Concurrent daily scrap appends (20 goroutines)
	const scrapAppends = 20
	var dailyPathMu sync.Mutex
	dailyPath := ""
	for i := 0; i < scrapAppends; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			marker := fmt.Sprintf("MARKER_%02d", idx)
			p, err := app.AppendDailyScrap(marker, "stress", filesDir)
			if err != nil {
				recordErr(fmt.Sprintf("AppendDailyScrap(%d): %v", idx, err))
				return
			}
			dailyPathMu.Lock()
			dailyPath = p
			dailyPathMu.Unlock()
		}(i)
	}

	// 5. Concurrent folder scans (5 goroutines)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			entries, err := app.ScanFolderFiles(scrapDir)
			if err != nil {
				recordErr(fmt.Sprintf("ScanFolderFiles(%d): %v", idx, err))
				return
			}
			if len(entries) == 0 || len(entries) > 300 {
				recordErr(fmt.Sprintf("ScanFolderFiles(%d) unexpected count=%d", idx, len(entries)))
			}
		}(i)
	}

	wg.Wait()

	// Wait for async callbacks from search & session saves
	mock.waitCountAll(t, "__onSearchScrapsResult", searchIDs, 20*time.Second)
	mock.waitCountAll(t, "__onDeepSearchResult", sessIDs, 20*time.Second)

	if errCount != 0 {
		t.Fatalf("observed %d error(s), first: %s", errCount, firstErr)
	}

	// Verify session.json integrity & no leftover temp files
	gotSess, err := app.GetSession()
	if err != nil {
		t.Fatalf("GetSession failed: %v", err)
	}
	if !json.Valid([]byte(gotSess)) || len(gotSess) != len(hugeSessionJSON) {
		t.Fatalf("session.json corrupted or mismatched length: got=%d want=%d valid=%v", len(gotSess), len(hugeSessionJSON), json.Valid([]byte(gotSess)))
	}
	if left := leftoverTemps(t, cfgDir); len(left) != 0 {
		t.Fatalf("leftover temp files in %s: %v", cfgDir, left)
	}

	// Verify external content preserved on conflict file
	diskConflict, err := os.ReadFile(conflictPath)
	if err != nil || string(diskConflict) != "external editor update\n" {
		t.Fatalf("conflict file altered: %q err=%v", string(diskConflict), err)
	}

	// Verify all 20 daily scrap markers landed
	dailyRaw, err := os.ReadFile(dailyPath)
	if err != nil {
		t.Fatalf("read daily scrap %s: %v", dailyPath, err)
	}
	dailyStr := string(dailyRaw)
	for i := 0; i < scrapAppends; i++ {
		marker := fmt.Sprintf("MARKER_%02d", i)
		if !strings.Contains(dailyStr, marker) {
			t.Fatalf("missing appended marker %s in %s", marker, dailyPath)
		}
	}

	time.Sleep(50 * time.Millisecond)
	runtime.GC()
	afterGoroutines := runtime.NumGoroutine()
	if afterGoroutines > baseGoroutines+20 {
		t.Fatalf("goroutine leak suspected: before=%d after=%d", baseGoroutines, afterGoroutines)
	}
}

func TestAppStress_ConfigQuickCaptureMobileDropAndInbox(t *testing.T) {
	cfgDir := sessionDir(t)
	scrapDir := t.TempDir()
	inboxDir := t.TempDir()

	stressScale := os.Getenv("SYKI_STRESS") == "1"
	cfgWorkers := 16
	qcWorkers := 20
	mobileCycles := 12
	inboxEach := 6
	if stressScale {
		cfgWorkers = 32
		qcWorkers = 40
		mobileCycles = 24
		inboxEach = 16
	}

	makeSafeConfigJSON := func(idx int, timeoutSec int) string {
		cfg := map[string]interface{}{
			"git_sync_enabled": false,
			"timeout_seconds":  timeoutSec,
			"scrap_dir":        scrapDir,
			"general": map[string]interface{}{
				"autoSave":     idx%2 == 0,
				"trayResident": idx%2 == 0,
				"commentStyle": []string{"line", "block"}[idx%2],
				"language":     "en",
			},
			"scraps": map[string]interface{}{
				"scrapDir":       scrapDir,
				"gitSyncEnabled": false,
			},
			"action":   map[string]interface{}{"enabled": false},
			"cfBridge": map[string]interface{}{"enabled": false},
			"inbox":    map[string]interface{}{"enabled": false},
		}
		raw, _ := json.Marshal(cfg)
		return string(raw)
	}

	mock := &stressMockWebView{}
	app := &App{w: mock, scrapDir: scrapDir}
	defer func() { _ = app.CancelMobileDrop() }()

	if ok, err := app.SaveConfig(makeSafeConfigJSON(0, 120)); err != nil || !ok {
		t.Fatalf("initial SaveConfig failed: ok=%v err=%v", ok, err)
	}

	prevQC := quickCaptureLLMQuery
	quickCaptureLLMQuery = func(prompt string, cfg llm.Config) (string, error) {
		if strings.Contains(prompt, "TIMEOUT_CASE") {
			time.Sleep(80 * time.Millisecond)
			return "late response", nil
		}
		return "Corrected capture entry for quick capture", nil
	}
	defer func() { quickCaptureLLMQuery = prevQC }()

	prevRecog := inboxRecognize
	prevTrans := inboxTranscribe
	inboxRecognize = func(ctx context.Context, path string, cfg llm.VisionConfig) (string, error) {
		return "OCR_MARKER_" + filepath.Base(path), nil
	}
	inboxTranscribe = func(path, mimeType string, cfg llm.VoiceConfig) (string, error) {
		return "VOICE_MARKER_" + filepath.Base(path), nil
	}
	defer func() {
		inboxRecognize = prevRecog
		inboxTranscribe = prevTrans
	}()

	baseGoroutines := runtime.NumGoroutine()

	var errMu sync.Mutex
	var firstErr string
	var errCount int32
	recordErr := func(msg string) {
		if atomic.AddInt32(&errCount, 1) == 1 {
			errMu.Lock()
			firstErr = msg
			errMu.Unlock()
		}
	}

	// 1. Concurrent SaveConfig + GetConfig + readGeneralConfigCached
	var cfgWg sync.WaitGroup
	for i := 0; i < cfgWorkers; i++ {
		cfgWg.Add(1)
		go func(idx int) {
			defer cfgWg.Done()
			for r := 0; r < 4; r++ {
				if idx%2 == 0 {
					ok, err := app.SaveConfig(makeSafeConfigJSON(idx+r, 120+(idx%30)))
					if err != nil || !ok {
						recordErr(fmt.Sprintf("SaveConfig(%d,%d): ok=%v err=%v", idx, r, ok, err))
						return
					}
				} else {
					raw, err := app.GetConfig()
					if err != nil || !json.Valid([]byte(raw)) {
						recordErr(fmt.Sprintf("GetConfig(%d,%d): valid=%v err=%v", idx, r, json.Valid([]byte(raw)), err))
						return
					}
					snap := app.readGeneralConfigCached()
					_ = snap.trayResident
				}
			}
		}(i)
	}
	cfgWg.Wait()
	if errCount != 0 {
		t.Fatalf("config stress error (%d): %s", errCount, firstErr)
	}
	finalCfg, err := app.GetConfig()
	if err != nil || !json.Valid([]byte(finalCfg)) {
		t.Fatalf("final GetConfig invalid JSON: err=%v raw=%q", err, finalCfg)
	}
	if left := leftoverTemps(t, cfgDir); len(left) != 0 {
		t.Fatalf("leftover temp files in %s after SaveConfig stress: %v", cfgDir, left)
	}

	// 2. Quick Capture concurrent LLM correction (normal + timeout fallback) + AppendDailyScrap
	var qcWg sync.WaitGroup
	var qcDailyMu sync.Mutex
	qcDailyPath := ""
	llmCfg := llm.Config{BaseURL: "http://127.0.0.1:0", Model: "mock"}
	for i := 0; i < qcWorkers; i++ {
		qcWg.Add(1)
		go func(idx int) {
			defer qcWg.Done()
			isTimeout := idx%5 == 0
			marker := fmt.Sprintf("QC_MARKER_%02d", idx)
			raw := marker
			if isTimeout {
				raw = "TIMEOUT_CASE_" + marker
			}
			corrected := correctQuickCaptureWithLLM(raw, llmCfg, false, 20*time.Millisecond)
			if isTimeout && !strings.Contains(corrected, "TIMEOUT_CASE_"+marker) {
				recordErr(fmt.Sprintf("timeout fallback lost raw input: got=%q", corrected))
				return
			}
			if !isTimeout && !strings.Contains(corrected, "Corrected capture entry") {
				recordErr(fmt.Sprintf("expected corrected text, got=%q", corrected))
				return
			}
			entry := formatQuickCaptureEntry(fmt.Sprintf("%s [%s]", corrected, marker), "StressWindow")
			p, err := app.AppendDailyScrap(entry, "quickcapture", scrapDir)
			if err != nil {
				recordErr(fmt.Sprintf("AppendDailyScrap QC(%d): %v", idx, err))
				return
			}
			qcDailyMu.Lock()
			qcDailyPath = p
			qcDailyMu.Unlock()
		}(i)
	}
	qcWg.Wait()
	if errCount != 0 {
		t.Fatalf("quickcapture stress error (%d): %s", errCount, firstErr)
	}

	// 3. Mobile Drop sequential rapid cycles + concurrent Start/Share/Cancel calls
	for i := 0; i < mobileCycles; i++ {
		info, err := app.StartMobileDropWithVoice("{}", "{}")
		if err != nil || info == nil || info.URL == "" {
			t.Fatalf("StartMobileDropWithVoice cycle %d failed: info=%+v err=%v", i, info, err)
		}
		if err := app.SetMobileDropSharedText(fmt.Sprintf("mobile-drop-cycle-%d", i)); err != nil {
			t.Fatalf("SetMobileDropSharedText cycle %d failed: %v", i, err)
		}
		if err := app.CancelMobileDrop(); err != nil {
			t.Fatalf("CancelMobileDrop cycle %d failed: %v", i, err)
		}
	}
	var mdWg sync.WaitGroup
	for i := 0; i < 8; i++ {
		mdWg.Add(1)
		go func(idx int) {
			defer mdWg.Done()
			_, _ = app.StartMobileDropWithVoice("{}", "{}")
			_ = app.SetMobileDropSharedText(fmt.Sprintf("concurrent-md-%d", idx))
			_ = app.CancelMobileDrop()
		}(i)
	}
	mdWg.Wait()
	if err := app.CancelMobileDrop(); err != nil {
		t.Fatalf("final CancelMobileDrop failed: %v", err)
	}

	// 4. Inbox hot-folder concurrent image & audio handling
	imgPaths := make([]string, inboxEach)
	audPaths := make([]string, inboxEach)
	for i := 0; i < inboxEach; i++ {
		ip := filepath.Join(inboxDir, fmt.Sprintf("img_%02d.png", i))
		ap := filepath.Join(inboxDir, fmt.Sprintf("aud_%02d.wav", i))
		if err := os.WriteFile(ip, []byte("PNG-DUMMY"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(ap, []byte("RIFF-DUMMY"), 0o644); err != nil {
			t.Fatal(err)
		}
		imgPaths[i] = ip
		audPaths[i] = ap
	}
	var inboxWg sync.WaitGroup
	for i := 0; i < inboxEach; i++ {
		inboxWg.Add(2)
		go func(p string) {
			defer inboxWg.Done()
			app.handleInboxImage(p, llm.VisionConfig{})
		}(imgPaths[i])
		go func(p string) {
			defer inboxWg.Done()
			app.handleInboxAudio(p, llm.VoiceConfig{})
		}(audPaths[i])
	}
	inboxWg.Wait()

	// Verify Quick Capture + Inbox markers landed in daily scrap and inbox files moved to assets
	dailyRaw, err := os.ReadFile(qcDailyPath)
	if err != nil {
		t.Fatalf("read daily scrap %s: %v", qcDailyPath, err)
	}
	dailyStr := string(dailyRaw)
	for i := 0; i < qcWorkers; i++ {
		m := fmt.Sprintf("QC_MARKER_%02d", i)
		if !strings.Contains(dailyStr, m) {
			t.Fatalf("missing quickcapture marker %s in %s", m, qcDailyPath)
		}
	}
	for i := 0; i < inboxEach; i++ {
		imgMarker := fmt.Sprintf("OCR_MARKER_img_%02d.png", i)
		audMarker := fmt.Sprintf("VOICE_MARKER_aud_%02d.wav", i)
		if !strings.Contains(dailyStr, imgMarker) {
			t.Fatalf("missing inbox OCR marker %s", imgMarker)
		}
		if !strings.Contains(dailyStr, audMarker) {
			t.Fatalf("missing inbox Voice marker %s", audMarker)
		}
	}
	remainingInbox, err := os.ReadDir(inboxDir)
	if err != nil || len(remainingInbox) != 0 {
		t.Fatalf("expected inbox dir emptied after processing, got len=%d err=%v", len(remainingInbox), err)
	}

	time.Sleep(60 * time.Millisecond)
	runtime.GC()
	afterGoroutines := runtime.NumGoroutine()
	if afterGoroutines > baseGoroutines+20 {
		t.Fatalf("goroutine leak suspected after Config/QC/MobileDrop/Inbox: before=%d after=%d", baseGoroutines, afterGoroutines)
	}
}

func TestAppStress_AtomicFileAndAgentsConfigConcurrency(t *testing.T) {
	noteDir := t.TempDir()
	scrapDir := t.TempDir()
	sharedPath := filepath.Join(noteDir, "shared-note.md")
	initial := "initial note body\n"
	if err := os.WriteFile(sharedPath, []byte(initial), 0o644); err != nil {
		t.Fatal(err)
	}

	agentsDir := filepath.Join(scrapDir, ".syki")
	if err := os.MkdirAll(agentsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	agentsPath := filepath.Join(agentsDir, "agents.yaml")
	initialYAML := "version: 1\ndefault_agent: old-agent\ntimeout_seconds: 60\nhover_peek_enabled: true\nghost_diff_duration_ms: 2000\n"
	if err := os.WriteFile(agentsPath, []byte(initialYAML), 0o644); err != nil {
		t.Fatal(err)
	}

	app := &App{w: &stressMockWebView{}, scrapDir: scrapDir}

	// (a) 16 goroutines concurrently calling SaveFile and SaveFileChecked on the SAME file path.
	var errMu sync.Mutex
	var firstErr string
	var errCount int32
	recordErr := func(msg string) {
		if atomic.AddInt32(&errCount, 1) == 1 {
			errMu.Lock()
			firstErr = msg
			errMu.Unlock()
		}
	}

	const fileWorkers = 16
	const rounds = 6
	var fileWg sync.WaitGroup
	for i := 0; i < fileWorkers; i++ {
		fileWg.Add(1)
		go func(id int) {
			defer fileWg.Done()
			for r := 0; r < rounds; r++ {
				payload := fmt.Sprintf("# Same-Path Stress\nworker=%02d round=%02d\nBODY_END\n", id, r)
				if id%2 == 0 {
					res, err := app.SaveFile(sharedPath, payload, "UTF-8")
					if err != nil || res == nil || !res.Success {
						recordErr(fmt.Sprintf("SaveFile(%d,%d): res=%+v err=%v", id, r, res, err))
						return
					}
				} else {
					readRes, err := app.ReadFileByPath(sharedPath)
					sig := ""
					if err == nil && readRes != nil {
						sig = textsig.Sum(readRes.Content)
					}
					res, err := app.SaveFileChecked(sharedPath, payload, "UTF-8", sig)
					if err != nil || res == nil || (!res.Success && !res.Conflict) {
						recordErr(fmt.Sprintf("SaveFileChecked(%d,%d): res=%+v err=%v", id, r, res, err))
						return
					}
				}
			}
		}(i)
	}
	fileWg.Wait()

	if errCount != 0 {
		t.Fatalf("same-path save concurrency error (%d): %s", errCount, firstErr)
	}
	diskRaw, err := os.ReadFile(sharedPath)
	if err != nil || !strings.HasPrefix(string(diskRaw), "# Same-Path Stress\n") || !strings.HasSuffix(string(diskRaw), "BODY_END\n") {
		t.Fatalf("shared-note.md corrupted or incomplete: err=%v raw=%q", err, string(diskRaw))
	}
	if left := leftoverTemps(t, noteDir); len(left) != 0 {
		t.Fatalf("leftover temp files in %s: %v", noteDir, left)
	}
	app.fileSaveMu.Lock()
	leftLocks := len(app.fileSaveLocks)
	app.fileSaveMu.Unlock()
	if leftLocks != 0 {
		t.Fatalf("expected fileSaveLocks cleaned up after completion, got %d entries", leftLocks)
	}

	// (b) Concurrent UpdateActiveAgentsConfigDefaultAgent / SlotSettings / DisabledAgents (no lost updates).
	var cfgWg sync.WaitGroup
	for r := 0; r < 6; r++ {
		cfgWg.Add(3)
		go func() {
			defer cfgWg.Done()
			if err := app.UpdateActiveAgentsConfigDefaultAgent(scrapDir, "gemini-cli"); err != nil {
				recordErr(fmt.Sprintf("UpdateActiveAgentsConfigDefaultAgent: %v", err))
			}
		}()
		go func() {
			defer cfgWg.Done()
			if err := app.UpdateActiveAgentsConfigSlotSettings(scrapDir, 240, false, 5500); err != nil {
				recordErr(fmt.Sprintf("UpdateActiveAgentsConfigSlotSettings: %v", err))
			}
		}()
		go func() {
			defer cfgWg.Done()
			if err := app.UpdateActiveAgentsConfigDisabledAgents(scrapDir, []string{"aider", "goose"}); err != nil {
				recordErr(fmt.Sprintf("UpdateActiveAgentsConfigDisabledAgents: %v", err))
			}
		}()
	}
	cfgWg.Wait()

	if errCount != 0 {
		t.Fatalf("agents.yaml concurrent update error (%d): %s", errCount, firstErr)
	}
	finalYAMLBytes, err := os.ReadFile(agentsPath)
	if err != nil {
		t.Fatalf("read final agents.yaml: %v", err)
	}
	finalYAML := string(finalYAMLBytes)
	for _, want := range []string{
		"default_agent: gemini-cli",
		"timeout_seconds: 240",
		"hover_peek_enabled: false",
		"ghost_diff_duration_ms: 5500",
		"disabled_agents: [aider, goose]",
	} {
		if !strings.Contains(finalYAML, want) {
			t.Fatalf("lost update in agents.yaml: missing %q in:\n%s", want, finalYAML)
		}
	}
	if left := leftoverTemps(t, agentsDir); len(left) != 0 {
		t.Fatalf("leftover temp files in %s: %v", agentsDir, left)
	}
}
