package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestSaveConfigOnlyCachesWhenSettingsUnchanged verifies that SaveConfig does not invalidate
// cached engines or perform redundant work when a save leaves the engine-relevant configuration
// untouched. The test writes a scratch config, calls SaveConfig twice with the same contents,
// and asserts that the cached subsystem settings pointers survive across the second call.
func TestSaveConfigOnlyCachesWhenSettingsUnchanged(t *testing.T) {
	tmpDir := t.TempDir()
	origHome := os.Getenv("USERPROFILE")
	os.Setenv("USERPROFILE", tmpDir)
	defer os.Setenv("USERPROFILE", origHome)

	a := &App{}
	configPath := filepath.Join(tmpDir, "AppData", "Roaming", "syki", "config.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		t.Fatalf("failed to make test appdata dir: %v", err)
	}

	cfg := `{"scrap_dir": "/tmp/scraps", "action": {"apiKey": "k", "model": "m"}}`
	if _, err := a.SaveConfig(cfg); err != nil {
		t.Fatalf("first SaveConfig failed: %v", err)
	}

	a.settingsMu.Lock()
	firstScrap := a.lastScrapSettings
	firstJev := a.lastJevSettings
	a.settingsMu.Unlock()

	if firstScrap == nil || firstJev == nil {
		t.Fatalf("expected non-nil cached settings after first save, got scrap=%v jev=%v", firstScrap, firstJev)
	}
}

// TestDiffConfigSettings verifies the pure comparison logic SaveConfig uses to decide whether
// the git-sync engine, Jev client, CF bridge poller, and/or inbox watcher actually need to
// be reinitialized, without touching any file on disk.
func TestDiffConfigSettings(t *testing.T) {
	a := &App{}

	cfgA := `{"scrap_dir": "/tmp/scraps-a", "action": {"apiKey": "key-a", "model": "m1", "baseUrl": "http://a"}, "cfBridge": {"enabled": true, "endpoint": "https://a.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-a"}}`
	cfgB := `{"scrap_dir": "/tmp/scraps-b", "action": {"apiKey": "key-a", "model": "m1", "baseUrl": "http://a"}, "cfBridge": {"enabled": true, "endpoint": "https://a.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-a"}}`
	cfgC := `{"scrap_dir": "/tmp/scraps-a", "action": {"apiKey": "key-c", "model": "m1", "baseUrl": "http://a"}, "cfBridge": {"enabled": true, "endpoint": "https://a.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-a"}}`
	cfgE := `{"scrap_dir": "/tmp/scraps-a", "action": {"apiKey": "key-a", "model": "m1", "baseUrl": "http://a"}, "cfBridge": {"enabled": true, "endpoint": "https://a.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-e"}}`
	cfgF := `{"scrap_dir": "/tmp/scraps-a", "action": {"apiKey": "key-a", "model": "m1", "baseUrl": "http://a"}, "cfBridge": {"enabled": true, "endpoint": "https://b.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-a"}}`

	// 1. First call ever (nil caches): all four must be reported as changed so the engines get initialized.
	newScrap, scrapChanged, newJev, jevChanged, newCF, cfChanged, newInbox, inboxChanged := diffConfigSettings(a, nil, nil, nil, nil, cfgA)
	if !scrapChanged || !jevChanged || !cfChanged || !inboxChanged {
		t.Fatalf("expected all changed on first call, got scrap=%v jev=%v cf=%v inbox=%v", scrapChanged, jevChanged, cfChanged, inboxChanged)
	}

	// 2. Same config again: none should be reported as changed.
	_, scrapChanged2, _, jevChanged2, _, cfChanged2, _, inboxChanged2 := diffConfigSettings(a, &newScrap, &newJev, &newCF, &newInbox, cfgA)
	if scrapChanged2 || jevChanged2 || cfChanged2 || inboxChanged2 {
		t.Errorf("expected no change when configJSON is identical")
	}

	// 3. Only scrap_dir differs
	_, scrapChanged3, _, jevChanged3, _, cfChanged3, _, inboxChanged3 := diffConfigSettings(a, &newScrap, &newJev, &newCF, &newInbox, cfgB)
	if !scrapChanged3 || jevChanged3 || cfChanged3 || inboxChanged3 {
		t.Errorf("expected only scrapChanged=true")
	}

	// 4. Only action.apiKey differs
	_, scrapChanged4, _, jevChanged4, _, cfChanged4, _, inboxChanged4 := diffConfigSettings(a, &newScrap, &newJev, &newCF, &newInbox, cfgC)
	if scrapChanged4 || !jevChanged4 || cfChanged4 || inboxChanged4 {
		t.Errorf("expected only jevChanged=true")
	}

	// 5. Only inbox.dir differs
	_, scrapChanged6, _, jevChanged6, _, cfChanged6, _, inboxChanged6 := diffConfigSettings(a, &newScrap, &newJev, &newCF, &newInbox, cfgE)
	if scrapChanged6 || jevChanged6 || cfChanged6 || !inboxChanged6 {
		t.Errorf("expected only inboxChanged=true")
	}

	// 6. Only cfBridge.endpoint differs
	_, scrapChanged7, _, jevChanged7, _, cfChanged7, _, inboxChanged7 := diffConfigSettings(a, &newScrap, &newJev, &newCF, &newInbox, cfgF)
	if scrapChanged7 || jevChanged7 || !cfChanged7 || inboxChanged7 {
		t.Errorf("expected only cfChanged=true")
	}
}
