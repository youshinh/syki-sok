package main

// Acceptance tests for the settings-screen view of the on-device engines (voice engine generalisation, T2).

import (
	"encoding/json"
	"runtime"
	"strings"
	"testing"

	"syki-sok/pkg/components"
	"syki-sok/pkg/llm"
	"syki-sok/pkg/speech"
)

func useTempSpeechManager(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("catalog runtimes are asserted for windows/amd64")
	}
	speechInit()
	oldMgr, oldSvc := speechMgr, speechSvc
	speechMgr = components.NewManager(t.TempDir())
	speechSvc = speech.NewService(speechMgr)
	t.Cleanup(func() { speechMgr, speechSvc = oldMgr, oldSvc })
}

func TestSpeechPartForPicksTheModelsRuntime(t *testing.T) {
	useTempSpeechManager(t)
	whisperRT, _ := speech.RuntimePartFor(speech.RuntimeWhisper)
	speechRT, _ := speech.RuntimePartFor(speech.RuntimeSpeech)
	for model, want := range map[string]string{
		"":                  speechRT.ID,
		"haas-ja-v1.0-q4_k": speechRT.ID,
		"kotoba-v2.0-q5_0":  whisperRT.ID,
		"small-q5_1":        whisperRT.ID,
	} {
		for _, engine := range []string{"whisper-local", "speech-local", ""} {
			p, ok := speechPartFor("runtime", llm.VoiceConfig{Engine: engine, Whisper: llm.WhisperSettings{Model: model}})
			if !ok || p.ID != want {
				t.Errorf("model %q engine %q: runtime %q %v, want %q", model, engine, p.ID, ok, want)
			}
		}
	}
	if p, ok := speechPartFor("model", llm.VoiceConfig{}); !ok || p.ID != speech.DefaultModelID() {
		t.Errorf("model with nothing chosen: %q %v", p.ID, ok)
	}
}

func TestSpeechPartForAddons(t *testing.T) {
	useTempSpeechManager(t)
	for _, id := range []string{"silero-vad", "nemotron-3-diarization", "re-use"} {
		if p, ok := speechPartFor("addon:"+id, llm.VoiceConfig{}); !ok || p.ID != id {
			t.Errorf("addon %s: %q %v", id, p.ID, ok)
		}
	}
	for _, which := range []string{"addon:haas-ja-v1.0-q8_0", "addon:kotoba-v2.0-q5_0", "addon:", "addon:nope", "silero-vad"} {
		if p, ok := speechPartFor(which, llm.VoiceConfig{}); ok {
			t.Errorf("%q must not resolve, got %q", which, p.ID)
		}
	}
}

type statusJSON struct {
	Supported    bool   `json:"supported"`
	DefaultModel string `json:"defaultModel"`
	Runtime      *struct {
		Part components.Part `json:"part"`
	} `json:"runtime"`
	Models []struct {
		Part components.Part `json:"part"`
	} `json:"models"`
	Addons []struct {
		Part   components.Part   `json:"part"`
		Role   string            `json:"role"`
		Status components.Status `json:"status"`
	} `json:"addons"`
}

func TestGetSpeechStatusSeparatesAddonsAndFollowsTheModel(t *testing.T) {
	useTempSpeechManager(t)
	a := &App{}
	read := func(cfg string) statusJSON {
		var st statusJSON
		if err := json.Unmarshal([]byte(a.GetSpeechStatus(cfg)), &st); err != nil {
			t.Fatal(err)
		}
		return st
	}

	st := read(`{"engine":"whisper-local","whisper":{"model":"kotoba-v2.0-q5_0"}}`)
	if st.DefaultModel != speech.DefaultModelID() || !st.Supported {
		t.Errorf("defaultModel %q supported %v", st.DefaultModel, st.Supported)
	}
	whisperRT, _ := speech.RuntimePartFor(speech.RuntimeWhisper)
	if st.Runtime == nil || st.Runtime.Part.ID != whisperRT.ID {
		t.Errorf("kotoba needs whisper.cpp, runtime = %+v", st.Runtime)
	}
	asr := map[string]bool{}
	for _, m := range speech.ASRModels() {
		asr[m.ID] = true
	}
	if len(st.Models) != len(asr) {
		t.Errorf("models: %d, want the %d recognition models", len(st.Models), len(asr))
	}
	for _, m := range st.Models {
		if !asr[m.Part.ID] {
			t.Errorf("%s is offered as a recognition model", m.Part.ID)
		}
	}
	roles := map[string]string{}
	for _, ad := range st.Addons {
		roles[ad.Part.ID] = ad.Role
	}
	if roles["silero-vad"] != speech.RoleVAD || roles["nemotron-3-diarization"] != speech.RoleDiarize || roles["re-use"] != speech.RoleEnhance || len(roles) != 3 {
		t.Errorf("addons = %v", roles)
	}

	st = read(`{"engine":"local","whisper":{"model":"haas-ja-v1.0-q8_0"}}`)
	speechRT, _ := speech.RuntimePartFor(speech.RuntimeSpeech)
	if st.Runtime == nil || st.Runtime.Part.ID != speechRT.ID {
		t.Errorf("haas needs speech.cpp, runtime = %+v", st.Runtime)
	}
}

func TestEnsureSpeechServerRefusesAWhisperModel(t *testing.T) {
	useTempSpeechManager(t)
	out := (&App{}).EnsureSpeechServer(`{"engine":"whisper-local","whisper":{"model":"kotoba-v2.0-q5_0"}}`)
	var res map[string]string
	if err := json.Unmarshal([]byte(out), &res); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res["error"], "このモデル") || res["wsUrl"] != "" {
		t.Errorf("got %v", res)
	}
}
