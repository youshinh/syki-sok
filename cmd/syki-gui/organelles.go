package main

import (
	"sync"

	"syki-sok/pkg/cfbridge"
	"syki-sok/pkg/dropzone"
	"syki-sok/pkg/inbox"
)

// ReceptorOrganelles encapsulates Ring 2 detachable background receptors:
// the Mobile Drop LAN HTTP server, the Cloudflare Bridge poller, and the Hot-folder Inbox watcher.
type ReceptorOrganelles struct {
	dropzoneMu     sync.Mutex
	dropzoneServer *dropzone.Server

	cfMu     sync.Mutex
	cfPoller *cfbridge.Poller

	inboxMu      sync.Mutex
	inboxWatcher *inbox.Watcher
}

func (a *App) StopCFBridge() {
	a.cfMu.Lock()
	defer a.cfMu.Unlock()

	if a.cfPoller != nil {
		a.cfPoller.Stop()
		a.cfPoller = nil
	}
}

func (a *App) InitOrganelles() {
	a.InitCFBridge()
	a.InitInboxWatcher()
}

func (a *App) ShutdownOrganelles() {
	a.CancelMobileDrop()
	a.StopCFBridge()
	a.StopInboxWatcher()
}
