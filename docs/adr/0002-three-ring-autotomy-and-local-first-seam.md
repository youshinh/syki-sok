# ADR-0002: Three-Ring Autotomy Architecture and Local-First Inference Seam

- **Status**: Accepted
- **Date**: 2026-10-31

## Context

`syki::sok` must serve two eras simultaneously:
1. **Present Desktop Era**: Users rely on a responsive Markdown Editor Canvas (Ring 1) alongside peripheral capture mechanisms (Mobile Bridge, Hot Folder, Quick Capture, Voice/OCR).
2. **Emerging Local-LLM & Stream Era (1-Year Horizon)**: Over the next 12 months, the majority of text, vision, audio transcription, and command-routing workloads will migrate from proprietary cloud APIs to local inference servers (Ollama, llama.cpp/Strata, vLLM, on-device Whisper). Furthermore, as desktop window metaphors evolve, `syki::sok`'s enduring identity is the **Stream Kernel (Ring 0)**—the universal plain-text pipe, `$EDITOR`, and `Scrap`-to-`Wiki` metabolic membrane.

Previously, all Ring 0, Ring 1, and Ring 2 states were mingled directly inside a single `App` struct in `cmd/syki-gui`, and `pkg/llm/audio.go` rejected non-Gemini endpoints outright for voice transcription, while non-core features (`pkg/telemetry` keystroke rhythm logging and cloud `GenerateImage` picture rendering) added maintenance and cognitive overhead.

## Decision

1. **Prune Non-Core Bloat Immediately**:
   - Remove operation-rhythm and foreground-window telemetry (`pkg/telemetry`, `app_telemetry.go`, `app_activity.go`, `frontend/js/telemetry.js`, `frontend/js/activity_log.go`) and cloud image generation (`GenerateImage` / `Render Image...`).
2. **Establish the Three-Ring Autotomy Seam**:
   - **Ring 0 (Stream Kernel)**: Pipe I/O, JSON-RPC dispatch, Scrap/Wiki file persistence, parallel Grep (`pkg/search`), JEV verification, and Slot execution (`pkg/slotagent`).
   - **Ring 1 (Editor Canvas)**: WebView UI, tabs, preview, and print.
   - **Ring 2 (Receptor Organelles)**: Encapsulate peripheral capture and sync subsystems (`cfbridge`, `dropzone`, `inbox`, `semindex`, `components`, `ollama_ops`) behind a unified `Organelles` container (`cmd/syki-gui/organelles.go`) with explicit `Reconfigure` / `Shutdown` lifecycle hooks and a narrow `ScrapSink` seam, so any Ring 2 organelle can be detached in one line without touching Ring 0 or Ring 1.
3. **Establish the Local-First Inference Seam**:
   - Update `pkg/llm` (`DetectProvider`, `IsLocalEndpoint`, `QueryVision`, `QueryAudio`) so any local endpoint (`localhost`, `127.0.0.1`, `.local`, or RFC1918 private LAN IPs) works without an API key across Text, Vision OCR, and Audio transcription (supporting OpenAI-compatible `/v1/audio/transcriptions` and `/v1/chat/completions` audio inputs alongside on-device Whisper and Ollama).

## Consequences

- **Positive**:
  - Zero loss of current Editor or capture capabilities while making every Ring 2 module cleanly detachable.
  - Full readiness for 100% local LLM operation across text, vision, and voice without cloud API keys.
  - Smaller binary footprint and zero keystroke/window telemetry overhead.
- **Negative**:
  - Existing tests and documentation referencing `telemetry`, `activityLog`, or `GenerateImage` must be removed or updated.
