package main

import (
	"os"
	"regexp"
	"path/filepath"
	"testing"
)

// A double-clicked file reaches the running instance from a second process that holds the user's attention; Windows lets only such a
// process put a window in front, so that process hands the right over BEFORE it sends the request (and the instance has a fallback).
func TestTheSendingProcessHandsOverTheRightToTheFront(t *testing.T) {
	read := func(p string) string {
		b, err := os.ReadFile(p)
		if err != nil {
			b, err = os.ReadFile(filepath.Join("..", "..", p))
		}
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	main := read("main.go")
	if !regexp.MustCompile(`(?s)ipc\.AllowForeground\(session\.PID\).*?ipc\.Send\(targetPort, ipcMsg`).MatchString(main) {
		t.Error("main.go must hand over the right (ipc.AllowForeground) before ipc.Send")
	}
	if !regexp.MustCompile(`(?s)ipc\.AllowForeground\(pid\).*?ipc\.Send\(port, msg`).MatchString(read("cmd/syki/run.go")) {
		t.Error("cmd/syki/run.go must hand over the right before ipc.Send")
	}
	if !regexp.MustCompile(`(?s)func showAndRestoreWindow.*?bringToForeground\(uintptr\(hwnd\)\)`).MatchString(read("window_windows.go")) {
		t.Error("showAndRestoreWindow must fall back to bringToForeground when SetForegroundWindow was refused")
	}
}
