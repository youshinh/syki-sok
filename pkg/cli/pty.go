package cli

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"
	"time"

	"syki-sok/pkg/ipc"
)

func (c *ClientRunner) runPty(args []string) (int, error) {
	if len(args) == 0 {
		return 1, errors.New("pty subcommand required: list, start, write, read, close, resize, rename, sleep, history, presets, detect-gate, prepare-worktree, loop-list, loop-start, or loop-stop")
	}
	action := args[0]
	rest := args[1:]

	switch action {
	case "list":
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.list", nil, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.MarshalIndent(res, "", "  ")
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "start":
		fs := flag.NewFlagSet("pty start", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		preset := fs.String("preset", "agy", "agent preset")
		dir := fs.String("dir", "", "working directory")
		label := fs.String("label", "", "session label")
		explicitID := fs.String("id", "", "explicit session id")
		cliSessionID := fs.String("cli-session-id", "", "CLI session id for resume")
		resume := fs.Bool("resume", false, "resume CLI session")
		cols := fs.Int("cols", 0, "terminal columns")
		rows := fs.Int("rows", 0, "terminal rows")
		if err := fs.Parse(rest); err != nil {
			return 1, err
		}
		params := map[string]interface{}{
			"preset":         *preset,
			"dir":            *dir,
			"label":          *label,
			"explicit_id":    *explicitID,
			"cli_session_id": *cliSessionID,
			"resume":         *resume,
			"cols":           *cols,
			"rows":           *rows,
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.start", params, &res, 5*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.MarshalIndent(res, "", "  ")
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "write":
		fs := flag.NewFlagSet("pty write", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		submit := fs.Bool("submit", false, "append carriage return")
		if err := fs.Parse(rest); err != nil {
			return 1, err
		}
		pos := fs.Args()
		if len(pos) < 1 {
			return 1, errors.New("usage: syki pty write [--submit] <id> [text]")
		}
		id := pos[0]
		var text string
		if len(pos) > 1 {
			text = strings.Join(pos[1:], " ")
		} else {
			text = readPipedText(c.stdin)
		}
		params := map[string]interface{}{
			"id":     id,
			"text":   text,
			"submit": *submit,
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.write", params, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.Marshal(res)
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "read":
		fs := flag.NewFlagSet("pty read", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		since := fs.Int64("since", -1, "byte offset")
		maxBytes := fs.Int("max-bytes", 16384, "max bytes")
		stripANSI := fs.Bool("strip-ansi", false, "strip ANSI escapes")
		raw := fs.Bool("raw", false, "print only data text")
		if err := fs.Parse(rest); err != nil {
			return 1, err
		}
		pos := fs.Args()
		if len(pos) < 1 {
			return 1, errors.New("usage: syki pty read [--since N] [--strip-ansi] [--raw] <id>")
		}
		params := map[string]interface{}{
			"id":           pos[0],
			"since_offset": *since,
			"max_bytes":    *maxBytes,
			"strip_ansi":   *stripANSI,
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.read", params, &res, 3*time.Second); err != nil {
			return 1, err
		}
		if *raw {
			if data, ok := res["data"].(string); ok {
				fmt.Fprint(c.stdout, data)
			}
			return 0, nil
		}
		enc, _ := json.MarshalIndent(res, "", "  ")
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "close":
		if len(rest) < 1 {
			return 1, errors.New("usage: syki pty close <id>")
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.close", map[string]string{"id": rest[0]}, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.Marshal(res)
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "resize":
		fs := flag.NewFlagSet("pty resize", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		cols := fs.Int("cols", 0, "columns")
		rows := fs.Int("rows", 0, "rows")
		if err := fs.Parse(rest); err != nil {
			return 1, err
		}
		pos := fs.Args()
		if len(pos) < 1 || *cols <= 0 || *rows <= 0 {
			return 1, errors.New("usage: syki pty resize --cols N --rows M <id>")
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.resize", map[string]interface{}{
			"id":   pos[0],
			"cols": *cols,
			"rows": *rows,
		}, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.Marshal(res)
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "rename":
		if len(rest) < 2 {
			return 1, errors.New("usage: syki pty rename <id> <label>")
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.rename", map[string]string{
			"id":    rest[0],
			"label": strings.Join(rest[1:], " "),
		}, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.Marshal(res)
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "sleep":
		if len(rest) < 1 {
			return 1, errors.New("usage: syki pty sleep <id>")
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.sleep", map[string]string{"id": rest[0]}, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.Marshal(res)
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "history":
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.history", nil, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.MarshalIndent(res, "", "  ")
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "presets":
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.presets", nil, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.MarshalIndent(res, "", "  ")
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "detect-gate":
		fs := flag.NewFlagSet("pty detect-gate", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		dir := fs.String("dir", "", "target directory")
		if err := fs.Parse(rest); err != nil {
			return 1, err
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.detect_gate", map[string]string{"dir": *dir}, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.MarshalIndent(res, "", "  ")
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "prepare-worktree":
		fs := flag.NewFlagSet("pty prepare-worktree", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		dir := fs.String("dir", "", "target directory")
		loopID := fs.String("id", "", "loop identifier")
		if err := fs.Parse(rest); err != nil {
			return 1, err
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.prepare_worktree", map[string]string{
			"dir":     *dir,
			"loop_id": *loopID,
		}, &res, 10*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.MarshalIndent(res, "", "  ")
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "loop-list":
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.loop_list", nil, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.MarshalIndent(res, "", "  ")
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "loop-start":
		fs := flag.NewFlagSet("pty loop-start", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		tabID := fs.String("tab", "", "tab id")
		line := fs.Int("line", 0, "1-based line number")
		title := fs.String("title", "", "harness block title")
		if err := fs.Parse(rest); err != nil {
			return 1, err
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.loop_start", map[string]interface{}{
			"tab_id": *tabID,
			"line":   *line,
			"title":  *title,
		}, &res, 10*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.MarshalIndent(res, "", "  ")
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	case "loop-stop":
		fs := flag.NewFlagSet("pty loop-stop", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		force := fs.Bool("force", false, "immediately interrupt active PTY session")
		if err := fs.Parse(rest); err != nil {
			return 1, err
		}
		pos := fs.Args()
		if len(pos) < 1 {
			return 1, errors.New("usage: syki pty loop-stop [--force] <id>")
		}
		var res map[string]interface{}
		if err := ipc.CallRPC(c.session, "pty.loop_stop", map[string]interface{}{
			"id":    pos[0],
			"force": *force,
		}, &res, 3*time.Second); err != nil {
			return 1, err
		}
		enc, _ := json.Marshal(res)
		fmt.Fprintln(c.stdout, string(enc))
		return 0, nil

	default:
		return 1, fmt.Errorf("unknown pty action: %s", action)
	}
}
