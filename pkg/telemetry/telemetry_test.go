package telemetry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 17, 12, 0, 0, 0, time.Local)

func good(ts time.Time) string {
	return `{"v":1,"ts":` + itoa(ts.UnixMilli()) + `,"dur_ms":30000,"keys":120,"mean_dwell_ms":72,"iki_mean_ms":180,"iki_cv":0.28,"delete_ratio":0.08,"nav_ratio":0.05,` +
		`"ime_ratio":0.7,"ime_delete_ratio":0.1,"stall_pauses":1,"mouse_dist_px":1200,"mouse_turns":14,"scroll_events":6,"scroll_flips":1,"scroll_px":900,` +
		`"cmd_count":2,"last_cmd":2,"cmd_latency_ms":1200,"voice_starts":1,"voice_ms":8000}`
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestLineAcceptsASnapshotAndWritesItCompactly(t *testing.T) {
	line, err := Line(good(t0), t0)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(string(line), "\n") || strings.Count(string(line), "\n") != 1 {
		t.Fatalf("one line expected: %q", line)
	}
	var back Snapshot
	if err := json.Unmarshal(line, &back); err != nil || back.Keys != 120 || back.IKICV != 0.28 {
		t.Fatalf("round trip: %v %+v", err, back)
	}
}

// The point of the package: nothing but numbers of the known names gets in.
func TestLineRefusesAnythingButTheKnownNumbers(t *testing.T) {
	cases := map[string]string{
		"an unknown field":          strings.Replace(good(t0), `"keys":120`, `"keys":120,"text":"hello"`, 1),
		"a string for a number":     strings.Replace(good(t0), `"keys":120`, `"keys":"abc"`, 1),
		"the key that was pressed":  strings.Replace(good(t0), `"last_cmd":2`, `"last_cmd":"ctrl+l"`, 1),
		"a nested object":           strings.Replace(good(t0), `"keys":120`, `"keys":{"a":1}`, 1),
		"an array":                  strings.Replace(good(t0), `"keys":120`, `"keys":[1,2]`, 1),
		"a fraction for a count":    strings.Replace(good(t0), `"keys":120`, `"keys":1.5`, 1),
		"a negative count":          strings.Replace(good(t0), `"keys":120`, `"keys":-1`, 1),
		"a ratio above 1":           strings.Replace(good(t0), `"delete_ratio":0.08`, `"delete_ratio":1.5`, 1),
		"a count above its range":   strings.Replace(good(t0), `"mean_dwell_ms":72`, `"mean_dwell_ms":999999`, 1),
		"another version":           strings.Replace(good(t0), `"v":1`, `"v":2`, 1),
		"no version":                strings.Replace(good(t0), `"v":1,`, ``, 1),
		"a time that is not now":    good(t0.Add(48 * time.Hour)),
		"a window that is too long": strings.Replace(good(t0), `"dur_ms":30000`, `"dur_ms":99999999`, 1),
		"two values":                good(t0) + good(t0),
		"not JSON":                  `keys=120`,
		"an array of snapshots":     `[` + good(t0) + `]`,
		"too large":                 good(t0) + strings.Repeat(" ", maxLineBytes),
	}
	for name, raw := range cases {
		if _, err := Line(raw, t0); err == nil {
			t.Errorf("%s: should have been refused", name)
		}
	}
}

// Every field of a snapshot is a number: no string, bool, slice or map can ever be added without this test saying so.
func TestSnapshotHasNumbersOnly(t *testing.T) {
	typ := reflect.TypeOf(Snapshot{})
	for i := 0; i < typ.NumField(); i++ {
		switch typ.Field(i).Type.Kind() {
		case reflect.Int, reflect.Int64, reflect.Float64:
		default:
			t.Errorf("field %s is a %s: a snapshot is numbers only", typ.Field(i).Name, typ.Field(i).Type.Kind())
		}
	}
	if typ.NumField() != 22 {
		t.Errorf("the log format has %d fields; changing it is a decision (update the manual's list and this number)", typ.NumField())
	}
}

func newStore(t *testing.T) (*Store, *time.Time) {
	t.Helper()
	now := t0
	s := NewStore(filepath.Join(t.TempDir(), "telemetry"))
	s.Now = func() time.Time { return now }
	return s, &now
}

func TestAppendWritesTodaysFileAndOnlyLines(t *testing.T) {
	s, now := newStore(t)
	if err := s.Append(good(*now)); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(30 * time.Second)
	if err := s.Append(good(*now)); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(s.Dir, "2026-10-17.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("two lines expected: %q", data)
	}
	for _, l := range lines {
		var m map[string]interface{}
		if err := json.Unmarshal([]byte(l), &m); err != nil {
			t.Fatal(err)
		}
		for k, v := range m {
			if _, ok := v.(float64); !ok {
				t.Errorf("%s is not a number in the file: %v", k, v)
			}
		}
	}
	files, bytes := s.Info()
	if files != 1 || bytes != int64(len(data)) {
		t.Fatalf("info: %d %d", files, bytes)
	}
}

func TestAppendRefusedLineLeavesNothing(t *testing.T) {
	s, now := newStore(t)
	if err := s.Append(strings.Replace(good(*now), `"keys":120`, `"keys":120,"note":"secret"`, 1)); err == nil {
		t.Fatal("refused expected")
	}
	if _, err := os.Stat(s.Dir); !os.IsNotExist(err) {
		t.Fatal("a refused line must not even create the folder")
	}
}

func TestAppendIsRateLimited(t *testing.T) {
	s, now := newStore(t)
	for i := 0; i < maxPerMinute; i++ {
		if err := s.Append(good(*now)); err != nil {
			t.Fatalf("line %d: %v", i, err)
		}
	}
	if err := s.Append(good(*now)); err == nil {
		t.Fatal("the line past the limit must be refused")
	}
	*now = now.Add(61 * time.Second)
	if err := s.Append(good(*now)); err != nil {
		t.Fatalf("a minute later it is fine again: %v", err)
	}
}

func TestAppendStopsAtTheDailyCap(t *testing.T) {
	s, now := newStore(t)
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.Dir, "2026-10-17.jsonl")
	if err := os.WriteFile(path, make([]byte, MaxDayBytes-10), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.Append(good(*now)); err == nil {
		t.Fatal("a full day's file takes no more")
	}
	*now = now.AddDate(0, 0, 1)
	if err := s.Append(good(*now)); err != nil {
		t.Fatalf("the next day starts a new file: %v", err)
	}
}

func TestPurgeRemovesOnlyOldDailyFiles(t *testing.T) {
	s, now := newStore(t)
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	mk := func(name string) { _ = os.WriteFile(filepath.Join(s.Dir, name), []byte("{}\n"), 0o600) }
	old := now.AddDate(0, 0, -RetainDays-1).Format("2006-01-02") + ".jsonl"
	edge := now.AddDate(0, 0, -RetainDays).Format("2006-01-02") + ".jsonl"
	mk(old)
	mk(edge)
	mk("2026-10-16.jsonl")
	mk("notes.txt")
	mk("2020-01-01.jsonl.bak")
	n, err := s.Purge()
	if err != nil || n != 1 {
		t.Fatalf("one old file expected to go: %d %v", n, err)
	}
	for _, name := range []string{edge, "2026-10-16.jsonl", "notes.txt", "2020-01-01.jsonl.bak"} {
		if _, err := os.Stat(filepath.Join(s.Dir, name)); err != nil {
			t.Errorf("%s must stay: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(s.Dir, old)); !os.IsNotExist(err) {
		t.Error("the old file must go")
	}
}

func TestAppendPurgesOncePerDay(t *testing.T) {
	s, now := newStore(t)
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(s.Dir, now.AddDate(0, 0, -40).Format("2006-01-02")+".jsonl")
	_ = os.WriteFile(old, []byte("{}\n"), 0o600)
	if err := s.Append(good(*now)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("the first line of the day purges")
	}
}

func TestClearRemovesTheDailyFilesOnly(t *testing.T) {
	s, now := newStore(t)
	if err := s.Append(good(*now)); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(s.Dir, "keep.txt"), []byte("x"), 0o600)
	n, err := s.Clear()
	if err != nil || n != 1 {
		t.Fatalf("clear: %d %v", n, err)
	}
	if files, _ := s.Info(); files != 0 {
		t.Fatal("no daily files left")
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "keep.txt")); err != nil {
		t.Fatal("other files stay")
	}
	if n, err := NewStore(filepath.Join(t.TempDir(), "none")).Clear(); err != nil || n != 0 {
		t.Fatalf("a missing folder is not an error: %d %v", n, err)
	}
}
