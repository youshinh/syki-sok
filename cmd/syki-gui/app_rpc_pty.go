package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"

	"syki-sok/pkg/ipc"
)

var ptyAnsiEscapeRE = regexp.MustCompile(`\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])`)

func (a *App) rpcPtyList(req *ipc.RPCRequest) *ipc.RPCResponse {
	items := a.ensurePTYManager().List()
	return successResponse(req.ID, map[string]interface{}{"sessions": items})
}

func (a *App) rpcPtyStart(req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		Preset       string `json:"preset"`
		Dir          string `json:"dir"`
		Label        string `json:"label"`
		ExplicitID   string `json:"explicit_id"`
		CLISessionID string `json:"cli_session_id"`
		Resume       bool   `json:"resume"`
		Cols         int    `json:"cols"`
		Rows         int    `json:"rows"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil && len(req.Params) > 0 {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
	}
	if params.Preset == "" {
		params.Preset = "agy"
	}
	raw, err := a.PtyStartWithOptions(params.ExplicitID, params.Preset, params.Dir, params.Label, params.CLISessionID, params.Resume, params.Cols, params.Rows)
	if err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInternalError, err.Error())
	}
	var info interface{}
	if err := json.Unmarshal([]byte(raw), &info); err != nil {
		return successResponse(req.ID, raw)
	}
	return successResponse(req.ID, info)
}

func (a *App) rpcPtyWrite(req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		ID     string `json:"id"`
		Text   string `json:"text"`
		Base64 string `json:"base64"`
		Submit bool   `json:"submit"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
	}
	if params.ID == "" {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, "id is required")
	}
	var payload []byte
	if params.Base64 != "" {
		dec, err := base64.StdEncoding.DecodeString(params.Base64)
		if err != nil {
			return errorResponse(req.ID, ipc.ErrCodeInvalidParams, "invalid base64: "+err.Error())
		}
		payload = dec
	} else {
		payload = []byte(params.Text)
	}
	if params.Submit {
		payload = append(payload, '\r')
	}
	if err := a.ensurePTYManager().Write(params.ID, payload); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInternalError, err.Error())
	}
	return successResponse(req.ID, map[string]interface{}{"ok": true, "bytes": len(payload)})
}

func (a *App) rpcPtyRead(req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		ID          string `json:"id"`
		SinceOffset *int64 `json:"since_offset"`
		MaxBytes    int    `json:"max_bytes"`
		StripANSI   bool   `json:"strip_ansi"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
	}
	if params.ID == "" {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, "id is required")
	}
	since := int64(-1)
	if params.SinceOffset != nil {
		since = *params.SinceOffset
	}
	data, nextOff, running, err := a.ensurePTYManager().ReadOutput(params.ID, since, params.MaxBytes)
	if err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInternalError, err.Error())
	}
	text := string(data)
	if params.StripANSI {
		text = ptyAnsiEscapeRE.ReplaceAllString(text, "")
	}
	return successResponse(req.ID, map[string]interface{}{
		"id":          params.ID,
		"data":        text,
		"next_offset": nextOff,
		"running":     running,
	})
}

func (a *App) rpcPtyClose(req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
	}
	if params.ID == "" {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, "id is required")
	}
	if err := a.PtyClose(params.ID); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInternalError, err.Error())
	}
	return successResponse(req.ID, map[string]interface{}{"ok": true})
}

func (a *App) rpcPtyResize(req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		ID   string `json:"id"`
		Cols int    `json:"cols"`
		Rows int    `json:"rows"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
	}
	if params.ID == "" {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, "id is required")
	}
	if params.Cols <= 0 || params.Rows <= 0 {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, "cols and rows must be > 0")
	}
	if err := a.PtyResize(params.ID, params.Cols, params.Rows); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInternalError, err.Error())
	}
	return successResponse(req.ID, map[string]interface{}{"ok": true, "id": params.ID, "cols": params.Cols, "rows": params.Rows})
}

func (a *App) rpcPtyRename(req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
	}
	if params.ID == "" {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, "id is required")
	}
	if err := a.PtyRename(params.ID, params.Label); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInternalError, err.Error())
	}
	return successResponse(req.ID, map[string]interface{}{"ok": true, "id": params.ID, "label": params.Label})
}

func (a *App) rpcPtySleep(req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
	}
	if params.ID == "" {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, "id is required")
	}
	if err := a.PtySleep(params.ID); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInternalError, err.Error())
	}
	return successResponse(req.ID, map[string]interface{}{"ok": true, "id": params.ID})
}

func (a *App) rpcPtyHistory(req *ipc.RPCRequest) *ipc.RPCResponse {
	raw := a.PtyHistory()
	var entries []interface{}
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		entries = []interface{}{}
	}
	return successResponse(req.ID, map[string]interface{}{"entries": entries})
}

func (a *App) rpcPtyPresets(req *ipc.RPCRequest) *ipc.RPCResponse {
	raw := a.PtyAvailablePresets()
	var presets []string
	if err := json.Unmarshal([]byte(raw), &presets); err != nil {
		presets = []string{}
	}
	return successResponse(req.ID, map[string]interface{}{"presets": presets})
}

func (a *App) rpcPtyDetectGate(req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		Dir string `json:"dir"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
		}
	}
	resolved := a.resolvePTYDir(params.Dir)
	gate := a.PtyDetectGate(params.Dir)
	return successResponse(req.ID, map[string]interface{}{"dir": resolved, "gate": gate})
}

func (a *App) rpcPtyPrepareWorktree(req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		Dir    string `json:"dir"`
		LoopID string `json:"loop_id"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
		}
	}
	raw, err := a.PtyPrepareWorktree(params.Dir, params.LoopID)
	if err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInternalError, err.Error())
	}
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInternalError, err.Error())
	}
	return successResponse(req.ID, out)
}

func (a *App) rpcPtyLoopList(ctx context.Context, req *ipc.RPCRequest) *ipc.RPCResponse {
	resJSON, err := a.CallJSWithResponse(ctx, "window.__sykiPtyLoopRPC ? window.__sykiPtyLoopRPC.list() : []")
	if err != nil {
		return jsErrorResponse(req.ID, err, "failed to list harness loops")
	}
	var loops []interface{}
	if err := json.Unmarshal([]byte(resJSON), &loops); err != nil {
		loops = []interface{}{}
	}
	return successResponse(req.ID, map[string]interface{}{"loops": loops})
}

func (a *App) rpcPtyLoopStart(ctx context.Context, req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		TabID string `json:"tab_id"`
		Line  int    `json:"line"`
		Title string `json:"title"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
		}
	}
	optsBytes, _ := json.Marshal(map[string]interface{}{
		"tabId": params.TabID,
		"line":  params.Line,
		"title": params.Title,
	})
	expr := fmt.Sprintf("(function(){ if (!window.__sykiPtyLoopRPC) throw new Error('harness loop bridge is not ready'); return window.__sykiPtyLoopRPC.start(%s); })()", string(optsBytes))
	resJSON, err := a.CallJSWithResponse(ctx, expr)
	if err != nil {
		return jsErrorResponse(req.ID, err, "failed to start harness loop")
	}
	var out interface{}
	if err := json.Unmarshal([]byte(resJSON), &out); err != nil {
		return successResponse(req.ID, resJSON)
	}
	return successResponse(req.ID, out)
}

func (a *App) rpcPtyLoopStop(ctx context.Context, req *ipc.RPCRequest) *ipc.RPCResponse {
	var params struct {
		ID    string `json:"id"`
		Force bool   `json:"force"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
	}
	if params.ID == "" {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, "id is required")
	}
	idJSON, _ := json.Marshal(params.ID)
	expr := fmt.Sprintf("(function(){ if (!window.__sykiPtyLoopRPC) throw new Error('harness loop bridge is not ready'); return window.__sykiPtyLoopRPC.stop(%s, %v); })()", string(idJSON), params.Force)
	resJSON, err := a.CallJSWithResponse(ctx, expr)
	if err != nil {
		return jsErrorResponse(req.ID, err, "failed to stop harness loop")
	}
	var out interface{}
	if err := json.Unmarshal([]byte(resJSON), &out); err != nil {
		return successResponse(req.ID, resJSON)
	}
	return successResponse(req.ID, out)
}
