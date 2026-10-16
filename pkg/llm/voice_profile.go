package llm

import "strings"

// The two ways audio is transcribed, each with its own engine (cloud or on-device) and models:
//
//	realtime  a short recording that somebody is waiting for: voice input, the voice button of the ask / rewrite bars, an audio file
//	          dropped on the window
//	batch     a long or unattended one: the meeting recording, the hot folder, the Discord bridge, Mobile Drop
//
// Shared settings (the key, the base URL, the prompt, the language, the custom vocabulary, the second stage) stay on VoiceConfig
// itself; a profile holds what differs: the engine, the Gemini model and API style, and the Whisper model.
const (
	ProfileRealtime = "realtime"
	ProfileBatch    = "batch"
)

// VoiceProfile is config.voice.realtime / config.voice.batch. An empty field means "not set here".
type VoiceProfile struct {
	Engine   string           `json:"engine"`
	Model    string           `json:"model"`
	APIStyle string           `json:"apiStyle"`
	Whisper  *WhisperSettings `json:"whisper"`
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// ForProfile is the voice config as one profile uses it: the shared settings with that profile's engine, model, API style and Whisper
// model put in the flat fields every consumer reads (Engine, Model, APIStyle, Whisper). It is for a config as config.json holds it.
//
// A config saved before the two profiles existed holds one engine, model and Whisper block under voice itself, and that engine only
// ever governed the hot folder and the Discord bridge (the on-screen voice input and Mobile Drop always used Gemini). So:
//
//	batch     an empty engine, model, API style or Whisper block falls back to voice.engine, voice.model, voice.apiStyle, voice.whisper:
//	          the hot folder and Discord keep the engine the person chose
//	realtime  an empty engine is Gemini (what it always was), an empty model / API style falls back to voice.model / voice.apiStyle,
//	          and a missing Whisper block to voice.whisper (the same model the person already downloaded)
//
// An unknown profile name gets the realtime rules.
func (v VoiceConfig) ForProfile(name string) VoiceConfig {
	var p VoiceProfile
	batch := name == ProfileBatch
	if batch {
		if v.Batch != nil {
			p = *v.Batch
		}
	} else if v.Realtime != nil {
		p = *v.Realtime
	}

	out := v
	out.Realtime, out.Batch = nil, nil
	if batch {
		out.Engine = firstNonEmpty(p.Engine, v.Engine)
	} else {
		out.Engine = p.Engine
	}
	out.Model = firstNonEmpty(p.Model, v.Model)
	out.APIStyle = firstNonEmpty(p.APIStyle, v.APIStyle)
	if p.Whisper != nil {
		out.Whisper = *p.Whisper
	}
	return out
}

// ResolveVoiceConfigFor is ResolveVoiceConfig for the profile a caller belongs to.
func ResolveVoiceConfigFor(voice VoiceConfig, vision VisionConfig, profile string) VoiceConfig {
	return ResolveVoiceConfig(voice.ForProfile(profile), vision)
}
