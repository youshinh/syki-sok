package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"syki-sok/pkg/appdir"
	"syki-sok/pkg/atomicfile"
	"time"
)

const maxPTYLedgerEntries = 30

type ptyLedgerEntry struct {
	ID           string `json:"id"`
	Label        string `json:"label,omitempty"`
	Preset       string `json:"preset"`
	Dir          string `json:"dir"`
	CLISessionID string `json:"cliSessionId,omitempty"`
	Status       string `json:"status"` // "running" | "dormant" | "closed"
	UpdatedAt    int64  `json:"updatedAt"`
}

var ptyLedgerMu sync.Mutex

// sanitizePTYToken restricts caller-supplied PTY/CLI session identifiers to
// safe alphanumeric/hyphen/underscore tokens of length 1..64, preventing flag injection.
func sanitizePTYToken(s string) string {
	if len(s) == 0 || len(s) > 64 {
		return ""
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			return ""
		}
	}
	return s
}

func ptyLedgerPath() string {
	return filepath.Join(appdir.AppConfigDir(), "pty_sessions.json")
}

func loadPTYLedgerLocked(path string) []ptyLedgerEntry {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var entries []ptyLedgerEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil
	}
	return entries
}

func savePTYLedgerLocked(path string, entries []ptyLedgerEntry) error {
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].UpdatedAt > entries[j].UpdatedAt
	})
	if len(entries) > maxPTYLedgerEntries {
		entries = entries[:maxPTYLedgerEntries]
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.WriteMode(path, raw, ".pty_sessions-*.tmp", 0o600)
}

func upsertPTYLedger(entry ptyLedgerEntry) {
	if entry.ID == "" {
		return
	}
	if entry.UpdatedAt == 0 {
		entry.UpdatedAt = time.Now().UnixMilli()
	}
	ptyLedgerMu.Lock()
	defer ptyLedgerMu.Unlock()
	path := ptyLedgerPath()
	entries := loadPTYLedgerLocked(path)
	found := false
	for i := range entries {
		if entries[i].ID == entry.ID {
			if entry.CLISessionID == "" {
				entry.CLISessionID = entries[i].CLISessionID
			}
			if entry.Label == "" {
				entry.Label = entries[i].Label
			}
			entries[i] = entry
			found = true
			break
		}
	}
	if !found {
		entries = append(entries, entry)
	}
	_ = savePTYLedgerLocked(path, entries)
}

func updatePTYLedgerFields(id, status, label string, updateLabel bool) {
	if id == "" {
		return
	}
	ptyLedgerMu.Lock()
	defer ptyLedgerMu.Unlock()
	path := ptyLedgerPath()
	entries := loadPTYLedgerLocked(path)
	changed := false
	for i := range entries {
		if entries[i].ID == id {
			if status != "" && !(status == "closed" && entries[i].Status == "dormant") {
				entries[i].Status = status
			}
			if updateLabel {
				entries[i].Label = label
			}
			entries[i].UpdatedAt = time.Now().UnixMilli()
			changed = true
			break
		}
	}
	if changed {
		_ = savePTYLedgerLocked(path, entries)
	}
}

func removePTYLedger(id string) {
	if id == "" {
		return
	}
	ptyLedgerMu.Lock()
	defer ptyLedgerMu.Unlock()
	path := ptyLedgerPath()
	entries := loadPTYLedgerLocked(path)
	out := make([]ptyLedgerEntry, 0, len(entries))
	for _, e := range entries {
		if e.ID != id {
			out = append(out, e)
		}
	}
	_ = savePTYLedgerLocked(path, out)
}

func readPTYLedger() []ptyLedgerEntry {
	ptyLedgerMu.Lock()
	defer ptyLedgerMu.Unlock()
	entries := loadPTYLedgerLocked(ptyLedgerPath())
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].UpdatedAt > entries[j].UpdatedAt
	})
	return entries
}

func newUUIDv4() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("syki-%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ptyBatcher coalesces high-rate PTY output chunks into 24ms / 16KB batches
// so WebView IPC evaluation does not saturate under heavy log output.
type ptyBatcher struct {
	mu       sync.Mutex
	buf      []byte
	timer    *time.Timer
	interval time.Duration
	maxBytes int
	emit     func([]byte)
}

func newPTYBatcher(interval time.Duration, maxBytes int, emit func([]byte)) *ptyBatcher {
	if interval <= 0 {
		interval = 24 * time.Millisecond
	}
	if maxBytes <= 0 {
		maxBytes = 16384
	}
	return &ptyBatcher{
		interval: interval,
		maxBytes: maxBytes,
		emit:     emit,
	}
}

func (b *ptyBatcher) Push(data []byte) {
	if len(data) == 0 {
		return
	}
	b.mu.Lock()
	b.buf = append(b.buf, data...)
	if len(b.buf) >= b.maxBytes {
		if b.timer != nil {
			b.timer.Stop()
			b.timer = nil
		}
		chunk := b.buf
		b.buf = nil
		b.mu.Unlock()
		if b.emit != nil {
			b.emit(chunk)
		}
		return
	}
	if b.timer == nil {
		b.timer = time.AfterFunc(b.interval, b.Flush)
	}
	b.mu.Unlock()
}

func (b *ptyBatcher) Flush() {
	b.mu.Lock()
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
	if len(b.buf) == 0 {
		b.mu.Unlock()
		return
	}
	chunk := b.buf
	b.buf = nil
	b.mu.Unlock()
	if b.emit != nil {
		b.emit(chunk)
	}
}
