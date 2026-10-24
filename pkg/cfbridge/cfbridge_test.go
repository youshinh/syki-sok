package cfbridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestClient_Verify(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret123" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "memos": []Memo{}})
	}))
	defer ts.Close()

	cGood := New(ts.URL, "secret123")
	if err := cGood.Verify(context.Background()); err != nil {
		t.Fatalf("expected verify success, got: %v", err)
	}

	cBad := New(ts.URL, "wrong")
	if err := cBad.Verify(context.Background()); err == nil {
		t.Fatalf("expected verify failure for bad token, got nil")
	}
}

func TestClient_FetchAndDelete(t *testing.T) {
	var mu sync.Mutex
	memos := []Memo{
		{ID: "m1", TextContent: "Note 1", Device: "Pixel 9"},
		{ID: "m2", TextContent: "Note 2", Device: "Pixel 9"},
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()

		if r.Method == "GET" && r.URL.Path == "/api/memos" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "memos": memos})
			return
		}

		if r.Method == "DELETE" && r.URL.Path == "/api/memos" {
			var body struct {
				IDs []string `json:"ids"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			memos = nil // wiped
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "deleted": len(body.IDs)})
			return
		}

		http.NotFound(w, r)
	}))
	defer ts.Close()

	client := New(ts.URL, "token")
	fetched, err := client.FetchMemos(context.Background())
	if err != nil {
		t.Fatalf("fetch error: %v", err)
	}
	if len(fetched) != 2 {
		t.Fatalf("expected 2 memos, got %d", len(fetched))
	}

	deleted, err := client.DeleteMemos(context.Background(), []string{"m1", "m2"})
	if err != nil {
		t.Fatalf("delete error: %v", err)
	}
	if deleted != 2 {
		t.Fatalf("expected 2 deleted, got %d", deleted)
	}

	// Verify wiped
	after, err := client.FetchMemos(context.Background())
	if err != nil {
		t.Fatalf("after fetch error: %v", err)
	}
	if len(after) != 0 {
		t.Fatalf("expected 0 memos after deletion, got %d", len(after))
	}
}

func TestPoller_Loop(t *testing.T) {
	var mu sync.Mutex
	memos := []Memo{
		{ID: "m1", TextContent: "Hello from phone", Device: "Pixel"},
	}
	deletedCount := 0

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()

		if r.Method == "GET" && r.URL.Path == "/api/memos" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "memos": memos})
			return
		}
		if r.Method == "DELETE" && r.URL.Path == "/api/memos" {
			var body struct {
				IDs []string `json:"ids"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			deletedCount += len(body.IDs)
			memos = nil
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "deleted": len(body.IDs)})
			return
		}
	}))
	defer ts.Close()

	received := make(chan []Memo, 1)
	p := NewPoller(Config{
		Endpoint:        ts.URL,
		Token:           "test",
		IntervalSeconds: 10,
		OnMemos: func(m []Memo) error {
			received <- m
			return nil
		},
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	p.Start(ctx)

	select {
	case m := <-received:
		if len(m) != 1 || m[0].ID != "m1" {
			t.Fatalf("unexpected memos received: %v", m)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for memos")
	}

	p.Stop()

	mu.Lock()
	if deletedCount != 1 {
		t.Fatalf("expected 1 deleted memo, got %d", deletedCount)
	}
	mu.Unlock()
}
