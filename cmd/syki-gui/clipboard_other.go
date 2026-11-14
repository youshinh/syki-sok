//go:build !windows && !darwin

package main

import "errors"

func copyPNGToClipboardNative(string) error {
	return errors.New("native PNG clipboard copy is not supported on this platform")
}
