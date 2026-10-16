package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"strings"

	"syki-sok/pkg/llm"
)

// The transcription every path shares: the engine in cfg decides who does it. Gemini (the default) sends the recording as it is: no
// conversion, nothing between the file and the request, so the cloud is as fast as it can be. "whisper-local" runs the on-device
// engine (pkg/speech), which turns the recording into the WAV whisper-cli reads, one recording at a time.
//
// cfg is already the config of one profile (realtime or batch, see llm.VoiceConfig.ForProfile): the page sends the flat fields of the
// profile the caller belongs to, and the hot folder and Discord resolve it from config.json.

// isLocalEngine reports whether cfg asks for the on-device engine.
func isLocalEngine(cfg llm.VoiceConfig) bool {
	return strings.EqualFold(strings.TrimSpace(cfg.Engine), "whisper-local")
}

// inputsTranscribe transcribes a recording held as base64. A variable so tests never reach the network or run whisper-cli.
var inputsTranscribe = func(ctx context.Context, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
	if isLocalEngine(cfg) {
		return speechService().TranscribeBase64(ctx, cfg, audioBase64, mimeType)
	}
	return inputsQueryAudio(cfg.Prompt, audioBase64, mimeType, cfg)
}

// inputsTranscribeFile transcribes a recording that is a file on disk (a meeting's pieces). The local engine reads the file where it
// lies; the cloud has to read it to send it.
var inputsTranscribeFile = func(ctx context.Context, path, mimeType string, cfg llm.VoiceConfig) (string, error) {
	if isLocalEngine(cfg) {
		return speechService().TranscribeFile(ctx, cfg, path, mimeType)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("録音の読み込みに失敗しました: %w", err)
	}
	return inputsQueryAudio(cfg.Prompt, base64.StdEncoding.EncodeToString(data), mimeType, cfg)
}
