package telemetry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

func newActivity(t *testing.T) (*ActivityStore, *time.Time) {
	t.Helper()
	now := t0
	s := NewActivityStore(filepath.Join(t.TempDir(), "activity"))
	s.Now = func() time.Time { return now }
	return s, &now
}

func ms(t time.Time) string { return strconv.FormatInt(t.UnixMilli(), 10) }

func editLine(ts time.Time, note string, net int) string {
	b, _ := json.Marshal(map[string]interface{}{"v": 1, "ts": ts.UnixMilli(), "kind": "edit", "note": note, "dur_ms": 30000, "net_chars": net, "ins": 40, "del": 5, "paste": 0, "undo": 0})
	return string(b)
}

func askLine(ts time.Time, req, prompt string) string {
	b, _ := json.Marshal(map[string]interface{}{"v": 1, "ts": ts.UnixMilli(), "kind": "ask", "req": req, "mode": "ask", "dest": "local", "prompt": prompt})
	return string(b)
}

func answerLine(ts time.Time, req, outcome string) string {
	b, _ := json.Marshal(map[string]interface{}{"v": 1, "ts": ts.UnixMilli(), "kind": "answer", "req": req, "outcome": outcome, "elapsed_ms": 1800, "chars": 420})
	return string(b)
}

func TestActivityAcceptsTheThreeKindsFromThePage(t *testing.T) {
	s, now := newActivity(t)
	for _, raw := range []string{editLine(*now, `C:\notes\plan.md`, 120), askLine(*now, "llm_1", "summarise this"), answerLine(*now, "llm_1", "ok")} {
		if err := s.Append(raw); err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
	}
	files, _ := s.Info()
	if files != 1 {
		t.Fatal("one daily file")
	}
}

// The page cannot write an "app" line: those are the program's own.
func TestActivityPageCannotWriteAppLines(t *testing.T) {
	s, now := newActivity(t)
	raw := `{"v":1,"ts":` + ms(*now) + `,"kind":"app","app":"chrome.exe","title":"x","self":0}`
	if err := s.Append(raw); err == nil {
		t.Fatal("an app line from the page must be refused")
	}
	if err := s.AppendApp("chrome.exe", "Docs - Chrome", false); err != nil {
		t.Fatal(err)
	}
}

func TestActivityRefusesWhatIsNotTheKnownShape(t *testing.T) {
	s, now := newActivity(t)
	ts := ms(*now)
	cases := map[string]string{
		"an unknown field":           strings.Replace(editLine(*now, "a", 1), `"kind":"edit"`, `"kind":"edit","typed":"hello"`, 1),
		"a key stream":               `{"v":1,"ts":` + ts + `,"kind":"keys","keys":"abc"}`,
		"no kind":                    `{"v":1,"ts":` + ts + `}`,
		"a note that is a number":    strings.Replace(editLine(*now, "a", 1), `"note":"a"`, `"note":5`, 1),
		"a count that is a string":   strings.Replace(editLine(*now, "a", 1), `"ins":40`, `"ins":"40"`, 1),
		"a negative count":           strings.Replace(editLine(*now, "a", 1), `"ins":40`, `"ins":-1`, 1),
		"a window longer than 10 m":  strings.Replace(editLine(*now, "a", 1), `"dur_ms":30000`, `"dur_ms":9999999`, 1),
		"a time that is not now":     editLine(now.Add(72*time.Hour), "a", 1),
		"another version":            strings.Replace(editLine(*now, "a", 1), `"v":1`, `"v":2`, 1),
		"an ask with a bad mode":     strings.Replace(askLine(*now, "r1", "p"), `"mode":"ask"`, `"mode":"hack"`, 1),
		"an ask with a bad dest":     strings.Replace(askLine(*now, "r1", "p"), `"dest":"local"`, `"dest":"mars"`, 1),
		"an ask with a bad request":  askLine(*now, "has space", "p"),
		"an ask with no request id":  askLine(*now, "", "p"),
		"an answer with a bad state": answerLine(*now, "r1", "maybe"),
		"two values":                 editLine(*now, "a", 1) + editLine(*now, "b", 1),
		"an array":                   "[" + editLine(*now, "a", 1) + "]",
		"not JSON":                   "kind=edit",
		"too large":                  askLine(*now, "r1", strings.Repeat("x", 3000)) + strings.Repeat(" ", maxActivityLine),
	}
	for name, raw := range cases {
		if err := s.Append(raw); err == nil {
			t.Errorf("%s: should have been refused", name)
		}
	}
	if files, _ := s.Info(); files != 0 {
		t.Fatal("refused lines leave nothing")
	}
}

func TestActivityStringsAreCleanedAndCapped(t *testing.T) {
	s, now := newActivity(t)
	long := strings.Repeat("あ", 6000)
	if err := s.Append(askLine(*now, "r1", "line one\nline two\x00\x1b[31m\t  tab\u2028end "+long)); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(s.Dir, "2026-10-17.jsonl"))
	if strings.Count(string(data), "\n") != 1 {
		t.Fatal("one line, however many line breaks the prompt had")
	}
	var e AskEvent
	if err := json.Unmarshal(data, &e); err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(e.Prompt, "\n\x00\x1b\t\u2028") {
		t.Fatalf("control characters: %q", e.Prompt)
	}
	if !strings.HasPrefix(e.Prompt, "line one line two") || len([]rune(e.Prompt)) != maxPromptLen {
		t.Fatalf("cleaned and capped to %d characters: %d %q", maxPromptLen, len([]rune(e.Prompt)), e.Prompt[:40])
	}
}

func TestActivityFieldsAreOnlyTheKnownOnes(t *testing.T) {
	// a new field is a decision about what is kept: this list is the log's format
	want := map[string][]string{
		"AppEvent":    {"v", "ts", "kind", "app", "title", "self"},
		"EditEvent":   {"v", "ts", "kind", "note", "dur_ms", "net_chars", "ins", "del", "paste", "undo"},
		"AskEvent":    {"v", "ts", "kind", "req", "mode", "dest", "prompt"},
		"AnswerEvent": {"v", "ts", "kind", "req", "outcome", "elapsed_ms", "chars"},
	}
	for name, typ := range map[string]reflect.Type{"AppEvent": reflect.TypeOf(AppEvent{}), "EditEvent": reflect.TypeOf(EditEvent{}), "AskEvent": reflect.TypeOf(AskEvent{}), "AnswerEvent": reflect.TypeOf(AnswerEvent{})} {
		var got []string
		for i := 0; i < typ.NumField(); i++ {
			got = append(got, strings.Split(typ.Field(i).Tag.Get("json"), ",")[0])
		}
		if !reflect.DeepEqual(got, want[name]) {
			t.Errorf("%s fields: %v (want %v)", name, got, want[name])
		}
	}
}

func TestActivityAppLinesForSykiHaveNoTitle(t *testing.T) {
	s, _ := newActivity(t)
	if err := s.AppendApp("syki.exe", "my secret note title", true); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(s.Dir, "2026-10-17.jsonl"))
	var e AppEvent
	_ = json.Unmarshal(data, &e)
	if e.Self != 1 || e.Title != "" {
		t.Fatalf("syki's own window: no title: %+v", e)
	}
	if err := s.AppendApp("", "", false); err == nil {
		t.Fatal("no name, not syki: refused")
	}
}

func TestActivityRetentionSizeAndRate(t *testing.T) {
	s, now := newActivity(t)
	_ = os.MkdirAll(s.Dir, 0o700)
	old := filepath.Join(s.Dir, now.AddDate(0, 0, -31).Format("2006-01-02")+".jsonl")
	_ = os.WriteFile(old, []byte("{}\n"), 0o600)
	if err := s.Append(editLine(*now, "a", 1)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("a file older than 30 days goes with the first line of the day")
	}
	for i := 1; i < maxActivityPerMinute; i++ {
		if err := s.Append(editLine(*now, "a", 1)); err != nil {
			t.Fatalf("line %d: %v", i, err)
		}
	}
	if err := s.Append(editLine(*now, "a", 1)); err == nil {
		t.Fatal("past the limit per minute")
	}
	if n, err := s.Clear(); err != nil || n != 1 {
		t.Fatalf("clear: %d %v", n, err)
	}
}

func TestDigest(t *testing.T) {
	s, now := newActivity(t)
	// 10:00 chrome (20 min, capped to 15), 10:20 syki 5 min, 10:25 chrome another page 10 min, 10:35 excel until now (12:00 -> capped 15)
	at := func(h, m int) time.Time { return time.Date(2026, 10, 17, h, m, 0, 0, time.Local) }
	put := func(ts time.Time, app, title string, self bool) {
		*now = ts
		if err := s.AppendApp(app, title, self); err != nil {
			t.Fatal(err)
		}
	}
	put(at(10, 0), "chrome.exe", "Spec - Docs", false)
	put(at(10, 20), "syki.exe", "", true)
	put(at(10, 25), "chrome.exe", "Spec - Docs", false)
	put(at(10, 35), "EXCEL.EXE", "budget.xlsx", false)
	*now = at(10, 36)
	_ = s.Append(editLine(at(10, 22), `C:\notes\plan.md`, 300))
	_ = s.Append(editLine(at(10, 23), `C:\notes\plan.md`, -40))
	_ = s.Append(editLine(at(10, 24), "", 12))
	_ = s.Append(askLine(at(10, 22), "llm_1", "turn this into three bullet points"))
	_ = s.Append(answerLine(at(10, 22), "llm_1", "ok"))
	_ = s.Append(askLine(at(10, 23), "llm_2", "translate"))
	*now = at(12, 0)
	d := s.Digest(3)
	for _, want := range []string{
		"Activity of the last 3 hour(s), until 2026-10-17 12:00",
		"- chrome.exe: 25", // 15 (capped) + 10
		"    Spec - Docs (25)",
		"- EXCEL.EXE: 15", // capped, the PC may have slept
		"- syki: 5",
		`- C:\notes\plan.md: 2, +260, 80, 10`,
		"- (untitled): 1, +12, 40, 5",
		"10:22 [ask, local] turn this into three bullet points -> ok",
		"10:23 [ask, local] translate -> no answer recorded",
	} {
		if !strings.Contains(d, want) {
			t.Errorf("the digest lacks %q:\n%s", want, d)
		}
	}
	if strings.Index(d, "- chrome.exe") > strings.Index(d, "- EXCEL.EXE") {
		t.Error("most time first")
	}
	// older than the window: not in it
	if d2 := s.Digest(1); strings.Contains(d2, "plan.md") || strings.Contains(d2, "translate") {
		t.Errorf("one hour back is only 11:00 on:\n%s", d2)
	}
	if empty, _ := newActivity(t); !strings.Contains(empty.Digest(1), "nothing was recorded") {
		t.Error("an empty log says so")
	}
	// hours are kept to 1..168
	if !strings.HasPrefix(s.Digest(0), "Activity of the last 1 hour(s)") || !strings.HasPrefix(s.Digest(9999), "Activity of the last 168 hour(s)") {
		t.Error("hours clamp")
	}
}
