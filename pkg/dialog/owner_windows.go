//go:build windows

package dialog

import (
	"sync/atomic"
	"unsafe"
)

var (
	procIsWindow        = user32.NewProc("IsWindow")
	procIsWindowVisible = user32.NewProc("IsWindowVisible")

	ownerWindow atomic.Uintptr
)

// SetOwner records the application's main window. Every dialog in this package is then shown owned by it.
//
// An ownerless dialog is a separate top-level window that is not tied to the application at all: clicking the
// application's window brings that window in front of the dialog and hides it, the application keeps accepting
// input while the dialog waits, and each further click on Save / Open queues another dialog that appears as soon as
// the previous one is closed. An owned dialog always stays above its owner, and Windows disables the owner while it
// is shown, so none of that can happen.
func SetOwner(hwnd uintptr) { ownerWindow.Store(hwnd) }

// owner returns the window to own a dialog, or 0 when there is none that could: not set, destroyed, or hidden (to the
// tray). A hidden owner would leave the dialog without a place on the screen, so an ownerless dialog is the better result.
func owner() uintptr {
	h := ownerWindow.Load()
	if h == 0 {
		return 0
	}
	if isWin, _, _ := procIsWindow.Call(h); isWin == 0 {
		return 0
	}
	if visible, _, _ := procIsWindowVisible.Call(h); visible == 0 {
		return 0
	}
	return h
}

var (
	procGetCursorPos = user32.NewProc("GetCursorPos")
	procSetCursorPos = user32.NewProc("SetCursorPos")
)

type cursorPoint struct{ x, y int32 }

// showPointer makes sure the mouse pointer is on screen when a dialog opens. Windows hides the pointer while text is being typed ("Hide pointer while
// typing" in the mouse settings; the text box of the page does it) and shows it again at the next movement of the mouse. A dialog that is opened from
// the keyboard (Ctrl+S, Ctrl+O) after some typing therefore comes up with no pointer in sight, and the person cannot tell where it is. A movement of
// the mouse is what brings it back, so the pointer is moved one pixel and put back, which ends the hiding without being seen.
func showPointer() {
	var p cursorPoint
	if ok, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&p))); ok == 0 {
		return
	}
	_, _, _ = procSetCursorPos.Call(uintptr(p.x+1), uintptr(p.y))
	_, _, _ = procSetCursorPos.Call(uintptr(p.x), uintptr(p.y))
}
