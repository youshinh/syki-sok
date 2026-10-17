package telemetry

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// The activity log: what the person works on and with, kept on this PC for a local model to read (a digest of the day, "where did I
// leave off"). It is the second tier of the operation-rhythm log and holds text, so it is a separate folder with its own switches
// (Settings > General): "app" lines (which app was in front, and its window title) and "edit" / "ask" / "answer" lines (which note was
// written in and by how much, the request typed in an AI bar and what became of it).
//
// What is never in it, whatever the switches say: the keys that were pressed, the text that was typed into a note (the note itself is on
// disk already; a line names it and counts characters), clipboard, screen contents, audio. Every line decodes into one of the typed
// structs below (an unknown field is refused), every string has a length cap and no control characters.
const (
	KindApp    = "app"
	KindEdit   = "edit"
	KindAsk    = "ask"
	KindAnswer = "answer"

	maxActivityDayBytes   = 8 << 20
	maxActivityPerMinute  = 240
	maxActivityLine       = 32 << 10
	maxAppLen             = 120
	maxTitleLen           = 300
	maxNoteLen            = 500
	maxPromptLen          = 4000
	activityVersion       = 1
	digestSegmentCap      = 15 * time.Minute // a stretch in one app counts at most this long (the PC may have slept, the person may have left)
	digestMaxAsks         = 20
	digestMaxTitlesPerApp = 3
)

// AppEvent: an app came to the front.
type AppEvent struct {
	V     int    `json:"v"`
	TS    int64  `json:"ts"`
	Kind  string `json:"kind"`
	App   string `json:"app"`   // the program's name (chrome.exe)
	Title string `json:"title"` // its window's title; empty for syki itself and for what the person excluded
	Self  int    `json:"self"`  // 1: it is syki
}

// EditEvent: one stretch of writing in one note.
type EditEvent struct {
	V        int    `json:"v"`
	TS       int64  `json:"ts"`
	Kind     string `json:"kind"`
	Note     string `json:"note"` // the note's path, or its title when it has no file yet
	DurMS    int    `json:"dur_ms"`
	NetChars int    `json:"net_chars"` // characters at the end minus at the start
	Ins      int    `json:"ins"`       // input events that put text in
	Del      int    `json:"del"`       // input events that took text out
	Paste    int    `json:"paste"`
	Undo     int    `json:"undo"` // undo / redo
}

// AskEvent: a request typed in an AI bar and sent.
type AskEvent struct {
	V      int    `json:"v"`
	TS     int64  `json:"ts"`
	Kind   string `json:"kind"`
	Req    string `json:"req"`
	Mode   string `json:"mode"`   // ask, rewrite, command, other
	Dest   string `json:"dest"`   // local, cloud, unknown: where the model is
	Prompt string `json:"prompt"` // what the person typed (not the note text that went with it)
}

// AnswerEvent: what became of it.
type AnswerEvent struct {
	V         int    `json:"v"`
	TS        int64  `json:"ts"`
	Kind      string `json:"kind"`
	Req       string `json:"req"`
	Outcome   string `json:"outcome"` // ok (put in the note), error, cancel
	ElapsedMS int    `json:"elapsed_ms"`
	Chars     int    `json:"chars"` // length of the answer
}

var (
	reqPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)
	modes      = map[string]bool{"ask": true, "rewrite": true, "command": true, "other": true}
	dests      = map[string]bool{"local": true, "cloud": true, "unknown": true}
	outcomes   = map[string]bool{"ok": true, "error": true, "cancel": true}
)

// clean makes a string safe for a line: control characters become spaces, runs of white space one space, at most max characters.
func clean(s string, max int) string {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	var b strings.Builder
	space := false
	n := 0
	for _, r := range s {
		if r < 0x20 || r == 0x7f || r == 0x85 || r == 0x2028 || r == 0x2029 {
			r = ' '
		}
		if r == ' ' || r == '\t' {
			if space || b.Len() == 0 {
				continue
			}
			space = true
			r = ' '
		} else {
			space = false
		}
		if n >= max {
			break
		}
		b.WriteRune(r)
		n++
	}
	return strings.TrimRight(b.String(), " ")
}

func inRange(v, min, max int) bool { return v >= min && v <= max }

func (s *ActivityStore) checkTS(ts int64) error {
	if d := time.UnixMilli(ts).Sub(s.now()); d > maxClockSkew || d < -maxClockSkew {
		return errors.New("activity: timestamp is not now")
	}
	return nil
}

// ActivityStore is the folder of daily files of the activity log.
type ActivityStore struct {
	Dir string
	// Now is the clock (a test sets it).
	Now func() time.Time

	log *dayLog
}

// NewActivityStore is a store in dir (created when the first line is written).
func NewActivityStore(dir string) *ActivityStore {
	return &ActivityStore{Dir: dir, Now: time.Now, log: newDayLog(maxActivityDayBytes, maxActivityPerMinute)}
}

func (s *ActivityStore) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Line decodes one line from the page: only the kinds in allowed, only the known fields, every string cleaned and capped, every number
// in range. It returns the line to write and its kind.
func (s *ActivityStore) Line(raw string, allowed ...string) ([]byte, string, error) {
	if len(raw) > maxActivityLine {
		return nil, "", errors.New("activity: line too large")
	}
	var probe struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal([]byte(raw), &probe); err != nil {
		return nil, "", fmt.Errorf("activity: not a line: %w", err)
	}
	ok := false
	for _, k := range allowed {
		if k == probe.Kind {
			ok = true
		}
	}
	if !ok {
		return nil, "", fmt.Errorf("activity: kind %q is not accepted here", probe.Kind)
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	var v interface{}
	switch probe.Kind {
	case KindApp:
		var e AppEvent
		if err := dec.Decode(&e); err != nil {
			return nil, "", fmt.Errorf("activity: %w", err)
		}
		e.App, e.Title = clean(e.App, maxAppLen), clean(e.Title, maxTitleLen)
		if err := s.checkTS(e.TS); err != nil {
			return nil, "", err
		}
		if e.V != activityVersion || (e.App == "" && e.Self == 0) || !inRange(e.Self, 0, 1) {
			return nil, "", errors.New("activity: bad app line")
		}
		v = e
	case KindEdit:
		var e EditEvent
		if err := dec.Decode(&e); err != nil {
			return nil, "", fmt.Errorf("activity: %w", err)
		}
		e.Note = clean(e.Note, maxNoteLen)
		if err := s.checkTS(e.TS); err != nil {
			return nil, "", err
		}
		if e.V != activityVersion || !inRange(e.DurMS, 0, maxWindowMS) || !inRange(e.NetChars, -1<<30, 1<<30) || !inRange(e.Ins, 0, 1<<24) ||
			!inRange(e.Del, 0, 1<<24) || !inRange(e.Paste, 0, 1<<24) || !inRange(e.Undo, 0, 1<<24) {
			return nil, "", errors.New("activity: bad edit line")
		}
		v = e
	case KindAsk:
		var e AskEvent
		if err := dec.Decode(&e); err != nil {
			return nil, "", fmt.Errorf("activity: %w", err)
		}
		e.Prompt = clean(e.Prompt, maxPromptLen)
		if err := s.checkTS(e.TS); err != nil {
			return nil, "", err
		}
		if e.V != activityVersion || !reqPattern.MatchString(e.Req) || !modes[e.Mode] || !dests[e.Dest] {
			return nil, "", errors.New("activity: bad ask line")
		}
		v = e
	case KindAnswer:
		var e AnswerEvent
		if err := dec.Decode(&e); err != nil {
			return nil, "", fmt.Errorf("activity: %w", err)
		}
		if err := s.checkTS(e.TS); err != nil {
			return nil, "", err
		}
		if e.V != activityVersion || !reqPattern.MatchString(e.Req) || !outcomes[e.Outcome] || !inRange(e.ElapsedMS, 0, 24*3600*1000) || !inRange(e.Chars, 0, 1<<30) {
			return nil, "", errors.New("activity: bad answer line")
		}
		v = e
	}
	if dec.More() {
		return nil, "", errors.New("activity: more than one value")
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(v); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), probe.Kind, nil
}

// Append writes a line from the page (edit, ask and answer only: the app lines are the program's own, see AppendApp).
func (s *ActivityStore) Append(raw string) error {
	line, _, err := s.Line(raw, KindEdit, KindAsk, KindAnswer)
	if err != nil {
		return err
	}
	return s.log.append(s.Dir, s.now(), line)
}

// AppendApp writes an "app" line: an app came to the front.
func (s *ActivityStore) AppendApp(app, title string, self bool) error {
	e := AppEvent{V: activityVersion, TS: s.now().UnixMilli(), Kind: KindApp, App: clean(app, maxAppLen), Title: clean(title, maxTitleLen)}
	if self {
		e.Self, e.Title = 1, ""
	}
	if e.App == "" && !self {
		return errors.New("activity: no app name")
	}
	line, _, err := s.Line(mustJSON(e), KindApp)
	if err != nil {
		return err
	}
	return s.log.append(s.Dir, s.now(), line)
}

func mustJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// Purge deletes the daily files older than RetainDays and returns how many.
func (s *ActivityStore) Purge() (int, error) { return s.log.purge(s.Dir, s.now()) }

// Info is what is on disk: how many daily files and how many bytes.
func (s *ActivityStore) Info() (files int, bytes int64) { return dirInfo(s.Dir) }

// Clear deletes every daily file and returns how many.
func (s *ActivityStore) Clear() (int, error) { return s.log.clear(s.Dir) }

// ---------------------------------------------------------------------------------------------------------------------------------
// the digest: the log of the last N hours as a short text a local model can be given

type digestLine struct {
	Kind      string `json:"kind"`
	TS        int64  `json:"ts"`
	App       string `json:"app"`
	Title     string `json:"title"`
	Self      int    `json:"self"`
	Note      string `json:"note"`
	NetChars  int    `json:"net_chars"`
	Ins       int    `json:"ins"`
	Del       int    `json:"del"`
	Req       string `json:"req"`
	Mode      string `json:"mode"`
	Dest      string `json:"dest"`
	Prompt    string `json:"prompt"`
	Outcome   string `json:"outcome"`
	ElapsedMS int    `json:"elapsed_ms"`
}

func (s *ActivityStore) readSince(since time.Time) []digestLine {
	var out []digestLine
	first := time.Date(since.Year(), since.Month(), since.Day(), 0, 0, 0, 0, since.Location())
	for d := first; !d.After(s.now()); d = d.AddDate(0, 0, 1) {
		f, err := os.Open(filepath.Join(s.Dir, d.Format("2006-01-02")+".jsonl"))
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64*1024), maxActivityLine*2)
		for sc.Scan() {
			var l digestLine
			if json.Unmarshal(sc.Bytes(), &l) == nil && l.TS >= since.UnixMilli() {
				out = append(out, l)
			}
		}
		_ = f.Close()
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].TS < out[j].TS })
	return out
}

func minutes(d time.Duration) int { return int((d + 30*time.Second) / time.Minute) }

// Digest is the activity of the last hours (1 to 168) as plain text: time per app (with the window titles it spent most time in), the
// notes written in and by how much, and the requests made to the AI bars with what became of them. Nothing in it is added: it is only
// what the lines hold, put together.
func (s *ActivityStore) Digest(hours int) string {
	if hours < 1 {
		hours = 1
	}
	if hours > 168 {
		hours = 168
	}
	now := s.now()
	lines := s.readSince(now.Add(-time.Duration(hours) * time.Hour))
	var sb strings.Builder
	fmt.Fprintf(&sb, "Activity of the last %d hour(s), until %s\n", hours, now.Format("2006-01-02 15:04"))

	// apps: each "app" line holds until the next one (at most digestSegmentCap)
	appTime := map[string]time.Duration{}
	titleTime := map[string]map[string]time.Duration{}
	var apps []digestLine
	for _, l := range lines {
		if l.Kind == KindApp {
			apps = append(apps, l)
		}
	}
	for i, l := range apps {
		end := now
		if i+1 < len(apps) {
			end = time.UnixMilli(apps[i+1].TS)
		}
		d := end.Sub(time.UnixMilli(l.TS))
		if d > digestSegmentCap {
			d = digestSegmentCap
		}
		if d < 0 {
			continue
		}
		name := l.App
		if l.Self == 1 {
			name = "syki"
		}
		appTime[name] += d
		if l.Title != "" {
			if titleTime[name] == nil {
				titleTime[name] = map[string]time.Duration{}
			}
			titleTime[name][l.Title] += d
		}
	}
	if len(appTime) > 0 {
		sb.WriteString("\nApps (minutes in front):\n")
		names := make([]string, 0, len(appTime))
		for n := range appTime {
			names = append(names, n)
		}
		sort.Slice(names, func(i, j int) bool {
			return appTime[names[i]] > appTime[names[j]] || (appTime[names[i]] == appTime[names[j]] && names[i] < names[j])
		})
		for i, n := range names {
			if i >= 10 {
				break
			}
			fmt.Fprintf(&sb, "- %s: %d\n", n, minutes(appTime[n]))
			titles := make([]string, 0, len(titleTime[n]))
			for t := range titleTime[n] {
				titles = append(titles, t)
			}
			sort.Slice(titles, func(a, b int) bool {
				return titleTime[n][titles[a]] > titleTime[n][titles[b]] || (titleTime[n][titles[a]] == titleTime[n][titles[b]] && titles[a] < titles[b])
			})
			for k, t := range titles {
				if k >= digestMaxTitlesPerApp {
					break
				}
				fmt.Fprintf(&sb, "    %s (%d)\n", t, minutes(titleTime[n][t]))
			}
		}
	}

	// notes
	type noteStat struct{ windows, net, ins, del int }
	notes := map[string]*noteStat{}
	for _, l := range lines {
		if l.Kind != KindEdit {
			continue
		}
		n := notes[l.Note]
		if n == nil {
			n = &noteStat{}
			notes[l.Note] = n
		}
		n.windows++
		n.net += l.NetChars
		n.ins += l.Ins
		n.del += l.Del
	}
	if len(notes) > 0 {
		sb.WriteString("\nNotes written in (30-second stretches, net characters, inserts, deletes):\n")
		keys := make([]string, 0, len(notes))
		for k := range notes {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool {
			return notes[keys[i]].windows > notes[keys[j]].windows || (notes[keys[i]].windows == notes[keys[j]].windows && keys[i] < keys[j])
		})
		for i, k := range keys {
			if i >= 10 {
				break
			}
			n := notes[k]
			label := k
			if label == "" {
				label = "(untitled)"
			}
			fmt.Fprintf(&sb, "- %s: %d, %+d, %d, %d\n", label, n.windows, n.net, n.ins, n.del)
		}
	}

	// requests
	answers := map[string]digestLine{}
	for _, l := range lines {
		if l.Kind == KindAnswer {
			answers[l.Req] = l
		}
	}
	var asks []digestLine
	for _, l := range lines {
		if l.Kind == KindAsk {
			asks = append(asks, l)
		}
	}
	if len(asks) > 0 {
		sb.WriteString("\nRequests to the AI bars (newest last):\n")
		if len(asks) > digestMaxAsks {
			asks = asks[len(asks)-digestMaxAsks:]
		}
		for _, a := range asks {
			res := "no answer recorded"
			if ans, ok := answers[a.Req]; ok {
				res = ans.Outcome
			}
			prompt := a.Prompt
			if r := []rune(prompt); len(r) > 160 {
				prompt = string(r[:160]) + "..."
			}
			fmt.Fprintf(&sb, "- %s [%s, %s] %s -> %s\n", time.UnixMilli(a.TS).In(now.Location()).Format("15:04"), a.Mode, a.Dest, prompt, res)
		}
	}
	if len(appTime) == 0 && len(notes) == 0 && len(asks) == 0 {
		sb.WriteString("\n(nothing was recorded)\n")
	}
	return sb.String()
}
