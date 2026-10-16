package fileassoc

import (
	"strings"
	"testing"
)

type fakeReg struct{ vals map[string]string }

func newFake() *fakeReg                       { return &fakeReg{vals: map[string]string{}} }
func (f *fakeReg) id(k, n string) string      { return k + "|" + n }
func (f *fakeReg) Set(k, n, d string) error   { f.vals[f.id(k, n)] = d; return nil }
func (f *fakeReg) Get(k, n string) (string, bool) {
	d, ok := f.vals[f.id(k, n)]
	return d, ok
}
func (f *fakeReg) DeleteValue(k, n string) error { delete(f.vals, f.id(k, n)); return nil }
func (f *fakeReg) DeleteKey(k string) error {
	for id := range f.vals {
		if strings.HasPrefix(id, k+"|") || strings.HasPrefix(id, k+`\`) {
			delete(f.vals, id)
		}
	}
	return nil
}

const exe = `C:\Tools\syki\syki.exe`

func TestApplyRegistersTheTypeTheCommandAndEveryExtension(t *testing.T) {
	f := newFake()
	if err := Apply(f, exe); err != nil {
		t.Fatal(err)
	}
	if got, _ := f.Get(`Software\Classes\syki.textfile\shell\open\command`, ""); got != `"C:\Tools\syki\syki.exe" "%1"` {
		t.Errorf("the open command = %q", got)
	}
	for _, ext := range []string{"md", "html", "log", "csv", "txt", "json"} {
		if _, ok := f.Get(`Software\Classes\.`+ext+`\OpenWithProgids`, ProgID); !ok {
			t.Errorf(".%s is not in the Open with list", ext)
		}
		if got, _ := f.Get(`Software\syki\Capabilities\FileAssociations`, "."+ext); got != ProgID {
			t.Errorf(".%s is not a capability of syki", ext)
		}
	}
	if got, _ := f.Get(`Software\RegisteredApplications`, "syki"); got != `Software\syki\Capabilities` {
		t.Errorf("syki is not in the Default apps list: %q", got)
	}
	// Everything stays under Software, and no type's own default program is written: only syki's name goes into OpenWithProgids.
	for id := range f.vals {
		if !strings.HasPrefix(id, `Software\`) {
			t.Errorf("a key outside Software: %s", id)
		}
		if strings.Contains(id, `\OpenWithProgids|`) && !strings.HasSuffix(id, "|"+ProgID) {
			t.Errorf("a value other than syki's in OpenWithProgids: %s", id)
		}
	}
	if reg, cur := Registered(f, exe); !reg || !cur {
		t.Errorf("Registered = %v, %v after Apply", reg, cur)
	}
	if reg, cur := Registered(f, `D:\Elsewhere\syki.exe`); !reg || cur {
		t.Errorf("a program that moved must show registered but not current, got %v, %v", reg, cur)
	}
}

func TestRemoveTakesBackEverythingAndOnlyThat(t *testing.T) {
	f := newFake()
	// Another program's association of .md must survive.
	f.Set(`Software\Classes\.md\OpenWithProgids`, "other.md", "")
	f.Set(`Software\Classes\.md`, "", "other.md")
	if err := Apply(f, exe); err != nil {
		t.Fatal(err)
	}
	if err := Remove(f); err != nil {
		t.Fatal(err)
	}
	for id := range f.vals {
		if strings.Contains(id, "syki") || strings.HasSuffix(id, "|"+ProgID) {
			t.Errorf("left behind: %s", id)
		}
	}
	if _, ok := f.Get(`Software\Classes\.md\OpenWithProgids`, "other.md"); !ok {
		t.Error("another program's Open with entry was removed")
	}
	if got, _ := f.Get(`Software\Classes\.md`, ""); got != "other.md" {
		t.Error("the default program of .md was touched")
	}
	if reg, _ := Registered(f, exe); reg {
		t.Error("still registered after Remove")
	}
}

func TestExtensionsAreLowerCaseAndUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, e := range Extensions {
		if e != strings.ToLower(e) || strings.HasPrefix(e, ".") || seen[e] {
			t.Errorf("bad or repeated extension %q", e)
		}
		seen[e] = true
	}
	for _, must := range []string{"md", "markdown", "txt", "log", "csv", "html", "htm"} {
		if !seen[must] {
			t.Errorf("%s is missing", must)
		}
	}
}
