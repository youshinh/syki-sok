package llm

import (
	"encoding/json"
	"testing"
)

// Every config.json that exists today has no realtime / batch block: one engine, model and Whisper block under voice. The profiles must
// give each call site what it gets today: the hot folder and Discord (batch) the engine the person chose, the on-screen voice input
// (realtime) Gemini with the model it always used.
func TestForProfileLegacyConfigGivesEachCallSiteWhatItGetsToday(t *testing.T) {
	cases := []struct {
		name                                  string
		voiceJSON                             string
		batchEngine, batchModel, batchStyle   string
		batchWhisperModel                     string
		realtimeEngine, realtimeModel         string
		realtimeStyle, realtimeWhisperModel   string
		batchCloudFallback, realtimeFallbackW bool
	}{
		{
			name:        "nothing set",
			voiceJSON:   `{}`,
			batchEngine: "", batchModel: "", batchStyle: "",
			realtimeEngine: "", realtimeModel: "", realtimeStyle: "",
		},
		{
			name:        "legacy: Gemini only",
			voiceJSON:   `{"model":"gemini-3.5-transcribe","apiStyle":"auto"}`,
			batchEngine: "", batchModel: "gemini-3.5-transcribe", batchStyle: "auto",
			realtimeEngine: "", realtimeModel: "gemini-3.5-transcribe", realtimeStyle: "auto",
		},
		{
			name:        "legacy: Whisper chosen for the hot folder and Discord",
			voiceJSON:   `{"model":"m1","apiStyle":"interactions","engine":"whisper-local","whisper":{"model":"small-q5_1","threads":4,"cloudFallback":true}}`,
			batchEngine: "whisper-local", batchModel: "m1", batchStyle: "interactions", batchWhisperModel: "small-q5_1", batchCloudFallback: true,
			// the on-screen voice input never used the engine: it stays Gemini, and a later switch to local starts from the same model
			realtimeEngine: "", realtimeModel: "m1", realtimeStyle: "interactions", realtimeWhisperModel: "small-q5_1", realtimeFallbackW: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var v VoiceConfig
			if err := json.Unmarshal([]byte(c.voiceJSON), &v); err != nil {
				t.Fatal(err)
			}
			b := v.ForProfile(ProfileBatch)
			if b.Engine != c.batchEngine || b.Model != c.batchModel || b.APIStyle != c.batchStyle || b.Whisper.Model != c.batchWhisperModel || b.Whisper.CloudFallback != c.batchCloudFallback {
				t.Errorf("batch = engine %q model %q style %q whisper %+v", b.Engine, b.Model, b.APIStyle, b.Whisper)
			}
			r := v.ForProfile(ProfileRealtime)
			if r.Engine != c.realtimeEngine || r.Model != c.realtimeModel || r.APIStyle != c.realtimeStyle || r.Whisper.Model != c.realtimeWhisperModel || r.Whisper.CloudFallback != c.realtimeFallbackW {
				t.Errorf("realtime = engine %q model %q style %q whisper %+v", r.Engine, r.Model, r.APIStyle, r.Whisper)
			}
		})
	}
}

func TestForProfileNewShapeAndPartialBlocks(t *testing.T) {
	var v VoiceConfig
	raw := `{
		"apiKey":"k","prompt":"p","languageCodes":["ja-JP"],"model":"old","apiStyle":"auto","engine":"gemini",
		"realtime":{"engine":"whisper-local","model":"rt","whisper":{"model":"base"}},
		"batch":{"engine":"gemini","model":"bt","apiStyle":"generateContent"}
	}`
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		t.Fatal(err)
	}
	r := v.ForProfile(ProfileRealtime)
	if r.Engine != "whisper-local" || r.Model != "rt" || r.APIStyle != "auto" || r.Whisper.Model != "base" {
		t.Errorf("realtime = %+v", r)
	}
	b := v.ForProfile(ProfileBatch)
	if b.Engine != "gemini" || b.Model != "bt" || b.APIStyle != "generateContent" {
		t.Errorf("batch = %+v", b)
	}
	// the shared settings are the same for both, and the profile blocks are not carried into the flat config
	for _, got := range []VoiceConfig{r, b} {
		if got.APIKey != "k" || got.Prompt != "p" || len(got.LanguageCodes) != 1 || got.Realtime != nil || got.Batch != nil {
			t.Errorf("shared settings or profile blocks wrong: %+v", got)
		}
	}
	if v.Realtime == nil || v.Batch == nil {
		t.Error("ForProfile must not change the config it is called on")
	}
}

// An empty block of the new shape must not turn the hot folder to Gemini: the engine the person had still counts until they set one.
func TestForProfileEmptyBatchBlockKeepsTheLegacyEngine(t *testing.T) {
	var v VoiceConfig
	if err := json.Unmarshal([]byte(`{"engine":"whisper-local","batch":{},"realtime":{}}`), &v); err != nil {
		t.Fatal(err)
	}
	if got := v.ForProfile(ProfileBatch).Engine; got != "whisper-local" {
		t.Errorf("batch engine = %q, want whisper-local", got)
	}
	if got := v.ForProfile(ProfileRealtime).Engine; got != "" {
		t.Errorf("realtime engine = %q, want Gemini (empty)", got)
	}
}

func TestResolveVoiceConfigForLendsTheVisionKeyLikeBefore(t *testing.T) {
	var v VoiceConfig
	if err := json.Unmarshal([]byte(`{"batch":{"engine":"whisper-local","whisper":{"model":"x"}}}`), &v); err != nil {
		t.Fatal(err)
	}
	got := ResolveVoiceConfigFor(v, VisionConfig{APIKey: "vk"}, ProfileBatch)
	if got.APIKey != "vk" || got.Engine != "whisper-local" || got.Whisper.Model != "x" || got.Timeout != DefaultVoiceTimeoutSec || got.Prompt != DefaultVoicePrompt {
		t.Errorf("got %+v", got)
	}
	// the same call without a profile block is exactly what ResolveVoiceConfig gave
	legacy := VoiceConfig{Engine: "whisper-local", Model: "m"}
	if a, b := ResolveVoiceConfigFor(legacy, VisionConfig{}, ProfileBatch), ResolveVoiceConfig(legacy, VisionConfig{}); a.Engine != b.Engine || a.Model != b.Model || a.Prompt != b.Prompt || a.Timeout != b.Timeout {
		t.Errorf("batch of a legacy config differs from ResolveVoiceConfig: %+v vs %+v", a, b)
	}
}
