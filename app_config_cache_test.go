package main

import "testing"

// TestParseJevRelevantSettings verifies the pure extraction of the Jev-relevant subset of
// config.json (mirroring the fields InitJevEngine reads from the "action" block).
func TestParseJevRelevantSettings(t *testing.T) {
	t.Run("empty config yields defaults", func(t *testing.T) {
		got := parseJevRelevantSettings("")
		want := jevRelevantSettings{Enabled: true}
		if got != want {
			t.Errorf("got %+v, want %+v", got, want)
		}
	})

	t.Run("extracts action block fields", func(t *testing.T) {
		json := `{"action":{"apiKey":"sk-123","model":"gpt-4","baseUrl":"https://api.example.com","enabled":false}}`
		got := parseJevRelevantSettings(json)
		want := jevRelevantSettings{APIKey: "sk-123", Model: "gpt-4", BaseURL: "https://api.example.com", Enabled: false}
		if got != want {
			t.Errorf("got %+v, want %+v", got, want)
		}
	})

	t.Run("missing action block yields defaults", func(t *testing.T) {
		got := parseJevRelevantSettings(`{"unrelated": true}`)
		want := jevRelevantSettings{Enabled: true}
		if got != want {
			t.Errorf("got %+v, want %+v", got, want)
		}
	})
}

// TestDiffConfigSettings verifies the pure comparison logic SaveConfig uses to decide whether
// the git-sync engine, Jev client, Discord bridge poller, CF bridge poller, and/or inbox watcher actually need to
// be reinitialized, without touching any file on disk.
func TestDiffConfigSettings(t *testing.T) {
	a := &App{}

	cfgA := `{"scrap_dir": "/tmp/scraps-a", "action": {"apiKey": "key-a", "model": "m1", "baseUrl": "http://a"}, "discordBridge": {"enabled": true, "botToken": "tok-a", "allowedUserId": "1"}, "cfBridge": {"enabled": true, "endpoint": "https://a.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-a"}}`
	cfgB := `{"scrap_dir": "/tmp/scraps-b", "action": {"apiKey": "key-a", "model": "m1", "baseUrl": "http://a"}, "discordBridge": {"enabled": true, "botToken": "tok-a", "allowedUserId": "1"}, "cfBridge": {"enabled": true, "endpoint": "https://a.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-a"}}`
	cfgC := `{"scrap_dir": "/tmp/scraps-a", "action": {"apiKey": "key-c", "model": "m1", "baseUrl": "http://a"}, "discordBridge": {"enabled": true, "botToken": "tok-a", "allowedUserId": "1"}, "cfBridge": {"enabled": true, "endpoint": "https://a.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-a"}}`
	cfgD := `{"scrap_dir": "/tmp/scraps-a", "action": {"apiKey": "key-a", "model": "m1", "baseUrl": "http://a"}, "discordBridge": {"enabled": true, "botToken": "tok-d", "allowedUserId": "1"}, "cfBridge": {"enabled": true, "endpoint": "https://a.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-a"}}`
	cfgE := `{"scrap_dir": "/tmp/scraps-a", "action": {"apiKey": "key-a", "model": "m1", "baseUrl": "http://a"}, "discordBridge": {"enabled": true, "botToken": "tok-a", "allowedUserId": "1"}, "cfBridge": {"enabled": true, "endpoint": "https://a.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-e"}}`
	cfgF := `{"scrap_dir": "/tmp/scraps-a", "action": {"apiKey": "key-a", "model": "m1", "baseUrl": "http://a"}, "discordBridge": {"enabled": true, "botToken": "tok-a", "allowedUserId": "1"}, "cfBridge": {"enabled": true, "endpoint": "https://b.workers.dev", "token": "tok-a"}, "inbox": {"enabled": true, "dir": "/tmp/inbox-a"}}`

	// 1. First call ever (nil caches): all five must be reported as changed so the engines get initialized.
	newScrap, scrapChanged, newJev, jevChanged, newDiscord, discordChanged, newCF, cfChanged, newInbox, inboxChanged := diffConfigSettings(a, nil, nil, nil, nil, nil, cfgA)
	if !scrapChanged || !jevChanged || !discordChanged || !cfChanged || !inboxChanged {
		t.Fatalf("expected all changed on first call, got scrap=%v jev=%v discord=%v cf=%v inbox=%v", scrapChanged, jevChanged, discordChanged, cfChanged, inboxChanged)
	}

	// 2. Same config again: none should be reported as changed.
	_, scrapChanged2, _, jevChanged2, _, discordChanged2, _, cfChanged2, _, inboxChanged2 := diffConfigSettings(a, &newScrap, &newJev, &newDiscord, &newCF, &newInbox, cfgA)
	if scrapChanged2 || jevChanged2 || discordChanged2 || cfChanged2 || inboxChanged2 {
		t.Errorf("expected no change when configJSON is identical")
	}

	// 3. Only scrap_dir differs
	_, scrapChanged3, _, jevChanged3, _, discordChanged3, _, cfChanged3, _, inboxChanged3 := diffConfigSettings(a, &newScrap, &newJev, &newDiscord, &newCF, &newInbox, cfgB)
	if !scrapChanged3 || jevChanged3 || discordChanged3 || cfChanged3 || inboxChanged3 {
		t.Errorf("expected only scrapChanged=true")
	}

	// 4. Only action.apiKey differs
	_, scrapChanged4, _, jevChanged4, _, discordChanged4, _, cfChanged4, _, inboxChanged4 := diffConfigSettings(a, &newScrap, &newJev, &newDiscord, &newCF, &newInbox, cfgC)
	if scrapChanged4 || !jevChanged4 || discordChanged4 || cfChanged4 || inboxChanged4 {
		t.Errorf("expected only jevChanged=true")
	}

	// 5. Only discordBridge.botToken differs
	_, scrapChanged5, _, jevChanged5, _, discordChanged5, _, cfChanged5, _, inboxChanged5 := diffConfigSettings(a, &newScrap, &newJev, &newDiscord, &newCF, &newInbox, cfgD)
	if scrapChanged5 || jevChanged5 || !discordChanged5 || cfChanged5 || inboxChanged5 {
		t.Errorf("expected only discordChanged=true")
	}

	// 6. Only inbox.dir differs
	_, scrapChanged6, _, jevChanged6, _, discordChanged6, _, cfChanged6, _, inboxChanged6 := diffConfigSettings(a, &newScrap, &newJev, &newDiscord, &newCF, &newInbox, cfgE)
	if scrapChanged6 || jevChanged6 || discordChanged6 || cfChanged6 || !inboxChanged6 {
		t.Errorf("expected only inboxChanged=true")
	}

	// 7. Only cfBridge.endpoint differs
	_, scrapChanged7, _, jevChanged7, _, discordChanged7, _, cfChanged7, _, inboxChanged7 := diffConfigSettings(a, &newScrap, &newJev, &newDiscord, &newCF, &newInbox, cfgF)
	if scrapChanged7 || jevChanged7 || discordChanged7 || !cfChanged7 || inboxChanged7 {
		t.Errorf("expected only cfChanged=true")
	}
}
