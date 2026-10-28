package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"syki-sok/pkg/cfbridge"
	"syki-sok/pkg/dropzone"
	"syki-sok/pkg/llm"
	"syki-sok/pkg/qrgen"
	"syki-sok/pkg/scrap"
)

// CFBridgeSettings models config.json's "cfBridge" section: an ephemeral mobile capture
// pipeline relaying memos from Cloudflare Workers + D1 to today's scrap file.
type CFBridgeSettings struct {
	Enabled             bool   `json:"enabled"`
	Endpoint            string `json:"endpoint"`
	Token               string `json:"token"`
	PollIntervalSeconds int    `json:"pollIntervalSeconds"`
}

func (a *App) parseCFBridgeConfig(configJSON string) CFBridgeSettings {
	cfg := CFBridgeSettings{PollIntervalSeconds: 30}
	if configJSON == "" {
		return cfg
	}
	var raw struct {
		CFBridge struct {
			Enabled             bool   `json:"enabled"`
			Endpoint            string `json:"endpoint"`
			Token               string `json:"token"`
			PollIntervalSeconds int    `json:"pollIntervalSeconds"`
		} `json:"cfBridge"`
	}
	if json.Unmarshal([]byte(configJSON), &raw) != nil {
		return cfg
	}
	cfg.Enabled = raw.CFBridge.Enabled
	cfg.Endpoint = strings.TrimRight(strings.TrimSpace(raw.CFBridge.Endpoint), "/")
	cfg.Token = strings.TrimSpace(raw.CFBridge.Token)
	if raw.CFBridge.PollIntervalSeconds > 0 {
		cfg.PollIntervalSeconds = raw.CFBridge.PollIntervalSeconds
	}
	return cfg
}

func cfDropConfigs(configJSON string) (llm.VisionConfig, llm.VoiceConfig) {
	var raw struct {
		Vision llm.VisionConfig `json:"vision"`
		Voice  llm.VoiceConfig  `json:"voice"`
	}
	_ = json.Unmarshal([]byte(configJSON), &raw)
	return raw.Vision, llm.ResolveVoiceConfigFor(raw.Voice, raw.Vision, llm.ProfileBatch)
}

var (
	cfBridgeBaseURLOverride string
	cfTestConnectionBaseURL string
)

// InitCFBridge (re)starts the Cloudflare bridge poller according to current settings.
func (a *App) InitCFBridge() {
	cfgStr, _ := a.GetConfig()
	s := a.parseCFBridgeConfig(cfgStr)

	a.cfMu.Lock()
	defer a.cfMu.Unlock()
	if a.cfPoller != nil {
		a.cfPoller.Stop()
		a.cfPoller = nil
	}
	if !s.Enabled || s.Endpoint == "" || s.Token == "" {
		return
	}

	endpoint := s.Endpoint
	if cfBridgeBaseURLOverride != "" {
		endpoint = cfBridgeBaseURLOverride
	}

	// The vision/voice settings are read when each batch of memos is handled, not captured here,
	// so a newly configured or changed API key applies immediately to the next memo without
	// needing to restart the bridge poller (mirroring app_inbox.go).
	poller := cfbridge.NewPoller(cfbridge.Config{
		Endpoint:        endpoint,
		Token:           s.Token,
		IntervalSeconds: s.PollIntervalSeconds,
		OnMemos: func(memos []cfbridge.Memo) error {
			cfgNow, _ := a.GetConfig()
			visionCfg, voiceCfg := cfDropConfigs(cfgNow)
			return a.handleCFMemos(memos, visionCfg, voiceCfg)
		},
		OnStatus: func(status, message string) {
			a.dispatchCFBridgeStatus(status, message)
		},
	})
	a.cfPoller = poller
	poller.Start(context.Background())
}

// PollCFBridgeNow triggers an immediate polling cycle if the bridge is running.
func (a *App) PollCFBridgeNow() {
	a.cfMu.Lock()
	poller := a.cfPoller
	a.cfMu.Unlock()
	if poller != nil {
		poller.PollNow()
	}
}

// TestCFBridgeConnection checks authentication with the Cloudflare Worker endpoint synchronously.
func (a *App) TestCFBridgeConnection(endpoint, token string) (map[string]interface{}, error) {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	token = strings.TrimSpace(token)
	if endpoint == "" || token == "" {
		return nil, fmt.Errorf("Endpoint URLとトークンを入力してください")
	}
	if cfTestConnectionBaseURL != "" {
		endpoint = cfTestConnectionBaseURL
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client := cfbridge.New(endpoint, token)
	if err := client.Verify(ctx); err != nil {
		return nil, err
	}
	return map[string]interface{}{"ok": true}, nil
}

// GetCFBridgePairingQR generates a QR code data URI that opens the mobile PWA with the pairing URL prefilled.
func (a *App) GetCFBridgePairingQR(endpoint, token string) (string, error) {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	token = strings.TrimSpace(token)
	if endpoint == "" {
		return "", fmt.Errorf("Endpoint URLを入力してください")
	}
	targetURL := endpoint
	if token != "" {
		targetURL += "/?token=" + token
	}
	return qrgen.DataURI(targetURL)
}

func (a *App) handleCFMemos(memos []cfbridge.Memo, visionCfg llm.VisionConfig, voiceCfg llm.VoiceConfig) error {
	return a.handleCFMemosAt(memos, visionCfg, voiceCfg, time.Now())
}

func (a *App) handleCFMemosAt(memos []cfbridge.Memo, visionCfg llm.VisionConfig, voiceCfg llm.VoiceConfig, at time.Time) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in handleCFMemos: %v", r)
			a.dispatchCFBridgeStatus("error", fmt.Sprintf("メモの処理中にエラーが発生しました: %v", r))
		}
	}()

	if len(memos) == 0 {
		return nil
	}

	scrapDir := a.GetDefaultNoteDir()
	var sb strings.Builder

	for _, m := range memos {
		memoTime := at
		if m.ClientTime != "" {
			if t, err := time.Parse(time.RFC3339, m.ClientTime); err == nil {
				memoTime = t.Local()
			}
		}

		for _, p := range cfMemoToPayloads(m) {
			body := cfItemBody(p, visionCfg, voiceCfg, scrapDir)
			sb.WriteString(formatCFSection(m, p.Kind, p.Filename, body, memoTime))
		}
	}

	if sb.Len() == 0 {
		return nil
	}

	path, err := scrap.AppendRaw(scrapDir, sb.String(), at)
	if err != nil {
		a.dispatchCFBridgeStatus("error", "スクラップへの書き込みに失敗しました: "+err.Error())
		return err
	}
	a.TriggerGitSync()
	a.dispatchCFBridgeMessage(path, at)
	return nil
}

func cfMemoToPayloads(m cfbridge.Memo) []dropzone.Payload {
	var items []dropzone.Payload

	if text := strings.TrimSpace(m.TextContent); text != "" {
		items = append(items, dropzone.Payload{Kind: dropzone.KindText, Text: text})
	}

	if b64 := strings.TrimSpace(m.AttachmentBase64); b64 != "" {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			items = append(items, dropzone.Payload{
				Kind: dropzone.KindText,
				Text: fmt.Sprintf("[Mobile: 添付ファイル %s のデコードに失敗しました: %s]", m.Filename, err.Error()),
			})
		} else {
			items = append(items, dropzone.Payload{
				Kind:     cfAttachmentKind(m.ContentType, m.FileMime),
				Filename: m.Filename,
				MimeType: m.FileMime,
				Data:     data,
			})
		}
	}

	return items
}

func cfAttachmentKind(contentType, mime string) dropzone.Kind {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	m := strings.ToLower(strings.TrimSpace(strings.SplitN(mime, ";", 2)[0]))
	switch {
	case ct == "image" || strings.HasPrefix(m, "image/"):
		return dropzone.KindImage
	case ct == "audio" || strings.HasPrefix(m, "audio/") || m == "video/webm":
		return dropzone.KindAudio
	default:
		return dropzone.KindFile
	}
}

func cfItemBody(p dropzone.Payload, visionCfg llm.VisionConfig, voiceCfg llm.VoiceConfig, scrapDir string) string {
	body, err := mobileDropItemBody(p, visionCfg, voiceCfg)
	if err == nil {
		return body
	}
	if p.Kind == dropzone.KindImage || p.Kind == dropzone.KindAudio {
		if kept, saveErr := mobileDropKeepFile(p, err, scrapDir); saveErr == nil {
			return kept
		}
	}
	return fmt.Sprintf("[Mobile: %sの処理に失敗しました: %s]", mobileDropItemLabel(p), err.Error())
}

func formatCFSection(m cfbridge.Memo, kind dropzone.Kind, filename, body string, at time.Time) string {
	header := fmt.Sprintf("## Mobile [%s]", at.Format("15:04:05"))
	if name := cfSanitizeFilename(filename); name != "" {
		header = fmt.Sprintf("%s — %s", header, name)
	}
	return fmt.Sprintf("\n\n%s\n\n%s\n", header, strings.TrimRight(body, "\n"))
}

func cfSanitizeFilename(name string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if runes := []rune(name); len(runes) > 120 {
		name = string(runes[:120])
	}
	return name
}

func (a *App) dispatchCFBridgeStatus(status, message string) {
	msgJSON, _ := json.Marshal(message)
	js := fmt.Sprintf("if (window.onCFBridgeStatus) { window.onCFBridgeStatus({status:%q, message:%s}); }", status, string(msgJSON))
	a.dispatchEval(js)
}

func (a *App) dispatchCFBridgeMessage(filePath string, at time.Time) {
	payload, _ := json.Marshal(map[string]interface{}{
		"filePath":  filePath,
		"fileName":  filepath.Base(filePath),
		"timestamp": at.Format("15:04:05"),
	})
	js := fmt.Sprintf("if (window.onCFBridgeMessage) { window.onCFBridgeMessage(%s); }", string(payload))
	a.dispatchEval(js)
}
