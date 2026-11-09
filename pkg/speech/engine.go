package speech

import (
	"strings"

	"syki-sok/pkg/components"
	"syki-sok/pkg/llm"
)

// The runtime that runs a local model is a property of the model, declared here once. Guessing it from an executable's file
// name or a model id prefix let the transcription path and the status screen disagree, and made every new model family a
// change in several places.
const (
	RuntimeWhisper = "whisper" // whisper.cpp (whisper-cli), ggml models
	RuntimeSpeech  = "speech"  // speech.cpp, GGUF models
)

// Roles separate the recognition models a person chooses from the add-ons a speech.cpp option needs.
const (
	RoleASR     = "asr"
	RoleVAD     = "vad"
	RoleDiarize = "diarize"
	RoleEnhance = "enhance"
)

type CatalogEntry struct {
	Part    components.Part
	Runtime string
	Role    string
}

var addonRoles = map[string]string{
	"silero-vad":             RoleVAD,
	"nemotron-3-diarization": RoleDiarize,
	"re-use":                 RoleEnhance,
}

// Entries is every downloadable model: the speech.cpp ones first, then the whisper.cpp ones. The result is a copy.
func Entries() []CatalogEntry {
	var out []CatalogEntry
	add := func(parts []components.Part, runtime string) {
		for _, p := range parts {
			role := RoleASR
			if r, ok := addonRoles[p.ID]; ok {
				role = r
			}
			out = append(out, CatalogEntry{Part: p, Runtime: runtime, Role: role})
		}
	}
	add(speechModelCatalogParts(), RuntimeSpeech)
	add(modelCatalogParts(), RuntimeWhisper)
	return out
}

func ASRModels() []components.Part {
	var out []components.Part
	for _, e := range Entries() {
		if e.Role == RoleASR {
			out = append(out, e.Part)
		}
	}
	return out
}

func Addons() []CatalogEntry {
	var out []CatalogEntry
	for _, e := range Entries() {
		if e.Role != RoleASR {
			out = append(out, e)
		}
	}
	return out
}

func entryByID(id string) (CatalogEntry, bool) {
	for _, e := range Entries() {
		if e.Part.ID == id {
			return e, true
		}
	}
	return CatalogEntry{}, false
}

func addonByRole(role string) (CatalogEntry, bool) {
	for _, e := range Addons() {
		if e.Role == role {
			return e, true
		}
	}
	return CatalogEntry{}, false
}

// DefaultModelID is the model used when none is chosen: the one place that decides it.
func DefaultModelID() string { return defaultSpeechModelID }

// RuntimePartFor is the runtime part of runtime for this host; false when the host has none.
func RuntimePartFor(runtime string) (components.Part, bool) {
	switch runtime {
	case RuntimeSpeech:
		return SpeechRuntimePart()
	case RuntimeWhisper:
		return RuntimePart()
	}
	return components.Part{}, false
}

// ModelRuntime is the runtime w's model needs. format is ModelInfo.Format, or "" when the file has not been read; it only
// matters for a custom model, since a catalog entry declares its runtime (a mismatching file is an error, not a switch).
// An unknown id has no runtime ("").
func ModelRuntime(w llm.WhisperSettings, format string) string {
	id := effectiveModelID(w)
	var name string
	switch id {
	case modelCustomPath:
		name = w.ModelPath
	case modelCustomURL:
		name, _, _ = strings.Cut(w.CustomURL, "?")
	default:
		if e, ok := entryByID(id); ok {
			return e.Runtime
		}
		return ""
	}
	switch format {
	case "gguf":
		return RuntimeSpeech
	case "ggml":
		return RuntimeWhisper
	}
	if strings.HasSuffix(strings.ToLower(strings.TrimSpace(name)), ".gguf") {
		return RuntimeSpeech
	}
	return RuntimeWhisper
}

// RequiredAddons are the add-ons w's options need. Only speech.cpp uses them; whisper-cli ignores those options.
func RequiredAddons(w llm.WhisperSettings) []CatalogEntry {
	if ModelRuntime(w, "") != RuntimeSpeech {
		return nil
	}
	var out []CatalogEntry
	want := func(on bool, role string) {
		if !on {
			return
		}
		if e, ok := addonByRole(role); ok {
			out = append(out, e)
		}
	}
	want(w.Diarize || w.Timestamps, RoleVAD)
	want(w.Diarize, RoleDiarize)
	want(w.Enhance, RoleEnhance)
	return out
}
