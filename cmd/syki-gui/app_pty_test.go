package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestApp_PtySuggestDirsFindsGitRootAndNoteDir(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".git"), 0755); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(root, "docs", "notes")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	noteFile := filepath.Join(sub, "design.md")
	if err := os.WriteFile(noteFile, []byte("# design"), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	raw := app.PtySuggestDirs(noteFile)
	var dirs []ptyDirSuggestion
	if err := json.Unmarshal([]byte(raw), &dirs); err != nil {
		t.Fatalf("invalid JSON: %v (%s)", err, raw)
	}
	if len(dirs) < 2 {
		t.Fatalf("expected at least git root and note dir, got %+v", dirs)
	}
	if dirs[0].Path != filepath.Clean(root) || dirs[0].Reason != "git" {
		t.Fatalf("expected first suggestion to be git root %q, got %+v", root, dirs[0])
	}
	if dirs[1].Path != filepath.Clean(sub) || dirs[1].Reason != "note" {
		t.Fatalf("expected second suggestion to be note dir %q, got %+v", sub, dirs[1])
	}
}

func TestApp_PtyLifecycleAndWriteDecode(t *testing.T) {
	app := &App{}
	defer app.closeAllPTYs()

	dir := t.TempDir()
	infoJSON, err := app.PtyStart("shell", dir, 80, 24)
	if err != nil {
		t.Fatalf("PtyStart failed: %v", err)
	}
	var info struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Running bool   `json:"running"`
	}
	if err := json.Unmarshal([]byte(infoJSON), &info); err != nil {
		t.Fatalf("unmarshal info: %v", err)
	}
	if info.ID == "" || !info.Running {
		t.Fatalf("unexpected info: %+v", info)
	}

	cmdStr := "echo ok\n"
	if runtime.GOOS == "windows" {
		cmdStr = "echo ok\r\n"
	}
	if err := app.PtyWrite(info.ID, base64.StdEncoding.EncodeToString([]byte(cmdStr))); err != nil {
		t.Fatalf("PtyWrite failed: %v", err)
	}
	if err := app.PtyResize(info.ID, 100, 30); err != nil {
		t.Fatalf("PtyResize failed: %v", err)
	}
	if err := app.PtyClose(info.ID); err != nil {
		t.Fatalf("PtyClose failed: %v", err)
	}
	if got := app.PtyList(); got != "[]" {
		t.Fatalf("expected empty list after close, got %s", got)
	}
}

func TestApp_PtyDetectGate(t *testing.T) {
	app := &App{}

	goDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(goDir, "go.mod"), []byte("module ex\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if got := app.PtyDetectGate(goDir); got != "go test ./..." {
		t.Fatalf("go project gate = %q, want go test ./...", got)
	}

	nodeDummyDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(nodeDummyDir, "package.json"), []byte(`{"scripts":{"test":"echo \"Error: no test specified\" && exit 1","check":"eslint ."}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if got := app.PtyDetectGate(nodeDummyDir); got != "npm run check" {
		t.Fatalf("dummy node test gate = %q, want npm run check", got)
	}

	nodeRealDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(nodeRealDir, "package.json"), []byte(`{"scripts":{"test":"vitest run"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nodeRealDir, "pnpm-lock.yaml"), []byte("lockfileVersion: 9\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if got := app.PtyDetectGate(nodeRealDir); got != "pnpm test" {
		t.Fatalf("pnpm node test gate = %q, want pnpm test", got)
	}

	plainDir := t.TempDir()
	if got := app.PtyDetectGate(plainDir); got != "git status --short" {
		t.Fatalf("plain fallback gate = %q, want git status --short", got)
	}
}

func TestApp_PtyPrepareWorktree(t *testing.T) {
	app := &App{}

	// 1. Non-git folder falls back gracefully.
	nonGit := t.TempDir()
	rawFallback, err := app.PtyPrepareWorktree(nonGit, "../bad/token")
	if err != nil {
		t.Fatalf("unexpected error on non-git dir: %v", err)
	}
	var resFallback ptyWorktreeResult
	if err := json.Unmarshal([]byte(rawFallback), &resFallback); err != nil {
		t.Fatalf("unmarshal fallback: %v", err)
	}
	if resFallback.Isolated || resFallback.Dir != filepath.Clean(nonGit) {
		t.Fatalf("expected non-isolated fallback %q, got %+v", nonGit, resFallback)
	}

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}

	// 2. Real git repo creates and reuses <gitRoot>/.worktrees/<safeID> without path traversal.
	repo := t.TempDir()
	runGit := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", repo}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v\n%s", args, err, string(out))
		}
	}
	runGit("init")
	runGit("config", "user.email", "test@example.com")
	runGit("config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("hello\n"), 0644); err != nil {
		t.Fatal(err)
	}
	runGit("add", "README.md")
	runGit("commit", "-m", "init")

	raw1, err := app.PtyPrepareWorktree(repo, "loop_alpha-1")
	if err != nil {
		t.Fatalf("PtyPrepareWorktree failed: %v", err)
	}
	var res1 ptyWorktreeResult
	if err := json.Unmarshal([]byte(raw1), &res1); err != nil {
		t.Fatal(err)
	}
	wantWT := filepath.Join(filepath.Clean(repo), ".worktrees", "loop_alpha-1")
	if !res1.Isolated || res1.Dir != wantWT {
		t.Fatalf("expected isolated worktree %q, got %+v", wantWT, res1)
	}
	excludeBytes, err := os.ReadFile(filepath.Join(repo, ".git", "info", "exclude"))
	if err != nil || !strings.Contains(string(excludeBytes), ".worktrees/") {
		t.Fatalf("expected .git/info/exclude to ignore .worktrees/, err=%v content=%q", err, string(excludeBytes))
	}

	// 3. Reusing existing worktree or passing a path inside .worktrees must not double-nest.
	raw2, err := app.PtyPrepareWorktree(wantWT, "loop_beta-2")
	if err != nil {
		t.Fatalf("nested PtyPrepareWorktree failed: %v", err)
	}
	var res2 ptyWorktreeResult
	if err := json.Unmarshal([]byte(raw2), &res2); err != nil {
		t.Fatal(err)
	}
	if !res2.Isolated || res2.Dir != wantWT {
		t.Fatalf("expected nested guard to keep %q, got %+v", wantWT, res2)
	}
}
