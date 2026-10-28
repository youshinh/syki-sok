package main

import (
	"encoding/json"
	"strings"
)

// The part of the memory the person sees in Task Manager that is not syki.exe is WebView2: a browser process, a GPU process, a network
// service and the renderer that draws the page, all children (and grandchildren) of syki.exe. Emptying only this process's own working set
// (the old behaviour) left every one of them untouched, so the memory of a window that had been hidden to the tray stayed where it was.

// procEntry is the part of a process snapshot the selection needs.
type procEntry struct {
	PID    uint32
	Parent uint32
	Exe    string
}

const webViewHostExe = "msedgewebview2.exe"

// webViewProcessesOf returns the pids of the WebView2 processes that belong to `root`: the processes named msedgewebview2.exe in the tree under
// it (a child of the browser process is a descendant of root, not a direct child). Processes of other applications' WebView2 are never in it.
func webViewProcessesOf(root uint32, all []procEntry) []uint32 {
	children := make(map[uint32][]procEntry, len(all))
	for _, p := range all {
		if p.PID == p.Parent {
			continue
		}
		children[p.Parent] = append(children[p.Parent], p)
	}
	var out []uint32
	seen := map[uint32]bool{root: true}
	queue := []uint32{root}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, c := range children[cur] {
			if seen[c.PID] {
				continue
			}
			seen[c.PID] = true
			queue = append(queue, c.PID)
			if strings.EqualFold(c.Exe, webViewHostExe) {
				out = append(out, c.PID)
			}
		}
	}
	return out
}

// webViewSettings are the two choices of Settings that concern the WebView2 processes.
type webViewSettings struct {
	// TrimWhenHidden: when the window is hidden or minimized, the WebView2 processes give back the memory they are not using.
	TrimWhenHidden bool
	// InProcessGPU: the GPU work runs inside the browser process instead of a process of its own (one process less; needs a restart).
	InProcessGPU bool
}

// parseWebViewSettings reads them from the settings text. The trim is on unless switched off, the GPU merge is off unless switched on.
func parseWebViewSettings(configJSON string) webViewSettings {
	s := webViewSettings{TrimWhenHidden: true}
	var c struct {
		General struct {
			TrimWebViewWhenHidden *bool `json:"trimWebViewWhenHidden"`
			WebViewInProcessGPU   *bool `json:"webViewInProcessGpu"`
		} `json:"general"`
	}
	if configJSON == "" || json.Unmarshal([]byte(configJSON), &c) != nil {
		return s
	}
	if c.General.TrimWebViewWhenHidden != nil {
		s.TrimWhenHidden = *c.General.TrimWebViewWhenHidden
	}
	if c.General.WebViewInProcessGPU != nil {
		s.InProcessGPU = *c.General.WebViewInProcessGPU
	}
	return s
}
