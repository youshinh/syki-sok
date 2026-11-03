package speech

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"syki-sok/pkg/procutil"
)

const (
	serverIdleTimeout = 5 * time.Minute
	healthCheckWait   = 50 * time.Millisecond
	serverStartWait   = 5 * time.Second
)

type ServerManager struct {
	mu         sync.Mutex
	cmd        *exec.Cmd
	port       int
	idleTimer  *time.Timer
	baseURL    string
	wsURL      string
	healthClient *http.Client
}

var globalServer = &ServerManager{
	healthClient: &http.Client{Timeout: 500 * time.Millisecond},
}

func GetServerManager() *ServerManager {
	return globalServer
}

func (m *ServerManager) EnsureServer(ctx context.Context, exe, modelPath, vadModelPath string, threads int) (baseURL string, wsURL string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.resetIdleTimerLocked()

	if m.cmd != nil && m.cmd.Process != nil && m.isHealthyLocked() {
		return m.baseURL, m.wsURL, nil
	}

	// Find free port
	port, err := freeTCPPort()
	if err != nil {
		return "", "", fmt.Errorf("空きポートを取得できません: %w", err)
	}

	args := []string{"serve", modelPath}
	if vadModelPath != "" {
		args = append(args, vadModelPath)
	}
	args = append(args, "--port", strconv.Itoa(port), "--device", "cpu", "--cors-origin", "*", "--no-warmup")
	if threads > 0 {
		args = append(args, "--threads", strconv.Itoa(threads))
	}

	cmd := exec.CommandContext(context.Background(), exe, args...)
	cmd.Dir = filepath.Dir(exe)
	procutil.HideWindow(cmd)

	if err := cmd.Start(); err != nil {
		return "", "", fmt.Errorf("speech server の起動に失敗しました: %w", err)
	}

	m.cmd = cmd
	m.port = port
	m.baseURL = fmt.Sprintf("http://127.0.0.1:%d", port)
	m.wsURL = fmt.Sprintf("ws://127.0.0.1:%d/v1/realtime", port)

	// Wait for health check
	deadline := time.Now().Add(serverStartWait)
	started := false
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			m.stopLocked()
			return "", "", ctx.Err()
		}
		if m.isHealthyLocked() {
			started = true
			break
		}
		time.Sleep(healthCheckWait)
	}

	if !started {
		m.stopLocked()
		return "", "", fmt.Errorf("speech server が時間内に起動しませんでした (port %d)", port)
	}

	return m.baseURL, m.wsURL, nil
}

func (m *ServerManager) isHealthyLocked() bool {
	if m.port == 0 {
		return false
	}
	resp, err := m.healthClient.Get(fmt.Sprintf("http://127.0.0.1:%d/health", m.port))
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func (m *ServerManager) resetIdleTimerLocked() {
	if m.idleTimer != nil {
		m.idleTimer.Stop()
	}
	m.idleTimer = time.AfterFunc(serverIdleTimeout, func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		m.stopLocked()
	})
}

func (m *ServerManager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked()
}

func (m *ServerManager) stopLocked() {
	if m.idleTimer != nil {
		m.idleTimer.Stop()
		m.idleTimer = nil
	}
	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
		_ = m.cmd.Wait()
		m.cmd = nil
	}
	m.port = 0
	m.baseURL = ""
	m.wsURL = ""
}

func freeTCPPort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}
