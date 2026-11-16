package main

import (
	"testing"
)

type stubWebView struct {
	evals     []string
	destroyed bool
}

func (s *stubWebView) Dispatch(fn func()) {
	if fn != nil {
		fn()
	}
}

func (s *stubWebView) Eval(js string) {
	s.evals = append(s.evals, js)
}

func (s *stubWebView) Destroy() {
	s.destroyed = true
}

func TestMultiWebViewRoutingAndDestroy(t *testing.T) {
	primary := &stubWebView{}
	secondary := &stubWebView{}

	mw := newMultiWebView(primary)
	mw.Eval("primary-initial")
	if len(primary.evals) != 1 || primary.evals[0] != "primary-initial" {
		t.Fatalf("expected Eval to hit primary initially, got %v", primary.evals)
	}

	mw.add(secondary)
	mw.Eval("secondary-active")
	if len(secondary.evals) != 1 || secondary.evals[0] != "secondary-active" {
		t.Fatalf("expected Eval to route to newly added active view, got %v", secondary.evals)
	}
	if len(primary.evals) != 1 {
		t.Fatalf("expected primary not to receive Eval when secondary is active, got %v", primary.evals)
	}

	mw.EvalAll("broadcast")
	if len(primary.evals) != 2 || primary.evals[1] != "broadcast" {
		t.Fatalf("expected EvalAll to hit primary, got %v", primary.evals)
	}
	if len(secondary.evals) != 2 || secondary.evals[1] != "broadcast" {
		t.Fatalf("expected EvalAll to hit secondary, got %v", secondary.evals)
	}

	mw.remove(secondary)
	mw.Eval("after-remove")
	if len(primary.evals) != 3 || primary.evals[2] != "after-remove" {
		t.Fatalf("expected Eval to fall back to primary after removing active, got %v", primary.evals)
	}

	mw.Destroy()
	if !primary.destroyed {
		t.Fatalf("expected multiWebView.Destroy to delegate to primary")
	}
	if secondary.destroyed {
		t.Fatalf("did not expect multiWebView.Destroy to destroy secondary directly")
	}
}

func TestOpenNewWindow(t *testing.T) {
	app := &App{}

	if err := app.OpenNewWindow("{invalid"); err == nil {
		t.Fatalf("expected error for invalid JSON")
	}

	if err := app.OpenNewWindow(""); err == nil {
		t.Fatalf("expected error when no handler is registered")
	}

	var got openWindowOpts
	called := false
	app.setOpenNewWindowHandler(func(opts openWindowOpts) error {
		called = true
		got = opts
		return nil
	})

	if err := app.OpenNewWindow(`{"filePath":"note.md","splitAgent":true}`); err != nil {
		t.Fatalf("unexpected error from OpenNewWindow: %v", err)
	}
	if !called || got.FilePath != "note.md" || !got.SplitAgent {
		t.Fatalf("unexpected opts passed to handler: called=%v got=%+v", called, got)
	}
}

func TestDispatchEvalToAndClosePTYsForView(t *testing.T) {
	primary := &stubWebView{}
	secondary := &stubWebView{}
	mw := newMultiWebView(primary)
	mw.add(secondary)

	app := &App{w: mw}

	app.dispatchEvalTo(secondary, "to-secondary")
	if len(secondary.evals) != 1 || secondary.evals[0] != "to-secondary" {
		t.Fatalf("expected dispatchEvalTo to target secondary, got %v", secondary.evals)
	}
	if len(primary.evals) != 0 {
		t.Fatalf("expected primary not to receive dispatchEvalTo for secondary, got %v", primary.evals)
	}

	mw.remove(secondary)
	app.dispatchEvalTo(secondary, "after-remove")
	if len(secondary.evals) != 1 {
		t.Fatalf("expected dispatchEvalTo to skip removed view, got %v", secondary.evals)
	}

	app.ptyOwners.Store("pty-1", primary)
	app.ptyOwners.Store("pty-2", secondary)
	app.ptyOwners.Store("pty-3", secondary)

	app.closePTYsForView(secondary)

	if _, ok := app.ptyOwners.Load("pty-1"); !ok {
		t.Fatalf("expected primary PTY owner to remain")
	}
	if _, ok := app.ptyOwners.Load("pty-2"); ok {
		t.Fatalf("expected pty-2 owned by secondary to be removed")
	}
	if _, ok := app.ptyOwners.Load("pty-3"); ok {
		t.Fatalf("expected pty-3 owned by secondary to be removed")
	}
}

func TestPlatformCapabilitiesMultiWindow(t *testing.T) {
	if !platformCapabilitiesFor("windows").MultiWindow {
		t.Fatalf("expected MultiWindow to be true on windows")
	}
	if platformCapabilitiesFor("darwin").MultiWindow {
		t.Fatalf("expected MultiWindow to be false on darwin")
	}
}
