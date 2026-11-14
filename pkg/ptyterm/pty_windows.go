//go:build windows

package ptyterm

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsSession struct {
	id      string
	hPC     windows.Handle
	inPipe  windows.Handle
	outPipe windows.Handle
	proc    windows.Handle
	thread  windows.Handle
	mu      sync.Mutex
	closed  bool
}

func startPlatformSession(id string, opts Options) (Session, error) {
	cmdPath := opts.Command
	if resolved, err := exec.LookPath(cmdPath); err == nil {
		cmdPath = resolved
	}

	var inRead, inWrite windows.Handle
	var outRead, outWrite windows.Handle
	if err := windows.CreatePipe(&inRead, &inWrite, nil, 0); err != nil {
		return nil, fmt.Errorf("create input pipe: %w", err)
	}
	if err := windows.CreatePipe(&outRead, &outWrite, nil, 0); err != nil {
		_ = windows.CloseHandle(inRead)
		_ = windows.CloseHandle(inWrite)
		return nil, fmt.Errorf("create output pipe: %w", err)
	}

	var hPC windows.Handle
	coord := windows.Coord{X: int16(opts.Cols), Y: int16(opts.Rows)}
	if err := windows.CreatePseudoConsole(coord, inRead, outWrite, 0, &hPC); err != nil {
		_ = windows.CloseHandle(inRead)
		_ = windows.CloseHandle(inWrite)
		_ = windows.CloseHandle(outRead)
		_ = windows.CloseHandle(outWrite)
		return nil, fmt.Errorf("CreatePseudoConsole: %w", err)
	}
	// The pseudo console holds duplicates/ownership of the child-side pipe ends.
	_ = windows.CloseHandle(inRead)
	_ = windows.CloseHandle(outWrite)

	attrList, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		windows.ClosePseudoConsole(hPC)
		_ = windows.CloseHandle(inWrite)
		_ = windows.CloseHandle(outRead)
		return nil, fmt.Errorf("NewProcThreadAttributeList: %w", err)
	}
	defer attrList.Delete()

	if err := attrList.Update(
		windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
		unsafe.Pointer(hPC),
		unsafe.Sizeof(hPC),
	); err != nil {
		windows.ClosePseudoConsole(hPC)
		_ = windows.CloseHandle(inWrite)
		_ = windows.CloseHandle(outRead)
		return nil, fmt.Errorf("UpdateProcThreadAttribute: %w", err)
	}

	cmdLine := buildPlatformWindowsCommandLine(cmdPath, opts.Args)
	cmdPtr, err := windows.UTF16PtrFromString(cmdLine)
	if err != nil {
		windows.ClosePseudoConsole(hPC)
		_ = windows.CloseHandle(inWrite)
		_ = windows.CloseHandle(outRead)
		return nil, err
	}

	var dirPtr *uint16
	if opts.Dir != "" {
		dirPtr, err = windows.UTF16PtrFromString(opts.Dir)
		if err != nil {
			windows.ClosePseudoConsole(hPC)
			_ = windows.CloseHandle(inWrite)
			_ = windows.CloseHandle(outRead)
			return nil, err
		}
	}

	var si windows.StartupInfoEx
	si.Cb = uint32(unsafe.Sizeof(si))
	si.Flags = windows.STARTF_USESTDHANDLES
	si.ProcThreadAttributeList = attrList.List()

	var pi windows.ProcessInformation
	flags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT)
	if err := windows.CreateProcess(
		nil,
		cmdPtr,
		nil,
		nil,
		false,
		flags,
		nil,
		dirPtr,
		&si.StartupInfo,
		&pi,
	); err != nil {
		windows.ClosePseudoConsole(hPC)
		_ = windows.CloseHandle(inWrite)
		_ = windows.CloseHandle(outRead)
		return nil, fmt.Errorf("CreateProcess(%q): %w", cmdPath, err)
	}

	s := &windowsSession{
		id:      id,
		hPC:     hPC,
		inPipe:  inWrite,
		outPipe: outRead,
		proc:    pi.Process,
		thread:  pi.Thread,
	}

	go s.readLoop(opts.OnData)
	go s.waitLoop(opts.OnExit)
	return s, nil
}

func buildPlatformWindowsCommandLine(cmdPath string, args []string) string {
	inner := buildWindowsCommandLine(cmdPath, args)
	lower := strings.ToLower(cmdPath)
	if strings.HasSuffix(lower, ".cmd") || strings.HasSuffix(lower, ".bat") {
		comspec := os.Getenv("COMSPEC")
		if comspec == "" {
			comspec = "cmd.exe"
		}
		return fmt.Sprintf(`%s /d /s /c "%s"`, windows.EscapeArg(comspec), inner)
	}
	return inner
}

func buildWindowsCommandLine(cmdPath string, args []string) string {
	parts := make([]string, 0, 1+len(args))
	parts = append(parts, windows.EscapeArg(cmdPath))
	for _, a := range args {
		parts = append(parts, windows.EscapeArg(a))
	}
	return strings.Join(parts, " ")
}

func (s *windowsSession) ID() string { return s.id }

func (s *windowsSession) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	s.mu.Lock()
	closed := s.closed
	h := s.inPipe
	s.mu.Unlock()
	if closed || h == 0 {
		return 0, fmt.Errorf("pty session closed")
	}
	var written uint32
	if err := windows.WriteFile(h, p, &written, nil); err != nil {
		return int(written), err
	}
	return int(written), nil
}

func (s *windowsSession) Resize(cols, rows uint16) error {
	s.mu.Lock()
	closed := s.closed
	hPC := s.hPC
	s.mu.Unlock()
	if closed || hPC == 0 {
		return nil
	}
	return windows.ResizePseudoConsole(hPC, windows.Coord{X: int16(cols), Y: int16(rows)})
}

func (s *windowsSession) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	hPC := s.hPC
	inPipe := s.inPipe
	outPipe := s.outPipe
	proc := s.proc
	s.hPC = 0
	s.inPipe = 0
	s.outPipe = 0
	s.mu.Unlock()

	if proc != 0 {
		_ = windows.TerminateProcess(proc, 1)
	}
	if hPC != 0 {
		windows.ClosePseudoConsole(hPC)
	}
	if inPipe != 0 {
		_ = windows.CloseHandle(inPipe)
	}
	if outPipe != 0 {
		_ = windows.CloseHandle(outPipe)
	}
	return nil
}

func (s *windowsSession) readLoop(onData func([]byte)) {
	buf := make([]byte, 8192)
	for {
		s.mu.Lock()
		h := s.outPipe
		closed := s.closed
		s.mu.Unlock()
		if closed || h == 0 {
			return
		}
		var n uint32
		err := windows.ReadFile(h, buf, &n, nil)
		if n > 0 && onData != nil {
			cp := make([]byte, n)
			copy(cp, buf[:n])
			onData(cp)
		}
		if err != nil {
			return
		}
	}
}

func (s *windowsSession) waitLoop(onExit func(int, error)) {
	s.mu.Lock()
	proc := s.proc
	s.mu.Unlock()
	if proc == 0 {
		return
	}
	_, waitErr := windows.WaitForSingleObject(proc, windows.INFINITE)
	var exitCode uint32
	if waitErr == nil {
		_ = windows.GetExitCodeProcess(proc, &exitCode)
	}
	s.mu.Lock()
	procToClose := s.proc
	threadToClose := s.thread
	s.proc = 0
	s.thread = 0
	s.mu.Unlock()
	if threadToClose != 0 {
		_ = windows.CloseHandle(threadToClose)
	}
	if procToClose != 0 {
		_ = windows.CloseHandle(procToClose)
	}
	_ = s.Close()
	if onExit != nil {
		onExit(int(exitCode), waitErr)
	}
}
