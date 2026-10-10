package ipc

import (
	"fmt"
	"os"
	"testing"

	"syki-sok/pkg/appdir"
)

// TestMain redirects the session file into a temp directory for the whole package. Without
// it StartServer writes GetSessionFilePath() - the real %AppData%\syki-sok\ipc-session.json -
// on every run, which clobbers the session of an syki::sok instance the developer has open and
// makes its CLI handoff point at a port that died with the test binary.
func TestMain(m *testing.M) {
	tempRoot, err := os.MkdirTemp("", "syki-ipc-test-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create temp config dir for tests: %v\n", err)
		os.Exit(1)
	}
	appdir.SetConfigDirOverride(tempRoot)

	code := m.Run()

	appdir.SetConfigDirOverride("")
	_ = os.RemoveAll(tempRoot)
	os.Exit(code)
}
