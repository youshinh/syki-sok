package cli

import (
	"bytes"
	"encoding/json"
	"testing"

	"syki-sok/pkg/ipc"
)

func TestPtyClientSubcommands(t *testing.T) {
	session, peer := startCapturePeer(t, func(method string, params json.RawMessage) (interface{}, *ipc.RPCError) {
		switch method {
		case "pty.presets":
			return map[string]interface{}{"presets": []string{"agy", "cc", "shell"}}, nil
		case "pty.history":
			return map[string]interface{}{"entries": []interface{}{}}, nil
		case "pty.detect_gate":
			return map[string]interface{}{"dir": "/repo", "gate": "go test ./..."}, nil
		case "pty.prepare_worktree":
			return map[string]interface{}{"dir": "/repo/.worktrees/l1", "isolated": true}, nil
		case "pty.loop_list":
			return map[string]interface{}{"loops": []interface{}{}}, nil
		case "pty.loop_start":
			return map[string]interface{}{"id": "loop-1", "phase": "maker"}, nil
		default:
			return map[string]interface{}{"ok": true}, nil
		}
	})

	cases := []struct {
		name       string
		args       []string
		wantMethod string
		check      func(t *testing.T, p map[string]interface{})
	}{
		{
			name:       "start with resume",
			args:       []string{"pty", "start", "--preset", "cc", "--cli-session-id", "sid-1", "--resume", "--cols", "100", "--rows", "30"},
			wantMethod: "pty.start",
			check: func(t *testing.T, p map[string]interface{}) {
				if p["preset"] != "cc" || p["cli_session_id"] != "sid-1" || p["resume"] != true {
					t.Fatalf("unexpected params: %+v", p)
				}
			},
		},
		{
			name:       "resize",
			args:       []string{"pty", "resize", "--cols", "120", "--rows", "40", "pty-1"},
			wantMethod: "pty.resize",
			check: func(t *testing.T, p map[string]interface{}) {
				if p["id"] != "pty-1" || p["cols"] != float64(120) || p["rows"] != float64(40) {
					t.Fatalf("unexpected params: %+v", p)
				}
			},
		},
		{
			name:       "rename",
			args:       []string{"pty", "rename", "pty-1", "Worker", "One"},
			wantMethod: "pty.rename",
			check: func(t *testing.T, p map[string]interface{}) {
				if p["id"] != "pty-1" || p["label"] != "Worker One" {
					t.Fatalf("unexpected params: %+v", p)
				}
			},
		},
		{
			name:       "sleep",
			args:       []string{"pty", "sleep", "pty-1"},
			wantMethod: "pty.sleep",
			check: func(t *testing.T, p map[string]interface{}) {
				if p["id"] != "pty-1" {
					t.Fatalf("unexpected params: %+v", p)
				}
			},
		},
		{
			name:       "history",
			args:       []string{"pty", "history"},
			wantMethod: "pty.history",
		},
		{
			name:       "presets",
			args:       []string{"pty", "presets"},
			wantMethod: "pty.presets",
		},
		{
			name:       "detect-gate",
			args:       []string{"pty", "detect-gate", "--dir", "/repo"},
			wantMethod: "pty.detect_gate",
			check: func(t *testing.T, p map[string]interface{}) {
				if p["dir"] != "/repo" {
					t.Fatalf("unexpected params: %+v", p)
				}
			},
		},
		{
			name:       "prepare-worktree",
			args:       []string{"pty", "prepare-worktree", "--dir", "/repo", "--id", "l1"},
			wantMethod: "pty.prepare_worktree",
			check: func(t *testing.T, p map[string]interface{}) {
				if p["dir"] != "/repo" || p["loop_id"] != "l1" {
					t.Fatalf("unexpected params: %+v", p)
				}
			},
		},
		{
			name:       "loop-list",
			args:       []string{"pty", "loop-list"},
			wantMethod: "pty.loop_list",
		},
		{
			name:       "loop-start",
			args:       []string{"pty", "loop-start", "--tab", "tab-2", "--line", "12", "--title", "Fix bug"},
			wantMethod: "pty.loop_start",
			check: func(t *testing.T, p map[string]interface{}) {
				if p["tab_id"] != "tab-2" || p["line"] != float64(12) || p["title"] != "Fix bug" {
					t.Fatalf("unexpected params: %+v", p)
				}
			},
		},
		{
			name:       "loop-stop",
			args:       []string{"pty", "loop-stop", "--force", "loop-1"},
			wantMethod: "pty.loop_stop",
			check: func(t *testing.T, p map[string]interface{}) {
				if p["id"] != "loop-1" || p["force"] != true {
					t.Fatalf("unexpected params: %+v", p)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			runner := NewClientRunner(session, &stdout, &stderr)
			code, err := runner.Run(tc.args)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if code != 0 {
				t.Fatalf("exit %d, stderr: %s", code, stderr.String())
			}
			req := peer.last(t)
			if req.Method != tc.wantMethod {
				t.Fatalf("got method %q, want %q", req.Method, tc.wantMethod)
			}
			if tc.check != nil {
				tc.check(t, peer.params(t))
			}
		})
	}
}

func TestPtyClientValidationErrors(t *testing.T) {
	session, _ := startCapturePeer(t, func(method string, params json.RawMessage) (interface{}, *ipc.RPCError) {
		return map[string]interface{}{"ok": true}, nil
	})
	badCases := [][]string{
		{"pty"},
		{"pty", "resize", "--cols", "0", "--rows", "24", "pty-1"},
		{"pty", "rename", "pty-1"},
		{"pty", "sleep"},
		{"pty", "loop-stop"},
		{"pty", "unknown"},
	}
	for _, args := range badCases {
		var stdout, stderr bytes.Buffer
		runner := NewClientRunner(session, &stdout, &stderr)
		if code, _ := runner.Run(args); code != 1 {
			t.Fatalf("args %v: expected exit 1, got %d", args, code)
		}
	}
}
