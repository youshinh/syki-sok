package main

import (
	"errors"
	"os"
	"path/filepath"
	"sync"

	"syki-sok/pkg/appdir"
	"syki-sok/pkg/telemetry"
)

// The operation-rhythm log (frontend/js/telemetry.js, pkg/telemetry). It is off until the person turns it on in Settings > General
// (general.telemetry); the page only sends while it is on, and this side checks the setting again, so a line that arrives while it is
// off is dropped. The folder is <config folder>/telemetry: on this PC, outside the scraps folder (which is synced with git), and no
// network code touches it.

var (
	telemetryStoreOnce sync.Once
	telemetryStore     *telemetry.Store
)

func telemetryDir() string { return filepath.Join(appdir.AppConfigDir(), "telemetry") }

func getTelemetryStore() *telemetry.Store {
	telemetryStoreOnce.Do(func() { telemetryStore = telemetry.NewStore(telemetryDir()) })
	return telemetryStore
}

// telemetryEnabled is general.telemetry of config.json (false when it is missing or the file cannot be read).
func (a *App) telemetryEnabled() bool {
	return a.readGeneralConfigCached().telemetryEnabled
}

// RecordTelemetry is bound as backend_recordTelemetry: one 30-second window of numbers (see telemetry.Snapshot). Anything else is refused.
func (a *App) RecordTelemetry(snapshotJSON string) error {
	if !a.telemetryEnabled() {
		return errors.New("telemetry is off")
	}
	return getTelemetryStore().Append(snapshotJSON)
}

// GetTelemetryInfo is bound as backend_getTelemetryInfo (Settings): where the log is and how big it is.
func (a *App) GetTelemetryInfo() map[string]interface{} {
	s := getTelemetryStore()
	_, _ = s.Purge()
	files, bytes := s.Info()
	return map[string]interface{}{"dir": s.Dir, "files": files, "bytes": bytes, "retainDays": telemetry.RetainDays}
}

// ClearTelemetry is bound as backend_clearTelemetry: deletes every daily file and returns how many.
func (a *App) ClearTelemetry() (int, error) {
	return getTelemetryStore().Clear()
}

// OpenTelemetryFolder is bound as backend_openTelemetryFolder: shows the folder in the file manager.
func (a *App) OpenTelemetryFolder() error {
	dir := getTelemetryStore().Dir
	if _, err := os.Stat(dir); err != nil {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	return a.RevealPath(dir, "")
}
