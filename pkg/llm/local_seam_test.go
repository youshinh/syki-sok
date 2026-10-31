package llm

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsLocalEndpoint(t *testing.T) {
	locals := []string{
		"http://127.0.0.1:8080/v1",
		"http://localhost:11434",
		"http://localhost:1234/v1",
		"http://192.168.1.50:8000/v1",
		"http://[::1]:5000/v1",
	}
	for _, u := range locals {
		if !IsLocalEndpoint(u) {
			t.Errorf("expected IsLocalEndpoint(%q) = true", u)
		}
	}

	nonLocals := []string{
		"",
		"https://generativelanguage.googleapis.com",
		"https://api.openai.com/v1",
		"http://localhost:8080/v1beta",
	}
	for _, u := range nonLocals {
		if IsLocalEndpoint(u) {
			t.Errorf("expected IsLocalEndpoint(%q) = false", u)
		}
	}
}

func TestQueryAudioLocalOpenAISeam(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		body, _ := io.ReadAll(r.Body)
		bodyStr := string(body)
		if !strings.Contains(bodyStr, `"input_audio"`) || !strings.Contains(bodyStr, `"format":"wav"`) {
			t.Errorf("expected input_audio with format wav in body, got: %s", bodyStr)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]string{
						"content": "<think>reasoning</think>ローカル音声認識テスト成功",
					},
				},
			},
		})
	}))
	defer server.Close()

	// Note: APIKey is empty and model is non-Gemini ("qwen3-omni").
	out, err := QueryAudio("文字起こしして", "UklGRg==", "audio/wav", VoiceConfig{
		BaseURL: server.URL + "/v1",
		Model:   "qwen3-omni",
		APIKey:   "",
		APIStyle: VoiceStyleOpenAI,
	})
	if err != nil {
		t.Fatalf("QueryAudio local seam failed: %v", err)
	}
	if out != "ローカル音声認識テスト成功" {
		t.Errorf("unexpected transcript: %q", out)
	}
}
