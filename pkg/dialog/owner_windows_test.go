//go:build windows

package dialog

import (
	"syscall"
	"testing"
	"unsafe"
)

// desktopWindow is a window that always exists and is visible, so the tests need no window of their own.
func desktopWindow(t *testing.T) uintptr {
	t.Helper()
	h, _, _ := user32.NewProc("GetDesktopWindow").Call()
	if h == 0 {
		t.Skip("no desktop window in this session")
	}
	return h
}

// Nothing here shows a dialog: the tests only look at what the dialogs are built with.

func TestOwner(t *testing.T) {
	t.Cleanup(func() { SetOwner(0) })

	SetOwner(0)
	if got := owner(); got != 0 {
		t.Fatalf("nothing set: owner() = %#x, want 0", got)
	}

	SetOwner(0x1234) // not a window
	if got := owner(); got != 0 {
		t.Fatalf("a handle that is not a window must not own a dialog: owner() = %#x", got)
	}

	d := desktopWindow(t)
	SetOwner(d)
	if got := owner(); got != d {
		t.Fatalf("a live visible window must be the owner: owner() = %#x, want %#x", got, d)
	}
}

// The regression itself: the Open and Save dialogs were built with no owner, so they were not modal to the
// application, and clicking the application's window hid them behind it.
func TestFileDialogsAreOwned(t *testing.T) {
	t.Cleanup(func() { SetOwner(0) })
	const fakeOwner = uintptr(0xABCD)

	open, openBuf := newOpenFileName("open", fakeOwner)
	if open.hwndOwner != fakeOwner {
		t.Fatalf("Open dialog owner = %#x, want %#x", open.hwndOwner, fakeOwner)
	}
	if open.flags&ofnExplorer == 0 || open.flags&ofnFileMustExist == 0 {
		t.Fatalf("Open dialog lost its flags: %#x", open.flags)
	}
	if len(openBuf) == 0 || open.lpstrFile != &openBuf[0] || open.nMaxFile != uint32(len(openBuf)) {
		t.Fatal("Open dialog must write the path into the returned buffer")
	}

	save, saveBuf, ext := newSaveFileName("save", "note.txt", fakeOwner)
	if save.hwndOwner != fakeOwner {
		t.Fatalf("Save dialog owner = %#x, want %#x", save.hwndOwner, fakeOwner)
	}
	if save.flags&ofnOverwritePrompt == 0 || save.flags&ofnExplorer == 0 {
		t.Fatalf("Save dialog lost its flags: %#x", save.flags)
	}
	if ext != "txt" {
		t.Fatalf("default extension = %q, want %q", ext, "txt")
	}
	if len(saveBuf) == 0 || saveBuf[0] != 'n' {
		t.Fatal("Save dialog must start with the suggested file name in the buffer")
	}
	if _, _, ext2 := newSaveFileName("save", "noext", 0); ext2 != "md" {
		t.Fatalf("a name without an extension must default to md, got %q", ext2)
	}
}

// The Save dialog opened in the folder of the last Open or Save, not in the folder of the note being saved: a full path in the buffer and
// the initial folder are what make it start where the caller says.
func TestSaveDialogStartsInTheFolderOfAFullPath(t *testing.T) {
	const dir = `C:\Users\me\notes`
	ofn, buf, ext := newSaveFileName("save", dir+`\memo.html`, 0)
	if got := syscall.UTF16ToString(buf); got != dir+`\memo.html` {
		t.Errorf("buffer = %q, want the full path", got)
	}
	if ofn.lpstrInitialDir == nil || syscall.UTF16ToString(unsafe.Slice(ofn.lpstrInitialDir, len(dir)+1)) != dir {
		t.Error("the initial folder is not the folder of the path")
	}
	if ext != "html" {
		t.Errorf("default extension = %q, want html", ext)
	}
	if bare, _, _ := newSaveFileName("save", "memo.md", 0); bare.lpstrInitialDir != nil {
		t.Error("a bare name must not set a folder")
	}
}
