package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"syki-sok/pkg/llm"
	"syki-sok/pkg/sysaudio"
)

// No sound device is touched: the sources are fakes that push a constant, and transcription is stubbed.

type fakeMeetingSource struct {
	name   string
	expect bool
	level  int16
	fail   error
	mu     sync.Mutex
	push   func([]int16)
	stop   chan struct{}
}

func (f *fakeMeetingSource) Name() string      { return f.name }
func (f *fakeMeetingSource) ExpectAudio() bool { return f.expect }
func (f *fakeMeetingSource) Start(push func([]int16)) error {
	if f.fail != nil {
		return f.fail
	}
	f.stop = make(chan struct{})
	go func() {
		t := time.NewTicker(20 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-f.stop:
				return
			case <-t.C:
				b := make([]int16, sysaudio.SampleRate/50) // 20 ms
				for i := range b {
					b[i] = f.level
				}
				push(b)
			}
		}
	}()
	return nil
}
func (f *fakeMeetingSource) Stop() {
	if f.stop != nil {
		close(f.stop)
		f.stop = nil
	}
}

func withFakeMeeting(t *testing.T, mic, system *fakeMeetingSource) {
	t.Helper()
	origSrc, origSup := meetingNewSources, meetingSupported
	meetingSupported = func() bool { return true }
	meetingNewSources = func(includeMic bool) []sysaudio.Source {
		var out []sysaudio.Source
		if includeMic {
			out = append(out, mic)
		}
		return append(out, system)
	}
	t.Cleanup(func() {
		meetingNewSources, meetingSupported = origSrc, origSup
		if s := takeMeeting(""); s != nil {
			res, _ := s.rec.Stop()
			removeMeetingFiles(res.Files)
		}
		if root, err := voiceCacheDir(); err == nil {
			_ = os.RemoveAll(filepath.Join(root, meetingSubdir))
		}
	})
}

func TestStartMeetingRecordingReportsWhichSourcesRun(t *testing.T) {
	withFakeMeeting(t, &fakeMeetingSource{name: "microphone", expect: true, fail: errors.New("no microphone")}, &fakeMeetingSource{name: "PC audio", level: 500})
	app := &App{}
	res, err := app.StartMeetingRecording("voice_a1", true)
	if err != nil {
		t.Fatalf("one working source is enough: %v", err)
	}
	var got map[string]bool
	if err := json.Unmarshal([]byte(res), &got); err != nil {
		t.Fatal(err)
	}
	if got["microphone"] || !got["system"] {
		t.Fatalf("expected only the PC audio to be recording, got %v", got)
	}
	if _, err := app.StartMeetingRecording("voice_a2", true); err == nil {
		t.Fatal("a second recording at the same time must be refused")
	}
	app.AbortMeetingRecording("voice_a1")
	if _, err := app.StartMeetingRecording("voice_a3", false); err != nil {
		t.Fatalf("after an abort a new recording can start: %v", err)
	}
	app.AbortMeetingRecording("voice_a3")
}

func TestStartMeetingRecordingUnsupportedAndNoSource(t *testing.T) {
	orig := meetingSupported
	meetingSupported = func() bool { return false }
	t.Cleanup(func() { meetingSupported = orig })
	if _, err := (&App{}).StartMeetingRecording("x", true); err == nil {
		t.Fatal("unsupported systems must say so")
	}
	if (&App{}).MeetingRecordingSupported() {
		t.Fatal("MeetingRecordingSupported must follow the platform")
	}

	withFakeMeeting(t, &fakeMeetingSource{name: "microphone", fail: errors.New("x")}, &fakeMeetingSource{name: "PC audio", fail: errors.New("no output")})
	if _, err := (&App{}).StartMeetingRecording("y", true); err == nil {
		t.Fatal("with no source at all the recording must not start")
	}
}

func TestStopMeetingRecordingTranscribesSegmentsInOrderAndDeletesTheFiles(t *testing.T) {
	withFakeMeeting(t, &fakeMeetingSource{name: "microphone", expect: true, level: 300}, &fakeMeetingSource{name: "PC audio", level: 200})
	var mu sync.Mutex
	var sent []int
	var mimes []string
	withStubbedQueryAudio(t, func(prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
		raw, err := base64.StdEncoding.DecodeString(audioBase64)
		if err != nil {
			return "", err
		}
		mu.Lock()
		defer mu.Unlock()
		sent = append(sent, len(raw))
		mimes = append(mimes, mimeType)
		if string(raw[:4]) != "RIFF" {
			t.Errorf("a WAV file must be sent, got %q", raw[:4])
		}
		return "piece " + string(rune('0'+len(sent))), nil
	})
	mock := &voiceMockWebView{}
	app := &App{w: mock}
	if _, err := app.StartMeetingRecording("voice_b1", true); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1600 * time.Millisecond) // a recording of about 1.2 s once the hold-back is out
	app.StopMeetingRecordingAsync("voice_b1", `{"prompt":"go"}`)
	eval := mock.waitFor(t, "__onVoiceResult", 10*time.Second)
	if !strings.Contains(eval, "voice_b1") || !strings.Contains(eval, "piece 1") {
		t.Fatalf("unexpected result: %s", eval)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(sent) != 1 || mimes[0] != "audio/wav" {
		t.Fatalf("sent %v with mime %v", sent, mimes)
	}
	root, _ := voiceCacheDir()
	if entries, err := os.ReadDir(root + string(os.PathSeparator) + meetingSubdir); err == nil && len(entries) != 0 {
		t.Fatalf("the recording must be deleted after a successful transcription, left: %v", entries)
	}
	// nothing is running any more
	if _, err := app.StartMeetingRecording("voice_b2", false); err != nil {
		t.Fatalf("a new recording can start after a stop: %v", err)
	}
	app.AbortMeetingRecording("")
}

func TestStopMeetingRecordingKeepsTheFilesWhenTranscriptionFails(t *testing.T) {
	withFakeMeeting(t, &fakeMeetingSource{name: "microphone", expect: true, level: 300}, &fakeMeetingSource{name: "PC audio", level: 200})
	withStubbedQueryAudio(t, func(prompt, audioBase64, mimeType string, cfg llm.VoiceConfig) (string, error) {
		return "", errors.New("quota exceeded")
	})
	mock := &voiceMockWebView{}
	app := &App{w: mock}
	if _, err := app.StartMeetingRecording("voice_c1", true); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1600 * time.Millisecond)
	app.StopMeetingRecordingAsync("voice_c1", "{}")
	eval := mock.waitFor(t, "__onVoiceResult", 10*time.Second)
	if !strings.Contains(eval, "quota exceeded") || !strings.Contains(eval, "残っています") {
		t.Fatalf("the error must say why and where the recording is: %s", eval)
	}
	root, _ := voiceCacheDir()
	entries, err := os.ReadDir(root + string(os.PathSeparator) + meetingSubdir)
	if err != nil || len(entries) == 0 {
		t.Fatalf("the recording must be kept on a failure: %v %v", entries, err)
	}
	for _, e := range entries {
		os.Remove(root + string(os.PathSeparator) + meetingSubdir + string(os.PathSeparator) + e.Name())
	}
}

func TestStopMeetingRecordingWithoutARecordingAnswersWithAnError(t *testing.T) {
	mock := &voiceMockWebView{}
	app := &App{w: mock}
	app.StopMeetingRecordingAsync("voice_none", "{}")
	eval := mock.waitFor(t, "__onVoiceResult", 5*time.Second)
	if !strings.Contains(eval, "動いていません") {
		t.Fatalf("unexpected: %s", eval)
	}
}

func TestCheckMeetingAudioReportsBothSources(t *testing.T) {
	withFakeMeeting(t, &fakeMeetingSource{name: "microphone", expect: true, level: 1000}, &fakeMeetingSource{name: "PC audio", fail: errors.New("no output device")})
	var got struct {
		Supported  bool
		Microphone struct {
			OK    bool
			Error string
			Level float64
		}
		System struct {
			OK    bool
			Error string
		}
	}
	if err := json.Unmarshal([]byte(checkMeetingAudio()), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Supported || !got.Microphone.OK || got.Microphone.Level <= 0 {
		t.Fatalf("the microphone should report ok with a level: %+v", got)
	}
	if got.System.OK || !strings.Contains(got.System.Error, "no output device") {
		t.Fatalf("the PC audio failure should be reported: %+v", got.System)
	}
}

func TestCheckMeetingAudioAsyncAnswersThePage(t *testing.T) {
	withFakeMeeting(t, &fakeMeetingSource{name: "microphone", expect: true, level: 1000}, &fakeMeetingSource{name: "PC audio", level: 1})
	mock := &voiceMockWebView{}
	(&App{w: mock}).CheckMeetingAudioAsync("chk_1")
	eval := mock.waitFor(t, "__onMeetingAudioCheck", 5*time.Second)
	if !strings.Contains(eval, "chk_1") || !strings.Contains(eval, "microphone") {
		t.Fatalf("unexpected: %s", eval)
	}
}

func TestTrimMemorySkipsWhileMeetingRecordingActive(t *testing.T) {
	withFakeMeeting(t, &fakeMeetingSource{name: "microphone", expect: true, level: 100}, &fakeMeetingSource{name: "PC audio", expect: false})
	app := &App{}
	if isMeetingRecordingActive() {
		t.Fatalf("expected no active meeting before StartMeetingRecording")
	}
	if _, err := app.StartMeetingRecording("req_trim_guard", true); err != nil {
		t.Fatalf("StartMeetingRecording: %v", err)
	}
	defer app.AbortMeetingRecording("req_trim_guard")
	if !isMeetingRecordingActive() {
		t.Fatalf("expected isMeetingRecordingActive() == true during recording")
	}
	if err := app.TrimMemory(); err != nil {
		t.Fatalf("TrimMemory: %v", err)
	}
}

func makeMeetingTestSegments(t *testing.T, prefix string, nSegs int) (string, []string) {
	t.Helper()
	root, err := voiceCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, meetingSubdir)
	w, err := sysaudio.NewSegmentWriter(dir, prefix, 1) // 1 second per segment
	if err != nil {
		t.Fatal(err)
	}
	samples := make([]int16, sysaudio.SampleRate*nSegs)
	for i := range samples {
		samples[i] = int16((i % 2000) + 100)
	}
	if err := w.Write(samples); err != nil {
		t.Fatal(err)
	}
	files, err := w.Close()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != nSegs {
		t.Fatalf("expected %d segments, got %d (%v)", nSegs, len(files), files)
	}
	t.Cleanup(func() {
		removeMeetingFiles(files)
	})
	return dir, files
}

func parseVoiceResultArgs(t *testing.T, evalJS string) []string {
	t.Helper()
	const prefix = "if (window.__onVoiceResult) { window.__onVoiceResult("
	const suffix = "); }"
	i := strings.Index(evalJS, prefix)
	if i == -1 {
		t.Fatalf("eval does not call __onVoiceResult: %s", evalJS)
	}
	rest := evalJS[i+len(prefix):]
	j := strings.LastIndex(rest, suffix)
	if j == -1 {
		t.Fatalf("eval missing suffix: %s", evalJS)
	}
	var args []string
	if err := json.Unmarshal([]byte("["+rest[:j]+"]"), &args); err != nil {
		t.Fatalf("parse __onVoiceResult args failed: %v (%s)", err, evalJS)
	}
	return args
}

func TestDispatchMeetingTranscription_PartialSuccessAndRetryRemaining(t *testing.T) {
	_, files := makeMeetingTestSegments(t, "2026-11-19-195000_part1", 3)

	orig := inputsTranscribeFile
	t.Cleanup(func() { inputsTranscribeFile = orig })

	failSecond := true
	var calls []string
	inputsTranscribeFile = func(ctx context.Context, path, mime string, cfg llm.VoiceConfig) (string, error) {
		calls = append(calls, filepath.Base(path))
		if failSecond && strings.HasSuffix(path, "_002.wav") {
			return "", errors.New("timeout on seg 2")
		}
		return "text-" + filepath.Base(path), nil
	}

	mock1 := &voiceMockWebView{}
	app1 := &App{w: mock1}
	app1.dispatchMeetingTranscription("voice_part1", files, voiceRequestConfig{})

	eval1 := mock1.waitFor(t, "__onVoiceResult", 5*time.Second)
	args1 := parseVoiceResultArgs(t, eval1)
	if len(args1) < 4 {
		t.Fatalf("expected at least 4 args, got %v", args1)
	}
	if args1[0] != "voice_part1" {
		t.Errorf("reqID = %q, want voice_part1", args1[0])
	}
	if args1[1] != "text-"+filepath.Base(files[0]) {
		t.Errorf("partial text = %q, want segment 1 text", args1[1])
	}
	if !strings.Contains(args1[2], "timeout on seg 2") || !strings.Contains(args1[2], "残っています") {
		t.Errorf("err = %q, want timeout error and remaining path", args1[2])
	}
	if args1[3] != files[1] {
		t.Errorf("cachePath = %q, want %q (segment 2)", args1[3], files[1])
	}
	if _, err := os.Stat(files[0]); !os.IsNotExist(err) {
		t.Errorf("completed segment 1 %q must be removed", files[0])
	}
	for _, rem := range files[1:] {
		if _, err := os.Stat(rem); err != nil {
			t.Errorf("remaining segment %q must stay on disk: %v", rem, err)
		}
	}

	// Retry from segment 2 must process segments 2 and 3 in order and clean them all up.
	failSecond = false
	calls = nil
	mock2 := &voiceMockWebView{}
	app2 := &App{w: mock2}
	app2.RetryVoiceCacheAsync("voice_part1", args1[3], "{}")

	eval2 := mock2.waitFor(t, "__onVoiceResult", 5*time.Second)
	args2 := parseVoiceResultArgs(t, eval2)
	wantText := "text-" + filepath.Base(files[1]) + "\n\ntext-" + filepath.Base(files[2])
	if args2[1] != wantText || args2[2] != "" {
		t.Fatalf("retry got text=%q err=%q, want text=%q err=\"\"", args2[1], args2[2], wantText)
	}
	if len(calls) != 2 || calls[0] != filepath.Base(files[1]) || calls[1] != filepath.Base(files[2]) {
		t.Errorf("retry calls = %v, want segments 2 and 3", calls)
	}
	for _, f := range files {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Errorf("segment %q must be removed after retry succeeds", f)
		}
	}
}

func TestDispatchMeetingTranscription_EmptyTranscriptKeepsFiles(t *testing.T) {
	_, files := makeMeetingTestSegments(t, "2026-11-19-195100_empty", 2)

	orig := inputsTranscribeFile
	t.Cleanup(func() { inputsTranscribeFile = orig })
	inputsTranscribeFile = func(ctx context.Context, path, mime string, cfg llm.VoiceConfig) (string, error) {
		return "   ", nil
	}

	mock := &voiceMockWebView{}
	app := &App{w: mock}
	app.dispatchMeetingTranscription("voice_empty", files, voiceRequestConfig{})

	eval := mock.waitFor(t, "__onVoiceResult", 5*time.Second)
	args := parseVoiceResultArgs(t, eval)
	if !strings.Contains(args[2], "話し声が検出されませんでした") {
		t.Errorf("expected no-speech error, got %q", args[2])
	}
	if args[3] != files[0] {
		t.Errorf("cachePath = %q, want %q", args[3], files[0])
	}
	for _, f := range files {
		if _, err := os.Stat(f); err != nil {
			t.Errorf("empty transcript must keep segment %q: %v", f, err)
		}
	}
}

func TestDiscardVoiceCache_RemovesAllMeetingSegments(t *testing.T) {
	_, files := makeMeetingTestSegments(t, "2026-11-19-195200_disc", 3)

	app := &App{}
	if err := app.DiscardVoiceCache(files[0]); err != nil {
		t.Fatalf("DiscardVoiceCache failed: %v", err)
	}
	for _, f := range files {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Errorf("expected segment %q to be deleted", f)
		}
	}
}

func TestKeepVoiceCache_JoinsAllMeetingSegmentsIntoSingleWAV(t *testing.T) {
	_, files := makeMeetingTestSegments(t, "2026-11-19-195300_keep", 3)

	var partBytes [][]byte
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		partBytes = append(partBytes, b)
	}
	wantJoined, ok := sysaudio.JoinWAVBytes(partBytes)
	if !ok {
		t.Fatal("JoinWAVBytes failed on test segments")
	}

	baseDir := t.TempDir()
	app := &App{}
	res, err := app.KeepVoiceCache(files[0], baseDir)
	if err != nil {
		t.Fatalf("KeepVoiceCache failed: %v", err)
	}
	if !strings.HasSuffix(res.AbsPath, ".wav") {
		t.Errorf("expected .wav extension, got %q", res.AbsPath)
	}
	gotBytes, err := os.ReadFile(res.AbsPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(gotBytes, wantJoined) {
		t.Errorf("saved WAV (%d bytes) does not match joined segments (%d bytes)", len(gotBytes), len(wantJoined))
	}
	for _, f := range files {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Errorf("expected source segment %q to be deleted after keep", f)
		}
	}
}
