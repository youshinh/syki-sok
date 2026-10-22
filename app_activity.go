package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"syki-sok/pkg/appdir"
	"syki-sok/pkg/telemetry"
)

// The activity log (pkg/telemetry/activity.go), the second tier of the operation-rhythm log: which app was in front (and its window title),
// which note was written in and by how much, the requests typed in the AI bars and what became of them. Two switches in Settings > General,
// both off until turned on: general.activityApps (the front app) and general.activityEdits (notes and requests). It is for a local model to
// read: GetActivityDigest gives the last hours as a short text, and hands it out for a cloud model only when that request was approved.
//
// How the front app is found matters to security software, so it is the plainest thing there is: every 2 seconds, GetForegroundWindow, the
// window's title and the program's name (activity_windows.go). No hook of any kind, no key or mouse state, no screen, no clipboard, no
// other process touched beyond asking its name (app_activity_test.go keeps the list of calls this code may never make).

var (
	activityStoreOnce sync.Once
	activityStoreVal  *telemetry.ActivityStore

	activityWatchMu   sync.Mutex
	activityWatchStop chan struct{}
)

func activityDir() string { return filepath.Join(appdir.AppConfigDir(), "activity") }

func getActivityStore() *telemetry.ActivityStore {
	activityStoreOnce.Do(func() { activityStoreVal = telemetry.NewActivityStore(activityDir()) })
	return activityStoreVal
}

type activitySettings struct {
	Apps    bool
	Edits   bool
	Exclude []string
}

// activitySettingsNow is general.activityApps, general.activityEdits and general.activityExclude of config.json. Anything that is not
// the value true is off.
func (a *App) activitySettingsNow() activitySettings {
	return a.readGeneralConfigCached().activity
}

// Programs whose window is never recorded (only that "an excluded app" was in front): password managers. The person can add more with
// general.activityExclude (words matched against the program's name).
var activityDefaultExclude = []string{"keepass", "1password", "bitwarden", "lastpass", "dashlane", "enpass", "nordpass", "keeper", "proton pass", "roboform"}

func activityExcluded(app string, extra []string) bool {
	name := strings.TrimSuffix(strings.ToLower(app), ".exe")
	for _, w := range append(append([]string{}, activityDefaultExclude...), extra...) {
		w = strings.ToLower(strings.TrimSpace(w))
		if w != "" && strings.Contains(name, w) {
			return true
		}
	}
	return false
}

// A private browsing window's title is not recorded.
func activityPrivateTitle(title string) bool {
	l := strings.ToLower(title)
	for _, w := range []string{"inprivate", "private browsing", "incognito", "private window", "シークレット", "プライベート ブラウズ", "プライベートブラウズ"} {
		if strings.Contains(l, w) {
			return true
		}
	}
	return false
}

// RecordActivity is bound as backend_recordActivity: an edit, ask or answer line from the page (see telemetry.ActivityStore.Line). Refused
// while general.activityEdits is off.
func (a *App) RecordActivity(lineJSON string) error {
	if !a.activitySettingsNow().Edits {
		return errors.New("the activity log of notes and requests is off")
	}
	return getActivityStore().Append(lineJSON)
}

// GetActivityInfo is bound as backend_getActivityInfo (Settings).
func (a *App) GetActivityInfo() map[string]interface{} {
	s := getActivityStore()
	_, _ = s.Purge()
	files, bytes := s.Info()
	return map[string]interface{}{"dir": s.Dir, "files": files, "bytes": bytes, "retainDays": telemetry.RetainDays, "appsSupported": foregroundSupported()}
}

// ClearActivity is bound as backend_clearActivity.
func (a *App) ClearActivity() (int, error) { return getActivityStore().Clear() }

// OpenActivityFolder is bound as backend_openActivityFolder.
func (a *App) OpenActivityFolder() error {
	dir := getActivityStore().Dir
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return a.RevealPath(dir, "")
}

// GetActivityDigest is bound as backend_getActivityDigest: the activity of the last hours as text for a model. destination says where the
// model is: "local" gets it; "cloud" gets it only with approved = true (the caller has shown the person what is sent and they agreed);
// anything else is refused.
func (a *App) GetActivityDigest(hours int, destination string, approved bool) (string, error) {
	switch destination {
	case "local":
	case "cloud":
		if !approved {
			return "", errors.New("the activity log is only given to a cloud model when the person approved this request")
		}
	default:
		return "", errors.New("the destination must be \"local\" or \"cloud\"")
	}
	return getActivityStore().Digest(hours), nil
}

// RefreshActivity is bound as backend_refreshActivity: the page calls it after the settings were saved and at start-up; it starts or stops
// the 2-second look at the front app to match general.activityApps.
func (a *App) RefreshActivity() bool {
	activityWatchMu.Lock()
	defer activityWatchMu.Unlock()
	want := a.activitySettingsNow().Apps && (foregroundSupported() || testForegroundSampler)
	if want && activityWatchStop == nil {
		stop := make(chan struct{})
		activityWatchStop = stop
		go a.watchForeground(stop)
	} else if !want && activityWatchStop != nil {
		close(activityWatchStop)
		activityWatchStop = nil
	}
	return want
}

// (variables so that a test can look at a front app of its own, quickly)
var (
	testForegroundSampler bool // a test sets it (foregroundSupported is false off Windows)
	activityPollInterval  = 2 * time.Second
	foregroundSampler     = foregroundSample
)

func (a *App) watchForeground(stop <-chan struct{}) {
	t := time.NewTicker(activityPollInterval)
	defer t.Stop()
	last := ""
	for {
		select {
		case <-stop:
			return
		case <-t.C:
		}
		set := a.activitySettingsNow()
		if !set.Apps { // switched off in config.json behind the page's back
			continue
		}
		app, title, self, ok := foregroundSampler()
		if !ok {
			continue
		}
		app, title, key := activityRecordable(app, title, self, set.Exclude)
		if key == last {
			continue
		}
		last = key
		_ = getActivityStore().AppendApp(app, title, self)
	}
}

// activityRecordable is what may be written for a front window: syki's own window has no title, an excluded program is only "an excluded
// app", and a private browsing window has no title. key is what changes when the line would.
func activityRecordable(app, title string, self bool, exclude []string) (string, string, string) {
	if app == "" && !self {
		app = "(unknown)"
	}
	switch {
	case self:
		return app, "", "\x00self"
	case activityExcluded(app, exclude):
		app, title = "(excluded app)", ""
	case activityPrivateTitle(title):
		title = ""
	}
	return app, title, app + "\x00" + title
}
