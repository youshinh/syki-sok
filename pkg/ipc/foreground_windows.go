//go:build windows

package ipc

import "golang.org/x/sys/windows"

var procAllowSetForegroundWindow = windows.NewLazySystemDLL("user32.dll").NewProc("AllowSetForegroundWindow")

// asfwAny is ASFW_ANY, (DWORD)-1: every process may take the foreground.
const asfwAny = 0xFFFFFFFF

// AllowForeground lets the running instance bring its window to the front for the request this process is about to send it.
//
// Why. Windows lets only the process that has the user's attention put a window in front (SetForegroundWindow from another process is
// refused, and the taskbar button just flashes). A double-clicked file starts a new process: it is that one that holds the right, and
// it exits as soon as it has handed the file to the instance that is already running, with the right unused. The instance then showed
// its window, but behind the others and not active. The right is handed over here, before the request. pid is the running instance's
// (0 = any process: the right lasts only until the next key press or click, and only a process that has it can pass it on).
func AllowForeground(pid int) {
	target := uintptr(asfwAny)
	if pid > 0 {
		target = uintptr(pid)
	}
	_, _, _ = procAllowSetForegroundWindow.Call(target)
}
