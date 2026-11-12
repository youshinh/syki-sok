package speech

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"syki-sok/pkg/components"
	"syki-sok/pkg/llm"
)

const (
	engineGemini        = "gemini"
	engineWhisperLocal  = "whisper-local"
	engineSpeechLocal   = "speech-local"
	engineLocal         = "local"
	transcriptFileName  = "transcript"
	silencePeak         = 64 // of 32768, about -54 dBFS; below this a recording holds no speech
	minAutoThreads      = 2
	maxAutoThreads      = 8
	installHintSettings = "設定の音声入力からインストールしてください"
)

var ErrNotInstalled = errors.New("speech: local Whisper is not installed")

type notInstalledError string

func (e notInstalledError) Error() string        { return string(e) }
func (e notInstalledError) Is(target error) bool { return target == ErrNotInstalled }

type PartStore interface {
	Path(p components.Part) (string, bool)
}

var queryGeminiAudio = llm.QueryAudio

type Service struct {
	store    PartStore
	tempRoot string
}

func NewService(store PartStore) *Service { return &Service{store: store} }

func (s *Service) Transcribe(ctx context.Context, cfg llm.VoiceConfig, audio []byte, mimeType string) (string, error) {
	return s.dispatch(ctx, cfg, audioInput{data: audio, mime: mimeType})
}

func (s *Service) TranscribeBase64(ctx context.Context, cfg llm.VoiceConfig, audioBase64, mimeType string) (string, error) {
	audioBase64 = strings.TrimSpace(audioBase64)
	if idx := strings.Index(audioBase64, ","); idx != -1 {
		if mimeType == "" {
			if head, ok := strings.CutPrefix(audioBase64[:idx], "data:"); ok {
				mimeType, _, _ = strings.Cut(head, ";")
			}
		}
		audioBase64 = strings.TrimSpace(audioBase64[idx+1:])
	}
	return s.dispatch(ctx, cfg, audioInput{b64: audioBase64, mime: mimeType})
}

func (s *Service) TranscribeFile(ctx context.Context, cfg llm.VoiceConfig, path, mimeType string) (string, error) {
	return s.dispatch(ctx, cfg, audioInput{path: path, mime: mimeType})
}

func (s *Service) dispatch(ctx context.Context, cfg llm.VoiceConfig, in audioInput) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Engine)) {
	case "", engineGemini:
		return s.transcribeCloud(cfg, in)
	case engineWhisperLocal, engineSpeechLocal, engineLocal:
		text, err := s.transcribeLocal(ctx, cfg, in)
		if err == nil || !cfg.Whisper.CloudFallback || ctx.Err() != nil {
			return text, err
		}
		text, cerr := s.transcribeCloud(cfg, in)
		if cerr != nil {
			return "", fmt.Errorf("%w (Gemini での再試行も失敗しました: %v)", err, cerr)
		}
		return text, nil
	}
	return "", fmt.Errorf("不明な音声認識エンジンです: %q (指定できるのは gemini / whisper-local / speech-local)", cfg.Engine)
}

func (s *Service) transcribeCloud(cfg llm.VoiceConfig, in audioInput) (string, error) {
	b64 := in.b64
	switch {
	case b64 != "":
	case in.path != "":
		raw, err := os.ReadFile(in.path)
		if err != nil {
			return "", fmt.Errorf("音声ファイルを読み取れません: %w", err)
		}
		b64 = base64.StdEncoding.EncodeToString(raw)
	default:
		b64 = base64.StdEncoding.EncodeToString(in.data)
	}
	mime := in.mime
	if mime == "" {
		if head, err := in.head(); err == nil {
			if detected := formatMIME(sniffFormat(head)); detected != "" {
				mime = detected
			}
		}
	}
	return queryGeminiAudio(cfg.Prompt, b64, mime, cfg)
}

var localGate = make(chan struct{}, 1)

func acquireLocalGate(ctx context.Context) (func(), error) {
	select {
	case localGate <- struct{}{}:
		return func() { <-localGate }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *Service) runtimeFor(w llm.WhisperSettings, info ModelInfo, modelPath string) (string, string, error) {
	rt := ModelRuntime(w, info.Format)
	id := effectiveModelID(w)
	if id != modelCustomPath && id != modelCustomURL {
		if rt == RuntimeWhisper && info.Format == "gguf" {
			return "", "", fmt.Errorf("Whisper の ggml 形式のモデルではありません(GGUF 形式のファイルです)。whisper.cpp 用の ggml-*.bin を指定してください: %s", modelPath)
		}
		if rt == RuntimeSpeech && info.Format == "ggml" {
			return "", "", fmt.Errorf("speech.cpp 用の GGUF 形式のモデルではありません(ggml 形式のファイルです): %s", modelPath)
		}
	}
	part, ok := RuntimePartFor(rt)
	if !ok {
		return "", "", fmt.Errorf("この環境(%s)ではこのモデルのローカル音声認識に対応していません", hostPlatform())
	}
	path, ok := s.partPath(part)
	if !ok {
		return "", "", notInstalledError("ローカル音声認識の実行ファイルが未インストールです。" + installHintSettings)
	}
	return rt, path, nil
}

func (s *Service) transcribeLocal(ctx context.Context, cfg llm.VoiceConfig, in audioInput) (string, error) {
	w := cfg.Whisper
	modelPath, err := s.locateModel(w)
	if err != nil {
		return "", err
	}
	info, err := ValidateModelFile(modelPath)
	if err != nil {
		return "", err
	}

	rt, exe, err := s.runtimeFor(w, info, modelPath)
	if err != nil {
		return "", err
	}

	if in.b64 != "" {
		if in.data, err = decodeBase64(in.b64); err != nil {
			return "", err
		}
		in.b64 = ""
	}

	release, err := acquireLocalGate(ctx)
	if err != nil {
		return "", err
	}
	defer release()

	dir, err := os.MkdirTemp(s.tempRoot, "syki-speech-")
	if err != nil {
		return "", fmt.Errorf("作業用フォルダを作れません: %w", err)
	}
	defer os.RemoveAll(dir)

	wav, stats, err := prepareWAV(ctx, in, dir)
	if err != nil {
		return "", err
	}
	if stats.samples == 0 {
		return "", errors.New("音声データが空です")
	}
	if stats.peak < silencePeak {
		return "", nil
	}

	threads := w.Threads
	if threads <= 0 {
		threads = autoThreads(runtime.NumCPU())
	}

	// speech.cpp runner
	if rt == RuntimeSpeech {
		job := speechJob{
			model:      modelPath,
			wav:        wav,
			threads:    threads,
			device:     "cpu",
			timestamps: w.Timestamps || w.Diarize,
		}
		for _, addon := range RequiredAddons(w) {
			if ap, ok := s.partPath(addon.Part); ok {
				switch addon.Role {
				case RoleVAD:
					job.vad = ap
				case RoleDiarize:
					job.diarize = ap
				case RoleEnhance:
					job.enhance = ap
				}
			}
		}
		text, err := execSpeech(ctx, exe, job.args())
		if err != nil {
			return "", err
		}
		return cleanTranscript(text), nil
	}

	// whisper-cli runner
	job := whisperJob{
		model:     modelPath,
		wav:       wav,
		lang:      whisperLanguage(w.Language, info.Multilingual),
		threads:   threads,
		outPrefix: filepath.Join(dir, transcriptFileName),
		prompt:    whisperPrompt(w.Prompt, cfg.CustomVocabulary),
	}
	if err := execWhisper(ctx, exe, job.args()); err != nil {
		return "", err
	}
	raw, err := os.ReadFile(job.outPrefix + ".txt")
	if err != nil {
		return "", fmt.Errorf("whisper-cli の出力を読み取れません: %w", err)
	}
	return cleanTranscript(string(raw)), nil
}

const maxWhisperPromptRunes = 200

func whisperPrompt(prompt string, vocabulary []string) string {
	out := strings.TrimSpace(prompt)
	if r := []rune(out); len(r) > maxWhisperPromptRunes {
		out = string(r[:maxWhisperPromptRunes])
	}
	seen := map[string]bool{}
	var terms []string
	used := len([]rune(out))
	for _, v := range vocabulary {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		add := len([]rune(v))
		if len(terms) > 0 || out != "" {
			add += 2
		}
		if used+add > maxWhisperPromptRunes {
			continue
		}
		terms = append(terms, v)
		used += add
	}
	if len(terms) == 0 {
		return out
	}
	list := strings.Join(terms, ", ")
	if out == "" {
		return list
	}
	return out + ", " + list
}

func decodeBase64(s string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		var rawErr error
		if raw, rawErr = base64.RawStdEncoding.DecodeString(strings.TrimRight(s, "=")); rawErr != nil {
			return nil, errors.New("音声データ(base64)を読み取れません")
		}
	}
	return raw, nil
}

func autoThreads(cpus int) int { return min(max(cpus/2, minAutoThreads), maxAutoThreads) }

func whisperLanguage(lang string, multilingual bool) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	switch {
	case !multilingual:
		return "en"
	case lang == "":
		return "auto"
	}
	return lang
}

func isEnglish(lang string) bool {
	lang = strings.ToLower(strings.TrimSpace(lang))
	return lang == "en" || lang == "english"
}

func cleanTranscript(raw string) string {
	raw = strings.ToValidUTF8(strings.TrimPrefix(raw, "\xef\xbb\xbf"), "")
	var lines []string
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.EqualFold(line, "[BLANK_AUDIO]") {
			continue
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

func (s *Service) partPath(p components.Part) (string, bool) {
	if s == nil || s.store == nil {
		return "", false
	}
	path, ok := s.store.Path(p)
	return path, ok && path != ""
}

func (s *Service) locateModel(w llm.WhisperSettings) (string, error) {
	id := effectiveModelID(w)
	if id == modelCustomPath {
		path := strings.TrimSpace(w.ModelPath)
		if path == "" {
			return "", errors.New("モデルファイルのパスが指定されていません")
		}
		if st, err := os.Stat(path); err != nil || st.IsDir() {
			return "", fmt.Errorf("モデルファイルが見つかりません: %s", path)
		}
		return path, nil
	}
	part, ok := ResolveModelPart(w)
	if !ok {
		if id == modelCustomURL {
			return "", errors.New("カスタムモデルの URL が指定されていません")
		}
		return "", fmt.Errorf("不明なモデルです: %s", id)
	}
	if path, ok := s.partPath(part); ok {
		return path, nil
	}
	return "", notInstalledError(fmt.Sprintf("音声認識モデル「%s」が未インストールです。%s", part.Title, installHintSettings))
}

type LocalStatus struct {
	Supported        bool   `json:"supported"`
	RuntimeInstalled bool   `json:"runtimeInstalled"`
	ModelID          string `json:"modelId"`
	ModelInstalled   bool   `json:"modelInstalled"`
	ModelPath        string `json:"modelPath"`
	Multilingual     bool   `json:"multilingual"`
	ModelWarning     string `json:"modelWarning"`
	Ready            bool   `json:"ready"`
	Reason           string `json:"reason"`
}

func (s *Service) LocalStatus(cfg llm.VoiceConfig) LocalStatus {
	w := cfg.Whisper
	modelID := effectiveModelID(w)
	st := LocalStatus{ModelID: modelID}
	var runtimeReason string
	var modelReason string

	path, err := s.locateModel(w)
	var info ModelInfo
	if err != nil {
		modelReason = err.Error()
	} else {
		st.ModelInstalled, st.ModelPath = true, path
		var verr error
		info, verr = ValidateModelFile(path)
		if verr != nil {
			st.ModelWarning = verr.Error()
			modelReason = st.ModelWarning
		} else {
			st.Multilingual = info.Multilingual
		}
	}

	rt := ModelRuntime(w, info.Format)
	id := effectiveModelID(w)
	if id != modelCustomPath && id != modelCustomURL && info.Format != "" {
		if rt == RuntimeWhisper && info.Format == "gguf" {
			st.ModelWarning = fmt.Sprintf("Whisper の ggml 形式のモデルではありません(GGUF 形式のファイルです)。whisper.cpp 用の ggml-*.bin を指定してください: %s", path)
			if modelReason == "" {
				modelReason = st.ModelWarning
			}
		} else if rt == RuntimeSpeech && info.Format == "ggml" {
			st.ModelWarning = fmt.Sprintf("speech.cpp 用の GGUF 形式のモデルではありません(ggml 形式のファイルです): %s", path)
			if modelReason == "" {
				modelReason = st.ModelWarning
			}
		}
	}

	if rt == RuntimeWhisper && info.Format != "" && !info.Multilingual && !isEnglish(w.Language) {
		st.ModelWarning = "このモデルは英語専用です。日本語などは認識できません。多言語モデルか kotoba-whisper を選んでください"
	}

	if rt != "" {
		part, ok := RuntimePartFor(rt)
		if !ok {
			runtimeReason = "この環境ではローカル音声認識に対応していません"
		} else {
			st.Supported = true
			if _, st.RuntimeInstalled = s.partPath(part); !st.RuntimeInstalled {
				runtimeReason = "ローカル音声認識の実行ファイルが未インストールです"
			}
		}
	}

	reason := runtimeReason
	if reason == "" {
		reason = modelReason
	}
	st.Ready, st.Reason = reason == "", reason
	return st
}
