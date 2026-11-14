//go:build darwin

package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func copyPNGToClipboardNative(dataURL string) error {
	s := strings.TrimSpace(dataURL)
	if idx := strings.Index(s, ";base64,"); idx >= 0 {
		s = s[idx+len(";base64,"):]
	}
	if s == "" {
		return errors.New("empty PNG payload")
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return fmt.Errorf("decode base64 PNG: %w", err)
	}
	tmp, err := os.CreateTemp("", "syki-clip-*.png")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	script := fmt.Sprintf(`set the clipboard to (read (POSIX file %q) as «class PNGf»)`, tmpPath)
	return exec.Command("osascript", "-e", script).Run()
}
