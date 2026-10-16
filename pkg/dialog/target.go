package dialog

import "path/filepath"

// SplitSaveTarget separates what the Save dialogs are given as the suggested name. A bare file name ("note.md") has no folder: the
// dialog starts wherever the system last had one open (the folder of the last Open or Save, whichever program). A full path
// ("C:\notes\note.md") says where the dialog starts and what the name is, so a note opened from a folder is saved as in that
// folder, and a new note starts in the folder the person chose for new notes instead of the last one browsed.
func SplitSaveTarget(target string) (dir, name string) {
	if target != "" && filepath.IsAbs(target) {
		return filepath.Dir(target), filepath.Base(target)
	}
	return "", target
}
