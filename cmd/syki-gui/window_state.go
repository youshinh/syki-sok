package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"syki-sok/pkg/appdir"
	"syki-sok/pkg/atomicfile"
)

type windowState struct {
	X         int32 `json:"x"`
	Y         int32 `json:"y"`
	Width     int32 `json:"width"`
	Height    int32 `json:"height"`
	Maximized bool  `json:"maximized"`
}

func getWindowStatePath() string {
	return filepath.Join(appdir.AppConfigDir(), "window_state.json")
}

func loadWindowState() (*windowState, error) {
	return loadWindowStateFromPath(getWindowStatePath())
}

func loadWindowStateFromPath(path string) (*windowState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	if len(data) == 0 {
		return nil, nil
	}
	var state windowState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("invalid window state JSON: %w", err)
	}
	if state.Width <= 0 || state.Height <= 0 {
		return nil, fmt.Errorf("invalid window dimensions: width=%d, height=%d", state.Width, state.Height)
	}
	return &state, nil
}

func saveWindowState(state *windowState) error {
	if state == nil {
		return nil
	}
	return saveWindowStateToPath(getWindowStatePath(), state)
}

func saveWindowStateToPath(path string, state *windowState) error {
	if state == nil {
		return nil
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.WriteMode(path, data, ".window-*.tmp", 0o600)
}
