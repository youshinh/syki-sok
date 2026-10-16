//go:build windows

package fileassoc

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows/registry"
)

// userRegistry is the current user's part of the registry (HKEY_CURRENT_USER).
type userRegistry struct{}

// UserRegistry is the Writer for the real registry.
func UserRegistry() Writer { return userRegistry{} }

func (userRegistry) Set(key, name, data string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, key, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue(name, data)
}

func (userRegistry) Get(key, name string) (string, bool) {
	k, err := registry.OpenKey(registry.CURRENT_USER, key, registry.QUERY_VALUE)
	if err != nil {
		return "", false
	}
	defer k.Close()
	s, _, err := k.GetStringValue(name)
	return s, err == nil
}

func (userRegistry) DeleteValue(key, name string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, key, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.DeleteValue(name)
}

func (userRegistry) DeleteKey(key string) error { return registry.DeleteKey(registry.CURRENT_USER, key) }

// Notify tells the shell that the associations changed, so Explorer and the Open with list pick them up without a restart.
func Notify() {
	const shcneAssocChanged, shcnfIDList = 0x08000000, 0
	shChangeNotify := syscall.NewLazyDLL("shell32.dll").NewProc("SHChangeNotify")
	shChangeNotify.Call(shcneAssocChanged, shcnfIDList, 0, 0)
}

// OpenDefaultAppsSettings opens Windows Settings at Default apps, where the person picks syki for a type.
func OpenDefaultAppsSettings() error {
	return exec.Command("explorer.exe", "ms-settings:defaultapps").Start()
}
