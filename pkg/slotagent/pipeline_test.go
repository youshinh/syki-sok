package slotagent

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// promptEchoAgent is an agent that prints the instruction it is handed (the appended last argument) and nothing else, so what a
// recipe step printed says which step it was.
func promptEchoAgent(t *testing.T) AgentDef {
	t.Helper()
	if runtime.GOOS == "windows" {
		exe, err := exec.LookPath("powershell.exe")
		if err != nil {
			t.Skipf("powershell.exe not available: %v", err)
		}
		return AgentDef{Command: exe, Args: []string{"-NoProfile", "-NonInteractive", "-Command", "& { param($x) Write-Output $x }"}}
	}
	exe, err := exec.LookPath("sh")
	if err != nil {
		t.Skipf("sh not available: %v", err)
	}
	return AgentDef{Command: exe, Args: []string{"-c", `echo "$0"`}}
}

func runRecipe(t *testing.T, rec Recipe, startStep int, approved bool) *PipelineStepResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	engine := NewPipelineEngine(NewRunner())
	return engine.ExecuteRecipe(ctx, "req-pipeline-"+t.Name(), rec, promptEchoAgent(t), "", "", startStep, approved)
}

// A recipe that runs to the end hands back what its LAST step printed. It used to return Completed with no output at all, so
// the caller wrote nothing over the slot and the note kept its "running" mark for good.
func TestExecuteRecipe_CompletedCarriesTheLastStepOutput(t *testing.T) {
	res := runRecipe(t, Recipe{Name: "two", Steps: []string{"first", "second"}}, 0, false)
	if res.Status != PipelineStatusCompleted {
		t.Fatalf("status = %q (%s), want completed", res.Status, res.ErrorMsg)
	}
	if res.Output != "second" {
		t.Errorf("Output = %q, want the last step's output %q", res.Output, "second")
	}
	if res.StepIndex != 2 || res.TotalSteps != 2 {
		t.Errorf("step %d of %d, want 2 of 2", res.StepIndex, res.TotalSteps)
	}
}

// With an approval gate the first run stops after that step (its output plus the gate line); the resumed run starts at the next
// step and its output is the recipe's result.
func TestExecuteRecipe_ResumeAfterTheGateReturnsTheLastStepOutput(t *testing.T) {
	rec := Recipe{Name: "gated", Steps: []string{"one", "two", "three"}, RequiresApprovalStep: 2}

	first := runRecipe(t, rec, 0, false)
	if first.Status != PipelineStatusWaitingApproval {
		t.Fatalf("first run status = %q (%s), want waiting_approval", first.Status, first.ErrorMsg)
	}
	if !strings.HasPrefix(first.Output, "two") || !strings.Contains(first.Output, "// approve") {
		t.Errorf("first run Output = %q, want the step-2 output followed by the gate line", first.Output)
	}

	resumed := runRecipe(t, rec, rec.RequiresApprovalStep, true)
	if resumed.Status != PipelineStatusCompleted {
		t.Fatalf("resumed status = %q (%s), want completed", resumed.Status, resumed.ErrorMsg)
	}
	if resumed.Output != "three" {
		t.Errorf("resumed Output = %q, want %q", resumed.Output, "three")
	}
}

// A gate on the last step has nothing to wait for: the recipe completes with that step's output.
func TestExecuteRecipe_GateOnTheLastStepStillCompletesWithItsOutput(t *testing.T) {
	res := runRecipe(t, Recipe{Name: "last-gate", Steps: []string{"only", "final"}, RequiresApprovalStep: 2}, 0, false)
	if res.Status != PipelineStatusCompleted {
		t.Fatalf("status = %q (%s), want completed", res.Status, res.ErrorMsg)
	}
	if res.Output != "final" {
		t.Errorf("Output = %q, want %q", res.Output, "final")
	}
}

func TestExecuteRecipe_EmptyStepsCompletesImmediately(t *testing.T) {
	res := runRecipe(t, Recipe{Name: "empty", Steps: nil}, 0, false)
	if res.Status != PipelineStatusCompleted || res.TotalSteps != 0 {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestSanitizeGateDesc_TruncatesByRunesPreservingUTF8(t *testing.T) {
	// 31 Japanese characters (> 30 runes and > 90 bytes) plus a newline.
	input := "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ\nま"
	got := sanitizeGateDesc(input)
	if !utf8.ValidString(got) {
		t.Fatalf("sanitizeGateDesc produced invalid UTF-8: %q", got)
	}
	want := "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ..."
	if got != want {
		t.Errorf("sanitizeGateDesc = %q, want %q", got, want)
	}

	// Exactly 30 runes with CRLF should not be truncated.
	exact30 := "あいうえおかきくけこ\r\nさしすせそたちつてとなにぬねのはひふへ"
	if gotExact := sanitizeGateDesc(exact30); !utf8.ValidString(gotExact) || strings.ContainsAny(gotExact, "\r\n") {
		t.Errorf("sanitizeGateDesc(%q) = %q", exact30, gotExact)
	}
}

func TestPipelineHelperProcess(t *testing.T) {
	counterFile := os.Getenv("SYKI_PIPELINE_HELPER_COUNTER")
	if counterFile == "" {
		return
	}
	data, _ := os.ReadFile(counterFile)
	count := len(data) + 1
	_ = os.WriteFile(counterFile, append(data, '1'), 0o644)

	if count == 1 {
		fmt.Print("initial draft")
		os.Exit(0)
	}
	// Second call (Evaluator): sleep until context deadline/cancellation kills it.
	time.Sleep(10 * time.Second)
	os.Exit(0)
}

func TestExecuteRecipe_SelfRefineAbortsOnTimeoutDuringEvaluator(t *testing.T) {
	counterFile := filepath.Join(t.TempDir(), "calls.txt")
	t.Setenv("SYKI_PIPELINE_HELPER_COUNTER", counterFile)

	agentDef := AgentDef{
		Command: os.Args[0],
		Args:    []string{"-test.run=^TestPipelineHelperProcess$", "--", "{instruction}"},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()

	engine := NewPipelineEngine(NewRunner())
	res := engine.ExecuteRecipe(ctx, "req-self-refine-timeout", Recipe{
		Name:       "self-refine",
		Steps:      []string{"generate something"},
		SelfRefine: true,
	}, agentDef, "", "", 0, false)

	if res.Status != PipelineStatusFailed {
		t.Fatalf("status = %q (output=%q), want failed on context deadline", res.Status, res.Output)
	}
	if !strings.Contains(res.ErrorMsg, "タイムアウト") {
		t.Errorf("ErrorMsg = %q, want timeout message", res.ErrorMsg)
	}
	if res.ExitCode != 124 {
		t.Errorf("ExitCode = %d, want 124 on timeout", res.ExitCode)
	}
}

func TestExecuteRecipe_StepFailurePropagatesExitCode(t *testing.T) {
	noAppend := false
	var failAgent AgentDef
	if runtime.GOOS == "windows" {
		exe, err := exec.LookPath("powershell.exe")
		if err != nil {
			t.Skipf("powershell.exe not available: %v", err)
		}
		failAgent = AgentDef{Command: exe, Args: []string{"-NoProfile", "-NonInteractive", "-Command", "exit 7"}, AppendInstruction: &noAppend}
	} else {
		exe, err := exec.LookPath("sh")
		if err != nil {
			t.Skipf("sh not available: %v", err)
		}
		failAgent = AgentDef{Command: exe, Args: []string{"-c", "exit 7"}, AppendInstruction: &noAppend}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	engine := NewPipelineEngine(NewRunner())
	res := engine.ExecuteRecipe(ctx, "req-step-fail", Recipe{
		Name:  "fail-step",
		Steps: []string{"step1"},
	}, failAgent, "", "", 0, false)

	if res.Status != PipelineStatusFailed {
		t.Fatalf("status = %q, want failed", res.Status)
	}
	if res.ExitCode != 7 {
		t.Errorf("ExitCode = %d, want 7", res.ExitCode)
	}
}
