//go:build !windows

package main

// The front app is only looked at on Windows (the macOS side has nothing for it yet; the log of notes and requests works everywhere).

func foregroundSupported() bool { return false }

func foregroundSample() (app, title string, self bool, ok bool) { return "", "", false, false }
