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
		return 1, errors.New("pty subcommand required: list, start, write, read, or close")
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
		if err := fs.Parse(rest); err != nil {
			return 1, err
		}
		params := map[string]interface{}{
			"preset":      *preset,
			"dir":         *dir,
			"label":       *label,
			"explicit_id": *explicitID,
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

	default:
		return 1, fmt.Errorf("unknown pty action: %s", action)
	}
}
