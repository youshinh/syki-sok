//go:build windows

package main

import (
	"os"
	"os/exec"
	"testing"
)

// The snapshot of the processes of the session must show this process and a child of it with the right parent, since that is what the selection
// of the WebView2 processes stands on. Nothing here is a WebView2, so the trim has nothing to touch and must simply return.
func TestWebViewProcessListSeesAChildOfThisProcess(t *testing.T) {
	cmd := exec.Command("cmd.exe", "/c", "ping -n 4 127.0.0.1 >nul")
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot start a child: %v", err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()

	all := webViewProcessList()
	if len(all) == 0 {
		t.Fatal("the process snapshot is empty")
	}
	var self, child bool
	for _, p := range all {
		if p.PID == uint32(os.Getpid()) {
			self = true
		}
		if p.PID == uint32(cmd.Process.Pid) && p.Parent == uint32(os.Getpid()) {
			child = true
		}
	}
	if !self || !child {
		t.Fatalf("snapshot of %d processes: this process listed=%v, its child with this process as parent listed=%v", len(all), self, child)
	}
	if got := webViewProcessesOf(uint32(os.Getpid()), all); len(got) != 0 {
		t.Fatalf("a console child is not a WebView2, got %v", got)
	}
	trimWebViewWorkingSets() // nothing to trim: returns without a fault
}
