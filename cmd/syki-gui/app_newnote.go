package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"unicode/utf8"

	"syki-sok/pkg/dropzone"
	"syki-sok/pkg/encoding"
	"syki-sok/pkg/llm"
	"syki-sok/pkg/scrap"
	"syki-sok/pkg/textsig"
)

// GetDefaultNoteDir returns the directory configured for new notes (config.general.defaultNoteDir),
// falling back to GetScrapDir() when empty or not configured.
func (a *App) GetDefaultNoteDir() string {
	cfgStr, _ := a.GetConfig()
	if strings.TrimSpace(cfgStr) != "" {
		var c struct {
			General struct {
				DefaultNoteDir string `json:"defaultNoteDir"`
			} `json:"general"`
		}
		if json.Unmarshal([]byte(cfgStr), &c) == nil {
			if dir := strings.TrimSpace(c.General.DefaultNoteDir); dir != "" {
				return scrap.ResolveScrapDir(dir)
			}
		}
	}
	return a.GetScrapDir()
}

// CreateNoteInFolder writes a new note's text to a new file in dir (the folder set for new notes; "" means the scraps folder, the
// app's default folder) and returns where it went. This is the automatic save of a note that has no file yet: it never asks, and it
// never replaces anything: a name that is taken gets -2, -3 ... before the extension.
func (a *App) CreateNoteInFolder(content, enc, name, dir string) (*SaveResult, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		dir = a.GetDefaultNoteDir()
	} else {
		dir = scrap.ResolveScrapDir(dir) // expands ~ the same way the scraps folder does
	}
	if dir == "" {
		return nil, errors.New("保存先のフォルダが決まっていません")
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("保存先のフォルダを作れませんでした: %w", err)
	}
	encoded, err := encoding.Encode(content, enc)
	if err != nil {
		return nil, fmt.Errorf("エンコードエラー: %w", err)
	}

	file := safeNoteFileName(name)
	ext := filepath.Ext(file)
	stem := strings.TrimSuffix(file, ext)
	for n := 1; n <= 999; n++ {
		candidate := file
		if n > 1 {
			candidate = fmt.Sprintf("%s-%d%s", stem, n, ext)
		}
		path := filepath.Join(dir, candidate)
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644) // fails when the name is taken: nothing is replaced
		if err != nil {
			if os.IsExist(err) {
				continue
			}
			return nil, fmt.Errorf("ファイルの保存に失敗しました: %w", err)
		}
		_, werr := f.Write(encoded)
		cerr := f.Close()
		if werr != nil || cerr != nil {
			_ = os.Remove(path)
			return nil, fmt.Errorf("ファイルの保存に失敗しました: %v", errors.Join(werr, cerr))
		}
		a.TriggerGitSync()
		return &SaveResult{Path: path, Title: candidate, Success: true, Sig: textsig.Sum(content)}, nil
	}
	return nil, errors.New("同じ名前のファイルが多すぎて保存できませんでした")
}

var windowsReservedNames = map[string]bool{
	"con": true, "prn": true, "aux": true, "nul": true,
	"com1": true, "com2": true, "com3": true, "com4": true, "com5": true, "com6": true, "com7": true, "com8": true, "com9": true,
	"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true, "lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
}

// safeNoteFileName makes a file name of whatever the page suggests: no folder part, no character a file name cannot hold, not a name
// Windows reserves, not too long, and an extension (.md when there is none).
func safeNoteFileName(name string) string {
	name = strings.ReplaceAll(name, `\`, "/")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r < 0x20, strings.ContainsRune(`<>:"|?*`, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	name = strings.Trim(b.String(), " .")
	ext := filepath.Ext(name)
	if ext == "" || len(ext) > 8 {
		name += ".md"
		ext = ".md"
	}
	stem := strings.TrimSuffix(name, ext)
	if stem == "" {
		stem = "memo"
	}
	if runes := []rune(stem); len(runes) > 80 { // keeps the path under MAX_PATH on Windows
		stem = string(runes[:80])
	}
	if windowsReservedNames[strings.ToLower(stem)] {
		stem = "_" + stem
	}
	if !utf8.ValidString(stem) {
		stem = "memo"
	}
	return stem + ext
}

// droppedMediaKind says what a dropped file is to the vision and voice services: an image to read the text of, a recording to
// transcribe, or neither (""). The browser's own type is trusted first; a file that came with none is told by its extension.
func droppedMediaKind(name, mimeType string) (dropzone.Kind, string) {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	imageTypes := map[string]string{"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif", "heic": "image/heic", "heif": "image/heif", "bmp": "image/bmp"}
	audioTypes := map[string]string{"mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4", "aac": "audio/aac", "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg", "flac": "audio/flac", "weba": "audio/webm"}
	switch {
	case strings.HasPrefix(mimeType, "image/") && mimeType != "image/svg+xml":
		return dropzone.KindImage, mimeType
	case strings.HasPrefix(mimeType, "audio/"):
		return dropzone.KindAudio, mimeType
	case mimeType == "" && imageTypes[ext] != "":
		return dropzone.KindImage, imageTypes[ext]
	case mimeType == "" && audioTypes[ext] != "":
		return dropzone.KindAudio, audioTypes[ext]
	}
	return "", mimeType
}

// ProcessDroppedMedia reads the text of an image dropped on the window, or transcribes a recording dropped on it, with the same
// services and settings as Mobile Drop, the hot folder and voice input, and answers through window.__onDroppedMedia(reqID, text, error).
// It runs in the background; the page makes a new note of the text.
func (a *App) ProcessDroppedMedia(reqID, name, mimeType, dataBase64, visionConfigJSON, voiceConfigJSON string) {
	go func() {
		answer := func(text, errMsg string) {
			if atomic.LoadInt32(&a.isDestroyed) != 0 {
				return
			}
			reqJSON, _ := json.Marshal(reqID)
			textJSON, _ := json.Marshal(text)
			errJSON, _ := json.Marshal(errMsg)
			a.dispatchEval(fmt.Sprintf("if (window.__onDroppedMedia) { window.__onDroppedMedia(%s, %s, %s); }", reqJSON, textJSON, errJSON))
		}
		defer func() {
			if r := recover(); r != nil {
				answer("", fmt.Sprintf("内部エラーが起きました: %v", r))
			}
		}()
		kind, mt := droppedMediaKind(name, mimeType)
		if kind == "" {
			answer("", "画像でも音声でもないファイルです")
			return
		}
		data, err := base64.StdEncoding.DecodeString(dataBase64)
		if err != nil {
			answer("", "ファイルを読み取れませんでした")
			return
		}
		var visionCfg llm.VisionConfig
		_ = json.Unmarshal([]byte(visionConfigJSON), &visionCfg)
		var voiceCfg llm.VoiceConfig
		_ = json.Unmarshal([]byte(voiceConfigJSON), &voiceCfg)
		text, err := mobileDropItemBody(dropzone.Payload{Kind: kind, Filename: name, MimeType: mt, Data: data}, visionCfg, voiceCfg)
		if err != nil {
			answer("", err.Error())
			return
		}
		answer(text, "")
	}()
}
