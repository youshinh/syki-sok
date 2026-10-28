package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"syki-sok/pkg/dropzone"
)

func TestCreateNoteInFolderNeverReplacesAFile(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "notes")
	app := &App{scrapDir: filepath.Join(t.TempDir(), "scraps")}

	first, err := app.CreateNoteInFolder("one\n", "UTF-8", "2026-10-16_memo.md", dir)
	if err != nil || first.Path != filepath.Join(dir, "2026-10-16_memo.md") {
		t.Fatalf("first = %+v, %v", first, err)
	}
	second, err := app.CreateNoteInFolder("two\n", "UTF-8", "2026-10-16_memo.md", dir)
	if err != nil || second.Path != filepath.Join(dir, "2026-10-16_memo-2.md") {
		t.Fatalf("second = %+v, %v; a name that is taken gets -2", second, err)
	}
	if got, _ := os.ReadFile(first.Path); string(got) != "one\n" {
		t.Errorf("the first note was replaced: %q", got)
	}
	if got, _ := os.ReadFile(second.Path); string(got) != "two\n" {
		t.Errorf("second note = %q", got)
	}
	if second.Sig == "" || !second.Success {
		t.Errorf("the result lacks the fingerprint the page checks the next save against: %+v", second)
	}
}

func TestCreateNoteInFolderWithoutAFolderUsesTheScrapsFolder(t *testing.T) {
	scrapDir := filepath.Join(t.TempDir(), "scraps")
	app := &App{scrapDir: scrapDir}
	res, err := app.CreateNoteInFolder("x", "UTF-8", "a.md", "  ")
	if err != nil || filepath.Dir(res.Path) != scrapDir {
		t.Fatalf("res = %+v, %v; want a file in %s", res, err, scrapDir)
	}
}

func TestCreateNoteInFolderWritesTheNotesEncoding(t *testing.T) {
	app := &App{scrapDir: t.TempDir()}
	res, err := app.CreateNoteInFolder("日本語", "Shift_JIS", "sj.md", "")
	if err != nil {
		t.Fatal(err)
	}
	if raw, _ := os.ReadFile(res.Path); len(raw) != 6 {
		t.Errorf("Shift_JIS file has %d bytes, want 6", len(raw))
	}
}

func TestSafeNoteFileName(t *testing.T) {
	cases := map[string]string{
		"2026-10-16_memo.md":       "2026-10-16_memo.md",
		`..\..\evil.md`:            "evil.md",
		"a/b/c.txt":                "c.txt",
		`what?:*<>|"x.md`:          "what_______x.md",
		"no extension":             "no extension.md",
		"":                         "memo.md",
		"  . ":                     "memo.md",
		"CON.md":                   "_CON.md",
		"trailing dot.md.":         "trailing dot.md",
		strings.Repeat("あ", 200) + ".md": strings.Repeat("あ", 80) + ".md",
	}
	for in, want := range cases {
		if got := safeNoteFileName(in); got != want {
			t.Errorf("safeNoteFileName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDroppedMediaKind(t *testing.T) {
	cases := []struct {
		name, mime string
		want       dropzone.Kind
	}{
		{"a.png", "image/png", dropzone.KindImage},
		{"scan.JPG", "", dropzone.KindImage},
		{"logo.svg", "image/svg+xml", ""},
		{"rec.m4a", "", dropzone.KindAudio},
		{"rec", "audio/webm", dropzone.KindAudio},
		{"clip.mp4", "video/mp4", ""},
		{"notes.md", "text/markdown", ""},
	}
	for _, c := range cases {
		if got, _ := droppedMediaKind(c.name, c.mime); got != c.want {
			t.Errorf("droppedMediaKind(%q, %q) = %q, want %q", c.name, c.mime, got, c.want)
		}
	}
}
