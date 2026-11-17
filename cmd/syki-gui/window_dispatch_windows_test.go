//go:build windows

package main

import (
	"testing"
	"unsafe"

	"github.com/jchv/go-webview2"
)

type fakeLayoutWebView struct {
	webviewBindingsLayout
}

func (f *fakeLayoutWebView) Run()                                              {}
func (f *fakeLayoutWebView) Terminate()                                        {}
func (f *fakeLayoutWebView) Dispatch(fn func())                                { f.dispatchq = append(f.dispatchq, fn) }
func (f *fakeLayoutWebView) Eval(js string)                                    {}
func (f *fakeLayoutWebView) Init(js string)                                    {}
func (f *fakeLayoutWebView) Bind(name string, fn interface{}) error            { return nil }
func (f *fakeLayoutWebView) Navigate(url string)                               {}
func (f *fakeLayoutWebView) SetHtml(html string)                               {}
func (f *fakeLayoutWebView) SetTitle(title string)                             {}
func (f *fakeLayoutWebView) SetSize(w int, h int, hints webview2.Hint)         {}
func (f *fakeLayoutWebView) Window() unsafe.Pointer                            { return nil }
func (f *fakeLayoutWebView) Destroy()                                          {}

type incompatibleWebView struct {
	fakeLayoutWebView
	extra int
}

func TestVerifyWebViewLayout(t *testing.T) {
	if verifyWebViewLayout(nil) {
		t.Fatalf("expected nil webview to fail layout verification")
	}
	okView := &fakeLayoutWebView{}
	if !verifyWebViewLayout(okView) {
		t.Fatalf("expected fakeLayoutWebView to pass layout verification")
	}
	wrapped := &batchedBinderWebView{WebView: okView}
	if !verifyWebViewLayout(wrapped) {
		t.Fatalf("expected wrapped batchedBinderWebView to pass layout verification")
	}
	badView := &struct {
		webview2.WebView
	}{}
	if verifyWebViewLayout(badView) {
		t.Fatalf("expected incompatible struct without m/dispatchq to fail layout verification")
	}
}

func TestDrainWebViewDispatchQueuePrimaryAndSecondary(t *testing.T) {
	primary := &fakeLayoutWebView{}
	secondary := &fakeLayoutWebView{}

	var order []string
	primary.Dispatch(func() { order = append(order, "primary-1") })
	secondary.Dispatch(func() { order = append(order, "secondary-1") })
	secondary.Dispatch(func() { order = append(order, "secondary-2") })

	drainWebViewDispatchQueue(primary)
	drainWebViewDispatchQueue(secondary)

	if len(order) != 3 || order[0] != "primary-1" || order[1] != "secondary-1" || order[2] != "secondary-2" {
		t.Fatalf("unexpected execution order: %v", order)
	}
	if len(primary.dispatchq) != 0 || len(secondary.dispatchq) != 0 {
		t.Fatalf("expected both dispatch queues to be empty after drain")
	}
}
