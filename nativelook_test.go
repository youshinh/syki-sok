package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
)

// TestParseAppearanceLook: "paper" only for the exact string at config.appearance.look; everything else, however odd, is ink (the rule
// of js/appearance.js, so the window and the page agree).
func TestParseAppearanceLook(t *testing.T) {
	cases := []struct {
		name string
		cfg  string
		want string
	}{
		{"empty", ``, "ink"},
		{"blank", "  \n ", "ink"},
		{"empty object", `{}`, "ink"},
		{"broken json", `{"appearance":{"look":"paper"`, "ink"},
		{"not json at all, but says paper", `paper`, "ink"},
		{"paper", `{"appearance":{"look":"paper"}}`, "paper"},
		{"paper with other keys and spacing", "{\n  \"general\": {\"language\": \"ja\"},\n  \"appearance\": {\n    \"accent\": \"blue\",\n    \"look\": \"paper\"\n  }\n}", "paper"},
		{"ink", `{"appearance":{"look":"ink"}}`, "ink"},
		{"look missing", `{"appearance":{"accent":"blue"}}`, "ink"},
		{"appearance missing", `{"general":{"theme":"olive"}}`, "ink"},
		{"capital P", `{"appearance":{"look":"Paper"}}`, "ink"},
		{"upper case", `{"appearance":{"look":"PAPER"}}`, "ink"},
		{"padded", `{"appearance":{"look":" paper "}}`, "ink"},
		{"look is a number", `{"appearance":{"look":1,"x":"paper"}}`, "ink"},
		{"look is null", `{"appearance":{"look":null,"x":"paper"}}`, "ink"},
		{"look is an array", `{"appearance":{"look":["paper"]}}`, "ink"},
		{"look is an object", `{"appearance":{"look":{"look":"paper"}}}`, "ink"},
		{"appearance is a string", `{"appearance":"paper"}`, "ink"},
		{"appearance is an array", `{"appearance":[{"look":"paper"}]}`, "ink"},
		{"appearance is null", `{"appearance":null,"x":"paper"}`, "ink"},
		{"general.look is not the setting", `{"general":{"look":"paper"}}`, "ink"},
		{"look at the top level is not the setting", `{"look":"paper"}`, "ink"},
		{"nested appearance is not the setting", `{"general":{"appearance":{"look":"paper"}}}`, "ink"},
		{"paper is another key's value", `{"appearance":{"look":"ink","note":"paper"}}`, "ink"},
		{"paper as a key", `{"appearance":{"look":"ink","paper":true}}`, "ink"},
		{"paper in a note text", `{"scraps":{"scrapDir":"C:/paper/notes"},"appearance":{"look":"ink"}}`, "ink"},
		{"keys are matched exactly (Appearance)", `{"Appearance":{"look":"paper"}}`, "ink"},
		{"keys are matched exactly (LOOK)", `{"appearance":{"LOOK":"paper"}}`, "ink"},
		{"the last duplicate wins, as in JSON.parse", `{"appearance":{"look":"ink","look":"paper"}}`, "paper"},
		{"the last duplicate wins (ink)", `{"appearance":{"look":"paper","look":"ink"}}`, "ink"},
		{"BOM then paper", "\xef\xbb\xbf" + `{"appearance":{"look":"paper"}}`, "paper"},
		{"BOM then ink", "\xef\xbb\xbf" + `{"appearance":{"look":"ink"}}`, "ink"},
		{"unicode escape of the word is not searched for", `{"appearance":{"look":"pap\u0065r"}}`, "ink"},
	}
	for _, c := range cases {
		if got := parseAppearanceLook(c.cfg); got != c.want {
			t.Errorf("%s: parseAppearanceLook(%q) = %q, want %q", c.name, c.cfg, got, c.want)
		}
	}

	// A big config (a long note path list, a long snippets table) with the setting at the end, and with "paper" in the middle only.
	pad := strings.Repeat(`"k":"v",`, 30000)
	if got := parseAppearanceLook(`{` + pad + `"appearance":{"look":"paper"}}`); got != "paper" {
		t.Errorf("large config with paper = %q", got)
	}
	if got := parseAppearanceLook(`{` + pad + `"x":"paper","appearance":{"look":"ink"}}`); got != "ink" {
		t.Errorf("large config with the word but ink = %q", got)
	}
	if got := parseAppearanceLook(`{` + pad + `"appearance":{"look":"ink"}}`); got != "ink" {
		t.Errorf("large config without the word = %q", got)
	}
}

// TestParseAppearanceLookDefaultCostsNothing: a default config (no word "paper") is answered without allocating, the case every start
// of an ordinary profile takes.
func TestParseAppearanceLookDefaultCostsNothing(t *testing.T) {
	cfg := `{"general":{"language":"ja","theme":"olive"},"appearance":{"look":"ink","accent":"olive"},"scraps":{"scrapDir":"C:/notes"}}`
	n := testing.AllocsPerRun(100, func() {
		if parseAppearanceLook(cfg) != "ink" {
			t.Fatal("not ink")
		}
	})
	if n != 0 {
		t.Errorf("parseAppearanceLook allocated %v times for a config without the word paper, want 0", n)
	}
}

var (
	canvasInkRE   = regexp.MustCompile(`(?s):root\s*\{[^}]*?--canvas-bg:\s*#([0-9a-fA-F]{6})\s*;`)
	canvasPaperRE = regexp.MustCompile(`(?s):root\.look-paper\s*\{[^}]*?--canvas-bg:\s*#([0-9a-fA-F]{6})\s*;`)
	themeColorRE  = regexp.MustCompile(`<meta\s+name="theme-color"\s+content="#([0-9a-fA-F]{6})"`)
)

func hexOf(l nativeLook) string { return fmt.Sprintf("%02x%02x%02x", l.R, l.G, l.B) }

func singleMatch(t *testing.T, re *regexp.Regexp, src, what string) string {
	t.Helper()
	all := re.FindAllStringSubmatch(src, -1)
	if len(all) != 1 {
		t.Fatalf("%s: found %d matches, want exactly 1 (pattern %s)", what, len(all), re)
	}
	return strings.ToLower(all[0][1])
}

// TestNativeLookMatchesTokens locks the two colours the OS paints to the page's own: --canvas-bg of the ink look (:root) and of the paper
// look (:root.look-paper) in tokens.css, and the theme-color of index.html (ink). A page whose canvas is another colour than the window
// behind it flashes the difference on every start.
func TestNativeLookMatchesTokens(t *testing.T) {
	tokens, err := frontendFS.ReadFile("frontend/css/tokens.css")
	if err != nil {
		t.Fatalf("tokens.css is not embedded: %v", err)
	}
	if got, want := hexOf(nativeInk), singleMatch(t, canvasInkRE, string(tokens), ":root --canvas-bg"); got != want {
		t.Errorf("nativeInk is #%s, tokens.css :root --canvas-bg is #%s", got, want)
	}
	if got, want := hexOf(nativePaper), singleMatch(t, canvasPaperRE, string(tokens), ":root.look-paper --canvas-bg"); got != want {
		t.Errorf("nativePaper is #%s, tokens.css :root.look-paper --canvas-bg is #%s", got, want)
	}
	index, err := frontendFS.ReadFile("frontend/index.html")
	if err != nil {
		t.Fatalf("index.html is not embedded: %v", err)
	}
	if got, want := hexOf(nativeInk), singleMatch(t, themeColorRE, string(index), "index.html theme-color"); got != want {
		t.Errorf("nativeInk is #%s, index.html theme-color is #%s", got, want)
	}
	if nativeInk.Paper || !nativePaper.Paper {
		t.Errorf("Paper flags are wrong: ink %v, paper %v", nativeInk.Paper, nativePaper.Paper)
	}
}

// The patterns above must not accept the wrong block: a tokens.css whose paper block carries another colour is not read as ink.
func TestNativeLookTokenPatternsAreSpecific(t *testing.T) {
	css := ":root {\r\n  --canvas-bg: #1e1e1e;\r\n  --canvas-fg: #dcdde3;\r\n}\r\n:root.look-paper {\r\n  --canvas-bg: #fbfbf9;\r\n  color-scheme: light;\r\n}\r\n"
	if got := singleMatch(t, canvasInkRE, css, "ink"); got != "1e1e1e" {
		t.Errorf("ink pattern read %s", got)
	}
	if got := singleMatch(t, canvasPaperRE, css, "paper"); got != "fbfbf9" {
		t.Errorf("paper pattern read %s", got)
	}
}

func TestNativeLookFormats(t *testing.T) {
	if got := webview2BackgroundEnv(nativeInk); got != "0xFF1E1E1E" {
		t.Errorf("webview2BackgroundEnv(ink) = %s", got)
	}
	if got := webview2BackgroundEnv(nativePaper); got != "0xFFFBFBF9" {
		t.Errorf("webview2BackgroundEnv(paper) = %s", got)
	}
	if got := colorrefBGR(nativeInk); got != 0x001E1E1E {
		t.Errorf("colorrefBGR(ink) = %#x", got)
	}
	if got := colorrefBGR(nativePaper); got != 0x00F9FBFB {
		t.Errorf("colorrefBGR(paper) = %#x", got)
	}
	if dwmDarkMode(nativeInk) != 1 || dwmDarkMode(nativePaper) != 0 {
		t.Errorf("the title bar is dark for ink (%d) and light for paper (%d)", dwmDarkMode(nativeInk), dwmDarkMode(nativePaper))
	}
	if nativeLookFor("paper") != nativePaper || nativeLookFor("ink") != nativeInk || nativeLookFor("") != nativeInk || nativeLookFor("Paper") != nativeInk {
		t.Errorf("nativeLookFor maps the names wrongly")
	}
}

// recordingApplier counts the looks the window was asked to take.
type recordingApplier struct {
	mu    sync.Mutex
	looks []nativeLook
}

func (r *recordingApplier) apply(l nativeLook) {
	r.mu.Lock()
	r.looks = append(r.looks, l)
	r.mu.Unlock()
}

func (r *recordingApplier) calls() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.looks)
}

// hermeticLook returns a settings text for SaveConfig that keeps the scrap engine away from the network and from the developer's notes.
func hermeticLook(t *testing.T, scrapDir, look string) string {
	t.Helper()
	cfg := map[string]interface{}{
		"scraps":     map[string]interface{}{"scrapDir": filepath.ToSlash(scrapDir), "gitSyncEnabled": false},
		"appearance": map[string]interface{}{"look": look, "accent": "olive"},
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// TestSaveConfigAppliesNativeLookOnChange: the window is repainted when a save changes the look, once, and not for a save that keeps it,
// not for a text the page could not read, and a missing window is no reason to fail.
func TestSaveConfigAppliesNativeLookOnChange(t *testing.T) {
	cfgPath := getConfigFilePath()
	t.Cleanup(func() { _ = os.Remove(cfgPath) })
	scrapDir := t.TempDir()

	app := &App{}
	rec := &recordingApplier{}
	app.setNativeLookApplier(rec.apply)

	save := func(label, text string, wantCalls int) {
		t.Helper()
		if _, err := app.SaveConfig(text); err != nil {
			t.Fatalf("%s: SaveConfig: %v", label, err)
		}
		if got := rec.calls(); got != wantCalls {
			t.Fatalf("%s: the window was repainted %d times in all, want %d", label, got, wantCalls)
		}
	}

	save("ink to ink (the window starts as ink)", hermeticLook(t, scrapDir, "ink"), 0)
	save("ink to paper", hermeticLook(t, scrapDir, "paper"), 1)
	if got := rec.looks[0]; got != nativePaper {
		t.Errorf("first repaint = %+v, want the paper look", got)
	}
	save("paper to paper", hermeticLook(t, scrapDir, "paper"), 1)
	save("a broken text keeps the paper window", `{"appearance":{"look":"ink"`, 1)
	save("an empty text keeps the paper window", ``, 1)
	save("paper to paper again, after the broken one", hermeticLook(t, scrapDir, "paper"), 1)
	save("paper to ink", hermeticLook(t, scrapDir, "ink"), 2)
	if got := rec.looks[1]; got != nativeInk {
		t.Errorf("second repaint = %+v, want the ink look", got)
	}
	save("ink to a config without the setting", `{"general":{"theme":"olive"}}`, 2)
	save("a config without the setting to paper", hermeticLook(t, scrapDir, "paper"), 3)
	save("paper to a config without the setting (ink)", `{"general":{"theme":"olive"}}`, 4)

	// No window yet (or none in a test): the look is only remembered, and nothing fails.
	bare := &App{}
	if _, err := bare.SaveConfig(hermeticLook(t, scrapDir, "paper")); err != nil {
		t.Fatalf("SaveConfig without an applier: %v", err)
	}
	if !bare.nativeLookPaper {
		t.Errorf("the paper look was not remembered when there was no applier")
	}
}

// TestStartupNativeLookIsWhatTheWindowHas: the look read at start is the one a later save compares with, so saving the same look does
// not repaint a window that already has it, and saving the other one does.
func TestStartupNativeLookIsWhatTheWindowHas(t *testing.T) {
	cfgPath := getConfigFilePath()
	t.Cleanup(func() { _ = os.Remove(cfgPath) })
	scrapDir := t.TempDir()

	for _, look := range []string{"paper", "ink"} {
		other := map[string]string{"paper": "ink", "ink": "paper"}[look]
		if err := os.WriteFile(cfgPath, []byte(hermeticLook(t, scrapDir, look)), 0600); err != nil {
			t.Fatal(err)
		}
		app := &App{}
		if got := app.startupNativeLook(); got != nativeLookFor(look) {
			t.Fatalf("saved look %s: startupNativeLook = %+v", look, got)
		}
		rec := &recordingApplier{}
		app.setNativeLookApplier(rec.apply)
		if _, err := app.SaveConfig(hermeticLook(t, scrapDir, look)); err != nil {
			t.Fatal(err)
		}
		if rec.calls() != 0 {
			t.Errorf("saved look %s: saving the same look repainted the window", look)
		}
		if _, err := app.SaveConfig(hermeticLook(t, scrapDir, other)); err != nil {
			t.Fatal(err)
		}
		if rec.calls() != 1 || rec.looks[0] != nativeLookFor(other) {
			t.Errorf("saved look %s: saving %s gave %d repaints %+v", look, other, rec.calls(), rec.looks)
		}
	}

	// No settings file at all (first run) and a file that is not JSON: ink.
	_ = os.Remove(cfgPath)
	if got := (&App{}).startupNativeLook(); got != nativeInk {
		t.Errorf("no config.json: %+v, want ink", got)
	}
	if err := os.WriteFile(cfgPath, []byte(`{"appearance": {"look": "paper"`), 0600); err != nil {
		t.Fatal(err)
	}
	if got := (&App{}).startupNativeLook(); got != nativeInk {
		t.Errorf("a broken config.json: %+v, want ink", got)
	}
}

type dispatchRecorder struct {
	queued []func()
}

func (d *dispatchRecorder) Dispatch(f func()) { d.queued = append(d.queued, f) }
func (d *dispatchRecorder) Eval(string)       {}

// TestUINativeLookApplier: the work is queued to the window's dispatcher, not run on the caller's thread, and dropped once the window
// is going away.
func TestUINativeLookApplier(t *testing.T) {
	var seen []nativeLook
	set := func(l nativeLook) { seen = append(seen, l) }

	app := &App{}
	apply := app.uiNativeLookApplier(set)
	apply(nativePaper) // no window yet
	if len(seen) != 0 {
		t.Fatalf("ran without a window")
	}

	d := &dispatchRecorder{}
	app.w = d
	apply(nativePaper)
	if len(seen) != 0 || len(d.queued) != 1 {
		t.Fatalf("the work must be queued, not run: ran %d, queued %d", len(seen), len(d.queued))
	}
	d.queued[0]()
	if len(seen) != 1 || seen[0] != nativePaper {
		t.Fatalf("after dispatch: %+v", seen)
	}

	apply(nativeInk)
	app.isDestroyed = 1
	d.queued[1]() // queued before the window went away, run after
	if len(seen) != 1 {
		t.Errorf("ran on a destroyed window")
	}
	apply(nativeInk)
	if len(d.queued) != 2 {
		t.Errorf("queued work for a destroyed window")
	}
}

// The OS-level code is not run by any test (it needs a window), so what can be checked of it as text is checked here, on every OS: the
// dark colour is not written out by hand again (the two looks live in nativelook.go, tied to tokens.css above), the start-up path
// reads the saved look, and macOS passes the colour in and can repaint.
func TestNativeColoursAreNotHardCoded(t *testing.T) {
	win := readSourceFile(t, "window_windows.go")
	for _, stale := range []string{"0x001e1e1e", "0xFF1E1E1E", "0x1e,", "#1e1e1e", "applyNativeDarkMode"} {
		if strings.Contains(win, stale) {
			t.Errorf("window_windows.go still has %q: the colours must come from nativeLook", stale)
		}
	}
	for _, need := range []string{"webview2BackgroundEnv(look)", "nativeClassBrush(look)", "setWindowLookAttrs(wParam, look)", "dark := dwmDarkMode(l)", "applyNativeLook(w, look)", "app.setNativeLookApplier("} {
		if !strings.Contains(win, need) {
			t.Errorf("window_windows.go no longer has %s", need)
		}
	}
	if i, j := strings.Index(win, "look := app.startupNativeLook()"), strings.Index(win, "webview2.NewWithOptions("); i < 0 || j < 0 || i > j {
		t.Errorf("the look must be read before the window is created (startupNativeLook at %d, NewWithOptions at %d)", i, j)
	}

	mac := readSourceFile(t, "window_darwin.go")
	for _, stale := range []string{"30.0 / 255.0", "colorWithCalibratedRed", "#1e1e1e", "applyNativeDarkMode"} {
		if strings.Contains(mac, stale) {
			t.Errorf("window_darwin.go still has %q", stale)
		}
	}
	for _, need := range []string{
		"static void setupMacWindowDelegate(void *nsWindow, double r, double g, double b)",
		"static void mdmemoSetBackdrop(double r, double g, double b)",
		"static void mdmemoApplyBackdrop(NSWindow *win, double r, double g, double b)",
		"[NSColor colorWithSRGBRed:r green:g blue:b alpha:1.0]",
		"C.setupMacWindowDelegate(w.Window(), bgR, bgG, bgB)",
		"app.setNativeLookApplier(setNativeLook)",
		"look := app.startupNativeLook()",
		"func setNativeLook(l nativeLook) {",
	} {
		if !strings.Contains(mac, need) {
			t.Errorf("window_darwin.go no longer has %s", need)
		}
	}
	if n := strings.Count(mac, "mdmemoApplyBackdrop(win, r, g, b)") + strings.Count(mac, "mdmemoApplyBackdrop(gWindow, r, g, b)"); n != 2 {
		t.Errorf("mdmemoApplyBackdrop is called %d times, want 2 (at start and when the look changes)", n)
	}

	// The cgo-less build type-checks the package on any machine; it needs the same function.
	nocgo := readSourceFile(t, "platform_darwin_nocgo.go")
	if !strings.Contains(nocgo, "func setNativeLook(l nativeLook) {}") {
		t.Errorf("platform_darwin_nocgo.go has no setNativeLook stub")
	}
}

// BenchmarkParseAppearanceLook: the start-up cost. "ink" is the case every ordinary profile takes (no word to find), "paper" parses.
func BenchmarkParseAppearanceLook(b *testing.B) {
	small := `{"general":{"language":"ja","theme":"olive","autoSave":true,"restoreSession":true},"appearance":{"look":"%s","accent":"olive","bars":"light","autoHide":true},` +
		`"scraps":{"scrapDir":"C:/Users/someone/Documents/md-memo/scraps","gitSyncEnabled":false},"shortcuts":{"globalSummon":"Ctrl+Alt+M"},"text":{"model":"gemini-3-flash","apiKey":""}%s}`
	pad := func(n int) string {
		var sb strings.Builder
		sb.WriteString(`,"snippets":{"first":"x"`)
		for i := 0; i < n; i++ {
			fmt.Fprintf(&sb, `,"key%d":"value of a snippet"`, i)
		}
		sb.WriteString("}")
		return sb.String()
	}
	for _, tc := range []struct {
		name string
		cfg  string
	}{
		{"5KB-ink", fmt.Sprintf(small, "ink", pad(170))},
		{"5KB-paper", fmt.Sprintf(small, "paper", pad(170))},
		{"200KB-ink", fmt.Sprintf(small, "ink", pad(7000))},
		{"200KB-paper", fmt.Sprintf(small, "paper", pad(7000))},
	} {
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(tc.cfg)))
			for i := 0; i < b.N; i++ {
				_ = parseAppearanceLook(tc.cfg)
			}
		})
	}
}
