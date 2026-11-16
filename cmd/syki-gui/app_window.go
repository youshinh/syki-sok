package main

import (
	"encoding/json"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
)

type openWindowOpts struct {
	FilePath   string `json:"filePath"`
	SplitAgent bool   `json:"splitAgent"`
}

// multiWebView routes Eval calls to the currently active window (falling back to primary)
// while keeping UI thread Dispatch on the primary message loop.
type multiWebView struct {
	mu      sync.RWMutex
	primary WebViewInstance
	active  WebViewInstance
	views   []WebViewInstance
}

func newMultiWebView(primary WebViewInstance) *multiWebView {
	views := make([]WebViewInstance, 0, 2)
	if primary != nil {
		views = append(views, primary)
	}
	return &multiWebView{primary: primary, active: primary, views: views}
}

func (m *multiWebView) Dispatch(fn func()) {
	m.mu.RLock()
	p := m.primary
	m.mu.RUnlock()
	if p != nil {
		p.Dispatch(fn)
	}
}

func (m *multiWebView) activeOrPrimary() WebViewInstance {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.active != nil {
		for _, v := range m.views {
			if v == m.active {
				return m.active
			}
		}
	}
	return m.primary
}

func (m *multiWebView) Eval(js string) {
	if target := m.activeOrPrimary(); target != nil {
		target.Eval(js)
	}
}

func (m *multiWebView) EvalAll(js string) {
	m.mu.RLock()
	snapshot := make([]WebViewInstance, len(m.views))
	copy(snapshot, m.views)
	m.mu.RUnlock()
	for _, v := range snapshot {
		if v != nil {
			v.Eval(js)
		}
	}
}

func (m *multiWebView) setActive(v WebViewInstance) {
	m.mu.Lock()
	if v == nil {
		m.active = m.primary
	} else {
		m.active = v
	}
	m.mu.Unlock()
}

func (m *multiWebView) add(v WebViewInstance) {
	if v == nil {
		return
	}
	m.mu.Lock()
	m.views = append(m.views, v)
	m.active = v
	m.mu.Unlock()
}

func (m *multiWebView) remove(v WebViewInstance) {
	if v == nil {
		return
	}
	m.mu.Lock()
	for i, item := range m.views {
		if item == v {
			m.views = append(m.views[:i], m.views[i+1:]...)
			break
		}
	}
	if m.active == v {
		m.active = m.primary
	}
	m.mu.Unlock()
}

// Destroy delegates window teardown to the primary WebViewInstance so closePlatformWindow works.
func (m *multiWebView) Destroy() {
	m.mu.RLock()
	p := m.primary
	m.mu.RUnlock()
	if closer, ok := p.(interface{ Destroy() }); ok {
		closer.Destroy()
	}
}

// dispatchEvalTo runs js on a specific WebViewInstance via the UI thread, falling back to dispatchEval when target is nil.
func (a *App) dispatchEvalTo(target WebViewInstance, js string) {
	if target == nil {
		a.dispatchEval(js)
		return
	}
	if a.w == nil || atomic.LoadInt32(&a.isDestroyed) != 0 {
		return
	}
	a.w.Dispatch(func() {
		if atomic.LoadInt32(&a.isDestroyed) != 0 {
			return
		}
		if mw, ok := a.w.(*multiWebView); ok {
			mw.mu.RLock()
			alive := false
			for _, v := range mw.views {
				if v == target {
					alive = true
					break
				}
			}
			mw.mu.RUnlock()
			if !alive {
				return
			}
		}
		target.Eval(js)
	})
}

func (a *App) setOpenNewWindowHandler(fn func(openWindowOpts) error) {
	a.newWindowMu.Lock()
	a.newWindowFn = fn
	a.newWindowMu.Unlock()
}

// OpenNewWindow opens an additional GUI window when supported by the platform.
func (a *App) OpenNewWindow(optsJSON string) error {
	var opts openWindowOpts
	if optsJSON != "" {
		if err := json.Unmarshal([]byte(optsJSON), &opts); err != nil {
			return fmt.Errorf("invalid window options: %w", err)
		}
	}
	a.newWindowMu.Lock()
	fn := a.newWindowFn
	a.newWindowMu.Unlock()
	if fn == nil {
		return fmt.Errorf("multi-window is not supported on %s", runtime.GOOS)
	}
	return fn(opts)
}
