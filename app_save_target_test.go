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

// A file dropped on the window has no path in the page; ResolveDroppedFile finds the file by name, size and modification time in the
// folders the page names (the folders of the open notes), so that the note is linked to it and saves over it.
func TestResolveDroppedFileFindsItInAHintFolder(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "projects", "memo.md")
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("abc"), 0644); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(p)
	app := &App{scrapDir: t.TempDir()}
	if got := app.ResolveDroppedFile("memo.md", 3, float64(info.ModTime().UnixMilli()), dir); got != p {
		t.Errorf("ResolveDroppedFile = %q, want %q", got, p)
	}
	if got := app.ResolveDroppedFile("memo.md", 4, float64(info.ModTime().UnixMilli()), dir); got != "" {
		t.Errorf("a file of another size was linked: %q", got)
	}
}
