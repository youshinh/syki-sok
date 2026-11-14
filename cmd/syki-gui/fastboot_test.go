package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"syki-sok/frontend"
)

// TestBuildFastBootAssetsFromEmbeddedFS pins the inlining contract against the
// real embedded frontend: no stylesheet request, no script fan-out, one bundle.
func TestBuildFastBootAssetsFromEmbeddedFS(t *testing.T) {
	assets, err := buildFastBootAssets(frontend.FS)
	if err != nil {
		t.Fatalf("buildFastBootAssets(frontend.FS): %v", err)
	}
	if assets == nil {
		t.Fatalf("buildFastBootAssets returned nil assets with no error")
	}
	html := string(assets.indexHTML)

	if strings.Contains(html, `<link rel="stylesheet" href="css/`) {
		t.Errorf("a stylesheet link survived inlining: index.html still requests css/")
	}
	for _, want := range []string{
		"<style>",
		`<style media="screen">`,
		`<style media="print">`,
		`<link rel="preload" href="js/__boot_bundle.js?v=`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("index.html is missing %q", want)
		}
	}

	if got := strings.Count(html, `<script src="js/__boot_bundle.js?v=`); got != 1 {
		t.Errorf("bundle script tag count = %d, want exactly 1", got)
	}
	if got := strings.Count(html, `<script src="js/`); got != 1 {
		t.Errorf("remaining js/ script tags = %d, want 0 besides the bundle", got-1)
	}
	if !strings.Contains(html, `</head>`) {
		t.Errorf("index.html lost its </head> marker")
	}

	if len(assets.bundleJS) <= 1000000 {
		t.Errorf("bundleJS = %d bytes, want > 1000000", len(assets.bundleJS))
	}
	sum := sha256.Sum256(assets.bundleJS)
	wantURL := "js/__boot_bundle.js?v=" + hex.EncodeToString(sum[:])[:8]
	if assets.bundleURL != wantURL {
		t.Errorf("bundleURL = %q, want %q", assets.bundleURL, wantURL)
	}
	if !strings.Contains(string(assets.bundleJS), "\n;\n") {
		t.Errorf("bundleJS is missing the %q separator between concatenated files", "\n;\n")
	}
	if !strings.Contains(html, `href="`+assets.bundleURL+`"`) {
		t.Errorf("index.html does not reference the computed bundle URL %q", assets.bundleURL)
	}
}

// TestServeFastBootAssetHTTP checks the synthetic routes: the inlined document,
// the immutable bundle, and everything else falling through to the real handler.
func TestServeFastBootAssetHTTP(t *testing.T) {
	warmFastBootAssets(frontend.FS)

	// GET / serves the inlined document with no-cache.
	rec := httptest.NewRecorder()
	if !serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, "/", nil), frontend.FS) {
		t.Fatalf("GET / was not handled")
	}
	if got := rec.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Errorf("GET / Content-Type = %q, want text/html; charset=utf-8", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("GET / Cache-Control = %q, want no-cache", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("GET / X-Content-Type-Options = %q, want nosniff", got)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "<style>") || strings.Contains(body, `href="css/`) {
		t.Errorf("GET / body is not the inlined document")
	}

	// GET /index.html behaves identically.
	rec = httptest.NewRecorder()
	if !serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, "/index.html", nil), frontend.FS) {
		t.Fatalf("GET /index.html was not handled")
	}
	if got := rec.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Errorf("GET /index.html Content-Type = %q, want text/html; charset=utf-8", got)
	}

	// GET the synthetic bundle path: long-lived immutable JS cache.
	rec = httptest.NewRecorder()
	if !serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, fastBootBundlePath, nil), frontend.FS) {
		t.Fatalf("GET %s was not handled", fastBootBundlePath)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/javascript; charset=utf-8" {
		t.Errorf("bundle Content-Type = %q, want application/javascript; charset=utf-8", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=604800, immutable" {
		t.Errorf("bundle Cache-Control = %q, want public, max-age=604800, immutable", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("bundle X-Content-Type-Options = %q, want nosniff", got)
	}
	if n := len(rec.Body.Bytes()); n <= 1000000 {
		t.Errorf("bundle body = %d bytes, want > 1000000", n)
	}

	// HEAD the bundle: headers only, still handled.
	rec = httptest.NewRecorder()
	if !serveFastBootAsset(rec, httptest.NewRequest(http.MethodHead, fastBootBundlePath, nil), frontend.FS) {
		t.Fatalf("HEAD %s was not handled", fastBootBundlePath)
	}
	if n := len(rec.Body.Bytes()); n != 0 {
		t.Errorf("HEAD bundle body = %d bytes, want 0", n)
	}

	// Everything else must fall through to the normal file server.
	rec = httptest.NewRecorder()
	if serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, "/app.png", nil), frontend.FS) {
		t.Errorf("GET /app.png was handled, want false so the real handler serves it")
	}
	rec = httptest.NewRecorder()
	if serveFastBootAsset(rec, httptest.NewRequest(http.MethodPost, "/", nil), frontend.FS) {
		t.Errorf("POST / was handled, want false")
	}
	rec = httptest.NewRecorder()
	if serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, "/js/app.js", nil), frontend.FS) {
		t.Errorf("GET /js/app.js was handled, want false")
	}

	// releaseFastBootAssets drops the cache; the next GET / must rebuild on demand.
	releaseFastBootAssets()
	rec = httptest.NewRecorder()
	if !serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, "/", nil), frontend.FS) {
		t.Fatalf("GET / after releaseFastBootAssets was not handled, want rebuild on demand")
	}
	if got := rec.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Errorf("rebuilt GET / Content-Type = %q, want text/html; charset=utf-8", got)
	}
	if body := rec.Body.String(); !strings.Contains(body, "<style>") || strings.Contains(body, `href="css/`) {
		t.Errorf("rebuilt GET / body is not the inlined document")
	}
}

// TestFastBootConcurrencyAndErrorPath hammers the shared cache with concurrent
// serveFastBootAsset and releaseFastBootAssets calls (run under -race in CI) and
// checks that an empty asset tree fails cleanly instead of panicking.
func TestFastBootConcurrencyAndErrorPath(t *testing.T) {
	releaseFastBootAssets()
	t.Cleanup(releaseFastBootAssets)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 12; j++ {
				rec := httptest.NewRecorder()
				serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, "/", nil), frontend.FS)
				serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, fastBootBundlePath, nil), frontend.FS)
			}
		}()
	}
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 12; j++ {
				releaseFastBootAssets()
			}
		}()
	}
	wg.Wait()

	// Whatever the interleaving, the cache must still answer a request.
	releaseFastBootAssets()
	rec := httptest.NewRecorder()
	if !serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, "/", nil), frontend.FS) {
		t.Fatalf("GET / after concurrent churn was not handled")
	}
	if body := rec.Body.String(); !strings.Contains(body, "<style>") {
		t.Errorf("GET / after concurrent churn is not the inlined document")
	}

	// Empty asset tree: index.html is missing, so nothing may be served.
	releaseFastBootAssets()
	empty := fstest.MapFS{}
	if assets := defaultFastBootAssets(empty); assets != nil {
		t.Errorf("defaultFastBootAssets(empty MapFS) = %+v, want nil", assets)
	}
	if _, err := buildFastBootAssets(empty); err == nil {
		t.Errorf("buildFastBootAssets(empty MapFS) succeeded, want an error")
	}
	rec = httptest.NewRecorder()
	if serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, "/", nil), empty) {
		t.Errorf("GET / against an empty MapFS was handled, want false")
	}
	rec = httptest.NewRecorder()
	if serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, fastBootBundlePath, nil), empty) {
		t.Errorf("GET %s against an empty MapFS was handled, want false", fastBootBundlePath)
	}

	// stripFastBootQuery must reject anything io/fs cannot open.
	for _, tc := range []struct{ in, want string }{
		{"css/app.css?v=1.2.3", "css/app.css"},
		{"./js/app.js", "js/app.js"},
		{"/js/app.js", "js/app.js"},
		{"css//a/../b.css", "css/b.css"},
		{"", ""},
		{"?v=1", ""},
		{"../secret.css", ""},
		{"css/../../secret.css", ""},
		{".", ""},
	} {
		if got := stripFastBootQuery(tc.in); got != tc.want {
			t.Errorf("stripFastBootQuery(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}

	releaseFastBootAssets()
}

// TestFastBootDeferredBundleKeepsVoiceInCore verifies that non-critical scripts
// are split into /js/__boot_deferred.js while core voice/recording scripts stay
// in the critical /js/__boot_bundle.js for instant meeting capture.
func TestFastBootDeferredBundleKeepsVoiceInCore(t *testing.T) {
	assets, err := buildFastBootAssets(frontend.FS)
	if err != nil {
		t.Fatalf("buildFastBootAssets: %v", err)
	}
	if len(assets.deferredJS) == 0 || assets.deferredURL == "" {
		t.Fatalf("expected non-empty deferredJS and deferredURL")
	}
	if !strings.Contains(string(assets.indexHTML), assets.deferredURL) {
		t.Errorf("indexHTML does not expose deferredURL %q", assets.deferredURL)
	}
	core := string(assets.bundleJS)
	deferred := string(assets.deferredJS)
	if !strings.Contains(core, "VoiceInput") {
		t.Errorf("core bundle must retain VoiceInput for immediate recording")
	}
	if !strings.Contains(deferred, "SettingsCompact") {
		t.Errorf("deferred bundle should include SettingsCompact")
	}
	rec := httptest.NewRecorder()
	if !serveFastBootAsset(rec, httptest.NewRequest(http.MethodGet, fastBootDeferredPath, nil), frontend.FS) {
		t.Fatalf("GET %s was not handled", fastBootDeferredPath)
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=604800, immutable" {
		t.Errorf("deferred Cache-Control = %q, want immutable", got)
	}
	if len(rec.Body.Bytes()) != len(assets.deferredJS) {
		t.Errorf("deferred body len = %d, want %d", len(rec.Body.Bytes()), len(assets.deferredJS))
	}
}

func TestDefaultFastBootPolicy(t *testing.T) {
	if defaultFastBootPolicy.BundlePath != fastBootBundlePath {
		t.Errorf("BundlePath = %q, want %q", defaultFastBootPolicy.BundlePath, fastBootBundlePath)
	}
	if defaultFastBootPolicy.DeferredPath != fastBootDeferredPath {
		t.Errorf("DeferredPath = %q, want %q", defaultFastBootPolicy.DeferredPath, fastBootDeferredPath)
	}
	if defaultFastBootPolicy.CoreBufInitialCap <= 0 || defaultFastBootPolicy.ImmutableCacheMaxAgeSec <= 0 {
		t.Errorf("invalid policy numeric bounds: cap=%d maxAge=%d", defaultFastBootPolicy.CoreBufInitialCap, defaultFastBootPolicy.ImmutableCacheMaxAgeSec)
	}
	if len(defaultFastBootPolicy.DeferredScripts) == 0 {
		t.Errorf("DeferredScripts must not be empty")
	}
}
