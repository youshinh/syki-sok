package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"syki-sok/pkg/llm"
	"syki-sok/pkg/speech"
)

func TestRunSpeech(t *testing.T) {
	dir := t.TempDir()
	audioPath := filepath.Join(dir, "test.wav")
	if err := os.WriteFile(audioPath, []byte("fake wav bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	oldTranscribeFile := speechTranscribeFile
	oldTranscribeBytes := speechTranscribeBytes
	oldScrapAppend := speechScrapAppend
	t.Cleanup(func() {
		speechTranscribeFile = oldTranscribeFile
		speechTranscribeBytes = oldTranscribeBytes
		speechScrapAppend = oldScrapAppend
	})

	var capturedCfg llm.VoiceConfig
	var capturedPath string
	speechTranscribeFile = func(ctx context.Context, svc *speech.Service, cfg llm.VoiceConfig, path, mimeType string) (string, error) {
		capturedCfg = cfg
		capturedPath = path
		return "[00:00] 話者 0: こんにちは、テストです。", nil
	}

	var capturedBytes []byte
	speechTranscribeBytes = func(ctx context.Context, svc *speech.Service, cfg llm.VoiceConfig, audio []byte, mimeType string) (string, error) {
		capturedCfg = cfg
		capturedBytes = audio
		return "パイプからの音声文字起こし", nil
	}

	t.Run("missing argument without pipe is an error", func(t *testing.T) {
		var out, errOut bytes.Buffer
		r := &HeadlessRunner{stdout: &out, stderr: &errOut, stdin: nil}
		code, err := r.runSpeech([]string{})
		if code == 0 || err == nil {
			t.Errorf("expected error on missing audio argument, got code %d, err %v", code, err)
		}
	})

	t.Run("audio file transcription outputs text to stdout", func(t *testing.T) {
		capturedCfg = llm.VoiceConfig{}
		capturedPath = ""
		var out, errOut bytes.Buffer
		r := &HeadlessRunner{stdout: &out, stderr: &errOut}

		code, err := r.runSpeech([]string{"--engine", "local", "--diarize", "--enhance", "--timestamps", audioPath})
		if code != 0 || err != nil {
			t.Fatalf("runSpeech failed: code %d, err %v", code, err)
		}
		if !strings.Contains(out.String(), "話者 0: こんにちは、テストです。") {
			t.Errorf("stdout = %q, want transcribed text", out.String())
		}
		if capturedPath != audioPath {
			t.Errorf("capturedPath = %q, want %q", capturedPath, audioPath)
		}
		if !capturedCfg.Whisper.Diarize || !capturedCfg.Whisper.Enhance || !capturedCfg.Whisper.Timestamps {
			t.Errorf("expected diarize, enhance, timestamps to be true, got %+v", capturedCfg.Whisper)
		}
	})

	t.Run("piped audio bytes transcribe", func(t *testing.T) {
		capturedCfg = llm.VoiceConfig{}
		capturedBytes = nil
		var out, errOut bytes.Buffer
		stdinBuf := bytes.NewBuffer([]byte("piped audio data"))
		r := &HeadlessRunner{stdout: &out, stderr: &errOut, stdin: stdinBuf}

		code, err := r.runSpeech([]string{"--json"})
		if code != 0 || err != nil {
			t.Fatalf("runSpeech failed: code %d, err %v", code, err)
		}
		if !strings.Contains(out.String(), `"text": "パイプからの音声文字起こし"`) {
			t.Errorf("stdout = %q, want json output", out.String())
		}
		if string(capturedBytes) != "piped audio data" {
			t.Errorf("capturedBytes = %q, want 'piped audio data'", string(capturedBytes))
		}
	})

	t.Run("--scrap flag appends to scrap", func(t *testing.T) {
		var scrapAppended string
		speechScrapAppend = func(scrapDir, content string, at time.Time) (string, error) {
			scrapAppended = content
			return filepath.Join(scrapDir, "2026-11-03.md"), nil
		}

		var out, errOut bytes.Buffer
		r := &HeadlessRunner{stdout: &out, stderr: &errOut}

		code, err := r.runSpeech([]string{"--scrap", audioPath})
		if code != 0 || err != nil {
			t.Fatalf("runSpeech failed: code %d, err %v", code, err)
		}
		if !strings.Contains(scrapAppended, "話者 0: こんにちは、テストです。") {
			t.Errorf("scrapAppended = %q, want transcribed text in scrap", scrapAppended)
		}
	})
}
