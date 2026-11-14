//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestPNGToDIB24ProducesValidExcelCompatibleBitmap(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, G: 0, B: 0, A: 255}) // top-left red
	img.SetNRGBA(1, 0, color.NRGBA{R: 0, G: 255, B: 0, A: 255}) // top-right green
	img.SetNRGBA(0, 1, color.NRGBA{R: 0, G: 0, B: 255, A: 255}) // bottom-left blue
	img.SetNRGBA(1, 1, color.NRGBA{R: 0, G: 0, B: 0, A: 0})     // bottom-right transparent -> white

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
	decoded, err := decodePNGDataURL(dataURL)
	if err != nil {
		t.Fatalf("decodePNGDataURL: %v", err)
	}
	dib, err := pngToDIB24(decoded)
	if err != nil {
		t.Fatalf("pngToDIB24: %v", err)
	}

	// Row stride for 2 pixels * 3 bytes = 6 -> padded to 8 bytes; 2 rows = 16 bytes + 40 header = 56.
	if len(dib) != 56 {
		t.Fatalf("dib len = %d, want 56", len(dib))
	}
	if w := binary.LittleEndian.Uint32(dib[4:8]); w != 2 {
		t.Errorf("width = %d, want 2", w)
	}
	if h := binary.LittleEndian.Uint32(dib[8:12]); h != 2 {
		t.Errorf("height = %d, want 2", h)
	}
	if bpp := binary.LittleEndian.Uint16(dib[14:16]); bpp != 24 {
		t.Errorf("biBitCount = %d, want 24", bpp)
	}
	// Bottom-up DIB: row 0 is image y=1 (bottom-left blue [255,0,0] BGR, bottom-right white [255,255,255]).
	if dib[40] != 255 || dib[41] != 0 || dib[42] != 0 {
		t.Errorf("bottom-left BGR = %v, want [255 0 0]", dib[40:43])
	}
	if dib[43] != 255 || dib[44] != 255 || dib[45] != 255 {
		t.Errorf("bottom-right transparent->white BGR = %v, want [255 255 255]", dib[43:46])
	}
	// Row 1 (offset 48) is image y=0 (top-left red [0,0,255] BGR).
	if dib[48] != 0 || dib[49] != 0 || dib[50] != 255 {
		t.Errorf("top-left red BGR = %v, want [0 0 255]", dib[48:51])
	}
}
