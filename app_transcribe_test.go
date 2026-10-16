package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"syki-sok/pkg/llm"
)

// The cloud is sent the recording as it is: no conversion, the same base64 and type the page recorded.
func TestInputsTranscribeCloudSendsTheRecordingUntouched(t *testing.T) {
	var gotB64, gotMIME, gotPrompt string
	calls := 0
	withStubbedQueryAudio(t, func(prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
		calls++
		gotPrompt, gotB64, gotMIME = prompt, audioBase64, mimeType
		return "こんにちは", nil
	})
	for _, engine := range []string{"", "gemini", "  Gemini "} {
		calls = 0
		got, err := inputsTranscribe(context.Background(), "QUJD", "audio/webm", llm.VoiceConfig{Engine: engine, Prompt: "p"})
		if err != nil || got != "こんにちは" || calls != 1 || gotB64 != "QUJD" || gotMIME != "audio/webm" || gotPrompt != "p" {
			t.Errorf("engine %q: got %q, %v (calls %d, b64 %q, mime %q)", engine, got, err, calls, gotB64, gotMIME)
		}
	}
}

// Asking for the on-device engine never reaches Gemini, whatever happens to the recording (here it is not even audio).
func TestInputsTranscribeLocalNeverCallsGemini(t *testing.T) {
	calls := 0
	withStubbedQueryAudio(t, func(prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
		calls++
		return "from the cloud", nil
	})
	for _, engine := range []string{"whisper-local", " Whisper-Local "} {
		got, err := inputsTranscribe(context.Background(), "QUJD", "audio/wav", llm.VoiceConfig{Engine: engine})
		if calls != 0 {
			t.Fatalf("engine %q reached Gemini", engine)
		}
		if err == nil && got == "from the cloud" {
			t.Fatalf("engine %q answered from the cloud", engine)
		}
	}
	if !isLocalEngine(llm.VoiceConfig{Engine: "whisper-local"}) || isLocalEngine(llm.VoiceConfig{Engine: "gemini"}) || isLocalEngine(llm.VoiceConfig{}) {
		t.Error("isLocalEngine")
	}
}

// A recording on disk goes to the cloud as one request with its own type; the engine of the profile decides, as for base64.
func TestInputsTranscribeFileCloud(t *testing.T) {
	path := filepath.Join(t.TempDir(), "piece.wav")
	if err := os.WriteFile(path, []byte("RIFFxxxx"), 0o644); err != nil {
		t.Fatal(err)
	}
	var gotB64, gotMIME string
	withStubbedQueryAudio(t, func(prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
		gotB64, gotMIME = audioBase64, mimeType
		return "text", nil
	})
	got, err := inputsTranscribeFile(context.Background(), path, "audio/wav", llm.VoiceConfig{})
	if err != nil || got != "text" || gotMIME != "audio/wav" || gotB64 != "UklGRnh4eHg=" {
		t.Errorf("got %q, %v, mime %q, b64 %q", got, err, gotMIME, gotB64)
	}
	if _, err := inputsTranscribeFile(context.Background(), filepath.Join(t.TempDir(), "gone.wav"), "audio/wav", llm.VoiceConfig{}); err == nil {
		t.Error("a missing file is an error")
	}
}

// The meeting's pieces take the engine of the config they are given (the batch profile): the same path and type for each piece, and
// the texts joined.
func TestTranscribeMeetingFilesUsesTheEngineOfTheConfig(t *testing.T) {
	orig := inputsTranscribeFile
	t.Cleanup(func() { inputsTranscribeFile = orig })
	var engines, mimes []string
	inputsTranscribeFile = func(ctx context.Context, path, mime string, cfg llm.VoiceConfig) (string, error) {
		engines = append(engines, cfg.Engine)
		mimes = append(mimes, mime)
		return "text of " + filepath.Base(path), nil
	}
	cfg := parseVoiceRequestConfig(`{"engine":"whisper-local","whisper":{"model":"small-q5_1"}}`)
	got, err := transcribeMeetingFiles([]string{"a.wav", "b.wav"}, cfg)
	if err != nil || got != "text of a.wav\n\ntext of b.wav" {
		t.Errorf("got %q, %v", got, err)
	}
	if strings.Join(engines, ",") != "whisper-local,whisper-local" || strings.Join(mimes, ",") != "audio/wav,audio/wav" {
		t.Errorf("engines %v, mimes %v", engines, mimes)
	}
	if cfg.Whisper.Model != "small-q5_1" {
		t.Errorf("the Whisper block of the request was not read: %+v", cfg.Whisper)
	}
}

// The second stage is a cloud model: with the on-device engine it is skipped, so the text stays on the PC.
func TestRefineIsSkippedForTheLocalEngine(t *testing.T) {
	orig := inputsRefine
	t.Cleanup(func() { inputsRefine = orig })
	calls := 0
	inputsRefine = func(ctx context.Context, raw string, cfg llm.VoiceConfig, rc llm.RefineContext) (string, error) {
		calls++
		return "refined", nil
	}
	cloud := parseVoiceRequestConfig(`{"refine":{"enabled":true}}`)
	if got, errText := refineTranscript("raw", cloud); got != "refined" || errText != "" || calls != 1 {
		t.Errorf("cloud: got %q, %q, calls %d", got, errText, calls)
	}
	local := parseVoiceRequestConfig(`{"engine":"whisper-local","refine":{"enabled":true}}`)
	if got, errText := refineTranscript("raw", local); got != "raw" || errText != "" || calls != 1 {
		t.Errorf("local: got %q, %q, calls %d (the second stage must not run)", got, errText, calls)
	}
}
