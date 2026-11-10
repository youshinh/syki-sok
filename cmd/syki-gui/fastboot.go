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

const fastBootBundlePath = "/js/__boot_bundle.js"

type fastBootAssets struct {
	indexHTML []byte
	bundleJS  []byte
	bundleURL string
}

var (
	// fastBootMu guards the lazily built asset cache so warmFastBootAssets and
	// the on-demand path never race, and so releaseFastBootAssets can drop the
	// multi-megabyte bundle safely once the UI has booted.
	fastBootMu      sync.Mutex
	fastBootDefault *fastBootAssets
	fastBootErr     error
)

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
		out.WriteString("<style" + attrs + ">\n" + strings.TrimRight(string(content), "\r\n") + "\n</style>")
	}
	out.WriteString(html[last:])
	if cssErr != nil {
		return "", 0, cssErr
	}
	return out.String(), cssCount, nil
}

// buildFastBootScriptBundle concatenates every <script src="js/..."> in document
// order into one immutable payload and derives its content-hash URL. The
// pre-sized buffer writes file bytes directly, avoiding the intermediate
// []string plus strings.Join copy that doubled peak heap.
func buildFastBootScriptBundle(fsys fs.FS, html string) (bundleJS []byte, bundleURL string, err error) {
	var buf bytes.Buffer
	buf.Grow(2200000)
	count := 0
	for _, m := range fastBootScriptTagRe.FindAllStringSubmatch(html, -1) {
		content, err := fs.ReadFile(fsys, stripFastBootQuery(m[1]))
		if err != nil {
			return nil, "", fmt.Errorf("read %s: %w", m[1], err)
		}
		if count > 0 {
			// contents are separated by "\n;\n" so each file starts on a clean
			// boundary and the previous file cannot swallow the next one.
			buf.WriteString("\n;\n")
		}
		buf.Write(bytes.TrimRight(content, "\r\n"))
		count++
	}
	if count == 0 {
		return nil, "", fmt.Errorf("no script tags found in index.html")
	}
	bundleJS = bytes.TrimRight(buf.Bytes(), "\r\n")
	sum := sha256.Sum256(bundleJS)
	return bundleJS, "js/__boot_bundle.js?v=" + hex.EncodeToString(sum[:])[:8], nil
}

// injectFastBootBundleTags preloads the bundle before </head>, then swaps the
// first script tag for the bundle reference and drops the rest.
func injectFastBootBundleTags(html, bundleURL string) string {
	preload := `<link rel="preload" href="` + bundleURL + `" as="script">`
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
// all js/ scripts into one immutable bundle served from a synthetic URL.
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

	bundleJS, bundleURL, err := buildFastBootScriptBundle(fsys, html)
	if err != nil {
		return nil, err
	}

	return &fastBootAssets{
		indexHTML: []byte(injectFastBootBundleTags(html, bundleURL)),
		bundleJS:  bundleJS,
		bundleURL: bundleURL,
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
	if !isDoc && !isBundle {
		return false
	}
	assets := defaultFastBootAssets(fsys)
	if assets == nil || len(assets.bundleJS) == 0 {
		return false
	}
	// Both payloads are sniffed by the WebView, so pin the type explicitly.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if isBundle {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
		if r.Method == http.MethodGet {
			w.Write(assets.bundleJS)
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
