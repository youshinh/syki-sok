// Package fileassoc makes syki one of the programs Windows offers for text files (Open with, and the Default apps list of Settings).
//
// It writes only under HKEY_CURRENT_USER, so no administrator rights are needed and nothing outside the current user changes.
// Windows 10 and 11 do not let a program make itself the default for a type (the choice is protected by a hash only Settings can
// write), so this registers what the person then picks in Default apps; it never takes a type from the program that has it.
//
// The registry is reached through the Writer interface: the keys and values are pinned by tests that use a fake, and the real
// registry is only touched when the person presses the button in Settings (registry_windows.go).
package fileassoc

import (
	"path/filepath"
	"sort"
	"strings"
)

// Extensions are the file types syki offers to open: Markdown and plain text, logs and tables, data and config files, web pages,
// and source code. The macOS Info.plist (build_mac.sh) lists the same ones; a test keeps the two together.
var Extensions = []string{
	"md", "markdown", "txt", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "xml", "ini", "cfg", "conf", "env",
	"html", "htm", "css", "js", "ts", "sql", "sh", "py", "go", "rs", "c", "cpp", "h",
}

const (
	// ProgID is the name of syki's file type in the registry.
	ProgID = "syki.textfile"
	// AppKey is syki's own key under Software (its Capabilities are what the Default apps list reads).
	AppKey = `Software\syki`
	// AppName is the name Windows shows.
	AppName = "syki"

	classes      = `Software\Classes`
	registeredKy = `Software\RegisteredApplications`
	capabilities = AppKey + `\Capabilities`
)

// Writer is the part of the registry this package uses. Keys are under HKEY_CURRENT_USER; a name of "" is the key's default value.
type Writer interface {
	Set(key, name, data string) error
	Get(key, name string) (string, bool)
	DeleteValue(key, name string) error
	DeleteKey(key string) error
}

type value struct{ key, name, data string }

func plan(exe string) []value {
	progKey := classes + `\` + ProgID
	vals := []value{
		{progKey, "", "syki document"},
		{progKey + `\DefaultIcon`, "", `"` + exe + `",0`},
		{progKey + `\shell\open\command`, "", `"` + exe + `" "%1"`},
		{capabilities, "ApplicationName", AppName},
		{capabilities, "ApplicationDescription", "Markdown scratchpad"},
		{registeredKy, AppName, capabilities},
	}
	for _, ext := range Extensions {
		vals = append(vals,
			value{capabilities + `\FileAssociations`, "." + ext, ProgID},
			value{classes + `\.` + ext + `\OpenWithProgids`, ProgID, ""},
		)
	}
	return vals
}

// Apply registers syki for Extensions. exe is the full path of the program; it is written into the registry, so a program that
// moves has to register again.
func Apply(w Writer, exe string) error {
	exe = filepath.Clean(exe)
	for _, v := range plan(exe) {
		if err := w.Set(v.key, v.name, v.data); err != nil {
			return err
		}
	}
	return nil
}

// Remove takes back everything Apply wrote. The values added to other types' OpenWithProgids go one by one (the keys are the
// system's and other programs'); the keys syki owns go whole.
func Remove(w Writer) error {
	for _, ext := range Extensions {
		_ = w.DeleteValue(classes+`\.`+ext+`\OpenWithProgids`, ProgID)
	}
	_ = w.DeleteValue(registeredKy, AppName)
	var owned []string
	for _, v := range plan("") {
		if strings.HasPrefix(v.key, classes+`\`+ProgID) || strings.HasPrefix(v.key, AppKey) {
			owned = append(owned, v.key)
		}
	}
	sort.Slice(owned, func(i, j int) bool { return len(owned[i]) > len(owned[j]) }) // the deepest key first
	seen := map[string]bool{}
	for _, k := range owned {
		if seen[k] {
			continue
		}
		seen[k] = true
		_ = w.DeleteKey(k)
	}
	_ = w.DeleteKey(AppKey) // the parent of Capabilities
	return nil
}

// Registered reports whether syki is registered, and whether the registered program is exe (a moved program shows false).
func Registered(w Writer, exe string) (registeredAtAll, current bool) {
	cmd, ok := w.Get(classes+`\`+ProgID+`\shell\open\command`, "")
	if !ok {
		return false, false
	}
	return true, cmd == `"`+filepath.Clean(exe)+`" "%1"`
}
