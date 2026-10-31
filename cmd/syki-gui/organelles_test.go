package main

import "testing"

func TestReceptorOrganellesShutdownIdempotent(t *testing.T) {
	app := &App{}

	app.ShutdownOrganelles()
	app.ShutdownOrganelles()

	if app.dropzoneServer != nil {
		t.Errorf("dropzoneServer = %v, want nil", app.dropzoneServer)
	}
	if app.cfPoller != nil {
		t.Errorf("cfPoller = %v, want nil", app.cfPoller)
	}
	if app.inboxWatcher != nil {
		t.Errorf("inboxWatcher = %v, want nil", app.inboxWatcher)
	}
}
