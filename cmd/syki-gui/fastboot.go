package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"runtime/debug"
	"strings"
	"sync"
)

const (
	fastBootBundlePath   = "/js/__boot_bundle.js"
	fastBootDeferredPath = "/js/__boot_deferred.js"
)

type fastBootAssets struct {
	indexHTML   []byte
	bundleJS    []byte
	bundleURL   string
	deferredJS  []byte
	deferredURL string
}

var (
	// fastBootMu guards the lazily built asset cache so warmFastBootAssets and
	// the on-demand path never race, and so releaseFastBootAssets can drop the
	// multi-megabyte bundle safely once the UI has booted.
	fastBootMu      sync.Mutex
	fastBootDefault *fastBootAssets
	fastBootErr     error
)

// fastBootDeferredScripts lists non-critical frontend modules loaded in the
// background right after first paint & input readiness. Core voice/recording
// modules (voice_profiles.js, voice_input.js, bar_voice.js, speech_stream.js)
// intentionally stay in the critical boot bundle for instant meeting capture.
var fastBootDeferredScripts = map[string]bool{
	"js/slot_snippets.js":       true,
	"js/agent_risk.js":          true,
	"js/bulk_insert.js":         true,
	"js/ghost_diff.js":          true,
	"js/slot_agent.js":          true,
	"js/llm_error.js":           true,
	"js/jev_action.js":          true,
	"js/auto_selector.js":       true,
	"js/html_to_md.js":          true,
	"js/speech_settings.js":     true,
	"js/semantic_settings.js":   true,
	"js/preview_images.js":      true,
	"js/mermaid_tone.js":        true,
	"js/mermaid_repair.js":      true,
	"js/scrap_quote.js":         true,
	"js/scraps_filter.js":       true,
	"js/config_pack.js":         true,
	"js/settings_compact.js":    true,
	"js/about_dialog.js":        true,
	"js/find_replace_engine.js": true,
	"js/infographic_prompt.js":  true,
	"js/first_run.js":           true,
	"js/goto_line.js":           true,
	"js/line_operations.js":     true,
}

var (
	// <link rel="stylesheet" href="css/x.css?v=1.2.3" media="screen">
	fastBootCSSLinkRe = regexp.MustCompile(`(?i)<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"([^>]*)>`)
	// <script src="js/x.js?v=1.2.3"></script>
	fastBootScriptTagRe = regexp.MustCompile(`(?i)<script\b[^>]*\bsrc="(js/[^"]+)"[^>]*>\s*</script>`)
)

// stripFastBootQuery removes a cache-busting "?v=..." suffix, normalises the
// result with path.Clean and rejects anything that is not a valid io/fs path,
// returning "" so callers fail fast instead of reading a surprising file.
func stripFastBootQuery(p string) string {
	if i := strings.IndexByte(p, '?'); i >= 0 {
		p = p[:i]
	}
	p = strings.TrimPrefix(strings.TrimPrefix(p, "./"), "/")
	if p == "" {
		return ""
	}
	clean := path.Clean(p)
	if clean == "." || !fs.ValidPath(clean) {
		return ""
	}
	return clean
}

// inlineFastBootStylesheets replaces every <link rel="stylesheet" href="css/...">
// with an inline <style> block, preserving any attributes that follow href
// (e.g. media="screen"). It reports how many stylesheets were inlined and the
// first read failure, which aborts the whole build.
func inlineFastBootStylesheets(fsys fs.FS, html string) (string, int, error) {
	var (
		out      strings.Builder
		cssErr   error
		cssCount int
	)
	out.Grow(len(html) + 131072)
	last := 0
	for _, loc := range fastBootCSSLinkRe.FindAllStringIndex(html, -1) {
		tag := html[loc[0]:loc[1]]
		out.WriteString(html[last:loc[0]])
		last = loc[1]
		if cssErr != nil {
			out.WriteString(tag)
			continue
		}
		m := fastBootCSSLinkRe.FindStringSubmatch(tag)
		if m == nil {
			out.WriteString(tag)
			continue
		}
		name := stripFastBootQuery(m[1])
		content, err := fs.ReadFile(fsys, name)
		if err != nil {
			cssErr = fmt.Errorf("read %s: %w", m[1], err)
			out.WriteString(tag)
			continue
		}
		cssCount++
		attrs := strings.TrimSpace(m[2])
		if attrs != "" {
			attrs = " " + attrs
		}
		out.WriteString("<style" + attrs + ">\n" + compactFastBootCSS(string(content)) + "\n</style>")
	}
	out.WriteString(html[last:])
	if cssErr != nil {
		return "", 0, cssErr
	}
	return out.String(), cssCount, nil
}

// compactFastBootCSS trims leading/trailing whitespace per line and skips blank
// lines in embedded CSS without altering strings or URLs.
func compactFastBootCSS(raw string) string {
	var b strings.Builder
	b.Grow(len(raw))
	first := true
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if !first {
			b.WriteByte('\n')
		}
		b.WriteString(trimmed)
		first = false
	}
	return b.String()
}

// buildFastBootScriptBundle splits <script src="js/..."> tags into the critical
// boot bundle and an optional background-deferred bundle (tagged data-boot-defer).
func buildFastBootScriptBundle(fsys fs.FS, html string) (bundleJS []byte, bundleURL string, deferredJS []byte, deferredURL string, err error) {
	var coreBuf, defBuf bytes.Buffer
	coreBuf.Grow(1800000)
	coreCount, defCount := 0, 0
	for _, m := range fastBootScriptTagRe.FindAllStringSubmatch(html, -1) {
		fullTag, src := m[0], m[1]
		cleanPath := stripFastBootQuery(src)
		content, err := fs.ReadFile(fsys, cleanPath)
		if err != nil {
			return nil, "", nil, "", fmt.Errorf("read %s: %w", src, err)
		}
		if fastBootDeferredScripts[cleanPath] || strings.Contains(strings.ToLower(fullTag), "data-boot-defer") {
			if defCount > 0 {
				defBuf.WriteString("\n;\n")
			}
			defBuf.Write(bytes.TrimRight(content, "\r\n"))
			defCount++
		} else {
			if coreCount > 0 {
				// contents are separated by "\n;\n" so each file starts on a clean
				// boundary and the previous file cannot swallow the next one.
				coreBuf.WriteString("\n;\n")
			}
			coreBuf.Write(bytes.TrimRight(content, "\r\n"))
			coreCount++
		}
	}
	if coreCount == 0 {
		return nil, "", nil, "", fmt.Errorf("no script tags found in index.html")
	}
	bundleJS = bytes.TrimRight(coreBuf.Bytes(), "\r\n")
	sum := sha256.Sum256(bundleJS)
	bundleURL = "js/__boot_bundle.js?v=" + hex.EncodeToString(sum[:])[:8]
	if defCount > 0 {
		deferredJS = bytes.TrimRight(defBuf.Bytes(), "\r\n")
		dSum := sha256.Sum256(deferredJS)
		deferredURL = "js/__boot_deferred.js?v=" + hex.EncodeToString(dSum[:])[:8]
	}
	return bundleJS, bundleURL, deferredJS, deferredURL, nil
}

// injectFastBootBundleTags preloads the core bundle before </head>, exposes the
// optional deferred bundle URL for idle background loading, and swaps the first
// script tag for the core bundle reference.
func injectFastBootBundleTags(html, bundleURL, deferredURL string) string {
	preload := `<link rel="preload" href="` + bundleURL + `" as="script">`
	if deferredURL != "" {
		preload += "\n<script>window.__bootDeferredURL=\"" + deferredURL + "\";</script>"
	}
	if i := strings.Index(strings.ToLower(html), "</head>"); i >= 0 {
		html = html[:i] + preload + "\n" + html[i:]
	} else {
		html = preload + "\n" + html
	}

	seen := 0
	return fastBootScriptTagRe.ReplaceAllStringFunc(html, func(tag string) string {
		seen++
		if seen == 1 {
			return `<script src="` + bundleURL + `"></script>`
		}
		return ""
	})
}

// buildFastBootAssets inlines every stylesheet into index.html and concatenates
// js/ scripts into immutable core and deferred bundles.
func buildFastBootAssets(fsys fs.FS) (*fastBootAssets, error) {
	indexHTML, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		return nil, fmt.Errorf("read index.html: %w", err)
	}

	html, cssCount, err := inlineFastBootStylesheets(fsys, string(indexHTML))
	if err != nil {
		return nil, err
	}
	if cssCount == 0 {
		return nil, fmt.Errorf("no stylesheet links found in index.html")
	}

	bundleJS, bundleURL, deferredJS, deferredURL, err := buildFastBootScriptBundle(fsys, html)
	if err != nil {
		return nil, err
	}

	return &fastBootAssets{
		indexHTML:   []byte(injectFastBootBundleTags(html, bundleURL, deferredURL)),
		bundleJS:    bundleJS,
		bundleURL:   bundleURL,
		deferredJS:  deferredJS,
		deferredURL: deferredURL,
	}, nil
}

// ensureFastBootAssetsLocked builds (once) and returns the cached asset set.
// The caller must hold fastBootMu; a failed build is remembered so every caller
// gets the same nil result instead of retrying a doomed bundling pass.
func ensureFastBootAssetsLocked(fsys fs.FS) *fastBootAssets {
	if fastBootDefault == nil && fastBootErr == nil {
		fastBootDefault, fastBootErr = buildFastBootAssets(fsys)
	}
	return fastBootDefault
}

// warmFastBootAssets kicks off background construction of the cached default
// asset set so the first window paint does not wait for the bundling work.
func warmFastBootAssets(fsys fs.FS) {
	go func() {
		fastBootMu.Lock()
		defer fastBootMu.Unlock()
		ensureFastBootAssetsLocked(fsys)
	}()
}

// defaultFastBootAssets returns the cached assets, building them on demand if
// warmFastBootAssets was never called or the cache was released after boot.
func defaultFastBootAssets(fsys fs.FS) *fastBootAssets {
	fastBootMu.Lock()
	defer fastBootMu.Unlock()
	return ensureFastBootAssetsLocked(fsys)
}

// releaseFastBootAssets drops the cached inlined document and multi-megabyte
// boot bundle so the Go heap can give them back to the OS. The next request
// rebuilds them on demand, which is fine because the WebView already holds the
// immutable copy it needs.
func releaseFastBootAssets() {
	fastBootMu.Lock()
	fastBootDefault = nil
	fastBootErr = nil
	fastBootMu.Unlock()
	debug.FreeOSMemory()
}

// serveFastBootAsset answers the inlined document and the synthetic boot bundle
// directly, returning true when the request was handled.
func serveFastBootAsset(w http.ResponseWriter, r *http.Request, fsys fs.FS) bool {
	if r == nil || r.URL == nil {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	isDoc := r.URL.Path == "/" || r.URL.Path == "/index.html"
	isBundle := r.URL.Path == fastBootBundlePath
	isDeferred := r.URL.Path == fastBootDeferredPath
	if !isDoc && !isBundle && !isDeferred {
		return false
	}
	assets := defaultFastBootAssets(fsys)
	if assets == nil || len(assets.bundleJS) == 0 {
		return false
	}
	if isDeferred && len(assets.deferredJS) == 0 {
		return false
	}
	// Payloads are sniffed by the WebView, so pin the type explicitly.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if isBundle || isDeferred {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
		if r.Method == http.MethodGet {
			if isDeferred {
				w.Write(assets.deferredJS)
			} else {
				w.Write(assets.bundleJS)
			}
		}
		return true
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if r.Method == http.MethodGet {
		w.Write(assets.indexHTML)
	}
	return true
}
