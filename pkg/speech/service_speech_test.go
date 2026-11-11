package speech

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"syki-sok/pkg/llm"
)

func writeGGUFModel(t *testing.T, path string) {
	t.Helper()
	b := make([]byte, 64)
	binary.LittleEndian.PutUint32(b, ggufMagic)
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSpeechLocalTranscribe(t *testing.T) {
	root := t.TempDir()
	store := fakeStore{}
	tempRoot := filepath.Join(root, "tmp")
	speechExe := filepath.Join(root, "runtime", "speech.exe")
	haasModel := filepath.Join(root, "models", "haas.gguf")

	for _, d := range []string{tempRoot, filepath.Dir(speechExe), filepath.Dir(haasModel)} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeGGUFModel(t, haasModel)

	// Register speech runtime and model in fake store
	rtPart, _ := SpeechRuntimePart()
	store[rtPart.ID] = speechExe
	modelPart, _ := ResolveModelPart(llm.WhisperSettings{Model: "haas-ja-v1.0-q8_0"})
	store[modelPart.ID] = haasModel

	var capturedExe string
	var capturedArgs []string
	oldExecSpeech := execSpeech
	execSpeech = func(ctx context.Context, exe string, args []string) (string, error) {
		capturedExe = exe
		capturedArgs = append([]string(nil), args...)
		return "こんにちは、テストです。", nil
	}
	t.Cleanup(func() { execSpeech = oldExecSpeech })

	svc := &Service{store: store, tempRoot: tempRoot}

	for _, eng := range []string{"speech-local", "local", "Speech-Local"} {
		t.Run("engine "+eng, func(t *testing.T) {
			capturedExe = ""
			capturedArgs = nil

			cfg := llm.VoiceConfig{
				Engine: eng,
				Whisper: llm.WhisperSettings{
					Model:   "haas-ja-v1.0-q8_0",
					Threads: 4,
				},
			}

			wav := speechWAV()
			got, err := svc.Transcribe(context.Background(), cfg, wav, "audio/wav")
			if err != nil {
				t.Fatalf("Transcribe failed: %v", err)
			}
			if got != "こんにちは、テストです。" {
				t.Errorf("got %q, want 'こんにちは、テストです。'", got)
			}
			if capturedExe != speechExe {
				t.Errorf("exe %q, want %q", capturedExe, speechExe)
			}
			expectedArgs := []string{"asr", haasModel, "--device", "cpu", "--format", "json", "--threads", "4"}
			// Verify arguments contain model, device, format, threads
			argStr := strings.Join(capturedArgs, " ")
			for _, exp := range expectedArgs {
				if !strings.Contains(argStr, exp) {
					t.Errorf("expected arg %q not found in %v", exp, capturedArgs)
				}
			}
		})
	}
}

func TestSpeechLocalDiarizationAndEnhance(t *testing.T) {
	root := t.TempDir()
	store := fakeStore{}
	tempRoot := filepath.Join(root, "tmp")
	speechExe := filepath.Join(root, "runtime", "speech.exe")
	haasModel := filepath.Join(root, "models", "haas.gguf")
	vadModel := filepath.Join(root, "models", "vad.onnx")
	diarizeModel := filepath.Join(root, "models", "diarize.onnx")
	enhanceModel := filepath.Join(root, "models", "enhance.onnx")

	for _, d := range []string{tempRoot, filepath.Dir(speechExe), filepath.Dir(haasModel)} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeGGUFModel(t, haasModel)
	for _, f := range []string{vadModel, diarizeModel, enhanceModel} {
		if err := os.WriteFile(f, []byte("dummy-model"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	rtPart, _ := SpeechRuntimePart()
	store[rtPart.ID] = speechExe
	modelPart, _ := ResolveModelPart(llm.WhisperSettings{Model: "haas-ja-v1.0-q8_0"})
	store[modelPart.ID] = haasModel

	vadPart, _ := ResolveModelPart(llm.WhisperSettings{Model: "silero-vad"})
	store[vadPart.ID] = vadModel
	diarizePart, _ := ResolveModelPart(llm.WhisperSettings{Model: "nemotron-3-diarization"})
	store[diarizePart.ID] = diarizeModel
	enhancePart, _ := ResolveModelPart(llm.WhisperSettings{Model: "re-use"})
	store[enhancePart.ID] = enhanceModel

	var capturedArgs []string
	oldExecSpeech := execSpeech
	execSpeech = func(ctx context.Context, exe string, args []string) (string, error) {
		capturedArgs = append([]string(nil), args...)
		return "[00:00] 話者 0: こんにちは、本日の会議を始めます。\n[00:05] 話者 1: よろしくお願いします。", nil
	}
	t.Cleanup(func() { execSpeech = oldExecSpeech })

	svc := &Service{store: store, tempRoot: tempRoot}
	cfg := llm.VoiceConfig{
		Engine: "speech-local",
		Whisper: llm.WhisperSettings{
			Model:      "haas-ja-v1.0-q8_0",
			Diarize:    true,
			Enhance:    true,
			Timestamps: true,
			Threads:    4,
		},
	}

	got, err := svc.Transcribe(context.Background(), cfg, speechWAV(), "audio/wav")
	if err != nil {
		t.Fatalf("Transcribe failed: %v", err)
	}
	if !strings.Contains(got, "話者 0") || !strings.Contains(got, "話者 1") {
		t.Errorf("expected diarized output, got %q", got)
	}

	argStr := strings.Join(capturedArgs, " ")
	for _, expected := range []string{"--vad", vadModel, "--diarize", diarizeModel, "--enhance", enhanceModel, "--timestamps"} {
		if !strings.Contains(argStr, expected) {
			t.Errorf("expected argument %q not found in %v", expected, capturedArgs)
		}
	}
}

func TestFormatSpeechRegions(t *testing.T) {
	regions := []speechRegion{
		{
			Start: 0.5,
			End:   2.5,
			Text:  "こんにちは。",
			Speakers: []speechSpeaker{
				{Speaker: 0, Start: 0.5, End: 2.5},
			},
		},
		{
			Start: 2.8,
			End:   4.0,
			Text:  "本日のアジェンダです。",
			Speakers: []speechSpeaker{
				{Speaker: 0, Start: 2.8, End: 4.0},
			},
		},
		{
			Start: 5.2,
			End:   7.5,
			Text:  "よろしくお願いします。",
			Speakers: []speechSpeaker{
				{Speaker: 1, Start: 5.2, End: 7.5},
			},
		},
	}

	formatted := formatSpeechRegions(regions)
	expectedLines := []string{
		"[00:00] 話者 0: こんにちは。本日のアジェンダです。",
		"[00:05] 話者 1: よろしくお願いします。",
	}
	expected := strings.Join(expectedLines, "\n")
	if formatted != expected {
		t.Errorf("formatSpeechRegions mismatch:\ngot:\n%s\nwant:\n%s", formatted, expected)
	}
}

func TestExecSpeechEmptyResult(t *testing.T) {
	rawJSON := `{"file":"test.wav","text":"","stop":"complete"}`
	var res speechJSONOutput
	if err := json.Unmarshal([]byte(rawJSON), &res); err != nil {
		t.Fatalf("json unmarshal failed: %v", err)
	}
	if res.Text != "" {
		t.Errorf("expected empty text, got %q", res.Text)
	}
}

func TestSpeechLocalStatusDarwin(t *testing.T) {
	oldPlatform := hostPlatform
	t.Cleanup(func() { hostPlatform = oldPlatform })

	root := t.TempDir()
	store := fakeStore{}
	speechExe := filepath.Join(root, "runtime", "speech")
	haasModel := filepath.Join(root, "models", "haas.gguf")

	for _, d := range []string{filepath.Dir(speechExe), filepath.Dir(haasModel)} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeGGUFModel(t, haasModel)

	hostPlatform = func() string { return "darwin/arm64" }

	rtPart, ok := SpeechRuntimePart()
	if !ok || rtPart.Platform != "darwin/arm64" {
		t.Fatalf("SpeechRuntimePart for darwin/arm64 not found: %+v", rtPart)
	}
	store[rtPart.ID] = speechExe
	modelPart, _ := ResolveModelPart(llm.WhisperSettings{Model: "haas-ja-v1.0-q8_0"})
	store[modelPart.ID] = haasModel

	svc := &Service{store: store}
	cfg := llm.VoiceConfig{
		Engine:  "local",
		Whisper: llm.WhisperSettings{Model: "haas-ja-v1.0-q8_0"},
	}

	st := svc.LocalStatus(cfg)
	if !st.Supported {
		t.Errorf("expected Supported=true on darwin/arm64 with engine=local, got %+v", st)
	}
	if !st.RuntimeInstalled {
		t.Errorf("expected RuntimeInstalled=true, got %+v", st)
	}
	if !st.ModelInstalled {
		t.Errorf("expected ModelInstalled=true, got %+v", st)
	}
	if !st.Ready {
		t.Errorf("expected Ready=true, got %+v", st)
	}
}
