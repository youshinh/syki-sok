package search

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func stressScaleFactor() int {
	if os.Getenv("SYKI_STRESS") == "1" {
		return 1
	}
	return 0
}

// writeStressCorpus writes fileCount deterministic Markdown notes across daily names and subdirs.
func writeStressCorpus(tb testing.TB, dir string, fileCount, linesPerFile int) {
	tb.Helper()
	var bodyBuilder strings.Builder
	for l := 0; l < linesPerFile; l++ {
		if l%15 == 0 {
			bodyBuilder.WriteString(fmt.Sprintf("## Entry %d\n<!-- tags: work, stress -->\n", l/15+1))
		}
		bodyBuilder.WriteString("定常ノート行: bamboo grows rapidly and needs clear layout verification.\n")
	}
	baseBody := bodyBuilder.String()

	for i := 0; i < fileCount; i++ {
		month := (i/28)%12 + 1
		day := (i % 28) + 1
		rel := fmt.Sprintf("2026-%02d-%02d_%04d.md", month, day, i)
		if i%3 == 0 {
			rel = filepath.Join(fmt.Sprintf("sub/%02d", i%10), rel)
		}
		full := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			tb.Fatal(err)
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("# 2026-%02d-%02d Note %d\n<!-- tags: work, stress -->\n\n", month, day, i))
		if i%25 == 0 {
			sb.WriteString("SYKI_NEEDLE_ALPHA 竹林設計 の検証対象行\n")
		}
		sb.WriteString(baseBody)
		if err := os.WriteFile(full, []byte(sb.String()), 0o644); err != nil {
			tb.Fatal(err)
		}
	}
}

func TestSearchStress_HighVolumeAndConcurrentCancel(t *testing.T) {
	fileCount := 300
	if stressScaleFactor() > 0 {
		fileCount = 2000
	}
	dir := t.TempDir()
	writeStressCorpus(t, dir, fileCount, 40)

	runtime.GC()
	baseGoroutines := runtime.NumGoroutine()

	const workers = 16
	var wg sync.WaitGroup
	var errCount int64
	var panicCount int64
	var emptyNonCancel int64

	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			defer func() {
				if recover() != nil {
					atomic.AddInt64(&panicCount, 1)
				}
			}()

			shouldCancel := id%2 == 1
			var ctx context.Context
			var cancel context.CancelFunc
			if shouldCancel {
				ctx, cancel = context.WithTimeout(context.Background(), time.Duration(1+(id%5))*time.Millisecond)
			} else {
				ctx, cancel = context.WithCancel(context.Background())
			}
			defer cancel()

			switch id % 5 {
			case 0:
				res, err := SearchScrapsContext(ctx, dir, "SYKI_NEEDLE_ALPHA", 50)
				if !shouldCancel {
					if err != nil {
						atomic.AddInt64(&errCount, 1)
					} else if len(res) == 0 {
						atomic.AddInt64(&emptyNonCancel, 1)
					}
				}
			case 1:
				res, err := SearchScrapsRanked(ctx, dir, "竹林設計 検証対象", 50, Options{})
				if !shouldCancel {
					if err != nil {
						atomic.AddInt64(&errCount, 1)
					} else if len(res) == 0 {
						atomic.AddInt64(&emptyNonCancel, 1)
					}
				}
			case 2:
				res, err := SearchScrapsWithFallback(ctx, dir, "SYKI_NEEDLE_ALPHA", 50)
				if !shouldCancel {
					if err != nil {
						atomic.AddInt64(&errCount, 1)
					} else if len(res) == 0 {
						atomic.AddInt64(&emptyNonCancel, 1)
					}
				}
			case 3:
				res, err := SearchScrapsOrdered(ctx, dir, "竹林設計", 50, Options{Headings: true, Tags: []string{"work"}})
				if !shouldCancel {
					if err != nil {
						atomic.AddInt64(&errCount, 1)
					} else if len(res) == 0 {
						atomic.AddInt64(&emptyNonCancel, 1)
					}
				}
			case 4:
				tags, err := CollectTags(ctx, dir)
				if !shouldCancel {
					if err != nil {
						atomic.AddInt64(&errCount, 1)
					} else {
						foundWork := false
						for _, tc := range tags {
							if tc.Tag == "work" && tc.Files == fileCount {
								foundWork = true
							}
						}
						if !foundWork {
							atomic.AddInt64(&emptyNonCancel, 1)
						}
					}
				}
			}
		}(w)
	}

	wg.Wait()
	if panicCount != 0 {
		t.Fatalf("observed %d panic(s) in concurrent search/tag workers", panicCount)
	}
	if errCount != 0 {
		t.Fatalf("observed %d unexpected error(s) in non-cancelled workers", errCount)
	}
	if emptyNonCancel != 0 {
		t.Fatalf("observed %d empty/unexpected result(s) in non-cancelled workers", emptyNonCancel)
	}

	time.Sleep(50 * time.Millisecond)
	runtime.GC()
	afterGoroutines := runtime.NumGoroutine()
	if afterGoroutines > baseGoroutines+15 {
		t.Fatalf("goroutine leak suspected: before=%d after=%d", baseGoroutines, afterGoroutines)
	}
}

func TestSearchStress_PathologicalShapes(t *testing.T) {
	// 1. Single giant 1MB line with no newlines + tail needle
	giantLine := strings.Repeat("a", 1024*1024) + " SYKI_GIANT_TAIL"
	// 2. 60,000 short lines with needle near the end
	var lines60k strings.Builder
	for i := 1; i <= 60000; i++ {
		if i == 59990 {
			lines60k.WriteString("line 59990 SYKI_LINE_HIT\n")
		} else {
			lines60k.WriteString("short line content for stress test\n")
		}
	}
	// 3. 5,000 headings + periodic tag comments
	var headings5k strings.Builder
	for i := 0; i < 5000; i++ {
		if i%10 == 0 {
			headings5k.WriteString(fmt.Sprintf("# Section %d\n<!-- tags: stress_tag -->\nbody %d\n", i, i))
		} else {
			headings5k.WriteString(fmt.Sprintf("## Sub %d\nbody %d\n", i, i))
		}
	}
	// 4. Mixed CRLF, blank lines, and unclosed HTML comment
	mixed := "first line\r\n\r\n<!-- unclosed comment stays open\r\n\r\nSYKI_MIXED_HIT\r\n"

	shapes := []struct {
		name      string
		file      string
		content   string
		query     string
		wantMatch bool
		wantTags  bool
		wantMinE  int
	}{
		{"giant_single_line", "2026-10-01.md", giantLine, "SYKI_GIANT_TAIL", true, false, 1},
		{"many_lines_60k", "2026-10-02.md", lines60k.String(), "SYKI_LINE_HIT", true, false, 1},
		{"heading_dense_5k", "2026-10-03.md", headings5k.String(), "Section 4990", true, true, 5000},
		{"mixed_crlf_unclosed", "2026-10-04.md", mixed, "SYKI_MIXED_HIT", true, true, 1},
	}

	for _, sh := range shapes {
		t.Run(sh.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, sh.file), []byte(sh.content), 0o644); err != nil {
				t.Fatal(err)
			}

			res, err := SearchScrapsContext(context.Background(), dir, sh.query, 20)
			if err != nil {
				t.Fatalf("SearchScrapsContext failed: %v", err)
			}
			if sh.wantMatch && len(res) == 0 {
				t.Fatalf("SearchScrapsContext expected match for %q, got none", sh.query)
			}

			if _, err := SearchScrapsRanked(context.Background(), dir, sh.query, 20, Options{}); err != nil {
				t.Fatalf("SearchScrapsRanked failed: %v", err)
			}

			data := []byte(sh.content)
			tm := ScanTags(data)
			if sh.wantTags && tm == nil {
				t.Fatalf("ScanTags returned nil despite comment/tag presence")
			}
			if !sh.wantTags && tm != nil {
				t.Fatalf("ScanTags expected nil fast-path for tagless content")
			}

			entries := Entries(data)
			if len(entries) < sh.wantMinE {
				t.Fatalf("Entries count = %d, want >= %d", len(entries), sh.wantMinE)
			}

			edit, err := EditTags(data, "add", "note", 1, []string{"checked"})
			if err != nil {
				t.Fatalf("EditTags failed: %v", err)
			}
			applied := edit.Apply(data)
			if len(applied) == 0 {
				t.Fatalf("EditTags.Apply produced empty output")
			}
		})
	}
}

func BenchmarkSearchScale(b *testing.B) {
	for _, count := range []int{500, 2000} {
		b.Run(fmt.Sprintf("files_%d", count), func(b *testing.B) {
			dir := b.TempDir()
			writeStressCorpus(b, dir, count, 30)

			b.Run("plain", func(b *testing.B) {
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					res, err := SearchScrapsContext(context.Background(), dir, "SYKI_NEEDLE_ALPHA", 100)
					if err != nil || len(res) == 0 {
						b.Fatalf("plain search failed: len=%d err=%v", len(res), err)
					}
				}
			})

			b.Run("ranked", func(b *testing.B) {
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					res, err := SearchScrapsRanked(context.Background(), dir, "竹林設計 検証対象", 50, Options{})
					if err != nil || len(res) == 0 {
						b.Fatalf("ranked search failed: len=%d err=%v", len(res), err)
					}
				}
			})

			b.Run("tags", func(b *testing.B) {
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					tags, err := CollectTags(context.Background(), dir)
					if err != nil || len(tags) == 0 {
						b.Fatalf("collect tags failed: len=%d err=%v", len(tags), err)
					}
				}
			})
		})
	}
}
