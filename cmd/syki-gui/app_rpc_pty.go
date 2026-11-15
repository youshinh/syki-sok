package main

import (
	"encoding/base64"
	"encoding/json"
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
		Preset     string `json:"preset"`
		Dir        string `json:"dir"`
		Label      string `json:"label"`
		ExplicitID string `json:"explicit_id"`
		Cols       int    `json:"cols"`
		Rows       int    `json:"rows"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil && len(req.Params) > 0 {
		return errorResponse(req.ID, ipc.ErrCodeInvalidParams, err.Error())
	}
	if params.Preset == "" {
		params.Preset = "agy"
	}
	raw, err := a.PtyStartWithOptions(params.ExplicitID, params.Preset, params.Dir, params.Label, "", false, params.Cols, params.Rows)
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
