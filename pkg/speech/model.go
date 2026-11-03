package speech

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
)

const (
	ggmlMagic         = 0x67676d6c // "lmgg" as stored on disk (little endian)
	ggufMagic         = 0x46554747 // "GGUF" as stored on disk (little endian)
	englishOnlyVocab  = 51864
	maxPlausibleVocab = 1 << 20
)

type ModelInfo struct {
	Format       string // "ggml" or "gguf"
	VocabSize    int
	Multilingual bool
	Size         int64
}

// ValidateModelFile reads only the file header to tell a valid speech/whisper model (ggml or GGUF)
// from anything else a user might point at (safetensors, a Hugging Face .pt, ...).
func ValidateModelFile(path string) (ModelInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ModelInfo{}, fmt.Errorf("モデルファイルが見つかりません: %s", path)
		}
		return ModelInfo{}, fmt.Errorf("モデルファイルを開けません: %s (%v)", path, err)
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		return ModelInfo{}, fmt.Errorf("モデルファイルを読み取れません: %s (%v)", path, err)
	}
	if st.IsDir() {
		return ModelInfo{}, fmt.Errorf("モデルにはファイルを指定してください(フォルダが指定されています): %s", path)
	}

	head := make([]byte, 16)
	n, err := io.ReadFull(f, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return ModelInfo{}, fmt.Errorf("モデルファイルを読み取れません: %s (%v)", path, err)
	}
	head = head[:n]
	if n < 8 {
		return ModelInfo{}, fmt.Errorf("モデルファイルが小さすぎます(%dバイト)。ダウンロードが途中で止まった可能性があります: %s", st.Size(), path)
	}

	magic := binary.LittleEndian.Uint32(head)
	if magic == ggufMagic {
		// Valid GGUF model for speech.cpp
		return ModelInfo{
			Format:       "gguf",
			Multilingual: true,
			Size:         st.Size(),
		}, nil
	}

	if magic != ggmlMagic {
		return ModelInfo{}, fmt.Errorf("Whisper/speech の ggml/GGUF 形式のモデルではありません(%s): %s", describeForeignModel(head), path)
	}
	vocab := int(int32(binary.LittleEndian.Uint32(head[4:])))
	if vocab <= 0 || vocab > maxPlausibleVocab {
		return ModelInfo{}, fmt.Errorf("モデルファイルのヘッダが壊れています(語彙数 %d)。もう一度ダウンロードしてください: %s", vocab, path)
	}
	return ModelInfo{Format: "ggml", VocabSize: vocab, Multilingual: vocab > englishOnlyVocab, Size: st.Size()}, nil
}

func describeForeignModel(head []byte) string {
	switch {
	case len(head) > 8 && head[8] == '{':
		return "safetensors 形式のファイルのようです"
	case string(head[:2]) == "PK":
		return "zip / PyTorch 形式のファイルのようです"
	}
	return "先頭のデータが対応モデルのものではありません"
}
