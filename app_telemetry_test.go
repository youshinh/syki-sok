package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"syki-sok/pkg/appdir"
)

// isolatedTelemetry points the config folder (config.json and the telemetry folder in it) at a temp dir and forgets the store.
func isolatedTelemetry(t *testing.T, configJSON string) (*App, string) {
	t.Helper()
	dir := t.TempDir()
	appdir.SetConfigDirOverride(dir)
	telemetryStoreOnce = sync.Once{}
	telemetryStore = nil
	t.Cleanup(func() {
		appdir.SetConfigDirOverride("")
		telemetryStoreOnce = sync.Once{}
		telemetryStore = nil
	})
	if configJSON != "" {
		if err := os.WriteFile(getConfigFilePath(), []byte(configJSON), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return &App{}, dir
}

func telemetryLine() string {
	return `{"v":1,"ts":` + strconv.FormatInt(time.Now().UnixMilli(), 10) + `,"dur_ms":30000,"keys":10,"mean_dwell_ms":70,"iki_mean_ms":150,"iki_cv":0.3,` +
		`"delete_ratio":0,"nav_ratio":0,"ime_ratio":0,"ime_delete_ratio":0,"stall_pauses":0,"mouse_dist_px":10,"mouse_turns":1,"scroll_events":0,` +
		`"scroll_flips":0,"scroll_px":0,"cmd_count":0,"last_cmd":0,"cmd_latency_ms":0,"voice_starts":0,"voice_ms":0}`
}

func TestTelemetryIsOffUntilTheSettingSaysSo(t *testing.T) {
	for name, cfg := range map[string]string{
		"no config at all":    "",
		"no telemetry key":    `{"general":{"theme":"olive"}}`,
		"false":               `{"general":{"telemetry":false}}`,
		"a string that is on": `{"general":{"telemetry":"true"}}`,
		"a broken config":     `{"general":`,
	} {
		a, dir := isolatedTelemetry(t, cfg)
		if err := a.RecordTelemetry(telemetryLine()); err == nil {
			t.Errorf("%s: a line must be refused while the log is off", name)
		}
		if _, err := os.Stat(filepath.Join(dir, "syki-sok", "telemetry")); !os.IsNotExist(err) {
			t.Errorf("%s: nothing may be created while the log is off", name)
		}
	}
}

func TestTelemetryWritesNumbersInTheConfigFolderAndNothingElse(t *testing.T) {
	a, dir := isolatedTelemetry(t, `{"general":{"telemetry":true},"scrap_dir":"`+filepath.ToSlash(t.TempDir())+`"}`)
	if err := a.RecordTelemetry(telemetryLine()); err != nil {
		t.Fatal(err)
	}
	folder := filepath.Join(dir, "syki-sok", "telemetry")
	entries, err := os.ReadDir(folder)
	if err != nil || len(entries) != 1 || !strings.HasSuffix(entries[0].Name(), ".jsonl") {
		t.Fatalf("one daily file in the config folder: %v %v", entries, err)
	}
	data, _ := os.ReadFile(filepath.Join(folder, entries[0].Name()))
	if !strings.Contains(string(data), `"keys":10`) {
		t.Fatalf("the line is there: %q", data)
	}
	// text cannot get in, even with the log on
	for _, bad := range []string{
		strings.Replace(telemetryLine(), `"keys":10`, `"keys":10,"typed":"hello"`, 1),
		strings.Replace(telemetryLine(), `"last_cmd":0`, `"last_cmd":"ctrl+l"`, 1),
		strings.Replace(telemetryLine(), `"mouse_dist_px":10`, `"mouse_dist_px":10,"x":512,"y":384`, 1),
	} {
		if err := a.RecordTelemetry(bad); err == nil {
			t.Errorf("must be refused: %s", bad)
		}
	}
	after, _ := os.ReadFile(filepath.Join(folder, entries[0].Name()))
	if string(after) != string(data) {
		t.Fatal("a refused line must leave the file as it was")
	}
	// info, open folder's target, and delete everything
	info := a.GetTelemetryInfo()
	if info["files"].(int) != 1 || info["retainDays"].(int) != 30 || info["dir"].(string) != folder {
		t.Fatalf("info: %v", info)
	}
	n, err := a.ClearTelemetry()
	if err != nil || n != 1 {
		t.Fatalf("clear: %d %v", n, err)
	}
	if a.GetTelemetryInfo()["files"].(int) != 0 {
		t.Fatal("nothing left")
	}
}

// The folder is the config folder's, not the scraps folder's (which is synced with git).
func TestTelemetryFolderIsNotInTheScrapsFolder(t *testing.T) {
	scraps := t.TempDir()
	a, _ := isolatedTelemetry(t, `{"general":{"telemetry":true},"scrap_dir":"`+filepath.ToSlash(scraps)+`"}`)
	if err := a.RecordTelemetry(telemetryLine()); err != nil {
		t.Fatal(err)
	}
	if rel, err := filepath.Rel(scraps, telemetryDir()); err == nil && !strings.HasPrefix(rel, "..") {
		t.Fatalf("the log is inside the scraps folder: %s", telemetryDir())
	}
	left, _ := filepath.Glob(filepath.Join(scraps, "*"))
	if len(left) != 0 {
		t.Fatalf("nothing may be written to the scraps folder: %v", left)
	}
}
