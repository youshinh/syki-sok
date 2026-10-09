//go:build windows

package main

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// webViewProcessList lists every process of the session as (pid, parent, exe name).
func webViewProcessList() []procEntry {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	if windows.Process32First(snap, &e) != nil {
		return nil
	}
	var all []procEntry
	for {
		all = append(all, procEntry{PID: e.ProcessID, Parent: e.ParentProcessID, Exe: windows.UTF16ToString(e.ExeFile[:])})
		if windows.Process32Next(snap, &e) != nil {
			break
		}
	}
	return all
}

// trimWebViewWorkingSets empties the working set of this application's WebView2 processes: Windows takes back the pages they are not using
// and gives them again, a few at a time, when the window is used. It touches no process of another application and no data.
func trimWebViewWorkingSets() {
	defer func() { _ = recover() }()
	if procEmptyWorkingSet.Find() != nil {
		return
	}
	for _, pid := range webViewProcessesOf(uint32(os.Getpid()), webViewProcessList()) {
		h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
		if err != nil {
			continue
		}
		_, _, _ = procEmptyWorkingSet.Call(uintptr(h))
		_ = windows.CloseHandle(h)
	}
}

// webViewSettingsNow reads the WebView2 choices of the saved settings.
func webViewSettingsNow() webViewSettings {
	if globalApp == nil {
		return parseWebViewSettings("")
	}
	return parseWebViewSettings(globalApp.readConfigCached())
}
