package semindex

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func buildSemindexCorpus(t testing.TB, scrap string, fileCount int) {
	t.Helper()
	for i := 0; i < fileCount; i++ {
		month := (i/28)%12 + 1
		day := (i % 28) + 1
		rel := fmt.Sprintf("2026-%02d-%02d_%04d.md", month, day, i)
		if i%4 == 0 {
			rel = fmt.Sprintf("sub/%02d/%s", i%10, rel)
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("# 2026-%02d-%02d Topic %d\n\n", month, day, i))
		if i%10 == 0 {
			sb.WriteString("竹林設計とSYKI_SEM_ALPHAに関する設計メモです。高速検索と増分更新を確認する。\n")
		} else {
			sb.WriteString("通常の記録行。日常的なテスト文章を数行並べてチャンク生成を確認する。\n")
		}
		sb.WriteString("追加の段落。境界テストとUTF-8文字分割の検証を兼ねた文章。\n")
		if tb, ok := t.(*testing.T); ok {
			writeFile(tb, scrap, rel, sb.String())
		} else {
			writeBenchFile(t, scrap, rel, sb.String())
		}
	}
}

func writeBenchFile(tb testing.TB, dir, rel, content string) {
	tb.Helper()
	full := fmt.Sprintf("%s%c%s", dir, os.PathSeparator, strings.ReplaceAll(rel, "/", string(os.PathSeparator)))
	lastSep := strings.LastIndexByte(full, os.PathSeparator)
	if lastSep > 0 {
		if err := os.MkdirAll(full[:lastSep], 0o755); err != nil {
			tb.Fatal(err)
		}
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		tb.Fatal(err)
	}
}

func TestSemindexStress_ScaleAndConcurrentSearch(t *testing.T) {
	fileCount := 150
	if os.Getenv("SYKI_STRESS") == "1" {
		fileCount = 800
	}
	scrap, idx := dirs(t)
	buildSemindexCorpus(t, scrap, fileCount)

	// Pathological 1: ~200KB single giant line with no newlines
	giant := "# 2026-10-01 Giant\n\nSYKI_SEM_GIANT " + strings.Repeat("abcdefgあいうえお。", 8000) + " SYKI_SEM_GIANT_END"
	writeFile(t, scrap, "2026-10-01_giant.md", giant)

	// Pathological 2: 1,500 headings in one file
	var dense strings.Builder
	for i := 0; i < 1500; i++ {
		dense.WriteString(fmt.Sprintf("# Heading %d\nbody line %d\n\n", i, i))
	}
	writeFile(t, scrap, "2026-10-02_dense.md", dense.String())

	emb := newFake()
	opts := DefaultOptions()
	ctx := context.Background()

	st1, err := Update(ctx, scrap, idx, emb, opts)
	if err != nil {
		t.Fatalf("initial Update failed: %v", err)
	}
	wantFiles := fileCount + 2
	if st1.Files != wantFiles {
		t.Fatalf("initial Files = %d, want %d", st1.Files, wantFiles)
	}
	if st1.Chunks == 0 || st1.Embedded == 0 {
		t.Fatalf("unexpected empty index stats: %+v", st1)
	}

	st2, err := Update(ctx, scrap, idx, emb, opts)
	if err != nil {
		t.Fatalf("incremental no-op Update failed: %v", err)
	}
	if st2.FilesChanged != 0 || st2.Embedded != 0 {
		t.Fatalf("expected zero work on unchanged corpus, got %+v", st2)
	}

	const searchWorkers = 12
	var wg sync.WaitGroup
	var searchErrs int64
	var emptyHits int64
	for w := 0; w < searchWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			hits, _, err := Search(ctx, idx, emb, "竹林設計 SYKI_SEM_ALPHA", SearchOptions{Limit: 10})
			if err != nil {
				atomic.AddInt64(&searchErrs, 1)
				return
			}
			if len(hits) == 0 {
				atomic.AddInt64(&emptyHits, 1)
			}
		}()
	}
	wg.Wait()
	if searchErrs != 0 || emptyHits != 0 {
		t.Fatalf("concurrent Search failures: errs=%d empty=%d", searchErrs, emptyHits)
	}

	// Modify 10 files (changing size + bumping mtime) and verify incremental delta
	future := time.Now().Add(2 * time.Second)
	for i := 0; i < 10; i++ {
		month := (i/28)%12 + 1
		day := (i % 28) + 1
		rel := fmt.Sprintf("2026-%02d-%02d_%04d.md", month, day, i)
		if i%4 == 0 {
			rel = fmt.Sprintf("sub/%02d/%s", i%10, rel)
		}
		p := writeFile(t, scrap, rel, fmt.Sprintf("# 2026-%02d-%02d Updated %d\n\n更新された一意コンテンツ %d\n", month, day, i, i))
		_ = os.Chtimes(p, future, future)
	}

	st3, err := Update(ctx, scrap, idx, emb, opts)
	if err != nil {
		t.Fatalf("incremental delta Update failed: %v", err)
	}
	if st3.FilesChanged != 10 {
		t.Fatalf("FilesChanged = %d, want 10", st3.FilesChanged)
	}
	if st3.Embedded == 0 {
		t.Fatalf("expected non-zero Embedded after modifying 10 files: %+v", st3)
	}
}

func BenchmarkSemindexScale(b *testing.B) {
	opts := DefaultOptions()

	b.Run("chunk_many_lines", func(b *testing.B) {
		var sb strings.Builder
		for i := 0; i < 10000; i++ {
			if i%50 == 0 {
				sb.WriteString(fmt.Sprintf("## Entry %d\n", i))
			}
			sb.WriteString("定常の日本語およびEnglishテキストの分割ベンチマーク行。\n")
		}
		data := []byte(sb.String())
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			chunks := ChunkFile("2026-10-01.md", data, opts.Chunk)
			if len(chunks) == 0 {
				b.Fatal("expected chunks")
			}
		}
	})

	b.Run("chunk_giant_single_line", func(b *testing.B) {
		data := []byte("# Giant\n\n" + strings.Repeat("abcdefgあいうえお。", 12000))
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			chunks := ChunkFile("2026-10-01.md", data, opts.Chunk)
			if len(chunks) == 0 {
				b.Fatal("expected chunks")
			}
		}
	})

	b.Run("update_300_files", func(b *testing.B) {
		root := b.TempDir()
		scrap := fmt.Sprintf("%s%cscraps", root, os.PathSeparator)
		buildSemindexCorpus(b, scrap, 300)
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			b.StopTimer()
			idx := fmt.Sprintf("%s%cidx_%d", root, os.PathSeparator, i)
			emb := newFake()
			b.StartTimer()
			st, err := Update(context.Background(), scrap, idx, emb, opts)
			if err != nil || st.Files != 300 {
				b.Fatalf("Update failed: st=%+v err=%v", st, err)
			}
		}
	})

	b.Run("search_300_files", func(b *testing.B) {
		root := b.TempDir()
		scrap := fmt.Sprintf("%s%cscraps", root, os.PathSeparator)
		idx := fmt.Sprintf("%s%cidx", root, os.PathSeparator)
		buildSemindexCorpus(b, scrap, 300)
		emb := newFake()
		if _, err := Update(context.Background(), scrap, idx, emb, opts); err != nil {
			b.Fatal(err)
		}
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			hits, _, err := Search(context.Background(), idx, emb, "竹林設計 SYKI_SEM_ALPHA", SearchOptions{Limit: 10})
			if err != nil || len(hits) == 0 {
				b.Fatalf("Search failed: hits=%d err=%v", len(hits), err)
			}
		}
	})
}
