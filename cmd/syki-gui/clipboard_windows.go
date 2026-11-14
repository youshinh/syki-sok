//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/png"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	cfDIB        = 8
	gmemMoveable = 0x0002
)

var (
	modKernel32Clip               = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalAllocClip           = modKernel32Clip.NewProc("GlobalAlloc")
	procGlobalLockClip            = modKernel32Clip.NewProc("GlobalLock")
	procGlobalUnlockClip          = modKernel32Clip.NewProc("GlobalUnlock")
	procGlobalFreeClip            = modKernel32Clip.NewProc("GlobalFree")
	procEmptyClipboard            = modUser32.NewProc("EmptyClipboard")
	procSetClipboardData          = modUser32.NewProc("SetClipboardData")
	procRegisterClipboardFormatW  = modUser32.NewProc("RegisterClipboardFormatW")
	procRtlMoveMemoryClip         = modKernel32Clip.NewProc("RtlMoveMemory")
)

func decodePNGDataURL(dataURL string) ([]byte, error) {
	s := strings.TrimSpace(dataURL)
	if idx := strings.Index(s, ";base64,"); idx >= 0 {
		s = s[idx+len(";base64,"):]
	}
	if s == "" {
		return nil, errors.New("empty PNG payload")
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decode base64 PNG: %w", err)
	}
	return raw, nil
}

// pngToDIB24 converts PNG bytes into a Windows CF_DIB (24-bit bottom-up BGR with white
// alpha-compositing) so Excel, Word, PowerPoint, and Paint paste it reliably.
func pngToDIB24(pngBytes []byte) ([]byte, error) {
	img, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return nil, fmt.Errorf("decode PNG: %w", err)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("invalid PNG dimensions")
	}

	const headerSize = 40
	rowStride := (w*3 + 3) &^ 3
	imgSize := rowStride * h
	dib := make([]byte, headerSize+imgSize)

	binary.LittleEndian.PutUint32(dib[0:4], headerSize)
	binary.LittleEndian.PutUint32(dib[4:8], uint32(w))
	binary.LittleEndian.PutUint32(dib[8:12], uint32(h)) // positive height = bottom-up DIB
	binary.LittleEndian.PutUint16(dib[12:14], 1)        // biPlanes
	binary.LittleEndian.PutUint16(dib[14:16], 24)       // biBitCount
	binary.LittleEndian.PutUint32(dib[16:20], 0)        // BI_RGB
	binary.LittleEndian.PutUint32(dib[20:24], uint32(imgSize))

	for y := 0; y < h; y++ {
		srcY := b.Max.Y - 1 - y // bottom-up row order
		rowOff := headerSize + y*rowStride
		for x := 0; x < w; x++ {
			r16, g16, b16, a16 := img.At(b.Min.X+x, srcY).RGBA()
			a := uint32(a16 >> 8)
			invA := 255 - a
			// Composite over white (255, 255, 255) for 24-bit BGR
			r := byte(((r16 >> 8) + invA) & 0xff)
			g := byte(((g16 >> 8) + invA) & 0xff)
			bl := byte(((b16 >> 8) + invA) & 0xff)
			if r16>>8 > 255-invA {
				r = 255
			}
			if g16>>8 > 255-invA {
				g = 255
			}
			if b16>>8 > 255-invA {
				bl = 255
			}
			pxOff := rowOff + x*3
			dib[pxOff] = bl
			dib[pxOff+1] = g
			dib[pxOff+2] = r
		}
	}
	return dib, nil
}

func allocClipboardGlobal(data []byte) (uintptr, error) {
	if len(data) == 0 {
		return 0, errors.New("empty clipboard data")
	}
	hMem, _, err := procGlobalAllocClip.Call(gmemMoveable, uintptr(len(data)))
	if hMem == 0 {
		return 0, fmt.Errorf("GlobalAlloc failed: %v", err)
	}
	ptr, _, err := procGlobalLockClip.Call(hMem)
	if ptr == 0 {
		_, _, _ = procGlobalFreeClip.Call(hMem)
		return 0, fmt.Errorf("GlobalLock failed: %v", err)
	}
	_, _, _ = procRtlMoveMemoryClip.Call(ptr, uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)))
	_, _, _ = procGlobalUnlockClip.Call(hMem)
	return hMem, nil
}

func copyPNGToClipboardNative(dataURL string) error {
	pngBytes, err := decodePNGDataURL(dataURL)
	if err != nil {
		return err
	}
	dib, err := pngToDIB24(pngBytes)
	if err != nil {
		return err
	}

	ret, _, openErr := procOpenClipboard.Call(uintptr(globalHwnd))
	if ret == 0 {
		return fmt.Errorf("OpenClipboard failed: %v", openErr)
	}
	defer procCloseClipboard.Call()

	_, _, _ = procEmptyClipboard.Call()

	hDIB, err := allocClipboardGlobal(dib)
	if err != nil {
		return err
	}
	if setRet, _, setErr := procSetClipboardData.Call(cfDIB, hDIB); setRet == 0 {
		_, _, _ = procGlobalFreeClip.Call(hDIB)
		return fmt.Errorf("SetClipboardData(CF_DIB) failed: %v", setErr)
	}

	// Also register standard "PNG" clipboard format for apps that prefer lossless PNG.
	if pngFmtName, perr := windows.UTF16PtrFromString("PNG"); perr == nil {
		if pngFmt, _, _ := procRegisterClipboardFormatW.Call(uintptr(unsafe.Pointer(pngFmtName))); pngFmt != 0 {
			if hPNG, gerr := allocClipboardGlobal(pngBytes); gerr == nil {
				if setRet, _, _ := procSetClipboardData.Call(pngFmt, hPNG); setRet == 0 {
					_, _, _ = procGlobalFreeClip.Call(hPNG)
				}
			}
		}
	}
	return nil
}

var _ image.Image
