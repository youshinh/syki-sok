package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"syki-sok/pkg/llm"
	"syki-sok/pkg/sysaudio"
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

func TestSniffRecordingMIME(t *testing.T) {
	cases := map[string]string{
		"\x00\x00\x00\x24ftypisom....": "audio/mp4",
		"OggS\x00\x02":                 "audio/ogg",
		"RIFF\x00\x00\x00\x00WAVEfmt ": "audio/wav",
		"\x1a\x45\xdf\xa3webm":         "audio/webm",
		"fake-audio":                   "audio/webm",
		"":                             "audio/webm",
	}
	for in, want := range cases {
		if got := sniffRecordingMIME([]byte(in)); got != want {
			t.Errorf("sniffRecordingMIME(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseVoiceConfigJSONDefaultsToHaasQ8(t *testing.T) {
	for _, raw := range []string{"", "{}", `{"engine":"whisper-local"}`, `{"whisper":{"model":"   "}}`} {
		cfg := parseVoiceConfigJSON(raw)
		if cfg.Whisper.Model != "haas-ja-v1.0-q8_0" {
			t.Errorf("parseVoiceConfigJSON(%q).Whisper.Model = %q, want haas-ja-v1.0-q8_0", raw, cfg.Whisper.Model)
		}
	}
	explicit := parseVoiceConfigJSON(`{"whisper":{"model":"haas-ja-v1.0-q4_k"}}`)
	if explicit.Whisper.Model != "haas-ja-v1.0-q4_k" {
		t.Errorf("expected explicit model preserved, got %q", explicit.Whisper.Model)
	}
}

func makeTestWAVBytes(seconds int) []byte {
	dataBytes := sysaudio.SampleRate * 2 * seconds
	h := make([]byte, 44)
	copy(h[0:], "RIFF")
	binary.LittleEndian.PutUint32(h[4:], uint32(36+dataBytes))
	copy(h[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(h[16:], 16)
	binary.LittleEndian.PutUint16(h[20:], 1)
	binary.LittleEndian.PutUint16(h[22:], 1)
	binary.LittleEndian.PutUint32(h[24:], sysaudio.SampleRate)
	binary.LittleEndian.PutUint32(h[28:], sysaudio.SampleRate*2)
	binary.LittleEndian.PutUint16(h[32:], 2)
	binary.LittleEndian.PutUint16(h[34:], 16)
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], uint32(dataBytes))
	out := make([]byte, len(h)+dataBytes)
	copy(out, h)
	return out
}

func TestInputsTranscribeFile_SplitsLongWAVForLocalAudioLLM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "long.wav")
	if err := os.WriteFile(path, makeTestWAVBytes(150), 0o644); err != nil {
		t.Fatal(err)
	}

	var chunkDataLens []int
	var gotTimeouts []int
	withStubbedQueryAudio(t, func(prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
		raw, err := base64.StdEncoding.DecodeString(audioBase64)
		if err != nil {
			return "", err
		}
		chunkDataLens = append(chunkDataLens, len(raw)-44)
		gotTimeouts = append(gotTimeouts, cfg.Timeout)
		return fmt.Sprintf("chunk-%d", len(chunkDataLens)), nil
	})

	cfg := llm.VoiceConfig{
		BaseURL:  "http://127.0.0.1:8080/v1",
		Model:    "qwen3-omni",
		APIStyle: llm.VoiceStyleOpenAI,
	}
	got, err := inputsTranscribeFile(context.Background(), path, "audio/wav", cfg)
	if err != nil {
		t.Fatalf("inputsTranscribeFile failed: %v", err)
	}
	if got != "chunk-1\n\nchunk-2\n\nchunk-3" {
		t.Fatalf("got %q, want 3 joined chunks", got)
	}
	wantLens := []int{sysaudio.SampleRate * 2 * 60, sysaudio.SampleRate * 2 * 60, sysaudio.SampleRate * 2 * 30}
	if len(chunkDataLens) != 3 {
		t.Fatalf("expected 3 calls, got %d (%v)", len(chunkDataLens), chunkDataLens)
	}
	for i := range wantLens {
		if chunkDataLens[i] != wantLens[i] {
			t.Errorf("chunk %d len = %d, want %d", i, chunkDataLens[i], wantLens[i])
		}
		if gotTimeouts[i] != localAudioLLMDefaultTimeoutSec {
			t.Errorf("chunk %d timeout = %d, want %d", i, gotTimeouts[i], localAudioLLMDefaultTimeoutSec)
		}
	}
}

func TestInputsTranscribeFile_DoesNotSplitForCloudGemini(t *testing.T) {
	path := filepath.Join(t.TempDir(), "long_cloud.wav")
	orig := makeTestWAVBytes(150)
	if err := os.WriteFile(path, orig, 0o644); err != nil {
		t.Fatal(err)
	}

	calls := 0
	var gotLen int
	withStubbedQueryAudio(t, func(prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
		calls++
		raw, err := base64.StdEncoding.DecodeString(audioBase64)
		if err != nil {
			return "", err
		}
		gotLen = len(raw)
		return "cloud-whole", nil
	})

	cfg := llm.VoiceConfig{
		BaseURL: "https://generativelanguage.googleapis.com",
		APIKey:  "k",
		Model:   "gemini-3.5-transcribe",
	}
	got, err := inputsTranscribeFile(context.Background(), path, "audio/wav", cfg)
	if err != nil {
		t.Fatalf("inputsTranscribeFile failed: %v", err)
	}
	if got != "cloud-whole" || calls != 1 || gotLen != len(orig) {
		t.Fatalf("cloud should send whole file in 1 call: got=%q calls=%d len=%d (want %d)", got, calls, gotLen, len(orig))
	}
}

func TestQueryAudioGuarded_SerializesLocalAudioLLM(t *testing.T) {
	var inFlight int32
	var maxInFlight int32
	withStubbedQueryAudio(t, func(prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
		cur := atomic.AddInt32(&inFlight, 1)
		for {
			prev := atomic.LoadInt32(&maxInFlight)
			if cur <= prev || atomic.CompareAndSwapInt32(&maxInFlight, prev, cur) {
				break
			}
		}
		time.Sleep(25 * time.Millisecond)
		atomic.AddInt32(&inFlight, -1)
		return "ok", nil
	})

	cfg := llm.VoiceConfig{
		BaseURL:  "http://127.0.0.1:8080/v1",
		Model:    "qwen3-omni",
		APIStyle: llm.VoiceStyleOpenAI,
	}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := inputsTranscribe(context.Background(), "QUJD", "audio/wav", cfg); err != nil {
				t.Errorf("inputsTranscribe failed: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := atomic.LoadInt32(&maxInFlight); got != 1 {
		t.Fatalf("expected max concurrent local audio LLM calls = 1, got %d", got)
	}
}

func TestQueryAudioGuarded_SetsDefault300sTimeoutForLocalAudioLLM(t *testing.T) {
	var gotTimeout int
	withStubbedQueryAudio(t, func(prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
		gotTimeout = cfg.Timeout
		return "ok", nil
	})
	cfg := llm.VoiceConfig{
		BaseURL: "http://localhost:1234/v1",
		Model:   "gemma",
	}
	if _, err := inputsTranscribe(context.Background(), "QUJD", "audio/wav", cfg); err != nil {
		t.Fatalf("inputsTranscribe failed: %v", err)
	}
	if gotTimeout != 300 {
		t.Fatalf("expected default 300s timeout for local audio LLM, got %d", gotTimeout)
	}
}
