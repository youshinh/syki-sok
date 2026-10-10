package slotagent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// SkillInfo contains metadata and instructions extracted from a skill definition file.
type SkillInfo struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Description string `json:"description"`
	Instruction string `json:"instruction,omitempty"`
	RawContent  string `json:"rawContent,omitempty"`
}

// ExtractSkillInstruction extracts markdown instruction content from a SKILL.md file,
// safely removing YAML frontmatter (between first and second ---) if present.
func ExtractSkillInstruction(content string) string {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "---") {
		return trimmed
	}

	// Find the closing --- of YAML frontmatter
	rest := trimmed[3:]
	closingIdx := strings.Index(rest, "\n---")
	if closingIdx == -1 {
		return trimmed
	}

	body := rest[closingIdx+4:]
	// Strip optional newline following closing delimiter
	body = strings.TrimPrefix(body, "\r\n")
	body = strings.TrimPrefix(body, "\n")
	return strings.TrimSpace(body)
}

// ExtractSkillDescription extracts description field from YAML frontmatter if present,
// or returns the first non-empty line of the instruction body.
func ExtractSkillDescription(content string) string {
	trimmed := strings.TrimSpace(content)
	if strings.HasPrefix(trimmed, "---") {
		rest := trimmed[3:]
		closingIdx := strings.Index(rest, "\n---")
		if closingIdx != -1 {
			fm := rest[:closingIdx]
			for _, line := range strings.Split(fm, "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "description:") {
					desc := strings.TrimPrefix(line, "description:")
					desc = strings.Trim(strings.TrimSpace(desc), "\"'")
					if desc != "" {
						return desc
					}
				}
			}
		}
	}
	instruction := ExtractSkillInstruction(content)
	for _, line := range strings.Split(instruction, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			if len(line) > 60 {
				return line[:60] + "..."
			}
			return line
		}
	}
	return ""
}

// ListAvailableSkills scans candidate skill directories and returns all unique skills.
func ListAvailableSkills(rootDir string) []SkillInfo {
	var searchDirs []string
	if rootDir != "" {
		searchDirs = append(searchDirs,
			filepath.Join(rootDir, "skills"),
			filepath.Join(rootDir, ".gemini", "skills"),
			filepath.Join(rootDir, ".claude", "skills"),
		)
	}

	if home, err := os.UserHomeDir(); err == nil && home != "" {
		searchDirs = append(searchDirs,
			filepath.Join(home, ".gemini", "antigravity", "skills"),
			filepath.Join(home, ".gemini", "config", "skills"),
			filepath.Join(home, ".gemini", "skills"),
			filepath.Join(home, ".claude", "skills"),
			filepath.Join(home, ".syki", "skills"),
			filepath.Join(home, ".syki-sok", "skills"),
			filepath.Join(home, ".syki", "skills"),
			filepath.Join(home, "skills"),
		)
	}

	seen := make(map[string]bool)
	var result []SkillInfo

	for _, dir := range searchDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			entryName := entry.Name()
			if entry.IsDir() {
				// Subdirectory skill: <dir>/<skillName>/SKILL.md or README.md
				skillName := entryName
				if seen[skillName] {
					continue
				}

				targetFiles := []string{
					filepath.Join(dir, entryName, "SKILL.md"),
					filepath.Join(dir, entryName, "skill.md"),
					filepath.Join(dir, entryName, "README.md"),
				}
				for _, tf := range targetFiles {
					if fi, err := os.Stat(tf); err == nil && !fi.IsDir() {
						if data, err := os.ReadFile(tf); err == nil {
							raw := string(data)
							desc := ExtractSkillDescription(raw)
							inst := ExtractSkillInstruction(raw)
							result = append(result, SkillInfo{
								Name:        skillName,
								Path:        tf,
								Description: desc,
								Instruction: inst,
								RawContent:  raw,
							})
							seen[skillName] = true
							break
						}
					}
				}
			} else if strings.HasSuffix(entryName, ".md") {
				// Single file skill: <dir>/<skillName>.md (exclude README.md)
				base := strings.TrimSuffix(entryName, ".md")
				if strings.EqualFold(base, "readme") || seen[base] {
					continue
				}

				tf := filepath.Join(dir, entryName)
				if data, err := os.ReadFile(tf); err == nil {
					raw := string(data)
					desc := ExtractSkillDescription(raw)
					inst := ExtractSkillInstruction(raw)
					result = append(result, SkillInfo{
						Name:        base,
						Path:        tf,
						Description: desc,
						Instruction: inst,
						RawContent:  raw,
					})
					seen[base] = true
				}
			}
		}
	}

	return result
}

// FindSkillInstruction searches for a skill definition file under rootDir and returns its body instructions.
// Search candidates (in order):
// 1. skills/<skillName>/SKILL.md
// 2. skills/<skillName>.md
// 3. skills/<skillName>/README.md
// 4. .gemini/skills/<skillName>/SKILL.md
// 5. .claude/skills/<skillName>/SKILL.md
func FindSkillInstruction(rootDir, skillName string) (*SkillInfo, error) {
	cleanName := strings.TrimSpace(skillName)
	cleanName = strings.TrimPrefix(cleanName, "@")
	cleanName = strings.TrimPrefix(cleanName, "/")
	cleanName = strings.TrimSpace(cleanName)
	if cleanName == "" {
		return nil, fmt.Errorf("skill name is empty")
	}

	candidates := []string{
		filepath.Join(rootDir, "skills", cleanName, "SKILL.md"),
		filepath.Join(rootDir, "skills", cleanName+".md"),
		filepath.Join(rootDir, "skills", cleanName, "README.md"),
		filepath.Join(rootDir, ".gemini", "skills", cleanName, "SKILL.md"),
		filepath.Join(rootDir, ".claude", "skills", cleanName, "SKILL.md"),
	}

	// Also search user's home directory for global / service skills (Antigravity, Gemini, Claude, local account skills)
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".gemini", "antigravity", "skills", cleanName, "SKILL.md"),
			filepath.Join(home, ".gemini", "config", "skills", cleanName, "SKILL.md"),
			filepath.Join(home, ".gemini", "skills", cleanName, "SKILL.md"),
			filepath.Join(home, ".claude", "skills", cleanName, "SKILL.md"),
			filepath.Join(home, ".syki", "skills", cleanName, "SKILL.md"),
			filepath.Join(home, ".syki-sok", "skills", cleanName, "SKILL.md"),
			filepath.Join(home, ".syki", "skills", cleanName, "SKILL.md"),
			filepath.Join(home, "skills", cleanName, "SKILL.md"),
		)
	}

	var foundPath string
	for _, cand := range candidates {
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
			foundPath = cand
			break
		}
	}

	if foundPath == "" {
		return nil, fmt.Errorf("skill '%s' not found (searched in skills/%s/SKILL.md)", cleanName, cleanName)
	}

	data, err := os.ReadFile(foundPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read skill file %s: %w", foundPath, err)
	}

	raw := string(data)
	instruction := ExtractSkillInstruction(raw)
	desc := ExtractSkillDescription(raw)

	return &SkillInfo{
		Name:        cleanName,
		Path:        foundPath,
		Description: desc,
		Instruction: instruction,
		RawContent:  raw,
	}, nil
}
