//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"

	"syki-sok/pkg/fileassoc"
)

func ownExecutable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolving syki's own executable path: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return exe, nil
}

// FileTypesStatus says whether syki is registered for text files: "no", "yes", or "moved" (registered for a copy of the program
// somewhere else, so double-clicking would start that one: register again).
func (a *App) FileTypesStatus() string {
	exe, err := ownExecutable()
	if err != nil {
		return "no"
	}
	registered, current := fileassoc.Registered(fileassoc.UserRegistry(), exe)
	switch {
	case !registered:
		return "no"
	case current:
		return "yes"
	default:
		return "moved"
	}
}

// RegisterFileTypes lists syki among the programs Windows offers for Markdown, text, log, CSV, HTML and the other types of
// fileassoc.Extensions, for the current user only, and opens Settings at Default apps: Windows lets only the person choose the default.
func (a *App) RegisterFileTypes() error {
	exe, err := ownExecutable()
	if err != nil {
		return err
	}
	if err := fileassoc.Apply(fileassoc.UserRegistry(), exe); err != nil {
		return fmt.Errorf("writing the file types: %w", err)
	}
	fileassoc.Notify()
	return fileassoc.OpenDefaultAppsSettings()
}

// UnregisterFileTypes takes back what RegisterFileTypes wrote.
func (a *App) UnregisterFileTypes() error {
	if err := fileassoc.Remove(fileassoc.UserRegistry()); err != nil {
		return err
	}
	fileassoc.Notify()
	return nil
}
