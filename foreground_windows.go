//go:build windows

package main

import (
	"unsafe"
)

var (
	procGetWindowThreadProcessID = modUser32.NewProc("GetWindowThreadProcessId")
	procAttachThreadInput        = modUser32.NewProc("AttachThreadInput")
	procBringWindowToTop         = modUser32.NewProc("BringWindowToTop")
)

// bringToForeground makes hwnd the active window when plain SetForegroundWindow was refused (the process had no right to it: a file was
// double-clicked while syki ran in the tray, or the shell started it behind other windows). The refusal only stands for a process that
// is not the one the user is working with, so the thread that owns the foreground window is joined (AttachThreadInput) for the moment
// the call takes, which is the documented way to share its right.
//
// It is the second line: the sending process hands its right over first (ipc.AllowForeground), and this covers what that cannot (a
// request from a program that had no right to give, the tray menu on a locked-down desktop).
func bringToForeground(hwnd uintptr) {
	fg, _, _ := procGetForegroundWindow.Call()
	if fg == hwnd {
		return
	}
	self, _, _ := procGetCurrentThreadId.Call()
	var fgThread uintptr
	if fg != 0 {
		var pid uint32
		fgThread, _, _ = procGetWindowThreadProcessID.Call(fg, uintptr(unsafe.Pointer(&pid)))
	}
	attached := false
	if fgThread != 0 && fgThread != self {
		r, _, _ := procAttachThreadInput.Call(self, fgThread, 1)
		attached = r != 0
	}
	_, _, _ = procBringWindowToTop.Call(hwnd)
	_, _, _ = procSetForegroundWindow.Call(hwnd)
	if attached {
		_, _, _ = procAttachThreadInput.Call(self, fgThread, 0)
	}
}
