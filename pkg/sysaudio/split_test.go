package sysaudio

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func makeTestPCMWAV(channels, sampleRate, bitsPerSample int, data []byte) []byte {
	hdr := pcmWAVHeader(channels, sampleRate, bitsPerSample, uint32(len(data)))
	out := make([]byte, len(hdr)+len(data))
	copy(out, hdr)
	copy(out[len(hdr):], data)
	return out
}

func TestSplitWAVBytes_ShortNoSplit(t *testing.T) {
	pcm := make([]byte, SampleRate*2*10) // 10 seconds at 16kHz mono 16-bit
	wav := makeTestPCMWAV(1, SampleRate, 16, pcm)

	parts := SplitWAVBytes(wav, 60)
	if len(parts) != 1 {
		t.Fatalf("expected 1 part, got %d", len(parts))
	}
	if !bytes.Equal(parts[0], wav) {
		t.Fatalf("short WAV should be returned unchanged")
	}
}

func TestSplitWAVBytes_Splits150sInto60sChunks(t *testing.T) {
	// 150 seconds of 16 kHz mono 16-bit PCM = 4,800,000 bytes
	totalSamples := SampleRate * 150
	pcm := make([]byte, totalSamples*2)
	for i := 0; i < totalSamples; i++ {
		binary.LittleEndian.PutUint16(pcm[i*2:], uint16(i%5000))
	}
	wav := makeTestPCMWAV(1, SampleRate, 16, pcm)

	parts := SplitWAVBytes(wav, 60)
	if len(parts) != 3 {
		t.Fatalf("expected 3 chunks (60s/60s/30s), got %d", len(parts))
	}

	wantDataLens := []int{SampleRate * 2 * 60, SampleRate * 2 * 60, SampleRate * 2 * 30}
	var combinedData []byte
	for i, part := range parts {
		fmtInfo, data, ok := parsePCMWAV(part)
		if !ok {
			t.Fatalf("chunk %d is not a valid PCM WAV", i)
		}
		if fmtInfo.channels != 1 || fmtInfo.sampleRate != SampleRate || fmtInfo.bitsPerSample != 16 {
			t.Fatalf("chunk %d format mismatch: %+v", i, fmtInfo)
		}
		if len(data) != wantDataLens[i] {
			t.Fatalf("chunk %d data len = %d, want %d", i, len(data), wantDataLens[i])
		}
		if gotRIFF := int(binary.LittleEndian.Uint32(part[4:8])); gotRIFF != 36+len(data) {
			t.Fatalf("chunk %d RIFF size = %d, want %d", i, gotRIFF, 36+len(data))
		}
		combinedData = append(combinedData, data...)
	}
	if !bytes.Equal(combinedData, pcm) {
		t.Fatalf("concatenated split data does not match original PCM samples")
	}
}

func TestSplitWAVBytes_Fallbacks(t *testing.T) {
	nonWAV := []byte("not-a-wav-file")
	if got := SplitWAVBytes(nonWAV, 60); len(got) != 1 || !bytes.Equal(got[0], nonWAV) {
		t.Fatalf("non-WAV input should fall back to single element")
	}

	valid := makeTestPCMWAV(1, SampleRate, 16, make([]byte, SampleRate*2*120))
	if got := SplitWAVBytes(valid, 0); len(got) != 1 || !bytes.Equal(got[0], valid) {
		t.Fatalf("maxSeconds <= 0 should not split")
	}

	// Truncated data chunk
	broken := append([]byte(nil), valid[:100]...)
	if got := SplitWAVBytes(broken, 1); len(got) != 1 || !bytes.Equal(got[0], broken) {
		t.Fatalf("truncated WAV should fall back cleanly")
	}

	// Non-PCM format (e.g. IEEE float = 3)
	floatWAV := append([]byte(nil), valid...)
	binary.LittleEndian.PutUint16(floatWAV[20:22], 3)
	if got := SplitWAVBytes(floatWAV, 10); len(got) != 1 || !bytes.Equal(got[0], floatWAV) {
		t.Fatalf("non-PCM WAV should fall back cleanly")
	}
}

func TestSplitWAVBytes_OddExtraChunkPadding(t *testing.T) {
	// Construct a WAV with an odd-sized LIST chunk before data so padding alignment is exercised.
	pcm := make([]byte, SampleRate*2*70)
	for i := range pcm {
		pcm[i] = byte(i)
	}
	var buf bytes.Buffer
	buf.WriteString("RIFF")
	totalPayload := 4 + (8 + 16) + (8 + 3 + 1) + (8 + len(pcm))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(totalPayload))
	buf.WriteString("WAVE")
	buf.WriteString("fmt ")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(16))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(SampleRate))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(SampleRate*2))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(2))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(16))
	buf.WriteString("JUNK")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(3))
	buf.Write([]byte{1, 2, 3, 0}) // 3 bytes + 1 pad byte
	buf.WriteString("data")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(len(pcm)))
	buf.Write(pcm)

	parts := SplitWAVBytes(buf.Bytes(), 60)
	if len(parts) != 2 {
		t.Fatalf("expected 2 parts with odd chunk padding, got %d", len(parts))
	}
	joined, ok := JoinWAVBytes(parts)
	if !ok {
		t.Fatalf("JoinWAVBytes failed")
	}
	_, joinedData, ok := parsePCMWAV(joined)
	if !ok || !bytes.Equal(joinedData, pcm) {
		t.Fatalf("round-trip joined data mismatch")
	}
}

func TestJoinWAVBytes_RoundTripAndRejectMismatch(t *testing.T) {
	if got, ok := JoinWAVBytes(nil); ok || got != nil {
		t.Fatalf("empty input should return nil, false")
	}

	single := makeTestPCMWAV(1, SampleRate, 16, []byte{1, 2, 3, 4})
	if got, ok := JoinWAVBytes([][]byte{single}); !ok || !bytes.Equal(got, single) {
		t.Fatalf("single part should pass through")
	}

	totalSamples := SampleRate * 130
	pcm := make([]byte, totalSamples*2)
	for i := 0; i < totalSamples; i++ {
		binary.LittleEndian.PutUint16(pcm[i*2:], uint16(i))
	}
	orig := makeTestPCMWAV(1, SampleRate, 16, pcm)
	parts := SplitWAVBytes(orig, 60)
	joined, ok := JoinWAVBytes(parts)
	if !ok {
		t.Fatalf("expected JoinWAVBytes to succeed")
	}
	if !bytes.Equal(joined, orig) {
		t.Fatalf("joined WAV bytes do not match original")
	}

	// Format mismatch (different sample rate) must be rejected
	other := makeTestPCMWAV(1, 8000, 16, []byte{1, 2, 3, 4})
	if _, ok := JoinWAVBytes([][]byte{parts[0], other}); ok {
		t.Fatalf("expected format mismatch to fail")
	}

	// Non-WAV element must be rejected
	if _, ok := JoinWAVBytes([][]byte{parts[0], []byte("bad")}); ok {
		t.Fatalf("expected non-WAV part to fail")
	}
}
