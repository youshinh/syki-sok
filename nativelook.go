package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
)

// The look (ink or paper, config.appearance.look) is painted by the page, but a few colours are painted by the OS before the page
// can: the window's background brush, the WebView2 / WKWebView backdrop that shows until the first frame, and on Windows the title
// bar. They follow the look so that neither look opens with a flash of the other:
//
//   - at start, from config.json (startupNativeLook: the file is read once for the whole start by InitScrapEngine, this costs one
//     stat and, for a default config, one substring search);
//   - while running, from SaveConfig (noteNativeLook): saving the settings is the one way a look changes. The settings dialog's
//     live preview does not reach the OS, on purpose, like the other OS-level settings (tray, global shortcut).
//
// Only the look matters: a self-chosen accent colour never changes these. Quick Capture (a Win32 popup over any application) and the
// screen-capture frame are separate windows that stay dark, and print.css stays paper.
//
// The two colours below are the --canvas-bg of frontend/css/tokens.css (:root and :root.look-paper). TestNativeLookMatchesTokens
// reads that file and fails when either differs: the page and the window must be the same colour.

// utf8BOM starts a file saved by an editor that marks UTF-8 (Notepad did, Windows PowerShell 5 does); encoding/json refuses it.
var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// nativeLook is what the OS-drawn parts of the window are painted with.
type nativeLook struct {
	R, G, B uint8
	Paper   bool // paper (light) or ink (dark): decides the title bar on Windows
}

var (
	nativeInk   = nativeLook{R: 0x1e, G: 0x1e, B: 0x1e}
	nativePaper = nativeLook{R: 0xfb, G: 0xfb, B: 0xf9, Paper: true}
)

// nativeLookFor maps the look name the page uses to its colours. Anything but "paper" is ink, as in js/appearance.js (normalize).
func nativeLookFor(look string) nativeLook {
	if look == "paper" {
		return nativePaper
	}
	return nativeInk
}

// parseAppearanceLook returns "paper" or "ink" for a raw config.json, by the page's own rule (js/appearance.js): config.appearance.look
// is paper only when it is exactly the string "paper" (the key names are matched exactly, too); a missing or malformed value, a
// broken file or an empty string is ink. It is pure (no I/O) and is on the start-up path: ink is the default, so a config that does
// not contain the word at all is answered without parsing anything.
func parseAppearanceLook(configJSON string) string {
	if !strings.Contains(configJSON, "paper") {
		return "ink"
	}
	// Only the word is searched for above; the real answer needs the structure. Objects are read into maps of raw values so that the
	// keys are matched exactly (a struct would also accept "Appearance" and "LOOK") and only the three that matter are decoded.
	var root map[string]json.RawMessage
	if json.Unmarshal(bytes.TrimPrefix([]byte(configJSON), utf8BOM), &root) != nil {
		return "ink"
	}
	var appearance map[string]json.RawMessage
	if json.Unmarshal(root["appearance"], &appearance) != nil {
		return "ink"
	}
	var look string
	if json.Unmarshal(appearance["look"], &look) != nil {
		return "ink"
	}
	if look == "paper" {
		return "paper"
	}
	return "ink"
}

// webview2BackgroundEnv is the value of WEBVIEW2_DEFAULT_BACKGROUND_COLOR: 0xAARRGGBB, opaque.
func webview2BackgroundEnv(l nativeLook) string {
	return fmt.Sprintf("0xFF%02X%02X%02X", l.R, l.G, l.B)
}

// colorrefBGR is the colour as a Win32 COLORREF: 0x00BBGGRR.
func colorrefBGR(l nativeLook) uintptr {
	return uintptr(l.B)<<16 | uintptr(l.G)<<8 | uintptr(l.R)
}

// dwmDarkMode is the value of DWMWA_USE_IMMERSIVE_DARK_MODE for the look: the title bar and frame are dark for ink, light for paper.
func dwmDarkMode(l nativeLook) int32 {
	if l.Paper {
		return 0
	}
	return 1
}

// startupNativeLook is the look the window opens with, from the saved settings, and it is remembered as the look the window now has.
// config.json is the cached copy InitScrapEngine read a moment before (readConfigCached: one stat), never a second read of the file.
func (a *App) startupNativeLook() nativeLook {
	l := nativeLookFor(parseAppearanceLook(a.readConfigCached()))
	a.nativeLookMu.Lock()
	a.nativeLookPaper = l.Paper
	a.nativeLookMu.Unlock()
	return l
}

// setNativeLookApplier installs what repaints the window when the saved look changes (the platform's runPlatformWindow, once the
// window exists). Without one (tests, a window not created yet) a change is only remembered.
func (a *App) setNativeLookApplier(apply func(nativeLook)) {
	a.nativeLookMu.Lock()
	a.nativeLookApply = apply
	a.nativeLookMu.Unlock()
}

// noteNativeLook is called by SaveConfig with the settings just written. When the look differs from the one the window has, the
// applier runs (once, however many saves repeat the same look). A settings text that is not JSON leaves the window as it is: the
// page cannot read it either. The applier only hands the work to the UI thread (it never blocks), so it is called with the lock
// held, which keeps two quick saves in the order they were made.
func (a *App) noteNativeLook(configJSON string) {
	if !json.Valid([]byte(configJSON)) {
		return
	}
	l := nativeLookFor(parseAppearanceLook(configJSON))
	a.nativeLookMu.Lock()
	defer a.nativeLookMu.Unlock()
	if a.nativeLookPaper == l.Paper {
		return
	}
	a.nativeLookPaper = l.Paper
	if a.nativeLookApply != nil {
		a.nativeLookApply(l)
	}
}

// uiNativeLookApplier wraps set (which touches window handles and so must run on the UI thread) into an applier that hands it to the
// window's dispatcher, and drops it when the window is already being torn down.
func (a *App) uiNativeLookApplier(set func(nativeLook)) func(nativeLook) {
	return func(l nativeLook) {
		if a.w == nil || atomic.LoadInt32(&a.isDestroyed) != 0 {
			return
		}
		a.w.Dispatch(func() {
			if atomic.LoadInt32(&a.isDestroyed) == 0 {
				set(l)
			}
		})
	}
}
