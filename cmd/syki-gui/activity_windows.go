package main

import (
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var procActGetWindowText = modUser32.NewProc("GetWindowTextW")

// The front app, the plain way: GetForegroundWindow, the window's title, and the name of the program that owns it (asked with the
// least right there is, PROCESS_QUERY_LIMITED_INFORMATION). Nothing here hooks, injects, reads another process or watches input.

func foregroundSupported() bool { return true }

func foregroundSample() (app, title string, self bool, ok bool) {
	return sampleWindow(windows.GetForegroundWindow())
}

// sampleWindow is the program's name and the title of a window (a test hands it a window of its own choosing).
func sampleWindow(hwnd windows.HWND) (app, title string, self bool, ok bool) {
	if hwnd == 0 {
		return "", "", false, false
	}
	var pid uint32
	if _, err := windows.GetWindowThreadProcessId(hwnd, &pid); err != nil || pid == 0 {
		return "", "", false, false
	}
	if int(pid) == os.Getpid() {
		return "", "", true, true
	}
	buf := make([]uint16, 512)
	n, _, _ := procActGetWindowText.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n > 0 && int(n) < len(buf) {
		title = windows.UTF16ToString(buf[:n])
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", title, false, title != ""
	}
	defer windows.CloseHandle(h)
	path := make([]uint16, 1024)
	size := uint32(len(path))
	if err := windows.QueryFullProcessImageName(h, 0, &path[0], &size); err != nil {
		return "", title, false, title != ""
	}
	return filepath.Base(windows.UTF16ToString(path[:size])), title, false, true
}
