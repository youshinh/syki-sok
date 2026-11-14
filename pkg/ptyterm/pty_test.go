package ptyterm

import (
	"bytes"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestResolvePresetAndDefaultShell(t *testing.T) {
	if DefaultShell() == "" {
		t.Fatal("DefaultShell must not be empty")
	}
	for _, p := range []string{"cc", "codex", "agy", "shell"} {
		lbl, cmd, _ := ResolvePreset(p)
		if lbl == "" || cmd == "" {
			t.Fatalf("ResolvePreset(%q) returned empty label/cmd: %q / %q", p, lbl, cmd)
		}
	}
}

func TestManagerStartWriteResizeAndClose(t *testing.T) {
	m := NewManager()
	defer m.CloseAll()

	var mu sync.Mutex
	var out bytes.Buffer
	exited := make(chan int, 1)

	cmd := "sh"
	args := []string{"-c", "echo pty-ready; read line; echo got:$line"}
	if runtime.GOOS == "windows" {
		cmd = "cmd.exe"
		args = []string{"/Q", "/C", "echo pty-ready"}
	}

	info, err := m.Start("term", "shell", "shell (test)", Options{
		Command: cmd,
		Args:    args,
		Dir:     t.TempDir(),
		Cols:    100,
		Rows:    30,
		OnData: func(b []byte) {
			mu.Lock()
			out.Write(b)
			mu.Unlock()
		},
		OnExit: func(code int, _ error) {
			select {
			case exited <- code:
			default:
			}
		},
	})
	if err != nil {
		t.Fatalf("Manager.Start failed: %v", err)
	}
	if info.ID == "" || !info.Running {
		t.Fatalf("unexpected info: %+v", info)
	}

	if err := m.Resize(info.ID, 120, 40); err != nil {
		t.Fatalf("Manager.Resize failed: %v", err)
	}

	if runtime.GOOS != "windows" {
		_ = m.Write(info.ID, []byte("hello-pty\r\n"))
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		got := out.String()
		mu.Unlock()
		if strings.Contains(got, "pty-ready") {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	mu.Lock()
	got := out.String()
	mu.Unlock()
	if !strings.Contains(got, "pty-ready") {
		t.Fatalf("expected pty-ready in output, got %q", got)
	}

	select {
	case <-exited:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for PTY process exit")
	}

	if err := m.Close(info.ID); err != nil {
		t.Fatalf("Manager.Close failed: %v", err)
	}
	if len(m.List()) != 0 {
		t.Fatalf("expected 0 sessions after Close, got %d", len(m.List()))
	}
}

func TestResolvePresetWithResume(t *testing.T) {
	lbl, _, args := ResolvePresetWithResume("cc", "uuid-123", false)
	if lbl != "cc" || len(args) != 2 || args[0] != "--session-id" || args[1] != "uuid-123" {
		t.Fatalf("unexpected cc start args: %s %v", lbl, args)
	}
	_, _, args = ResolvePresetWithResume("cc", "uuid-123", true)
	if len(args) != 2 || args[0] != "--resume" || args[1] != "uuid-123" {
		t.Fatalf("unexpected cc resume args: %v", args)
	}
	_, _, args = ResolvePresetWithResume("codex", "", true)
	if len(args) != 2 || args[0] != "resume" || args[1] != "--last" {
		t.Fatalf("unexpected codex resume args: %v", args)
	}
}
