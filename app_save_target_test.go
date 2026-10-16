package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The Save dialog starts in a folder this app chose, never in "wherever the last dialog was": a note's own path stays as it is (Save As
// starts next to the file), and a bare name for a new note gets the scraps folder, made when it is not there yet.
func TestSaveDialogTarget(t *testing.T) {
	scrap := filepath.Join(t.TempDir(), "scraps")
	app := &App{scrapDir: scrap}

	own := filepath.Join(t.TempDir(), "opened.md")
	if got := app.saveDialogTarget(own); got != own {
		t.Errorf("a full path = %q, want it unchanged", got)
	}

	want := filepath.Join(scrap, "2026-10-16_memo.md")
	if got := app.saveDialogTarget("2026-10-16_memo.md"); got != want {
		t.Errorf("a bare name = %q, want %q", got, want)
	}
	if info, err := os.Stat(scrap); err != nil || !info.IsDir() {
		t.Errorf("the default folder was not made: %v", err)
	}
}
