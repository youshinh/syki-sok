package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWindowStateSaveAndLoad(t *testing.T) {
	tmpDir := t.TempDir()
	statePath := filepath.Join(tmpDir, "window_state.json")

	state := &windowState{
		X:         120,
		Y:         150,
		Width:     1400,
		Height:    900,
		Maximized: true,
	}

	if err := saveWindowStateToPath(statePath, state); err != nil {
		t.Fatalf("saveWindowStateToPath failed: %v", err)
	}

	loaded, err := loadWindowStateFromPath(statePath)
	if err != nil {
		t.Fatalf("loadWindowStateFromPath failed: %v", err)
	}
	if loaded == nil {
		t.Fatal("expected non-nil windowState")
	}

	if loaded.X != 120 || loaded.Y != 150 || loaded.Width != 1400 || loaded.Height != 900 || !loaded.Maximized {
		t.Fatalf("loaded state mismatch: got %+v, want %+v", loaded, state)
	}
}

func TestWindowStateMissingOrDamaged(t *testing.T) {
	tmpDir := t.TempDir()

	// Missing file should return nil, nil
	missingPath := filepath.Join(tmpDir, "non_existent.json")
	state, err := loadWindowStateFromPath(missingPath)
	if err != nil {
		t.Fatalf("expected nil error for missing file, got: %v", err)
	}
	if state != nil {
		t.Fatalf("expected nil state for missing file, got: %+v", state)
	}

	// Corrupted file should return nil, err
	damagedPath := filepath.Join(tmpDir, "damaged.json")
	_ = os.WriteFile(damagedPath, []byte("invalid json {{"), 0600)
	state, err = loadWindowStateFromPath(damagedPath)
	if err == nil {
		t.Fatal("expected error for corrupted json file, got nil")
	}
	if state != nil {
		t.Fatalf("expected nil state for corrupted file, got: %+v", state)
	}

	// Invalid dimensions (e.g. width <= 0 or height <= 0) should be rejected
	invalidDimsPath := filepath.Join(tmpDir, "invalid_dims.json")
	_ = os.WriteFile(invalidDimsPath, []byte(`{"x":100,"y":100,"width":0,"height":-50,"maximized":false}`), 0600)
	state, err = loadWindowStateFromPath(invalidDimsPath)
	if err == nil {
		t.Fatal("expected error for invalid dimensions, got nil")
	}
	if state != nil {
		t.Fatalf("expected nil state for invalid dimensions, got: %+v", state)
	}
}
