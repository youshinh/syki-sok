package speech

import (
	"crypto/sha256"
	"encoding/hex"
	"runtime"
	"strings"

	"syki-sok/pkg/components"
	"syki-sok/pkg/llm"
)

const (
	defaultModelID       = "kotoba-v2.0-q5_0"
	defaultSpeechModelID = "haas-ja-v1.0-q8_0"
	modelCustomPath      = "custom-path"
	modelCustomURL       = "custom-url"

	hfWhisperCpp = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"
	hfKotoba     = "https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml/resolve/main/"
	hfHaas       = "https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/resolve/main/"
	hfSilero     = "https://huggingface.co/sakasegawa/silero-vad-GGUF/resolve/main/"
	hfDiarize    = "https://huggingface.co/sakasegawa/Nemotron-3-Diarization-GGUF/resolve/main/"
	hfEnhance    = "https://huggingface.co/sakasegawa/NVIDIA-NemotronLabs-RE-USE-GGUF/resolve/main/"
)

var hostPlatform = func() string { return runtime.GOOS + "/" + runtime.GOARCH }

func runtimeCatalogPart() components.Part {
	return components.Part{
		ID:       "whisper-runtime-b5130-win-x64",
		Kind:     "runtime",
		Title:    "Whisper 実行ファイル (whisper.cpp b5130 / Windows x64 CPU)",
		Note:     "音声認識を実行する小さなプログラム(約9MB)",
		URL:      "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip",
		SHA256:   "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c",
		Size:     8573270,
		Archive:  "zip",
		Extract:  []string{"whisper-cli.exe", "whisper.dll", "ggml*.dll"},
		Entry:    "whisper-cli.exe",
		Platform: "windows/amd64",
	}
}

func speechRuntimeCatalogParts() []components.Part {
	return []components.Part{
		{
			ID:       "speech-runtime-v0.10.1-win-x64",
			Kind:     "runtime",
			Title:    "speech.cpp 実行ファイル (v0.10.1 / Windows x64 AVX2/Vulkan)",
			Note:     "軽量・高速なローカル音声認識エンジン(約28MB)",
			URL:      "https://github.com/nyosegawa/speech.cpp/releases/download/v0.10.1/speech-0.10.1-windows-x64-vulkan.zip",
			SHA256:   "a8fe0e4b4f463c460e7ace9d38c363bec08b254cac5a7f764b7967af35d4fa1a",
			Size:     29548632,
			Archive:  "zip",
			Extract:  []string{"speech.exe", "speech.dll"},
			Entry:    "speech.exe",
			Platform: "windows/amd64",
		},
		{
			ID:       "speech-runtime-v0.10.1-darwin-arm64",
			Kind:     "runtime",
			Title:    "speech.cpp 実行ファイル (v0.10.1 / macOS Apple Silicon Metal)",
			Note:     "Apple Silicon Metal 最適化ローカル音声認識エンジン(約6MB)",
			URL:      "https://github.com/nyosegawa/speech.cpp/releases/download/v0.10.1/speech-0.10.1-macos-arm64-metal.zip",
			SHA256:   "ff24f6f58c9d2dedb01caa88ba043ae845c76eff228e4cbfae5de749174404c1",
			Size:     6092040,
			Archive:  "zip",
			Extract:  []string{"speech", "libspeech*.dylib"},
			Entry:    "speech",
			Platform: "darwin/arm64",
		},
	}
}

func speechModelCatalogParts() []components.Part {
	model := func(id, title, note, base, file, sum string, size int64) components.Part {
		return components.Part{ID: id, Kind: "model", Title: title, Note: note, URL: base + file, SHA256: sum, Size: size, Entry: file}
	}
	return []components.Part{
		model(defaultSpeechModelID, "Haas-ja v1.0 量子化版(q8_0・推奨)",
			"日本語特化の超高速・高精度ストリーミング対応ASRモデル。約626MB。元モデルと精度差ほぼゼロ",
			hfHaas, "Haas-616M-ja-v1.0-Q8_0.gguf", "9dffbc7235614a2f046393ec232eea55d5495dd512da3202d6497fd03a55360f", 656381472),
		model("haas-ja-v1.0-q4_k", "Haas-ja v1.0 超軽量版(q4_k)",
			"メモリ消費約350MBの極小・高速ASRモデル。一般的なノートPCで超低負荷動作",
			hfHaas, "Haas-616M-ja-v1.0-Q4_K.gguf", "d24d53f29b75214a933ff482b0de1217e0a800f4118cca39ad6cf03609a89d6f", 351901216),
		model("silero-vad", "Silero VAD v6.2 (音声区間検出)",
			"リアルタイム無音検知・発話区切りモデル。約1.2MB。ストリーミング認識に必須",
			hfSilero, "silero-vad-309K-v6.2-F32.gguf", "2fc312514e5fc4fa4ffd02b25c76a4853fa4130e8fb9777d01502183b01238cb", 1238624),
		model("nemotron-3-diarization", "Nemotron-3 Diarization (話者識別)",
			"会議録音で発言者を分離・識別するモデル。約106MB",
			hfDiarize, "Nemotron-3-Diarization-99M-Q8_0.gguf", "336df6350dce2ea5ff06aa6e2b249d331a859ced13305fbb45c44bdb3c0abe20", 106179488),
		model("re-use", "RE-USE (ノイズ除去・音声強調)",
			"会議やカフェの環境ノイズを除去するモデル。約38MB",
			hfEnhance, "NVIDIA-NemotronLabs-RE-USE-10M-F32.gguf", "827faf209c6988b9cfd07b08ee7f212a7b2eeb7870a25380df671d55338b3879", 38519136),
	}
}

func modelCatalogParts() []components.Part {
	model := func(id, title, note, base, file, sum string, size int64) components.Part {
		return components.Part{ID: id, Kind: "model", Title: title, Note: note, URL: base + file, SHA256: sum, Size: size, Entry: file}
	}
	return []components.Part{
		model(defaultModelID, "kotoba-whisper v2.0 量子化版(日本語特化・推奨)",
			"日本語に特化した高精度モデル。約513MB。フル精度版よりわずかに精度が落ちる代わりに小さく速い",
			hfKotoba, "ggml-kotoba-whisper-v2.0-q5_0.bin", "4a3b92192b5d3578ff854a5876213e2e27af0c2d357492c2d14271e82c303658", 537819875),
		model("kotoba-v2.0", "kotoba-whisper v2.0 フル精度版(日本語特化)",
			"日本語に特化した最高精度のモデル。約1.4GB。ディスクとメモリを多く使うぶん、量子化版よりわずかに正確",
			hfKotoba, "ggml-kotoba-whisper-v2.0.bin", "eff70a8a236e731abba774ba71e1f6d0fce53302137208c32207e694e0bf4546", 1519521155),
		model("large-v3-turbo-q5_0", "Whisper large-v3-turbo 量子化版(多言語)",
			"日本語以外も認識できる多言語モデル。約547MB。日本語だけなら kotoba 版のほうが得意",
			hfWhisperCpp, "ggml-large-v3-turbo-q5_0.bin", "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", 574041195),
		model("small-q5_1", "Whisper small 量子化版(軽量)",
			"約181MB の軽量な多言語モデル。速くて小さいが、固有名詞や早口は間違えやすい",
			hfWhisperCpp, "ggml-small-q5_1.bin", "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", 190085487),
		model("base", "Whisper base(最軽量・低精度)",
			"約141MB の最小クラスのモデル。動作確認向けで、実用の精度は低い",
			hfWhisperCpp, "ggml-base.bin", "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe", 147951465),
	}
}

// Catalog returns the runtime part (always the Windows one; see RuntimePart for the platform
// check) and the downloadable models. The result is a copy the caller may modify.
func Catalog() (components.Part, []components.Part) {
	return runtimeCatalogPart(), modelCatalogParts()
}

// SpeechCatalog returns the speech.cpp runtime for the current host and all speech models.
func SpeechCatalog() (components.Part, []components.Part) {
	rt, _ := SpeechRuntimePart()
	return rt, speechModelCatalogParts()
}

// SpeechRuntimePart returns the speech.cpp runtime part for the current platform if supported.
func SpeechRuntimePart() (components.Part, bool) {
	host := hostPlatform()
	for _, p := range speechRuntimeCatalogParts() {
		if p.Platform == host {
			return p, true
		}
	}
	return components.Part{}, false
}

// RuntimePart returns the runtime part when it supports this OS/architecture.
func RuntimePart() (components.Part, bool) {
	rt := runtimeCatalogPart()
	if rt.Platform != "" && rt.Platform != hostPlatform() {
		return components.Part{}, false
	}
	return rt, true
}

func DefaultWhisperModelID() string { return defaultModelID }
func DefaultSpeechModelID() string  { return defaultSpeechModelID }

// ResolveModelPart finds the downloadable part for w.Model. It is false for "custom-path" (no
// download), for a "custom-url" without a URL, and for unknown ids.
func ResolveModelPart(w llm.WhisperSettings) (components.Part, bool) {
	switch id := effectiveModelID(w); id {
	case modelCustomPath:
		return components.Part{}, false
	case modelCustomURL:
		if strings.TrimSpace(w.CustomURL) == "" {
			return components.Part{}, false
		}
		return CustomURLPart(w.CustomURL, w.CustomSHA256), true
	default:
		// Check speech.cpp models first
		for _, p := range speechModelCatalogParts() {
			if p.ID == id {
				return p, true
			}
		}
		// Then check legacy Whisper models
		for _, p := range modelCatalogParts() {
			if p.ID == id {
				return p, true
			}
		}
	}
	return components.Part{}, false
}

// CustomURLPart describes a user-supplied model download. The id derives from the URL, so a
// different URL installs side by side instead of overwriting.
func CustomURLPart(url, sha string) components.Part {
	url = strings.TrimSpace(url)
	sum := sha256.Sum256([]byte(url))
	return components.Part{
		ID:     "custom-" + hex.EncodeToString(sum[:])[:12],
		Kind:   "model",
		Title:  "Custom model",
		Note:   "ユーザーが指定した URL のモデル",
		URL:    url,
		SHA256: strings.ToLower(strings.TrimSpace(sha)),
		Entry:  "model.bin",
	}
}

func effectiveModelID(w llm.WhisperSettings) string {
	if id := strings.TrimSpace(w.Model); id != "" {
		return id
	}
	return defaultModelID
}
