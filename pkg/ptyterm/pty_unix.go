//go:build !windows

package ptyterm

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

type unixSession struct {
	id     string
	ptmx   *os.File
	cmd    *exec.Cmd
	mu     sync.Mutex
	closed bool
}

func startPlatformSession(id string, opts Options) (Session, error) {
	cmd := exec.Command(opts.Command, opts.Args...)
	if opts.Dir != "" {
		cmd.Dir = opts.Dir
	}
	env := os.Environ()
	env = append(env, "TERM=xterm-256color")
	if len(opts.Env) > 0 {
		env = append(env, opts.Env...)
	}
	cmd.Env = env

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: opts.Cols,
		Rows: opts.Rows,
	})
	if err != nil {
		return nil, fmt.Errorf("pty.StartWithSize(%q): %w", opts.Command, err)
	}

	s := &unixSession{
		id:   id,
		ptmx: ptmx,
		cmd:  cmd,
	}

	go s.readLoop(opts.OnData)
	go s.waitLoop(opts.OnExit)
	return s, nil
}

func (s *unixSession) ID() string { return s.id }

func (s *unixSession) Write(p []byte) (int, error) {
	s.mu.Lock()
	closed := s.closed
	f := s.ptmx
	s.mu.Unlock()
	if closed || f == nil {
		return 0, fmt.Errorf("pty session closed")
	}
	return f.Write(p)
}

func (s *unixSession) Resize(cols, rows uint16) error {
	s.mu.Lock()
	closed := s.closed
	f := s.ptmx
	s.mu.Unlock()
	if closed || f == nil {
		return nil
	}
	return pty.Setsize(f, &pty.Winsize{Cols: cols, Rows: rows})
}

func (s *unixSession) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	f := s.ptmx
	cmd := s.cmd
	s.ptmx = nil
	s.mu.Unlock()

	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	if f != nil {
		return f.Close()
	}
	return nil
}

func (s *unixSession) readLoop(onData func([]byte)) {
	buf := make([]byte, 8192)
	for {
		s.mu.Lock()
		f := s.ptmx
		closed := s.closed
		s.mu.Unlock()
		if closed || f == nil {
			return
		}
		n, err := f.Read(buf)
		if n > 0 && onData != nil {
			cp := make([]byte, n)
			copy(cp, buf[:n])
			onData(cp)
		}
		if err != nil {
			if err != io.EOF {
				return
			}
			return
		}
	}
}

func (s *unixSession) waitLoop(onExit func(int, error)) {
	err := s.cmd.Wait()
	code := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		} else {
			code = 1
		}
	}
	_ = s.Close()
	if onExit != nil {
		onExit(code, err)
	}
}
