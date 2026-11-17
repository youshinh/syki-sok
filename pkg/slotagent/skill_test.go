package slotagent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindSkillInstruction_ValidAndTraversal(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, "skills", "demo")
	if err := os.MkdirAll(skillDir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("# Demo Skill"), 0644); err != nil {
		t.Fatalf("write skill: %v", err)
	}
	// File outside skills/ that must never be reachable via traversal.
	if err := os.WriteFile(filepath.Join(root, "secret.md"), []byte("SECRET"), 0644); err != nil {
		t.Fatalf("write secret: %v", err)
	}

	info, err := FindSkillInstruction(root, "@demo")
	if err != nil {
		t.Fatalf("expected valid skill to load, got error: %v", err)
	}
	if info.Instruction != "# Demo Skill" {
		t.Fatalf("unexpected skill content: %q", info.Instruction)
	}

	badNames := []string{
		"../../secret",
		"@../secret",
		"/../secret",
		`..\secret`,
		"a/b",
		`a\b`,
		".",
		"..",
	}
	for _, name := range badNames {
		if _, err := FindSkillInstruction(root, name); err == nil {
			t.Errorf("FindSkillInstruction(%q) should reject traversal/path separators", name)
		}
	}
}
