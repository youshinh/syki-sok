package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"syki-sok/pkg/components"
	"syki-sok/pkg/llm"
	"syki-sok/pkg/scrap"
	"syki-sok/pkg/speech"
)

const speechTimeout = 5 * time.Minute

var (
	speechServiceNew = func(mgr *components.Manager) *speech.Service {
		return speech.NewService(mgr)
	}
	speechComponentsDir = func() string {
		base, err := os.UserCacheDir()
		if err != nil || base == "" {
			base = os.TempDir()
		}
		return filepath.Join(base, "syki-sok", "components")
	}
	speechScrapAppend = scrap.AppendRaw
	speechTranscribeFile = func(ctx context.Context, svc *speech.Service, cfg llm.VoiceConfig, path, mimeType string) (string, error) {
		return svc.TranscribeFile(ctx, cfg, path, mimeType)
	}
	speechTranscribeBytes = func(ctx context.Context, svc *speech.Service, cfg llm.VoiceConfig, audio []byte, mimeType string) (string, error) {
		return svc.Transcribe(ctx, cfg, audio, mimeType)
	}
)

type speechFileConfig struct {
	ScrapDir string
	Voice    llm.VoiceConfig
	Vision   llm.VisionConfig
}

func loadSpeechFileConfig() speechFileConfig {
	return speechConfigFrom(LoadConfig())
}

func speechConfigFrom(c *Config) speechFileConfig {
	cfg := speechFileConfig{ScrapDir: c.ScrapDir()}
	c.Section("voice", &cfg.Voice)
	c.Section("vision", &cfg.Vision)
	return cfg
}

func (r *HeadlessRunner) runSpeech(args []string) (int, error) {
	fs := flag.NewFlagSet("speech", flag.ContinueOnError)
	fs.SetOutput(r.stderr)
	forceJSON := fs.Bool("json", false, "Force JSON output")
	toScrap := fs.Bool("scrap", false, "Append transcription to daily scrap")
	engine := fs.String("engine", "", "Speech engine: local or gemini (default from config)")
	model := fs.String("model", "", "Model name / ID")
	lang := fs.String("language", "ja", "Language code")
	diarize := fs.Bool("diarize", false, "Enable speaker identification (diarization)")
	enhance := fs.Bool("enhance", false, "Enable background noise reduction")
	timestamps := fs.Bool("timestamps", false, "Prefix output with timestamps")

	if err := fs.Parse(args); err != nil {
		return 1, err
	}

	rest := fs.Args()
	var audioBytes []byte
	var audioPath string
	var mimeType string

	if len(rest) > 0 {
		audioPath = rest[0]
		if _, err := os.Stat(audioPath); err != nil {
			return 1, fmt.Errorf("cannot read %s: %w", audioPath, err)
		}
	} else {
		// Read from stdin if piped
		stdin := r.stdin
		if stdin == nil {
			stdin = os.Stdin
		}
		if f, ok := stdin.(*os.File); ok {
			stat, err := f.Stat()
			if err != nil || (stat.Mode()&os.ModeCharDevice) != 0 {
				return 1, errors.New("usage: syki speech [options] <audioPath> or pipe audio to stdin")
			}
		}
		data, err := io.ReadAll(stdin)
		if err != nil {
			return 1, fmt.Errorf("failed to read audio from standard input: %w", err)
		}
		if len(data) == 0 {
			return 1, errors.New("standard input audio data is empty")
		}
		audioBytes = data
	}

	fileCfg := loadSpeechFileConfig()
	voiceCfg := fileCfg.Voice

	if *engine != "" {
		voiceCfg.Engine = *engine
	}
	if voiceCfg.Engine == "" {
		voiceCfg.Engine = "local"
	}
	if *model != "" {
		voiceCfg.Whisper.Model = *model
	}
	if voiceCfg.Whisper.Model == "" {
		voiceCfg.Whisper.Model = speech.DefaultSpeechModelID()
	}
	if *lang != "" {
		voiceCfg.Whisper.Language = *lang
	}
	if *diarize {
		voiceCfg.Whisper.Diarize = true
	}
	if *enhance {
		voiceCfg.Whisper.Enhance = true
	}
	if *timestamps {
		voiceCfg.Whisper.Timestamps = true
	}
	// Fall back to vision credentials for cloud if needed
	voiceCfg = llm.ResolveVoiceConfig(voiceCfg, fileCfg.Vision)

	mgr := components.NewManager(speechComponentsDir())
	svc := speechServiceNew(mgr)

	ctx, cancel := context.WithTimeout(context.Background(), speechTimeout)
	defer cancel()

	var text string
	var err error
	if audioPath != "" {
		text, err = speechTranscribeFile(ctx, svc, voiceCfg, audioPath, mimeType)
	} else {
		text, err = speechTranscribeBytes(ctx, svc, voiceCfg, audioBytes, mimeType)
	}
	if err != nil {
		return 1, fmt.Errorf("speech transcription failed: %w", err)
	}

	text = strings.TrimSpace(text)
	format := ResolveFormat(*forceJSON)

	var notePath string
	if *toScrap && text != "" {
		entry := fmt.Sprintf("\n### 音声メモ\n\n%s\n", text)
		np, err := speechScrapAppend(fileCfg.ScrapDir, entry, time.Now())
		if err != nil {
			return 1, fmt.Errorf("failed to append to scrap: %w", err)
		}
		notePath = np
	}

	if format == FormatJSON {
		res := map[string]interface{}{
			"text":     text,
			"appended": notePath != "",
		}
		if notePath != "" {
			res["path"] = notePath
		}
		PrintFormatted(r.stdout, FormatJSON, "", res)
	} else {
		if text != "" {
			fmt.Fprintln(r.stdout, text)
		}
		if notePath != "" {
			fmt.Fprintf(r.stderr, "Appended to %s\n", notePath)
		}
	}

	return 0, nil
}
