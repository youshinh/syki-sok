// Package dropresolve finds the file on disk that a dropped file came from.
//
// A file dropped on the window reaches the page as a File object that has a name, a size and a modification time, but no path (the
// webview does not give one out). A note made from it had no file, so every save opened "Save as". Find looks for the file by what
// the page does know: the same name (any letter case), the same size, and the same modification time (within the two seconds a FAT
// drive rounds to), in the folders a person's notes are likely to be in.
//
// A wrong guess would make the next save overwrite another file, so a match counts only when it is the single file that fits: two
// copies with the same name, size and time mean the answer is not known, and nothing is linked.
package dropresolve

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	maxDepth   = 6
	mtimeSlack = 2000 // milliseconds
)

var skipDirs = map[string]bool{
	"node_modules": true, "appdata": true, "$recycle.bin": true, "system volume information": true, "windows": true,
	"program files": true, "program files (x86)": true, "library": true,
}

// Find searches the roots, in order, until the budget is used up. path is the one file that matches; ambiguous is true when more than
// one different file matches (path is then empty).
func Find(roots []string, name string, size, modifiedMs int64, budget time.Duration) (path string, ambiguous bool) {
	if name == "" || strings.ContainsAny(name, `/\`) {
		return "", false
	}
	deadline := time.Now().Add(budget)
	seenDirs := map[string]bool{}
	found := map[string]bool{}
	for _, root := range roots {
		if root == "" {
			continue
		}
		root = filepath.Clean(root)
		rootDepth := strings.Count(root, string(filepath.Separator))
		_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if time.Now().After(deadline) {
				return fs.SkipAll
			}
			if err != nil {
				if d != nil && d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				if p != root {
					base := strings.ToLower(d.Name())
					if skipDirs[base] || strings.HasPrefix(base, ".") || strings.Count(p, string(filepath.Separator))-rootDepth > maxDepth {
						return fs.SkipDir
					}
				}
				key := strings.ToLower(p)
				if seenDirs[key] {
					return fs.SkipDir // a folder an earlier root already covered
				}
				seenDirs[key] = true
				return nil
			}
			if !strings.EqualFold(d.Name(), name) {
				return nil
			}
			info, err := d.Info()
			if err != nil || info.Size() != size {
				return nil
			}
			if diff := info.ModTime().UnixMilli() - modifiedMs; diff > mtimeSlack || diff < -mtimeSlack {
				return nil
			}
			found[p] = true
			return nil
		})
		if time.Now().After(deadline) {
			break
		}
	}
	switch len(found) {
	case 0:
		return "", false
	case 1:
		for p := range found {
			if _, err := os.Stat(p); err == nil {
				return p, false
			}
		}
		return "", false
	default:
		return "", true
	}
}
