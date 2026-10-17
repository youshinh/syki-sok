package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"syki-sok/pkg/appdir"
)

func isolatedActivity(t *testing.T, configJSON string) (*App, string) {
	t.Helper()
	dir := t.TempDir()
	appdir.SetConfigDirOverride(dir)
	activityStoreOnce = sync.Once{}
	activityStoreVal = nil
	t.Cleanup(func() {
		activityWatchMu.Lock()
		if activityWatchStop != nil {
			close(activityWatchStop)
			activityWatchStop = nil
		}
		activityWatchMu.Unlock()
		appdir.SetConfigDirOverride("")
		activityStoreOnce = sync.Once{}
		activityStoreVal = nil
		testForegroundSampler = false
		activityPollInterval = 2 * time.Second
		foregroundSampler = foregroundSample
	})
	if configJSON != "" {
		if err := os.WriteFile(getConfigFilePath(), []byte(configJSON), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return &App{}, dir
}

func editJSON() string {
	return `{"v":1,"ts":` + strconv.FormatInt(time.Now().UnixMilli(), 10) + `,"kind":"edit","note":"a.md","dur_ms":30000,"net_chars":10,"ins":3,"del":1,"paste":0,"undo":0}`
}

func TestActivityIsOffUntilTheSettingsSayTrue(t *testing.T) {
	for name, cfg := range map[string]string{
		"no config":      "",
		"no keys":        `{"general":{}}`,
		"false":          `{"general":{"activityApps":false,"activityEdits":false}}`,
		"strings":        `{"general":{"activityApps":"true","activityEdits":"true"}}`,
		"the rhythm log": `{"general":{"telemetry":true}}`, // the first tier does not switch the second on
		"broken":         `{"general":`,
	} {
		a, dir := isolatedActivity(t, cfg)
		if set := a.activitySettingsNow(); set.Apps || set.Edits {
			t.Errorf("%s: both are off: %+v", name, set)
		}
		if err := a.RecordActivity(editJSON()); err == nil {
			t.Errorf("%s: a line must be refused while it is off", name)
		}
		if _, err := os.Stat(filepath.Join(dir, "syki-sok", "activity")); !os.IsNotExist(err) {
			t.Errorf("%s: nothing may be created while it is off", name)
		}
		if a.RefreshActivity() {
			t.Errorf("%s: the front app is not watched while it is off", name)
		}
	}
}

func TestActivityEditsAreRecordedWhenOnAndTheSwitchesAreSeparate(t *testing.T) {
	a, dir := isolatedActivity(t, `{"general":{"activityEdits":true}}`)
	if err := a.RecordActivity(editJSON()); err != nil {
		t.Fatal(err)
	}
	folder := filepath.Join(dir, "syki-sok", "activity")
	entries, err := os.ReadDir(folder)
	if err != nil || len(entries) != 1 {
		t.Fatalf("one daily file: %v %v", entries, err)
	}
	if a.RefreshActivity() {
		t.Fatal("edits on does not switch the front app on")
	}
	if err := a.RecordActivity(`{"v":1,"ts":` + strconv.FormatInt(time.Now().UnixMilli(), 10) + `,"kind":"app","app":"chrome.exe","title":"x","self":0}`); err == nil {
		t.Fatal("the page cannot write an app line")
	}
	info := a.GetActivityInfo()
	if info["files"].(int) != 1 || info["dir"].(string) != folder {
		t.Fatalf("info: %v", info)
	}
	if n, err := a.ClearActivity(); err != nil || n != 1 {
		t.Fatalf("clear: %d %v", n, err)
	}
}

func TestActivityFolderIsNotTheScrapsFolder(t *testing.T) {
	scraps := t.TempDir()
	a, _ := isolatedActivity(t, `{"general":{"activityEdits":true},"scrap_dir":"`+filepath.ToSlash(scraps)+`"}`)
	if err := a.RecordActivity(editJSON()); err != nil {
		t.Fatal(err)
	}
	if rel, err := filepath.Rel(scraps, activityDir()); err == nil && !strings.HasPrefix(rel, "..") {
		t.Fatal("the activity log is inside the scraps folder (synced with git)")
	}
	if left, _ := filepath.Glob(filepath.Join(scraps, "*")); len(left) != 0 {
		t.Fatalf("nothing is written to the scraps folder: %v", left)
	}
}

func TestActivityWhatIsRecordedOfAFrontWindow(t *testing.T) {
	app, title, key := activityRecordable("chrome.exe", "Spec - Docs", false, nil)
	if app != "chrome.exe" || title != "Spec - Docs" || key == "" {
		t.Fatalf("an ordinary window: %q %q", app, title)
	}
	if _, title, _ := activityRecordable("", "my note", true, nil); title != "" {
		t.Fatal("syki's own window has no title")
	}
	if app, title, _ := activityRecordable("KeePassXC.exe", "Vault - passwords", false, nil); app != "(excluded app)" || title != "" {
		t.Fatalf("a password manager is not recorded: %q %q", app, title)
	}
	for _, name := range []string{"1Password.exe", "Bitwarden.exe", "LastPass.exe", "keepass.exe"} {
		if !activityExcluded(name, nil) {
			t.Errorf("%s is excluded by default", name)
		}
	}
	if activityExcluded("chrome.exe", nil) || activityExcluded("EXCEL.EXE", nil) {
		t.Error("ordinary programs are not")
	}
	if app, title, _ := activityRecordable("bank.exe", "Account", false, []string{"BANK"}); app != "(excluded app)" || title != "" {
		t.Fatalf("the person's own words (general.activityExclude): %q %q", app, title)
	}
	for _, private := range []string{"Docs - InPrivate", "News - Mozilla Firefox Private Browsing", "x - Google Chrome (Incognito)", "シークレット ウィンドウ"} {
		if _, title, _ := activityRecordable("msedge.exe", private, false, nil); title != "" {
			t.Errorf("a private window's title is not recorded: %q", private)
		}
	}
	if app, _, _ := activityRecordable("", "title only", false, nil); app != "(unknown)" {
		t.Error("a program whose name could not be asked is (unknown)")
	}
}

// The watcher, with a front window of the test's own: a line when the front window changes, none when it does not, nothing when the
// switch is off, and it stops when asked.
func TestActivityWatcherWritesChangesOnly(t *testing.T) {
	a, _ := isolatedActivity(t, `{"general":{"activityApps":true,"activityExclude":["secretapp"]}}`)
	var mu sync.Mutex
	cur := [3]string{"chrome.exe", "Docs", ""}
	foregroundSampler = func() (string, string, bool, bool) {
		mu.Lock()
		defer mu.Unlock()
		return cur[0], cur[1], cur[2] == "self", true
	}
	set := func(app, title, self string) { mu.Lock(); cur = [3]string{app, title, self}; mu.Unlock() }
	testForegroundSampler = true
	activityPollInterval = 15 * time.Millisecond
	if !a.RefreshActivity() {
		t.Fatal("the front app is watched when the switch is on")
	}
	wait := func() { time.Sleep(120 * time.Millisecond) }
	wait()
	wait() // the same window for a while: one line
	set("EXCEL.EXE", "budget.xlsx", "")
	wait()
	set("SecretApp.exe", "customer list", "")
	wait()
	set("", "", "self")
	wait()
	set("chrome.exe", "Docs - InPrivate", "")
	wait()
	a.RefreshActivity()
	data, err := os.ReadFile(filepath.Join(activityDir(), time.Now().Format("2006-01-02")+".jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 5 {
		t.Fatalf("five changes, five lines: %d\n%s", len(lines), data)
	}
	for i, want := range []string{`"app":"chrome.exe","title":"Docs"`, `"app":"EXCEL.EXE","title":"budget.xlsx"`, `"app":"(excluded app)","title":""`, `"self":1`, `"app":"chrome.exe","title":""`} {
		if !strings.Contains(lines[i], want) {
			t.Errorf("line %d lacks %s: %s", i, want, lines[i])
		}
	}
	if strings.Contains(string(data), "customer list") || strings.Contains(string(data), "InPrivate") {
		t.Fatal("an excluded app's title and a private window's title are not in the file")
	}
	// switched off in the config behind the page's back: no more lines, even before the watcher is told
	if err := os.WriteFile(getConfigFilePath(), []byte(`{"general":{"activityApps":false}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	a.invalidateConfigCache()
	set("notepad.exe", "new", "")
	wait()
	after, _ := os.ReadFile(filepath.Join(activityDir(), time.Now().Format("2006-01-02")+".jsonl"))
	if strings.Contains(string(after), "notepad.exe") {
		t.Fatal("off means off")
	}
	a.RefreshActivity()
	activityWatchMu.Lock()
	stopped := activityWatchStop == nil
	activityWatchMu.Unlock()
	if !stopped {
		t.Fatal("the watcher stops when the switch is off")
	}
}

// The digest goes to a local model; to a cloud model only for a request the person approved.
func TestActivityDigestGate(t *testing.T) {
	a, _ := isolatedActivity(t, `{"general":{"activityEdits":true}}`)
	if err := a.RecordActivity(editJSON()); err != nil {
		t.Fatal(err)
	}
	if d, err := a.GetActivityDigest(1, "local", false); err != nil || !strings.Contains(d, "a.md") {
		t.Fatalf("local: %v %q", err, d)
	}
	if _, err := a.GetActivityDigest(1, "cloud", false); err == nil {
		t.Fatal("cloud without approval must be refused")
	}
	if d, err := a.GetActivityDigest(1, "cloud", true); err != nil || d == "" {
		t.Fatalf("cloud with approval: %v", err)
	}
	for _, bad := range []string{"", "LOCAL", "remote", "cloud "} {
		if _, err := a.GetActivityDigest(1, bad, true); err == nil {
			t.Errorf("destination %q must be refused (even approved)", bad)
		}
	}
}

// What the rhythm and activity logs may never call. Security software looks at exactly these: hooks, the state of keys, raw input, the
// clipboard, the screen, the memory of other processes. The logs get what they need from the page's own events and from
// GetForegroundWindow, nothing else; this list is the promise, kept as a test.
func TestActivityCodeMakesNoSuspiciousCalls(t *testing.T) {
	forbidden := []string{
		"SetWindowsHookEx", "SetWinEventHook", "UnhookWindowsHook", "CallNextHookEx",
		"GetAsyncKeyState", "GetKeyState", "GetKeyboardState", "MapVirtualKey", "GetKeyNameText", "ToUnicodeEx",
		"RegisterRawInputDevices", "GetRawInputData", "keybd_event", "SendInput", "mouse_event",
		"GetClipboardData", "AddClipboardFormatListener", "OpenClipboard", "SetClipboardViewer",
		"BitBlt", "PrintWindow", "GetDC", "GetWindowDC", "CreateCompatibleDC", "CaptureScreen", "DwmGetWindowAttribute",
		"WriteProcessMemory", "ReadProcessMemory", "VirtualAllocEx", "CreateRemoteThread", "QueueUserAPC", "NtQueueApcThread",
		"AttachThreadInput", "SetThreadDesktop", "OpenInputDesktop", "AdjustTokenPrivileges", "SeDebugPrivilege",
		"PROCESS_VM_READ", "PROCESS_ALL_ACCESS", "PROCESS_VM_WRITE", "PROCESS_CREATE_THREAD",
	}
	files := []string{"app_activity.go", "activity_windows.go", "activity_other.go", "app_telemetry.go",
		"pkg/telemetry/telemetry.go", "pkg/telemetry/activity.go", "pkg/telemetry/daylog.go",
		"frontend/js/telemetry.js", "frontend/js/activity_log.js"}
	comment := regexp.MustCompile(`(?m)^\s*//.*$`)
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		code := comment.ReplaceAllString(string(data), "")
		for _, name := range forbidden {
			if strings.Contains(code, name) {
				t.Errorf("%s uses %s: the activity code must not make this call", f, name)
			}
		}
	}
	// the one process right it asks for is the least there is
	data, _ := os.ReadFile("activity_windows.go")
	if !strings.Contains(string(data), "windows.PROCESS_QUERY_LIMITED_INFORMATION") || strings.Count(string(data), "OpenProcess(") != 1 {
		t.Error("the program's name is asked with PROCESS_QUERY_LIMITED_INFORMATION and nothing more")
	}
}
