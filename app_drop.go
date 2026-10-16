package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"syki-sok/pkg/dropresolve"
)

// dropSearchBudget is how long the search for a dropped file's folder may take; it runs while the drop is being opened.
const dropSearchBudget = 3 * time.Second

// ResolveDroppedFile returns the path of the file a dropped file came from, or "" when it is not found or not certain (see
// pkg/dropresolve). The webview gives the page a dropped file's name, size and modification time but not its folder; without the
// path the note had no file and every save asked where to save. hintDirs are folders (one per line) to look in first: the folders
// of the notes already open and the workspace folder.
func (a *App) ResolveDroppedFile(name string, size, modifiedMs float64, hintDirs string) string {
	var roots []string
	for _, d := range strings.Split(hintDirs, "\n") {
		if d = strings.TrimSpace(d); d != "" {
			roots = append(roots, d)
		}
	}
	roots = append(roots, a.GetScrapDir())
	roots = append(roots, dropSearchRoots()...)
	path, _ := dropresolve.Find(roots, name, int64(size), int64(modifiedMs), dropSearchBudget)
	return path
}

// dropSearchRoots are the places a person keeps files they drag in: the desktop, documents and downloads, also under OneDrive.
func dropSearchRoots() []string {
	var bases []string
	if home, err := os.UserHomeDir(); err == nil {
		bases = append(bases, home)
	}
	for _, env := range []string{"OneDrive", "OneDriveConsumer", "OneDriveCommercial"} {
		if v := os.Getenv(env); v != "" {
			bases = append(bases, v)
		}
	}
	var roots []string
	for _, b := range bases {
		for _, sub := range []string{"Desktop", "Documents", "Downloads"} {
			roots = append(roots, filepath.Join(b, sub))
		}
	}
	return roots
}
