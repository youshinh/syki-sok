package dialog

import (
	"path/filepath"
	"testing"
)

func TestSplitSaveTarget(t *testing.T) {
	abs := filepath.Join(t.TempDir(), "メモ 1.md")
	if dir, name := SplitSaveTarget(abs); dir != filepath.Dir(abs) || name != "メモ 1.md" {
		t.Errorf("a full path = (%q, %q), want its folder and its name", dir, name)
	}
	if dir, name := SplitSaveTarget("note.md"); dir != "" || name != "note.md" {
		t.Errorf("a bare name = (%q, %q), want no folder", dir, name)
	}
	if dir, name := SplitSaveTarget(""); dir != "" || name != "" {
		t.Errorf("nothing = (%q, %q)", dir, name)
	}
}
