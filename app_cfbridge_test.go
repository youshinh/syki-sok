package main

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"syki-sok/pkg/cfbridge"
	"syki-sok/pkg/dropzone"
	"syki-sok/pkg/llm"
)

func TestParseCFBridgeConfig(t *testing.T) {
	t.Run("empty config yields defaults", func(t *testing.T) {
		a := &App{}
		got := a.parseCFBridgeConfig("")
		want := CFBridgeSettings{PollIntervalSeconds: 30}
		if got != want {
			t.Errorf("got %+v, want %+v", got, want)
		}
	})

	t.Run("parses and trims cfBridge block", func(t *testing.T) {
		a := &App{}
		cfg := `{"cfBridge":{"enabled":true,"endpoint":"  https://test.workers.dev/  ","token":"  secret-123  ","pollIntervalSeconds":15}}`
		got := a.parseCFBridgeConfig(cfg)
		want := CFBridgeSettings{Enabled: true, Endpoint: "https://test.workers.dev", Token: "secret-123", PollIntervalSeconds: 15}
		if got != want {
			t.Errorf("got %+v, want %+v", got, want)
		}
	})

	t.Run("missing cfBridge block yields defaults", func(t *testing.T) {
		a := &App{}
		got := a.parseCFBridgeConfig(`{"unrelated": true}`)
		if got.Enabled || got.PollIntervalSeconds != 30 {
			t.Errorf("expected disabled defaults, got %+v", got)
		}
	})

	t.Run("non-positive interval falls back to 30s default", func(t *testing.T) {
		a := &App{}
		got := a.parseCFBridgeConfig(`{"cfBridge":{"pollIntervalSeconds":0}}`)
		if got.PollIntervalSeconds != 30 {
			t.Errorf("expected default interval, got %d", got.PollIntervalSeconds)
		}
	})
}

func TestCFDropConfigs(t *testing.T) {
	cfg := `{"vision":{"apiKey":"vk","model":"vm"},"voice":{"apiKey":"ak","model":"am"}}`
	vision, voice := cfDropConfigs(cfg)
	if vision.APIKey != "vk" || vision.Model != "vm" {
		t.Errorf("unexpected vision: %+v", vision)
	}
	if voice.APIKey != "ak" || voice.Model != "am" {
		t.Errorf("unexpected voice: %+v", voice)
	}
}

func TestCFAttachmentKind(t *testing.T) {
	cases := []struct {
		contentType string
		mime        string
		want        dropzone.Kind
	}{
		{"image", "image/jpeg", dropzone.KindImage},
		{"", "image/png; charset=utf-8", dropzone.KindImage},
		{"audio", "audio/webm", dropzone.KindAudio},
		{"", "video/webm", dropzone.KindAudio},
		{"file", "application/pdf", dropzone.KindFile},
		{"", "text/plain", dropzone.KindFile},
	}
	for _, tc := range cases {
		got := cfAttachmentKind(tc.contentType, tc.mime)
		if got != tc.want {
			t.Errorf("cfAttachmentKind(%q, %q) = %v, want %v", tc.contentType, tc.mime, got, tc.want)
		}
	}
}

func TestTestCFBridgeConnection(t *testing.T) {
	t.Run("fails on empty inputs", func(t *testing.T) {
		a := &App{}
		_, err := a.TestCFBridgeConnection("", "")
		if err == nil {
			t.Fatal("expected error on empty inputs")
		}
	})

	t.Run("verifies successfully with valid bearer token", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer good-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true,"memos":[]}`))
		}))
		defer srv.Close()

		a := &App{}
		res, err := a.TestCFBridgeConnection(srv.URL, "good-token")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res["ok"] != true {
			t.Errorf("expected ok=true, got %+v", res)
		}

		// Wrong token
		_, err = a.TestCFBridgeConnection(srv.URL, "bad-token")
		if err == nil {
			t.Fatal("expected unauthorized error")
		}
	})
}

func TestHandleCFMemosAt(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "syki-test-scraps-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	a := &App{}
	// Set scrap dir via config
	cfgJSON := `{"scrap_dir": "` + filepath.ToSlash(tmpDir) + `"}`
	_, _ = a.SaveConfig(cfgJSON)

	now := time.Date(2026, 10, 24, 15, 30, 0, 0, time.Local)
	memos := []cfbridge.Memo{
		{
			ID:          "memo-1",
			Device:      "Pixel 9",
			ContentType: "text",
			TextContent: "Quick thought from mobile",
			ClientTime:  "2026-10-24T15:30:00+09:00",
		},
		{
			ID:               "memo-2",
			Device:           "Pixel 9",
			ContentType:      "file",
			Filename:         "hello.txt",
			FileMime:         "text/plain",
			AttachmentBase64: base64.StdEncoding.EncodeToString([]byte("file content here")),
			ClientTime:       "2026-10-24T15:31:00+09:00",
		},
	}

	err = a.handleCFMemosAt(memos, llm.VisionConfig{}, llm.VoiceConfig{}, now)
	if err != nil {
		t.Fatalf("handleCFMemosAt failed: %v", err)
	}

	dailyFile := filepath.Join(tmpDir, "2026-10-24.md")
	content, err := os.ReadFile(dailyFile)
	if err != nil {
		t.Fatalf("failed to read daily file: %v", err)
	}

	strContent := string(content)
	if !strings.Contains(strContent, "## Mobile [") {
		t.Errorf("expected Mobile header, got:\n%s", strContent)
	}
	if !strings.Contains(strContent, "Quick thought from mobile") {
		t.Errorf("expected text content, got:\n%s", strContent)
	}
	if !strings.Contains(strContent, "hello.txt") {
		t.Errorf("expected file section for hello.txt, got:\n%s", strContent)
	}
}

func TestCFSanitizeFilename(t *testing.T) {
	raw := "bad\x00file\nname\t.png"
	clean := cfSanitizeFilename(raw)
	if strings.ContainsAny(clean, "\x00\n\t") {
		t.Errorf("expected control characters removed, got %q", clean)
	}
}

func TestHandleCFMemosSavesToDefaultNoteDir(t *testing.T) {
	tmpDir := t.TempDir()
	customDir := filepath.Join(tmpDir, "my_custom_notes")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}

	a := &App{}
	cfg := fmt.Sprintf(`{"general":{"defaultNoteDir":%q}}`, customDir)
	if _, err := a.SaveConfig(cfg); err != nil {
		t.Fatal(err)
	}

	if got := a.GetDefaultNoteDir(); got != customDir {
		t.Errorf("GetDefaultNoteDir() = %q, want %q", got, customDir)
	}

	now := time.Date(2026, 10, 24, 15, 30, 0, 0, time.Local)
	memos := []cfbridge.Memo{
		{
			ID:          "memo-custom",
			Device:      "Pixel 9",
			ContentType: "text",
			TextContent: "Testing save to defaultNoteDir",
			ClientTime:  "2026-10-24T15:30:00+09:00",
		},
	}

	err := a.handleCFMemosAt(memos, llm.VisionConfig{}, llm.VoiceConfig{}, now)
	if err != nil {
		t.Fatalf("handleCFMemosAt failed: %v", err)
	}

	expectedFile := filepath.Join(customDir, "2026-10-24.md")
	content, err := os.ReadFile(expectedFile)
	if err != nil {
		t.Fatalf("expected memo in %s, but file not found: %v", expectedFile, err)
	}
	if !strings.Contains(string(content), "Testing save to defaultNoteDir") {
		t.Errorf("expected memo content in custom file, got: %s", string(content))
	}
}
