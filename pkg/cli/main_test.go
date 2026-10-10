package cli

import (
	"fmt"
	"os"
	"testing"

	"syki-sok/pkg/appdir"
)

// TestMain makes the package's tests hermetic. The commands under test read config.json, the IPC
// session file and the scraps folder from the per-user directories, which are the developer's real
// %AppData%\syki-sok and ~/Documents/syki-sok unless redirected: without this, `syki info` ran
// against the machine's own settings, and the ocr tests read the real config.json. Both roots go
// into one temp folder for the whole run; a test that needs its own layout redirects them again
// (see withTempHome in scrapcmd_test.go).
func TestMain(m *testing.M) {
	root, err := os.MkdirTemp("", "syki-cli-test-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create a temp home for the tests: %v\n", err)
		os.Exit(1)
	}
	appdir.SetConfigDirOverride(root)
	appdir.SetHomeDirOverride(root)

	code := m.Run()

	appdir.SetConfigDirOverride("")
	appdir.SetHomeDirOverride("")
	_ = os.RemoveAll(root)
	os.Exit(code)
}
