package main

import (
	"bytes"
	"sync"
	"testing"
	"time"
)

func TestPTYLedger_UpsertRenameDormantRemove(t *testing.T) {
	upsertPTYLedger(ptyLedgerEntry{
		ID:           "cc-1",
		Preset:       "cc",
		Dir:          "/tmp/proj",
		CLISessionID: "uuid-1",
		Status:       "running",
	})
	updatePTYLedgerFields("cc-1", "dormant", "auth-fix", true)

	got := readPTYLedger()
	var found *ptyLedgerEntry
	for i := range got {
		if got[i].ID == "cc-1" {
			found = &got[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("expected cc-1 in ledger")
	}
	if found.Status != "dormant" || found.Label != "auth-fix" || found.CLISessionID != "uuid-1" {
		t.Fatalf("unexpected ledger entry: %+v", *found)
	}

	// Process OnExit firing "closed" after PtySleep marked "dormant" must preserve "dormant".
	updatePTYLedgerFields("cc-1", "closed", "", false)
	for _, e := range readPTYLedger() {
		if e.ID == "cc-1" && e.Status != "dormant" {
			t.Fatalf("expected closed update after dormant to preserve dormant, got %q", e.Status)
		}
	}

	removePTYLedger("cc-1")
	for _, e := range readPTYLedger() {
		if e.ID == "cc-1" {
			t.Fatalf("expected cc-1 to be removed")
		}
	}
}

func TestSanitizePTYToken(t *testing.T) {
	if got := sanitizePTYToken("cc-1_abc"); got != "cc-1_abc" {
		t.Fatalf("expected valid token preserved, got %q", got)
	}
	for _, bad := range []string{"", "--resume=evil", "bad token", "a/b", "日本語"} {
		if got := sanitizePTYToken(bad); got != "" {
			t.Fatalf("expected %q to be rejected, got %q", bad, got)
		}
	}
}

func TestPTYBatcher_CoalescesAndFlushes(t *testing.T) {
	var mu sync.Mutex
	var chunks [][]byte
	b := newPTYBatcher(15*time.Millisecond, 10, func(c []byte) {
		mu.Lock()
		chunks = append(chunks, c)
		mu.Unlock()
	})
	b.Push([]byte("abc"))
	b.Push([]byte("def"))
	b.Flush()

	mu.Lock()
	defer mu.Unlock()
	if len(chunks) != 1 || !bytes.Equal(chunks[0], []byte("abcdef")) {
		t.Fatalf("expected 1 coalesced chunk 'abcdef', got %v", chunks)
	}
}
