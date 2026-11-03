package speech

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"syki-sok/pkg/boundedbuf"
	"syki-sok/pkg/procutil"
)

type whisperJob struct {
	model, wav, lang, outPrefix, prompt string
	threads                             int
}

func (j whisperJob) args() []string {
	a := []string{"-m", j.model, "-f", j.wav, "-l", j.lang, "-t", strconv.Itoa(j.threads), "-otxt", "-of", j.outPrefix, "-np"}
	if j.prompt != "" {
		a = append(a, "--prompt", j.prompt)
	}
	return a
}

type speechJob struct {
	model      string
	wav        string
	threads    int
	device     string // "cpu", "gpu", "auto" (default: "cpu")
	vad        string // path to silero-vad
	diarize    string // path to nemotron-3-diarization
	enhance    string // path to re-use
	timestamps bool
}

func (j speechJob) args() []string {
	dev := strings.TrimSpace(j.device)
	if dev == "" {
		dev = "cpu"
	}
	a := []string{"asr", j.model}
	if j.vad != "" {
		a = append(a, "--vad", j.vad)
	}
	if j.diarize != "" {
		a = append(a, "--diarize", j.diarize)
	}
	if j.enhance != "" {
		a = append(a, "--enhance", j.enhance)
	}
	if j.timestamps {
		a = append(a, "--timestamps")
	}
	a = append(a, "--device", dev, "--format", "json")
	if j.threads > 0 {
		a = append(a, "--threads", strconv.Itoa(j.threads))
	}
	a = append(a, j.wav)
	return a
}

type speechSpeaker struct {
	Speaker int     `json:"speaker"`
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
}

type speechRegion struct {
	Start    float64         `json:"start"`
	End      float64         `json:"end"`
	Text     string          `json:"text"`
	Speakers []speechSpeaker `json:"speakers"`
}

type speechJSONOutput struct {
	File    string         `json:"file"`
	Text    string         `json:"text"`
	Stop    string         `json:"stop"`
	Regions []speechRegion `json:"regions"`
}

// No -hide_banner: builds from before 2015 (one turns up on PATH via Python packages) reject it.
func ffmpegArgs(in, out string) []string {
	return []string{"-loglevel", "error", "-y", "-i", in, "-vn", "-ar", strconv.Itoa(targetRate), "-ac", "1", "-c:a", "pcm_s16le", out}
}

// execWhisper runs whisper-cli in its own directory (its DLLs sit next to it) and returns once it
// has exited; a cancelled ctx kills it.
var execWhisper = func(ctx context.Context, exe string, args []string) error {
	return runProcess(ctx, exe, filepath.Dir(exe), args, "whisper-cli")
}

// execSpeech runs speech.exe and captures its JSON output from stdout.
var execSpeech = func(ctx context.Context, exe string, args []string) (string, error) {
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Dir = filepath.Dir(exe)
	procutil.HideWindow(cmd)
	cmd.WaitDelay = 3 * time.Second

	stdout := &bytes.Buffer{}
	stderr := boundedbuf.New(2048)
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	if err := cmd.Run(); err != nil {
		if cerr := ctx.Err(); cerr != nil {
			return "", cerr
		}
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return "", fmt.Errorf("speech が失敗しました: %v: %s", err, msg)
		}
		return "", fmt.Errorf("speech が失敗しました: %v", err)
	}

	raw := strings.TrimSpace(stdout.String())
	if raw == "" {
		return "", nil
	}
	var res speechJSONOutput
	if err := json.Unmarshal([]byte(raw), &res); err == nil {
		if len(res.Regions) > 0 {
			formatted := formatSpeechRegions(res.Regions)
			if formatted != "" {
				return formatted, nil
			}
		}
		if res.Text != "" {
			return res.Text, nil
		}
	}
	return raw, nil
}

func formatSpeechRegions(regions []speechRegion) string {
	if len(regions) == 0 {
		return ""
	}
	var lines []string
	lastSpeaker := -1
	var currentText strings.Builder
	var currentStart float64

	flush := func() {
		if currentText.Len() == 0 {
			return
		}
		mins := int(currentStart) / 60
		secs := int(currentStart) % 60
		timeStr := fmt.Sprintf("[%02d:%02d]", mins, secs)
		if lastSpeaker >= 0 {
			lines = append(lines, fmt.Sprintf("%s 話者 %d: %s", timeStr, lastSpeaker, strings.TrimSpace(currentText.String())))
		} else {
			lines = append(lines, fmt.Sprintf("%s %s", timeStr, strings.TrimSpace(currentText.String())))
		}
		currentText.Reset()
	}

	for _, r := range regions {
		speaker := -1
		if len(r.Speakers) > 0 {
			speaker = r.Speakers[0].Speaker
		}
		if speaker != lastSpeaker && lastSpeaker != -1 {
			flush()
		}
		if currentText.Len() == 0 {
			currentStart = r.Start
			lastSpeaker = speaker
		}
		currentText.WriteString(r.Text)
	}
	flush()
	return strings.Join(lines, "\n")
}

func runFFmpeg(ctx context.Context, exe, in, out string) error {
	return runProcess(ctx, exe, "", ffmpegArgs(in, out), "ffmpeg")
}

func runProcess(ctx context.Context, exe, dir string, args []string, name string) error {
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Dir = dir
	procutil.HideWindow(cmd)
	cmd.WaitDelay = 3 * time.Second
	stderr := boundedbuf.New(2048)
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		if cerr := ctx.Err(); cerr != nil {
			return cerr
		}
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return fmt.Errorf("%s が失敗しました: %v: %s", name, err, msg)
		}
		return fmt.Errorf("%s が失敗しました: %v", name, err)
	}
	return nil
}
