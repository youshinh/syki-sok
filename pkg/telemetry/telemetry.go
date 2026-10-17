// Package telemetry keeps the operation-rhythm log: one line per 30-second window of how the person types, moves the mouse, scrolls and
// calls commands (frontend/js/telemetry.js). Nothing that was typed, no key, no pointer position and no audio is in it, and this package
// is what makes sure of that: a line is accepted only if it decodes into Snapshot, where every field is a number of a known name and
// range. An unknown field, a string where a number belongs or a number out of range is refused, so a bug (or a page that was tampered
// with) cannot write text into the log.
//
// The log is a folder of JSON Lines files, one per local day (YYYY-MM-DD.jsonl), append only, in the app's config folder (never in the
// scraps folder, which is synced with git). Files older than RetainDays are deleted.
package telemetry

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	// Version is the schema version of a line ("v").
	Version = 1
	// RetainDays is how long the daily files are kept.
	RetainDays = 30
	// MaxDayBytes caps one day's file: a runaway sender stops filling the disk (a normal day is a few hundred KB).
	MaxDayBytes = 2 << 20
	// maxPerMinute caps how fast lines are taken (a window is 30 s; a few extra come when the window is hidden).
	maxPerMinute = 10
	// maxLineBytes: a line is about 350 bytes.
	maxLineBytes = 2048
	// maxClockSkew: a line says when its window ended; one far from now is refused.
	maxClockSkew = 24 * time.Hour
	maxWindowMS  = 10 * 60 * 1000
)

// Snapshot is one window. Every field is a number; the names are the log's format.
type Snapshot struct {
	V              int     `json:"v"`
	TS             int64   `json:"ts"`               // end of the window, Unix ms
	DurMS          int     `json:"dur_ms"`           // length of the window
	Keys           int     `json:"keys"`             // key presses (no key is named)
	MeanDwellMS    int     `json:"mean_dwell_ms"`    // how long a key is held
	IKIMeanMS      int     `json:"iki_mean_ms"`      // press to press, pauses of 2 s or more left out
	IKICV          float64 `json:"iki_cv"`           // spread of that interval / its mean: steady rhythm is low
	DeleteRatio    float64 `json:"delete_ratio"`     // Backspace / Delete outside of an IME composition, of all key presses
	NavRatio       float64 `json:"nav_ratio"`        // arrows, Home, End, Page keys, of all key presses
	IMERatio       float64 `json:"ime_ratio"`        // key presses made while an IME was composing, of all key presses
	IMEDeleteRatio float64 `json:"ime_delete_ratio"` // Backspace / Delete inside a composition, of the composing key presses
	StallPauses    int     `json:"stall_pauses"`     // pauses of 2 s or more between key presses
	MouseDistPX    int     `json:"mouse_dist_px"`    // distance the pointer moved (a sum, not where)
	MouseTurns     int     `json:"mouse_turns"`      // sharp changes of direction of the pointer
	ScrollEvents   int     `json:"scroll_events"`    // wheel events
	ScrollFlips    int     `json:"scroll_flips"`     // reversals of the scroll direction
	ScrollPX       int     `json:"scroll_px"`        // distance scrolled
	CmdCount       int     `json:"cmd_count"`        // commands called (the shortcuts of the AI bars, voice, ...)
	LastCmd        int     `json:"last_cmd"`         // id of the last one: 1 Ctrl+J, 2 Ctrl+L, 3 Ctrl+E, 4 Ctrl+Enter, 5 voice, 99 other (0 none)
	CmdLatencyMS   int     `json:"cmd_latency_ms"`   // time from the last key press to that command (0: unknown)
	VoiceStarts    int     `json:"voice_starts"`     // voice input started (the count only: no audio and no analysis)
	VoiceMS        int     `json:"voice_ms"`         // time the microphone was on for it
	WinState       int     `json:"win_state"`        // the window when the window ended: 0 floating, 1 maximized, 2 snapped to a side of the screen, 3 full screen
	Zen            int     `json:"zen"`              // 1 in Zen mode
	View           int     `json:"view"`             // 0 editor, 1 preview, 2 split
	WinChanged     int     `json:"win_changed"`      // 1 when win_state, zen or view differ from the window before
	BlurCount      int     `json:"blur_count"`       // times the window lost the focus (another app was used)
	FocusMS        int     `json:"focus_ms"`         // time the window had the focus (dur_ms - focus_ms is the time spent elsewhere)
}

// Validate refuses a snapshot with a number out of its range.
func (s *Snapshot) Validate(now time.Time) error {
	if s.V != Version {
		return fmt.Errorf("telemetry: unknown version %d", s.V)
	}
	if d := time.UnixMilli(s.TS).Sub(now); d > maxClockSkew || d < -maxClockSkew {
		return errors.New("telemetry: timestamp is not now")
	}
	if s.DurMS < 0 || s.DurMS > maxWindowMS {
		return errors.New("telemetry: window length out of range")
	}
	ints := []struct {
		name string
		v    int
		max  int
	}{
		{"keys", s.Keys, 1 << 20}, {"mean_dwell_ms", s.MeanDwellMS, 60000}, {"iki_mean_ms", s.IKIMeanMS, 60000},
		{"stall_pauses", s.StallPauses, 1 << 20}, {"mouse_dist_px", s.MouseDistPX, 1 << 30}, {"mouse_turns", s.MouseTurns, 1 << 24},
		{"scroll_events", s.ScrollEvents, 1 << 24}, {"scroll_flips", s.ScrollFlips, 1 << 24}, {"scroll_px", s.ScrollPX, 1 << 30},
		{"cmd_count", s.CmdCount, 1 << 20}, {"last_cmd", s.LastCmd, 99}, {"cmd_latency_ms", s.CmdLatencyMS, 24 * 3600 * 1000},
		{"voice_starts", s.VoiceStarts, 1 << 16}, {"voice_ms", s.VoiceMS, maxWindowMS},
		{"win_state", s.WinState, 3}, {"zen", s.Zen, 1}, {"view", s.View, 2}, {"win_changed", s.WinChanged, 1},
		{"blur_count", s.BlurCount, 1 << 16}, {"focus_ms", s.FocusMS, maxWindowMS},
	}
	for _, f := range ints {
		if f.v < 0 || f.v > f.max {
			return fmt.Errorf("telemetry: %s out of range", f.name)
		}
	}
	ratios := []struct {
		name string
		v    float64
		max  float64
	}{
		{"iki_cv", s.IKICV, 100}, {"delete_ratio", s.DeleteRatio, 1}, {"nav_ratio", s.NavRatio, 1},
		{"ime_ratio", s.IMERatio, 1}, {"ime_delete_ratio", s.IMEDeleteRatio, 1},
	}
	for _, f := range ratios {
		if math.IsNaN(f.v) || math.IsInf(f.v, 0) || f.v < 0 || f.v > f.max {
			return fmt.Errorf("telemetry: %s out of range", f.name)
		}
	}
	return nil
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// Line decodes and checks one snapshot and returns the line to write (compact, fields in a fixed order, ratios to 3 decimals).
func Line(raw string, now time.Time) ([]byte, error) {
	if len(raw) > maxLineBytes {
		return nil, errors.New("telemetry: snapshot too large")
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	var s Snapshot
	if err := dec.Decode(&s); err != nil {
		return nil, fmt.Errorf("telemetry: not a snapshot: %w", err)
	}
	if dec.More() {
		return nil, errors.New("telemetry: more than one value")
	}
	if err := s.Validate(now); err != nil {
		return nil, err
	}
	s.IKICV, s.DeleteRatio, s.NavRatio, s.IMERatio, s.IMEDeleteRatio = round3(s.IKICV), round3(s.DeleteRatio), round3(s.NavRatio), round3(s.IMERatio), round3(s.IMEDeleteRatio)
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	if err := enc.Encode(&s); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil // Encode ends the line
}

// Store is the folder of daily files.
type Store struct {
	Dir string
	// Now is the clock (a test sets it).
	Now func() time.Time

	mu        sync.Mutex
	recent    [maxPerMinute]time.Time
	recentPos int
	purgedDay string
}

// NewStore is a store in dir (created when the first line is written).
func NewStore(dir string) *Store { return &Store{Dir: dir, Now: time.Now} }

var dayFile = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})\.jsonl$`)

func (s *Store) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Append checks a snapshot and writes it to today's file.
func (s *Store) Append(raw string) error {
	now := s.now()
	line, err := Line(raw, now)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// at most maxPerMinute lines in any minute: the oldest of the last maxPerMinute must be a minute old
	if old := s.recent[s.recentPos]; !old.IsZero() && now.Sub(old) < time.Minute {
		return errors.New("telemetry: too many snapshots")
	}
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	day := now.Format("2006-01-02")
	if s.purgedDay != day {
		s.purgedDay = day
		_, _ = s.purgeLocked(now)
	}
	path := filepath.Join(s.Dir, day+".jsonl")
	if fi, err := os.Stat(path); err == nil && fi.Size()+int64(len(line)) > MaxDayBytes {
		return errors.New("telemetry: today's file is full")
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, werr := f.Write(line)
	cerr := f.Close()
	if werr != nil {
		return werr
	}
	if cerr != nil {
		return cerr
	}
	s.recent[s.recentPos] = now
	s.recentPos = (s.recentPos + 1) % maxPerMinute
	return nil
}

func (s *Store) purgeLocked(now time.Time) (int, error) {
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	cutoff := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -RetainDays)
	removed := 0
	for _, e := range entries {
		m := dayFile.FindStringSubmatch(e.Name())
		if m == nil || e.IsDir() {
			continue
		}
		d, err := time.ParseInLocation("2006-01-02", m[1], now.Location())
		if err != nil || !d.Before(cutoff) {
			continue
		}
		if os.Remove(filepath.Join(s.Dir, e.Name())) == nil {
			removed++
		}
	}
	return removed, nil
}

// Purge deletes the daily files older than RetainDays and returns how many.
func (s *Store) Purge() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.purgeLocked(s.now())
}

// Info is what is on disk: the folder, how many daily files and how many bytes.
func (s *Store) Info() (files int, bytes int64) {
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		return 0, 0
	}
	for _, e := range entries {
		if e.IsDir() || dayFile.FindStringSubmatch(e.Name()) == nil {
			continue
		}
		if fi, err := e.Info(); err == nil {
			files++
			bytes += fi.Size()
		}
	}
	return files, bytes
}

// Clear deletes every daily file (only files of that name: anything else in the folder is left) and returns how many.
func (s *Store) Clear() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	removed := 0
	var firstErr error
	for _, e := range entries {
		if e.IsDir() || dayFile.FindStringSubmatch(e.Name()) == nil {
			continue
		}
		if err := os.Remove(filepath.Join(s.Dir, e.Name())); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		removed++
	}
	return removed, firstErr
}
