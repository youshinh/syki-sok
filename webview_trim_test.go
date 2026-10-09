package main

import (
	"reflect"
	"sort"
	"testing"
)

func TestWebViewProcessesOfTakesOnlyTheTreeUnderTheRoot(t *testing.T) {
	all := []procEntry{
		{PID: 10, Parent: 1, Exe: "syki.exe"},
		{PID: 11, Parent: 10, Exe: "msedgewebview2.exe"}, // the browser process of syki
		{PID: 12, Parent: 11, Exe: "msedgewebview2.exe"}, // its GPU process
		{PID: 13, Parent: 11, Exe: "MSEDGEWEBVIEW2.EXE"}, // its renderer (upper case: Windows names are not case sensitive)
		{PID: 14, Parent: 13, Exe: "crashpad_handler.exe"},
		{PID: 15, Parent: 10, Exe: "cmd.exe"}, // something syki started: not a WebView2
		{PID: 20, Parent: 1, Exe: "other.exe"},
		{PID: 21, Parent: 20, Exe: "msedgewebview2.exe"}, // another application's WebView2
		{PID: 22, Parent: 21, Exe: "msedgewebview2.exe"},
		{PID: 30, Parent: 30, Exe: "msedgewebview2.exe"}, // a process that is its own parent must not loop
	}
	got := webViewProcessesOf(10, all)
	sort.Slice(got, func(i, j int) bool { return got[i] < got[j] })
	if want := []uint32{11, 12, 13}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if got := webViewProcessesOf(99, all); len(got) != 0 {
		t.Fatalf("a root that is not there has no WebView2 under it, got %v", got)
	}
	if got := webViewProcessesOf(10, nil); len(got) != 0 {
		t.Fatalf("an empty list has none, got %v", got)
	}
}

func TestParseWebViewSettings(t *testing.T) {
	cases := []struct {
		name string
		json string
		want webViewSettings
	}{
		{"nothing saved: the trim is on, the GPU merge off", ``, webViewSettings{TrimWhenHidden: true}},
		{"not json", `{oops`, webViewSettings{TrimWhenHidden: true}},
		{"no general section", `{"text":{}}`, webViewSettings{TrimWhenHidden: true}},
		{"trim switched off", `{"general":{"trimWebViewWhenHidden":false}}`, webViewSettings{TrimWhenHidden: false}},
		{"the GPU merge switched on", `{"general":{"webViewInProcessGpu":true}}`, webViewSettings{TrimWhenHidden: true, InProcessGPU: true}},
		{"both", `{"general":{"trimWebViewWhenHidden":false,"webViewInProcessGpu":true}}`, webViewSettings{TrimWhenHidden: false, InProcessGPU: true}},
	}
	for _, c := range cases {
		if got := parseWebViewSettings(c.json); got != c.want {
			t.Errorf("%s: got %+v want %+v", c.name, got, c.want)
		}
	}
}
