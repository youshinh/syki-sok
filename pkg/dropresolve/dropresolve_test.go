package dropresolve

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func write(t *testing.T, p, body string, mod time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(p, mod, mod); err != nil {
		t.Fatal(err)
	}
}

func TestFindTheOneFileThatFits(t *testing.T) {
	root := t.TempDir()
	mod := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	want := filepath.Join(root, "work", "reports", "Memo.MD")
	write(t, want, "hello", mod)
	write(t, filepath.Join(root, "work", "other.md"), "hello", mod)                  // another name
	write(t, filepath.Join(root, "work", "a", "memo.md.bak"), "hello", mod)          // another name
	write(t, filepath.Join(root, "node_modules", "x", "memo.md"), "hello", mod)       // a folder that is skipped
	write(t, filepath.Join(root, "work", "old", "memo2.md"), "hello world", mod)

	got, amb := Find([]string{root}, "memo.md", 5, mod.UnixMilli()+1500, 5*time.Second)
	if got != want || amb {
		t.Fatalf("Find = %q, %v; want %q", got, amb, want)
	}
	if got, _ := Find([]string{root}, "memo.md", 6, mod.UnixMilli(), 5*time.Second); got != "" {
		t.Errorf("a file of another size matched: %q", got)
	}
	if got, _ := Find([]string{root}, "memo.md", 5, mod.UnixMilli()+60000, 5*time.Second); got != "" {
		t.Errorf("a file saved a minute later matched: %q", got)
	}
}

func TestTwoCopiesAreNotGuessed(t *testing.T) {
	root := t.TempDir()
	mod := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	write(t, filepath.Join(root, "a", "memo.md"), "same", mod)
	write(t, filepath.Join(root, "b", "memo.md"), "same", mod)
	got, amb := Find([]string{root}, "memo.md", 4, mod.UnixMilli(), 5*time.Second)
	if got != "" || !amb {
		t.Fatalf("Find = %q, %v; two identical copies must be reported as ambiguous and not linked", got, amb)
	}
}

func TestARootCoveredTwiceCountsOnce(t *testing.T) {
	root := t.TempDir()
	mod := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	want := filepath.Join(root, "docs", "memo.md")
	write(t, want, "x", mod)
	got, amb := Find([]string{filepath.Join(root, "docs"), root}, "memo.md", 1, mod.UnixMilli(), 5*time.Second)
	if got != want || amb {
		t.Fatalf("Find = %q, %v; want %q", got, amb, want)
	}
}

func TestANameWithAFolderIsRefused(t *testing.T) {
	if got, _ := Find([]string{t.TempDir()}, `..\memo.md`, 1, 0, time.Second); got != "" {
		t.Error("a name with a folder in it was searched")
	}
}
