package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"syki-sok/pkg/ipc"
)

func TestDispatchRPCOperation_PtyExtraMethods(t *testing.T) {
	app := &App{}

	t.Run("pty.presets returns array", func(t *testing.T) {
		resp := app.DispatchRPCOperation(&ipc.RPCRequest{
			JSONRPC: "2.0",
			ID:      1,
			Method:  "pty.presets",
		})
		if resp.Error != nil {
			t.Fatalf("unexpected error: %+v", resp.Error)
		}
		m, ok := resp.Result.(map[string]interface{})
		if !ok {
			t.Fatalf("expected map result, got %T", resp.Result)
		}
		if _, ok := m["presets"]; !ok {
			t.Fatalf("missing presets key: %+v", m)
		}
	})

	t.Run("pty.detect_gate detects go.mod", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module example.com/test\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		params, _ := json.Marshal(map[string]string{"dir": dir})
		resp := app.DispatchRPCOperation(&ipc.RPCRequest{
			JSONRPC: "2.0",
			ID:      2,
			Method:  "pty.detect_gate",
			Params:  params,
		})
		if resp.Error != nil {
			t.Fatalf("unexpected error: %+v", resp.Error)
		}
		m := resp.Result.(map[string]interface{})
		if m["gate"] != "go test ./..." {
			t.Fatalf("expected 'go test ./...', got %v", m["gate"])
		}
	})

	t.Run("pty.prepare_worktree falls back on non-git dir", func(t *testing.T) {
		dir := t.TempDir()
		params, _ := json.Marshal(map[string]string{"dir": dir, "loop_id": "loop-test-1"})
		resp := app.DispatchRPCOperation(&ipc.RPCRequest{
			JSONRPC: "2.0",
			ID:      3,
			Method:  "pty.prepare_worktree",
			Params:  params,
		})
		if resp.Error != nil {
			t.Fatalf("unexpected error: %+v", resp.Error)
		}
		m := resp.Result.(map[string]interface{})
		if m["isolated"] != false {
			t.Fatalf("expected isolated=false on non-git dir, got %+v", m)
		}
	})

	t.Run("pty.history returns entries", func(t *testing.T) {
		resp := app.DispatchRPCOperation(&ipc.RPCRequest{
			JSONRPC: "2.0",
			ID:      4,
			Method:  "pty.history",
		})
		if resp.Error != nil {
			t.Fatalf("unexpected error: %+v", resp.Error)
		}
		m := resp.Result.(map[string]interface{})
		if _, ok := m["entries"]; !ok {
			t.Fatalf("missing entries key: %+v", m)
		}
	})

	t.Run("pty.resize validates params", func(t *testing.T) {
		params, _ := json.Marshal(map[string]interface{}{"id": "s1", "cols": 0, "rows": 24})
		resp := app.DispatchRPCOperation(&ipc.RPCRequest{
			JSONRPC: "2.0",
			ID:      5,
			Method:  "pty.resize",
			Params:  params,
		})
		if resp.Error == nil || resp.Error.Code != ipc.ErrCodeInvalidParams {
			t.Fatalf("expected ErrCodeInvalidParams, got %+v", resp.Error)
		}
	})

	t.Run("pty.rename and pty.sleep validate id", func(t *testing.T) {
		for _, method := range []string{"pty.rename", "pty.sleep", "pty.loop_stop"} {
			resp := app.DispatchRPCOperation(&ipc.RPCRequest{
				JSONRPC: "2.0",
				ID:      6,
				Method:  method,
				Params:  json.RawMessage(`{}`),
			})
			if resp.Error == nil || resp.Error.Code != ipc.ErrCodeInvalidParams {
				t.Fatalf("%s: expected ErrCodeInvalidParams, got %+v", method, resp.Error)
			}
		}
	})
}
