package ptyterm

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"sync/atomic"
)

// Options configures a newly spawned PTY session.
type Options struct {
	ExplicitID   string
	Label        string
	CLISessionID string
	Command      string
	Args         []string
	Dir          string
	Env          []string
	Cols         uint16
	Rows         uint16
	OnData       func([]byte)
	OnExit       func(exitCode int, err error)
}

// Session represents a live OS pseudo-terminal session.
type Session interface {
	ID() string
	Write(p []byte) (int, error)
	Resize(cols, rows uint16) error
	Close() error
}

// SessionInfo describes a managed PTY session for UI listing.
type SessionInfo struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Label        string `json:"label,omitempty"`
	Preset       string `json:"preset"`
	Dir          string `json:"dir"`
	CLISessionID string `json:"cliSessionId,omitempty"`
	Running      bool   `json:"running"`
}

// DefaultShell returns the OS-appropriate interactive shell command.
func DefaultShell() string {
	if runtime.GOOS == "windows" {
		if p, err := exec.LookPath("pwsh.exe"); err == nil {
			return p
		}
		if p, err := exec.LookPath("powershell.exe"); err == nil {
			return p
		}
		if comspec := os.Getenv("COMSPEC"); comspec != "" {
			return comspec
		}
		return "cmd.exe"
	}
	if sh := os.Getenv("SHELL"); sh != "" {
		return sh
	}
	return "/bin/sh"
}

// ResolvePreset maps a launcher preset ("cc", "codex", "agy", "shell") to a command + args.
func ResolvePreset(preset string) (label string, command string, args []string) {
	return ResolvePresetWithResume(preset, "", false)
}

// ResolvePresetWithResume maps a preset and optional CLI session ID / resume flag to command + args.
func ResolvePresetWithResume(preset, cliSessionID string, resume bool) (label string, command string, args []string) {
	switch preset {
	case "cc", "claude", "claude-code":
		cmd := "claude"
		if p, err := exec.LookPath("claude"); err == nil {
			cmd = p
		}
		if resume {
			if cliSessionID != "" {
				return "cc", cmd, []string{"--resume", cliSessionID}
			}
			return "cc", cmd, []string{"--continue"}
		}
		if cliSessionID != "" {
			return "cc", cmd, []string{"--session-id", cliSessionID}
		}
		return "cc", cmd, nil
	case "codex":
		cmd := "codex"
		if p, err := exec.LookPath("codex"); err == nil {
			cmd = p
		}
		if resume {
			return "codex", cmd, []string{"resume", "--last"}
		}
		return "codex", cmd, nil
	case "agy", "antigravity", "gemini":
		if p, err := exec.LookPath("agy"); err == nil {
			return "agy", p, nil
		}
		return "agy", "agy", nil
	case "shell", "":
		return "shell", DefaultShell(), nil
	default:
		return preset, preset, nil
	}
}

// Manager tracks multiple concurrent PTY sessions.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*managedSession
	seq      atomic.Uint64
}

type managedSession struct {
	info SessionInfo
	sess Session
}

// NewManager creates an empty PTY session manager.
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*managedSession),
	}
}

// AllocateID returns an unused session ID (preserving explicitID when free).
func (m *Manager) AllocateID(idPrefix, explicitID string) string {
	prefix := idPrefix
	if prefix == "" {
		prefix = "pty"
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	if explicitID != "" {
		if _, exists := m.sessions[explicitID]; !exists {
			return explicitID
		}
	}
	for {
		cand := fmt.Sprintf("%s-%d", prefix, m.seq.Add(1))
		if _, taken := m.sessions[cand]; !taken {
			return cand
		}
	}
}

// Start spawns a new PTY session and registers it under a unique ID.
func (m *Manager) Start(idPrefix string, preset string, title string, opts Options) (SessionInfo, error) {
	if opts.Cols == 0 {
		opts.Cols = 80
	}
	if opts.Rows == 0 {
		opts.Rows = 24
	}
	if opts.Command == "" {
		_, cmd, args := ResolvePreset(preset)
		opts.Command = cmd
		if len(opts.Args) == 0 {
			opts.Args = args
		}
	}
	if opts.Dir != "" {
		if st, err := os.Stat(opts.Dir); err != nil || !st.IsDir() {
			return SessionInfo{}, fmt.Errorf("working directory does not exist: %s", opts.Dir)
		}
	}

	id := m.AllocateID(idPrefix, opts.ExplicitID)

	userOnExit := opts.OnExit
	opts.OnExit = func(code int, err error) {
		m.mu.Lock()
		if ms, ok := m.sessions[id]; ok {
			ms.info.Running = false
		}
		m.mu.Unlock()
		if userOnExit != nil {
			userOnExit(code, err)
		}
	}

	sess, err := startPlatformSession(id, opts)
	if err != nil {
		return SessionInfo{}, err
	}

	info := SessionInfo{
		ID:           id,
		Title:        title,
		Label:        opts.Label,
		Preset:       preset,
		Dir:          opts.Dir,
		CLISessionID: opts.CLISessionID,
		Running:      true,
	}
	m.mu.Lock()
	m.sessions[id] = &managedSession{info: info, sess: sess}
	m.mu.Unlock()
	return info, nil
}

// Write sends bytes to the target PTY session.
func (m *Manager) Write(id string, data []byte) error {
	m.mu.RLock()
	ms, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("pty session not found: %s", id)
	}
	_, err := ms.sess.Write(data)
	return err
}

// Resize updates the terminal dimensions of the target PTY session.
func (m *Manager) Resize(id string, cols, rows uint16) error {
	m.mu.RLock()
	ms, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("pty session not found: %s", id)
	}
	return ms.sess.Resize(cols, rows)
}

// Close terminates and removes a PTY session.
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	ms, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if !ok {
		return nil
	}
	return ms.sess.Close()
}

// CloseAll terminates every active PTY session (used during app shutdown).
func (m *Manager) CloseAll() {
	m.mu.Lock()
	all := make([]Session, 0, len(m.sessions))
	for id, ms := range m.sessions {
		all = append(all, ms.sess)
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	for _, s := range all {
		_ = s.Close()
	}
}

// Rename updates the user-facing label of a live PTY session.
func (m *Manager) Rename(id, label string) (SessionInfo, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, ok := m.sessions[id]
	if !ok {
		return SessionInfo{}, false
	}
	ms.info.Label = label
	return ms.info, true
}

// Get returns metadata for a single live PTY session.
func (m *Manager) Get(id string) (SessionInfo, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ms, ok := m.sessions[id]
	if !ok {
		return SessionInfo{}, false
	}
	return ms.info, true
}

// List returns metadata for all registered sessions.
func (m *Manager) List() []SessionInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]SessionInfo, 0, len(m.sessions))
	for _, ms := range m.sessions {
		out = append(out, ms.info)
	}
	return out
}
