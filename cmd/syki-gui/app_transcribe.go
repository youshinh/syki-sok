package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"sync"

	"syki-sok/pkg/llm"
	"syki-sok/pkg/speech"
	"syki-sok/pkg/sysaudio"
)

// The transcription every path shares: the engine in cfg decides who does it. Gemini (the default) sends the recording as it is: no
// conversion, nothing between the file and the request, so the cloud is as fast as it can be. "whisper-local" runs the on-device
// engine (pkg/speech), which turns the recording into the WAV whisper-cli reads, one recording at a time.
//
// cfg is already the config of one profile (realtime or batch, see llm.VoiceConfig.ForProfile): the page sends the flat fields of the
// profile the caller belongs to, and the hot folder and Discord resolve it from config.json.

const (
	localLLMAudioChunkSeconds      = 60
	localAudioLLMDefaultTimeoutSec = 300
)

var localAudioLLMGate = make(chan struct{}, 1)

// isLocalEngine reports whether cfg asks for the on-device engine.
func isLocalEngine(cfg llm.VoiceConfig) bool {
	s := strings.ToLower(strings.TrimSpace(cfg.Engine))
	return s == "whisper-local" || s == "speech-local" || s == "local"
}

// isLocalAudioLLM reports whether cfg routes audio through a local or OpenAI-compatible LLM endpoint.
func isLocalAudioLLM(cfg llm.VoiceConfig) bool {
	if isLocalEngine(cfg) {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(cfg.APIStyle), llm.VoiceStyleOpenAI) || llm.IsLocalEndpoint(cfg.BaseURL)
}

func acquireLocalAudioGate(ctx context.Context) (func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case localAudioLLMGate <- struct{}{}:
		var once sync.Once
		return func() { once.Do(func() { <-localAudioLLMGate }) }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func queryAudioGuarded(ctx context.Context, prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
	if isLocalAudioLLM(cfg) {
		release, err := acquireLocalAudioGate(ctx)
		if err != nil {
			return "", err
		}
		defer release()
		if cfg.Timeout <= 0 {
			cfg.Timeout = localAudioLLMDefaultTimeoutSec
		}
	}
	return inputsQueryAudio(prompt, audioBase64, mimeType, cfg)
}

// inputsTranscribe transcribes a recording held as base64. A variable so tests never reach the network or run whisper-cli.
var inputsTranscribe = func(ctx context.Context, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
	if isLocalEngine(cfg) {
		if strings.TrimSpace(cfg.Whisper.Model) == "" {
			cfg.Whisper.Model = speech.DefaultSpeechModelID()
		}
		return speechService().TranscribeBase64(ctx, cfg, audioBase64, mimeType)
	}
	return queryAudioGuarded(ctx, cfg.Prompt, audioBase64, mimeType, cfg)
}

// inputsTranscribeFile transcribes a recording that is a file on disk (a meeting's pieces). The local engine reads the file where it
// lies; the cloud has to read it to send it. Local audio LLMs split long WAV files into 60-second chunks to stay within VRAM/context limits.
var inputsTranscribeFile = func(ctx context.Context, path, mimeType string, cfg llm.VoiceConfig) (string, error) {
	if isLocalEngine(cfg) {
		if strings.TrimSpace(cfg.Whisper.Model) == "" {
			cfg.Whisper.Model = speech.DefaultSpeechModelID()
		}
		return speechService().TranscribeFile(ctx, cfg, path, mimeType)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("録音の読み込みに失敗しました: %w", err)
	}
	if isLocalAudioLLM(cfg) && (strings.EqualFold(strings.TrimSpace(mimeType), "audio/wav") || sniffRecordingMIME(data) == "audio/wav") {
		chunks := sysaudio.SplitWAVBytes(data, localLLMAudioChunkSeconds)
		if len(chunks) > 1 {
			var parts []string
			for _, chunk := range chunks {
				if err := ctx.Err(); err != nil {
					return "", err
				}
				text, err := queryAudioGuarded(ctx, cfg.Prompt, base64.StdEncoding.EncodeToString(chunk), "audio/wav", cfg)
				if err != nil {
					return "", err
				}
				if t := strings.TrimSpace(text); t != "" {
					parts = append(parts, t)
				}
			}
			return strings.Join(parts, "\n\n"), nil
		}
	}
	return queryAudioGuarded(ctx, cfg.Prompt, base64.StdEncoding.EncodeToString(data), mimeType, cfg)
}
