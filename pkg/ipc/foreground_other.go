//go:build !windows

package ipc

// AllowForeground does nothing here: only Windows restricts which process may bring a window to the front.
func AllowForeground(pid int) {}
