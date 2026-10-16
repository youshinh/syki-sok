//go:build !windows

package fileassoc

import "errors"

// ErrUnsupported: on macOS the types are declared in the app bundle's Info.plist (build_mac.sh) and chosen in Finder (Get Info, Open with).
var ErrUnsupported = errors.New("file types are chosen in the system on this OS")

// UserRegistry has no registry to write to here.
func UserRegistry() Writer { return nil }

// Notify does nothing here.
func Notify() {}

// OpenDefaultAppsSettings is not available here.
func OpenDefaultAppsSettings() error { return ErrUnsupported }
