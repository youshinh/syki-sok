package speech

import (
	"slices"
	"testing"
)

func TestFreeTCPPort(t *testing.T) {
	port, err := freeTCPPort()
	if err != nil {
		t.Fatalf("freeTCPPort failed: %v", err)
	}
	if port <= 1024 || port > 65535 {
		t.Errorf("unexpected port number: %d", port)
	}
}

func TestServerManagerStopWhenInactive(t *testing.T) {
	mgr := &ServerManager{}
	mgr.Stop() // Should not panic or fail
	if mgr.port != 0 || mgr.baseURL != "" || mgr.wsURL != "" {
		t.Errorf("expected clean state after stop, got %+v", mgr)
	}
}

func TestBuildSpeechServerArgs_NoWildcardCORS(t *testing.T) {
	args := buildSpeechServerArgs("model.gguf", "vad.gguf", 18080, 4)
	if slices.Contains(args, "--cors-origin") || slices.Contains(args, "*") {
		t.Fatalf("unexpected wildcard CORS flag in speech server args: %v", args)
	}
}
