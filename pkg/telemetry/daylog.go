package telemetry

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

var dayFile = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})\.jsonl$`)

// dayLog is a folder of daily JSON Lines files (YYYY-MM-DD.jsonl, local date): append only, one file per day, a size cap per day, a cap on
// lines per minute, and files older than RetainDays deleted. The rhythm log (Store) and the activity log (ActivityStore) both use it; what
// a line may hold is each one's own business.
type dayLog struct {
	maxDayBytes  int64
	maxPerMinute int

	mu        sync.Mutex
	recent    []time.Time
	recentPos int
	purgedDay string
}

func newDayLog(maxDayBytes int64, maxPerMinute int) *dayLog {
	return &dayLog{maxDayBytes: maxDayBytes, maxPerMinute: maxPerMinute, recent: make([]time.Time, maxPerMinute)}
}

func (l *dayLog) append(dir string, now time.Time, line []byte) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	// at most maxPerMinute lines in any minute: the oldest of the last maxPerMinute must be a minute old
	if old := l.recent[l.recentPos]; !old.IsZero() && now.Sub(old) < time.Minute {
		return errors.New("telemetry: too many lines")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	day := now.Format("2006-01-02")
	if l.purgedDay != day {
		l.purgedDay = day
		_, _ = purgeDir(dir, now)
	}
	path := filepath.Join(dir, day+".jsonl")
	if fi, err := os.Stat(path); err == nil && fi.Size()+int64(len(line)) > l.maxDayBytes {
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
	l.recent[l.recentPos] = now
	l.recentPos = (l.recentPos + 1) % l.maxPerMinute
	return nil
}

func purgeDir(dir string, now time.Time) (int, error) {
	entries, err := os.ReadDir(dir)
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
		if os.Remove(filepath.Join(dir, e.Name())) == nil {
			removed++
		}
	}
	return removed, nil
}

func (l *dayLog) purge(dir string, now time.Time) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return purgeDir(dir, now)
}

func dirInfo(dir string) (files int, bytes int64) {
	entries, err := os.ReadDir(dir)
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

func (l *dayLog) clear(dir string) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	entries, err := os.ReadDir(dir)
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
		if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		removed++
	}
	return removed, firstErr
}
