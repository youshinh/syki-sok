package speech

// Acceptance tests for the model-driven runtime choice (voice engine generalisation, T1).
// The runtime that runs a local model is decided by the catalog entry (or the file format for a custom model),
// never by the engine string, the executable's file name or a model id prefix.

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"syki-sok/pkg/llm"
)

func TestCatalogEntriesDeclareRuntimeAndRole(t *testing.T) {
	want := map[string][2]string{
		"haas-ja-v1.0-q8_0":      {RuntimeSpeech, RoleASR},
		"haas-ja-v1.0-q4_k":      {RuntimeSpeech, RoleASR},
		"silero-vad":             {RuntimeSpeech, RoleVAD},
		"nemotron-3-diarization": {RuntimeSpeech, RoleDiarize},
		"re-use":                 {RuntimeSpeech, RoleEnhance},
		"kotoba-v2.0-q5_0":       {RuntimeWhisper, RoleASR},
		"kotoba-v2.0":            {RuntimeWhisper, RoleASR},
		"large-v3-turbo-q5_0":    {RuntimeWhisper, RoleASR},
		"small-q5_1":             {RuntimeWhisper, RoleASR},
		"base":                   {RuntimeWhisper, RoleASR},
	}
	got := map[string][2]string{}
	for _, e := range Entries() {
		if e.Part.ID == "" || e.Part.Kind != "model" {
			t.Errorf("bad entry part: %+v", e.Part)
		}
		if _, dup := got[e.Part.ID]; dup {
			t.Errorf("duplicate id %q", e.Part.ID)
		}
		got[e.Part.ID] = [2]string{e.Runtime, e.Role}
	}
	for id, w := range want {
		if got[id] != w {
			t.Errorf("%s: got runtime/role %v, want %v", id, got[id], w)
		}
	}
	if len(got) != len(want) {
		t.Errorf("catalog has %d entries, want %d: %v", len(got), len(want), got)
	}
}

func TestASRModelsAndAddonsAreDisjoint(t *testing.T) {
	asr := map[string]bool{}
	for _, p := range ASRModels() {
		asr[p.ID] = true
	}
	for _, id := range []string{"silero-vad", "nemotron-3-diarization", "re-use"} {
		if asr[id] {
			t.Errorf("%s is an add-on and must not be offered as a recognition model", id)
		}
	}
	if !asr[DefaultModelID()] || !asr[DefaultWhisperModelID()] {
		t.Errorf("ASRModels must contain the defaults: %v", asr)
	}
	var addons []string
	for _, e := range Addons() {
		if e.Role == RoleASR {
			t.Errorf("add-on %s has the asr role", e.Part.ID)
		}
		addons = append(addons, e.Part.ID)
	}
	sort.Strings(addons)
	if strings.Join(addons, ",") != "nemotron-3-diarization,re-use,silero-vad" {
		t.Errorf("Addons() = %v", addons)
	}
}

func TestDefaultModelHasOneSource(t *testing.T) {
	if DefaultModelID() != "haas-ja-v1.0-q8_0" {
		t.Fatalf("DefaultModelID() = %q", DefaultModelID())
	}
	if DefaultSpeechModelID() != DefaultModelID() {
		t.Errorf("DefaultSpeechModelID() = %q, want it to equal DefaultModelID()", DefaultSpeechModelID())
	}
	for _, w := range []llm.WhisperSettings{{}, {Model: "   "}} {
		if p, ok := ResolveModelPart(w); !ok || p.ID != DefaultModelID() {
			t.Errorf("ResolveModelPart(%+v) = %q, %v; want the default %q", w, p.ID, ok, DefaultModelID())
		}
	}
}

func TestModelRuntime(t *testing.T) {
	for name, tc := range map[string]struct {
		w      llm.WhisperSettings
		format string
		want   string
	}{
		"empty model is the default (speech)": {llm.WhisperSettings{}, "", RuntimeSpeech},
		"haas":                                {llm.WhisperSettings{Model: "haas-ja-v1.0-q4_k"}, "", RuntimeSpeech},
		"kotoba":                              {llm.WhisperSettings{Model: "kotoba-v2.0-q5_0"}, "", RuntimeWhisper},
		"catalog id wins over the file format": {llm.WhisperSettings{Model: "kotoba-v2.0"}, "gguf", RuntimeWhisper},
		"custom-path gguf":                    {llm.WhisperSettings{Model: "custom-path", ModelPath: "m.bin"}, "gguf", RuntimeSpeech},
		"custom-path ggml":                    {llm.WhisperSettings{Model: "custom-path", ModelPath: "m.gguf"}, "ggml", RuntimeWhisper},
		"custom-path unread, .gguf name":      {llm.WhisperSettings{Model: "custom-path", ModelPath: `C:\m\X.GGUF`}, "", RuntimeSpeech},
		"custom-path unread, .bin name":       {llm.WhisperSettings{Model: "custom-path", ModelPath: "x.bin"}, "", RuntimeWhisper},
		"custom-url unread, .gguf url":        {llm.WhisperSettings{Model: "custom-url", CustomURL: "https://h/x.gguf?download=1"}, "", RuntimeSpeech},
		"custom-url unread, .bin url":         {llm.WhisperSettings{Model: "custom-url", CustomURL: "https://h/x.bin"}, "", RuntimeWhisper},
		"custom-url read as gguf":             {llm.WhisperSettings{Model: "custom-url", CustomURL: "https://h/x.bin"}, "gguf", RuntimeSpeech},
		"unknown id":                          {llm.WhisperSettings{Model: "large-v9"}, "", ""},
	} {
		if got := ModelRuntime(tc.w, tc.format); got != tc.want {
			t.Errorf("%s: ModelRuntime(%+v, %q) = %q, want %q", name, tc.w, tc.format, got, tc.want)
		}
	}
}

func TestRuntimePartFor(t *testing.T) {
	old := hostPlatform
	t.Cleanup(func() { hostPlatform = old })

	hostPlatform = func() string { return "windows/amd64" }
	if p, ok := RuntimePartFor(RuntimeWhisper); !ok || p.ID != runtimeCatalogPart().ID {
		t.Errorf("windows whisper: %q %v", p.ID, ok)
	}
	if p, ok := RuntimePartFor(RuntimeSpeech); !ok || !strings.Contains(p.ID, "win-x64") {
		t.Errorf("windows speech: %q %v", p.ID, ok)
	}
	hostPlatform = func() string { return "darwin/arm64" }
	if _, ok := RuntimePartFor(RuntimeWhisper); ok {
		t.Error("whisper.cpp is not offered on macOS")
	}
	if p, ok := RuntimePartFor(RuntimeSpeech); !ok || !strings.Contains(p.ID, "darwin") {
		t.Errorf("darwin speech: %q %v", p.ID, ok)
	}
	if _, ok := RuntimePartFor("nope"); ok {
		t.Error("unknown runtime must not resolve")
	}
}

func TestRequiredAddons(t *testing.T) {
	ids := func(es []CatalogEntry) string {
		var out []string
		for _, e := range es {
			out = append(out, e.Part.ID)
		}
		sort.Strings(out)
		return strings.Join(out, ",")
	}
	haas := "haas-ja-v1.0-q8_0"
	for name, tc := range map[string]struct {
		w    llm.WhisperSettings
		want string
	}{
		"nothing on":          {llm.WhisperSettings{Model: haas}, ""},
		"diarize":             {llm.WhisperSettings{Model: haas, Diarize: true}, "nemotron-3-diarization,silero-vad"},
		"timestamps":          {llm.WhisperSettings{Model: haas, Timestamps: true}, "silero-vad"},
		"enhance":             {llm.WhisperSettings{Model: haas, Enhance: true}, "re-use"},
		"all":                 {llm.WhisperSettings{Model: haas, Diarize: true, Timestamps: true, Enhance: true}, "nemotron-3-diarization,re-use,silero-vad"},
		"whisper model needs none": {llm.WhisperSettings{Model: "kotoba-v2.0-q5_0", Diarize: true, Enhance: true}, ""},
	} {
		if got := ids(RequiredAddons(tc.w)); got != tc.want {
			t.Errorf("%s: RequiredAddons = %q, want %q", name, got, tc.want)
		}
	}
}

// speechEnv is newTestEnv plus an installed speech.cpp runtime and a recorder for execSpeech.
func speechEnv(t *testing.T) (*testEnv, *[]string) {
	t.Helper()
	e := newTestEnv(t)
	sp, ok := SpeechRuntimePart()
	if !ok {
		t.Fatal("no speech runtime for windows/amd64")
	}
	e.store[sp.ID] = filepath.Join(filepath.Dir(e.exe), "speech.exe")
	var ran []string
	old := execSpeech
	execSpeech = func(_ context.Context, exe string, _ []string) (string, error) {
		ran = append(ran, exe)
		return "speech text", nil
	}
	t.Cleanup(func() { execSpeech = old })
	return e, &ran
}

func TestCustomGGUFRunsOnSpeechWhateverTheEngineString(t *testing.T) {
	for _, engine := range []string{"whisper-local", "speech-local", "local"} {
		t.Run(engine, func(t *testing.T) {
			e, ran := speechEnv(t)
			gguf := writeFile(t, "my-model.bin", "GGUF\x03\x00\x00\x00\x00\x00\x00\x00")
			cfg := llm.VoiceConfig{Engine: engine, Whisper: llm.WhisperSettings{Model: "custom-path", ModelPath: gguf}}
			got, err := e.svc.Transcribe(context.Background(), cfg, speechWAV(), "audio/wav")
			if err != nil || got != "speech text" {
				t.Fatalf("got %q, %v", got, err)
			}
			if len(*ran) != 1 || len(e.whisper.calls) != 0 {
				t.Errorf("speech runs %v, whisper runs %d", *ran, len(e.whisper.calls))
			}
			if st := e.svc.LocalStatus(cfg); !st.Ready || st.ModelWarning != "" {
				t.Errorf("LocalStatus must agree with Transcribe: %+v", st)
			}
		})
	}
}

func TestNoSilentRuntimeSwitch(t *testing.T) {
	e, ran := speechEnv(t)
	delete(e.store, runtimeCatalogPart().ID) // whisper.cpp missing, speech.cpp present
	cfg := llm.VoiceConfig{Engine: "whisper-local", Whisper: llm.WhisperSettings{Model: DefaultWhisperModelID()}}
	_, err := e.svc.Transcribe(context.Background(), cfg, speechWAV(), "audio/wav")
	if !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("a ggml model with whisper.cpp missing must report not-installed, got %v", err)
	}
	if len(*ran) != 0 || len(e.whisper.calls) != 0 {
		t.Errorf("nothing may run: speech %v whisper %d", *ran, len(e.whisper.calls))
	}
	if st := e.svc.LocalStatus(cfg); st.Ready || st.RuntimeInstalled {
		t.Errorf("LocalStatus must agree: %+v", st)
	}
}

func TestCatalogModelWithWrongFileFormat(t *testing.T) {
	e, ran := speechEnv(t)
	e.store[DefaultWhisperModelID()] = writeFile(t, "kotoba.bin", "GGUF\x03\x00\x00\x00\x00\x00\x00\x00")
	cfg := llm.VoiceConfig{Engine: "whisper-local", Whisper: llm.WhisperSettings{Model: DefaultWhisperModelID()}}
	_, err := e.svc.Transcribe(context.Background(), cfg, speechWAV(), "audio/wav")
	if err == nil || !strings.Contains(err.Error(), "GGUF") {
		t.Fatalf("got %v, want a format mismatch mentioning GGUF", err)
	}
	if len(*ran) != 0 || len(e.whisper.calls) != 0 {
		t.Errorf("nothing may run: speech %v whisper %d", *ran, len(e.whisper.calls))
	}
	if st := e.svc.LocalStatus(cfg); st.Ready || !strings.Contains(st.ModelWarning, "GGUF") {
		t.Errorf("LocalStatus must agree: %+v", st)
	}
}

func TestSpeechModelReadyOnMacOS(t *testing.T) {
	e, _ := speechEnv(t)
	hostPlatform = func() string { return "darwin/arm64" }
	sp, _ := SpeechRuntimePart()
	e.store[sp.ID] = filepath.Join(filepath.Dir(e.exe), "speech")
	e.store[DefaultModelID()] = writeFile(t, "haas.gguf", "GGUF\x03\x00\x00\x00\x00\x00\x00\x00")
	st := e.svc.LocalStatus(llm.VoiceConfig{Engine: "local"})
	if !st.Supported || !st.RuntimeInstalled || !st.Ready || st.ModelID != DefaultModelID() {
		t.Fatalf("got %+v", st)
	}
}

func TestUnknownEngineNamesAllEngines(t *testing.T) {
	e := newTestEnv(t)
	_, err := e.svc.Transcribe(context.Background(), llm.VoiceConfig{Engine: "azure"}, []byte("x"), "audio/wav")
	if err == nil || !strings.Contains(err.Error(), "speech-local") || !strings.Contains(err.Error(), "whisper-local") {
		t.Fatalf("got %v", err)
	}
}
