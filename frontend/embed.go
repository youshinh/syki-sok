package frontend

import "embed"

// note: selective assets embedded to exclude test files while shipping css/tokens.css
//
//go:embed index.html app.png
//go:embed css/*
//go:embed vendor/*
//go:embed js/a11y.js
//go:embed js/about_dialog.js
//go:embed js/activity_log.js
//go:embed js/agent_risk.js
//go:embed js/app.js
//go:embed js/appearance.js
//go:embed js/auto_selector.js
//go:embed js/bar_voice.js
//go:embed js/builtin_ai.js
//go:embed js/bulk_insert.js
//go:embed js/chrome_layout.js
//go:embed js/chrome_overlay.js
//go:embed js/comment_toggle.js
//go:embed js/config_pack.js
//go:embed js/disk_sync.js
//go:embed js/drop_zones.js
//go:embed js/file_anchor.js
//go:embed js/first_run.js
//go:embed js/ghost_diff.js
//go:embed js/go_text.js
//go:embed js/html_comments.js
//go:embed js/html_to_md.js
//go:embed js/i18n.js
//go:embed js/ime_guardian.js
//go:embed js/immersive_exit.js
//go:embed js/jev_action.js
//go:embed js/lessons.js
//go:embed js/line_gutter.js
//go:embed js/llm_error.js
//go:embed js/mermaid_repair.js
//go:embed js/mermaid_tone.js
//go:embed js/model_list.js
//go:embed js/note_hash.js
//go:embed js/note_title.js
//go:embed js/panel_fade.js
//go:embed js/platform.js
//go:embed js/preview_images.js
//go:embed js/print_panel.js
//go:embed js/print_preview.js
//go:embed js/result_blocks.js
//go:embed js/scrap_quote.js
//go:embed js/scraps_filter.js
//go:embed js/secret_strip.js
//go:embed js/semantic_settings.js
//go:embed js/settings_compact.js
//go:embed js/slot_agent.js
//go:embed js/slot_snippets.js
//go:embed js/speech_settings.js
//go:embed js/status_ai.js
//go:embed js/tab_dock.js
//go:embed js/tab_overflow.js
//go:embed js/tab_strip.js
//go:embed js/tag_edit.js
//go:embed js/task_manager.js
//go:embed js/telemetry.js
//go:embed js/view_layout.js
//go:embed js/voice_input.js
//go:embed js/voice_profiles.js
var FS embed.FS
