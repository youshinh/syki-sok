//go:build windows

package main

import (
	"os"
	"regexp"
	"testing"
	"unsafe"
)

func TestShowAndRestoreWindowDoesNotUnconditionallyUseShowNormal(t *testing.T) {
	data, err := os.ReadFile("window_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(data)

	// Invariant: showAndRestoreWindow must not call SW_SHOWNORMAL unconditionally,
	// which forcibly un-maximizes and un-arranges windows back to default size.
	// It must preserve maximized / restored state.
	m := regexp.MustCompile(`func showAndRestoreWindow\([^)]*\)\s*\{([^}]*)\}`).FindStringSubmatch(src)
	if len(m) < 2 {
		t.Fatal("could not find showAndRestoreWindow in window_windows.go")
	}
	fnBody := m[1]

	// Must NOT contain unconditional SW_SHOWNORMAL
	if regexp.MustCompile(`procShowWindow\.Call\([^,]+,\s*SW_SHOWNORMAL\)`).MatchString(fnBody) {
		t.Error("showAndRestoreWindow must NOT unconditionally call SW_SHOWNORMAL (it destroys maximized/snapped state)")
	}

	// Must check IsIconic or IsZoomed to preserve window state
	if !regexp.MustCompile(`procIsZoomed|procIsIconic|isZoomed`).MatchString(fnBody) {
		t.Error("showAndRestoreWindow must inspect window state (IsZoomed/IsIconic) to preserve geometry")
	}
}

func TestWindowStateNullWindowSafety(t *testing.T) {
	// Must not panic on null window handle
	saveCurrentWindowPlacement(0)
	if restoreWindowPlacement(0) {
		t.Error("restoreWindowPlacement(0) must return false")
	}
}

func TestWindowPlacementWiring(t *testing.T) {
	data, err := os.ReadFile("window_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(data)

	if !regexp.MustCompile(`func hideWindowToTray\([^)]*\)\s*\{[^}]*saveCurrentWindowPlacement`).MatchString(src) {
		t.Error("hideWindowToTray must save window placement before hiding")
	}
	if !regexp.MustCompile(`restoreWindowPlacement\(hwnd\)`).MatchString(src) {
		t.Error("runPlatformWindow must restore window placement on startup")
	}
}

func TestCreateStructWLayoutAndCBTHookPlacement(t *testing.T) {
	if unsafe.Sizeof(uintptr(0)) != 8 {
		t.Skip("64-bit Win32 CREATESTRUCTW offsets test")
	}
	var cs createStructW
	if got := unsafe.Offsetof(cs.cy); got != 32 {
		t.Errorf("offsetof(cy) = %d, want 32", got)
	}
	if got := unsafe.Offsetof(cs.cx); got != 36 {
		t.Errorf("offsetof(cx) = %d, want 36", got)
	}
	if got := unsafe.Offsetof(cs.y); got != 40 {
		t.Errorf("offsetof(y) = %d, want 40", got)
	}
	if got := unsafe.Offsetof(cs.x); got != 44 {
		t.Errorf("offsetof(x) = %d, want 44", got)
	}
	if got := unsafe.Offsetof(cs.style); got != 48 {
		t.Errorf("offsetof(style) = %d, want 48", got)
	}

	data, err := os.ReadFile("window_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(data)
	if !regexp.MustCompile(`(?s)cbtCallback := windows\.NewCallback.*cbt\.lpcs\.x = initPlacement\.X.*cbt\.lpcs\.y = initPlacement\.Y.*webview2\.NewWithOptions`).MatchString(src) {
		t.Error("runPlatformWindow must apply initPlacement inside HCBT_CREATEWND before webview2.NewWithOptions")
	}
}
