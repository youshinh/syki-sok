package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syki-sok/pkg/dialog"
	"syki-sok/pkg/procutil"
	"syki-sok/pkg/ptyterm"
	"time"
)

type ptyDirSuggestion struct {
	Path   string `json:"path"`
	Label  string `json:"label"`
	Reason string `json:"reason"`
}

type ptyWorktreeResult struct {
	Dir      string `json:"dir"`
	Isolated bool   `json:"isolated"`
}

func (a *App) ensurePTYManager() *ptyterm.Manager {
	a.ptyMu.Lock()
	defer a.ptyMu.Unlock()
	if a.ptyMgr == nil {
		a.ptyMgr = ptyterm.NewManager()
	}
	return a.ptyMgr
}

func (a *App) closeAllPTYs() {
	a.ptyMu.Lock()
	mgr := a.ptyMgr
	a.ptyMu.Unlock()
	if mgr != nil {
		mgr.CloseAll()
	}
}

// PtyStart launches a new PTY session for the given preset ("cc"|"codex"|"agy"|"shell") and dir.
// Returns JSON-encoded ptyterm.SessionInfo.
func (a *App) PtyStart(preset, dir string, cols, rows int) (string, error) {
	return a.PtyStartWithOptions("", preset, dir, "", "", false, cols, rows)
}

// PtyStartWithOptions launches or resumes a PTY session with optional explicit ID, label, and CLI session ID.
func (a *App) PtyStartWithOptions(explicitID, preset, dir, label, cliSessionID string, resume bool, cols, rows int) (string, error) {
	mgr := a.ensurePTYManager()
	explicitID = sanitizePTYToken(explicitID)
	cliSessionID = sanitizePTYToken(cliSessionID)
	workDir := a.resolvePTYDir(dir)
	if !resume && (preset == "cc" || preset == "claude" || preset == "claude-code") && cliSessionID == "" {
		cliSessionID = newUUIDv4()
	}
	normPreset, cmd, args := ptyterm.ResolvePresetWithResume(preset, cliSessionID, resume)
	folderName := filepath.Base(workDir)
	if folderName == "" || folderName == "." || folderName == string(filepath.Separator) {
		folderName = workDir
	}
	title := fmt.Sprintf("%s (%s)", normPreset, folderName)

	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	sid := mgr.AllocateID(normPreset, explicitID)
	upsertPTYLedger(ptyLedgerEntry{
		ID:           sid,
		Label:        label,
		Preset:       normPreset,
		Dir:          workDir,
		CLISessionID: cliSessionID,
		Status:       "running",
	})

	batcher := newPTYBatcher(24*time.Millisecond, 16384, func(chunk []byte) {
		if len(chunk) == 0 {
			return
		}
		b64 := base64.StdEncoding.EncodeToString(chunk)
		a.dispatchEval(fmt.Sprintf("if (window.__onPtyData) { window.__onPtyData(%q, %q); }", sid, b64))
	})

	info, err := mgr.Start(normPreset, normPreset, title, ptyterm.Options{
		ExplicitID:   sid,
		Label:        label,
		CLISessionID: cliSessionID,
		Command:      cmd,
		Args:         args,
		Dir:          workDir,
		Cols:         uint16(cols),
		Rows:         uint16(rows),
		OnData: func(b []byte) {
			batcher.Push(b)
		},
		OnExit: func(code int, exitErr error) {
			batcher.Flush()
			errMsg := ""
			if exitErr != nil {
				errMsg = exitErr.Error()
			}
			updatePTYLedgerFields(sid, "closed", "", false)
			a.dispatchEval(fmt.Sprintf("if (window.__onPtyExit) { window.__onPtyExit(%q, %d, %q); }", sid, code, errMsg))
		},
	})
	if err != nil {
		removePTYLedger(sid)
		return "", err
	}
	raw, err := json.Marshal(info)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// PtyWrite decodes base64 input and writes it to the target PTY session.
func (a *App) PtyWrite(id, b64Data string) error {
	if id == "" || b64Data == "" {
		return nil
	}
	raw, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return err
	}
	return a.ensurePTYManager().Write(id, raw)
}

// PtyResize updates the terminal grid dimensions of the target PTY session.
func (a *App) PtyResize(id string, cols, rows int) error {
	if id == "" || cols <= 0 || rows <= 0 {
		return nil
	}
	return a.ensurePTYManager().Resize(id, uint16(cols), uint16(rows))
}

// PtyClose terminates and removes a PTY session.
func (a *App) PtyClose(id string) error {
	if id == "" {
		return nil
	}
	updatePTYLedgerFields(id, "closed", "", false)
	return a.ensurePTYManager().Close(id)
}

// PtySleep terminates the OS PTY process to free memory while marking the session dormant for later resume.
func (a *App) PtySleep(id string) error {
	if id == "" {
		return nil
	}
	updatePTYLedgerFields(id, "dormant", "", false)
	return a.ensurePTYManager().Close(id)
}

// PtyRename updates the user-facing label on both the live session and persistent ledger.
func (a *App) PtyRename(id, label string) error {
	if id == "" {
		return nil
	}
	a.ensurePTYManager().Rename(id, label)
	updatePTYLedgerFields(id, "", label, true)
	return nil
}

// PtyHistory returns JSON-encoded ledger entries for dormant or closed sessions.
func (a *App) PtyHistory() string {
	entries := readPTYLedger()
	if len(entries) == 0 {
		return "[]"
	}
	live := make(map[string]bool)
	for _, s := range a.ensurePTYManager().List() {
		if s.Running {
			live[s.ID] = true
		}
	}
	out := make([]ptyLedgerEntry, 0, len(entries))
	for _, e := range entries {
		if !live[e.ID] {
			out = append(out, e)
		}
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

// PtyDeleteHistory deletes a session entry from the persistent ledger.
func (a *App) PtyDeleteHistory(id string) {
	removePTYLedger(id)
}

// PtyList returns JSON-encoded metadata for all registered PTY sessions.
func (a *App) PtyList() string {
	raw, err := json.Marshal(a.ensurePTYManager().List())
	if err != nil {
		return "[]"
	}
	return string(raw)
}

// PtyPickFolder opens the native OS folder chooser for selecting an agent working directory.
func (a *App) PtyPickFolder() (string, error) {
	return dialog.OpenFolderDialog("作業フォルダを選択")
}

// PtySuggestDirs returns candidate working directories derived from the active note path,
// its nearest git root, the configured scrap directory, and the user's home/cwd.
func (a *App) PtySuggestDirs(activeFilePath string) string {
	seen := make(map[string]bool)
	out := make([]ptyDirSuggestion, 0, 4)
	add := func(dirPath, reason string) {
		if dirPath == "" {
			return
		}
		clean := filepath.Clean(dirPath)
		st, err := os.Stat(clean)
		if err != nil || !st.IsDir() {
			return
		}
		key := clean
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, ptyDirSuggestion{
			Path:   clean,
			Label:  filepath.Base(clean),
			Reason: reason,
		})
	}

	if activeFilePath != "" {
		noteDir := activeFilePath
		if st, err := os.Stat(activeFilePath); err == nil && !st.IsDir() {
			noteDir = filepath.Dir(activeFilePath)
		} else if err != nil {
			noteDir = filepath.Dir(activeFilePath)
		}
		if gitRoot := findNearestGitRoot(noteDir); gitRoot != "" {
			add(gitRoot, "git")
		}
		add(noteDir, "note")
	}
	if a.scrapDir != "" {
		add(a.scrapDir, "scraps")
	}
	if cwd, err := os.Getwd(); err == nil {
		add(cwd, "cwd")
	}
	if home, err := os.UserHomeDir(); err == nil {
		add(home, "home")
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

func (a *App) resolvePTYDir(dir string) string {
	if dir != "" {
		clean := filepath.Clean(dir)
		if st, err := os.Stat(clean); err == nil {
			if st.IsDir() {
				return clean
			}
			return filepath.Dir(clean)
		}
	}
	if a.scrapDir != "" {
		if st, err := os.Stat(a.scrapDir); err == nil && st.IsDir() {
			return a.scrapDir
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	if home, err := os.UserHomeDir(); err == nil {
		return home
	}
	return "."
}

func findNearestGitRoot(startDir string) string {
	cur := filepath.Clean(startDir)
	for i := 0; i < 12; i++ {
		if _, err := os.Stat(filepath.Join(cur, ".git")); err == nil {
			return cur
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			break
		}
		cur = parent
	}
	return ""
}

func ptyFileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

// PtyDetectGate inspects the target directory (and its nearest git root) for
// canonical build/test verification commands without requiring user input.
func (a *App) PtyDetectGate(dir string) string {
	workDir := a.resolvePTYDir(dir)
	candidates := []string{workDir}
	if gitRoot := findNearestGitRoot(workDir); gitRoot != "" && gitRoot != workDir {
		candidates = append(candidates, gitRoot)
	}
	for _, d := range candidates {
		if ptyFileExists(filepath.Join(d, "tools", "pre_release_check.ps1")) {
			return "pwsh -File tools/pre_release_check.ps1"
		}
		if ptyFileExists(filepath.Join(d, "go.mod")) {
			return "go test ./..."
		}
		pkgPath := filepath.Join(d, "package.json")
		if ptyFileExists(pkgPath) {
			if raw, err := os.ReadFile(pkgPath); err == nil {
				var pkg struct {
					Scripts map[string]string `json:"scripts"`
				}
				if json.Unmarshal(raw, &pkg) == nil && pkg.Scripts != nil {
					tCmd := strings.TrimSpace(pkg.Scripts["test"])
					if tCmd != "" && !strings.Contains(tCmd, "no test specified") {
						if ptyFileExists(filepath.Join(d, "pnpm-lock.yaml")) {
							return "pnpm test"
						}
						if ptyFileExists(filepath.Join(d, "yarn.lock")) {
							return "yarn test"
						}
						return "npm test"
					}
					if strings.TrimSpace(pkg.Scripts["check"]) != "" {
						return "npm run check"
					}
					if strings.TrimSpace(pkg.Scripts["build"]) != "" {
						return "npm run build"
					}
				}
			}
		}
		if ptyFileExists(filepath.Join(d, "pyproject.toml")) || ptyFileExists(filepath.Join(d, "pytest.ini")) {
			return "pytest"
		}
		if ptyFileExists(filepath.Join(d, "Cargo.toml")) {
			return "cargo test"
		}
		if ptyFileExists(filepath.Join(d, "Makefile")) {
			return "make test"
		}
	}
	return "git status --short"
}

func marshalPTYWorktree(dir string, isolated bool) (string, error) {
	raw, err := json.Marshal(ptyWorktreeResult{Dir: dir, Isolated: isolated})
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func ensureWorktreeExclude(gitDir string) {
	infoDir := filepath.Join(gitDir, "info")
	excludePath := filepath.Join(infoDir, "exclude")
	raw, err := os.ReadFile(excludePath)
	if err == nil {
		for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
			t := strings.TrimSpace(line)
			if t == ".worktrees/" || t == ".worktrees" || t == "/.worktrees/" {
				return
			}
		}
	}
	if err := os.MkdirAll(infoDir, 0o755); err != nil {
		return
	}
	content := string(raw)
	if len(content) > 0 && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	content += ".worktrees/\n"
	_ = os.WriteFile(excludePath, []byte(content), 0o644)
}

// PtyPrepareWorktree creates or reuses a detached git worktree under <gitRoot>/.worktrees/<safeID>
// for isolated parallel agent loops, falling back cleanly when git isolation is unavailable.
func (a *App) PtyPrepareWorktree(dir, loopID string) (string, error) {
	workDir := a.resolvePTYDir(dir)
	safeID := sanitizePTYToken(loopID)
	if safeID == "" {
		safeID = fmt.Sprintf("loop-%d", time.Now().Unix())
	}
	if filepath.Base(filepath.Dir(workDir)) == ".worktrees" {
		return marshalPTYWorktree(workDir, true)
	}
	gitRoot := findNearestGitRoot(workDir)
	if gitRoot == "" {
		return marshalPTYWorktree(workDir, false)
	}
	gitDotPath := filepath.Join(gitRoot, ".git")
	if st, err := os.Stat(gitDotPath); err == nil && !st.IsDir() {
		// Already inside a linked worktree; avoid nesting .worktrees inside another worktree.
		return marshalPTYWorktree(workDir, true)
	}

	runGit := func(args ...string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "git", append([]string{"-C", gitRoot}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		procutil.KillTreeOnCancel(cmd)
		return cmd.Run()
	}

	if err := runGit("rev-parse", "--verify", "HEAD"); err != nil {
		return marshalPTYWorktree(workDir, false)
	}
	ensureWorktreeExclude(gitDotPath)

	wtDir := filepath.Join(gitRoot, ".worktrees", safeID)
	if _, err := os.Stat(filepath.Join(wtDir, ".git")); err == nil {
		return marshalPTYWorktree(wtDir, true)
	}
	_ = os.MkdirAll(filepath.Dir(wtDir), 0o755)
	_ = runGit("worktree", "prune")
	if err := runGit("worktree", "add", "--detach", wtDir, "HEAD"); err != nil {
		return marshalPTYWorktree(workDir, false)
	}
	return marshalPTYWorktree(wtDir, true)
}
