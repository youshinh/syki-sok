package ipc

import (
	"os"
	"testing"
)

// AllowForeground only asks Windows for a right this process may not have (it succeeds for the process the user is working with, and is
// refused for any other): what it must never do is fail loudly, hang, or panic, in either form, on any platform.
func TestAllowForegroundNeverPanics(t *testing.T) {
	AllowForeground(0)            // any process
	AllowForeground(os.Getpid())  // a given one
	AllowForeground(-1)           // a bad value is the same as any
	AllowForeground(1 << 30)      // a process that does not exist
}
