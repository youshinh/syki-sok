package sysaudio

import (
	"encoding/binary"
	"math"
)

type pcmWAVFormat struct {
	channels      int
	sampleRate    int
	bitsPerSample int
}

// SplitWAVBytes splits a PCM WAV payload into segments of at most maxSeconds each.
// If maxSeconds <= 0, the payload is not a valid PCM WAV, or it already fits within
// maxSeconds, the original slice is returned unchanged as a single element.
func SplitWAVBytes(wav []byte, maxSeconds int) [][]byte {
	if maxSeconds <= 0 {
		return [][]byte{wav}
	}
	fmtInfo, data, ok := parsePCMWAV(wav)
	if !ok {
		return [][]byte{wav}
	}
	blockAlign := fmtInfo.channels * (fmtInfo.bitsPerSample / 8)
	if blockAlign <= 0 {
		return [][]byte{wav}
	}
	maxDataBytes := int64(maxSeconds) * int64(fmtInfo.sampleRate) * int64(blockAlign)
	if maxDataBytes <= 0 || int64(len(data)) <= maxDataBytes {
		return [][]byte{wav}
	}
	chunkSize := (maxDataBytes / int64(blockAlign)) * int64(blockAlign)
	if chunkSize <= 0 || chunkSize > math.MaxUint32-36 {
		return [][]byte{wav}
	}

	nChunks := (int64(len(data)) + chunkSize - 1) / chunkSize
	out := make([][]byte, 0, int(nChunks))
	for off := int64(0); off < int64(len(data)); off += chunkSize {
		end := off + chunkSize
		if end > int64(len(data)) {
			end = int64(len(data))
		}
		partData := data[off:end]
		hdr := pcmWAVHeader(fmtInfo.channels, fmtInfo.sampleRate, fmtInfo.bitsPerSample, uint32(len(partData)))
		buf := make([]byte, len(hdr)+len(partData))
		copy(buf, hdr)
		copy(buf[len(hdr):], partData)
		out = append(out, buf)
	}
	return out
}

// JoinWAVBytes concatenates PCM WAV payloads that share the exact same format into a single WAV.
func JoinWAVBytes(parts [][]byte) ([]byte, bool) {
	if len(parts) == 0 {
		return nil, false
	}
	if len(parts) == 1 {
		return parts[0], true
	}

	var baseFmt pcmWAVFormat
	datas := make([][]byte, 0, len(parts))
	var totalData int64
	for i, part := range parts {
		fmtInfo, data, ok := parsePCMWAV(part)
		if !ok {
			return nil, false
		}
		if i == 0 {
			baseFmt = fmtInfo
		} else if fmtInfo != baseFmt {
			return nil, false
		}
		datas = append(datas, data)
		totalData += int64(len(data))
		if totalData > math.MaxUint32-36 {
			return nil, false
		}
	}

	hdr := pcmWAVHeader(baseFmt.channels, baseFmt.sampleRate, baseFmt.bitsPerSample, uint32(totalData))
	out := make([]byte, len(hdr)+int(totalData))
	copy(out, hdr)
	pos := len(hdr)
	for _, d := range datas {
		copy(out[pos:], d)
		pos += len(d)
	}
	return out, true
}

func parsePCMWAV(wav []byte) (pcmWAVFormat, []byte, bool) {
	if len(wav) < 12 || string(wav[0:4]) != "RIFF" || string(wav[8:12]) != "WAVE" {
		return pcmWAVFormat{}, nil, false
	}
	var fmtInfo pcmWAVFormat
	var hasFmt bool
	var data []byte
	var hasData bool

	offset := int64(12)
	total := int64(len(wav))
	for offset+8 <= total {
		chunkID := string(wav[offset : offset+4])
		chunkSize := int64(binary.LittleEndian.Uint32(wav[offset+4 : offset+8]))
		payloadStart := offset + 8
		payloadEnd := payloadStart + chunkSize
		if payloadEnd > total || payloadEnd < payloadStart {
			return pcmWAVFormat{}, nil, false
		}
		payload := wav[payloadStart:payloadEnd]

		switch chunkID {
		case "fmt ":
			if len(payload) < 16 {
				return pcmWAVFormat{}, nil, false
			}
			audioFormat := binary.LittleEndian.Uint16(payload[0:2])
			if audioFormat != 1 {
				return pcmWAVFormat{}, nil, false
			}
			channels := int(binary.LittleEndian.Uint16(payload[2:4]))
			sampleRate := int(binary.LittleEndian.Uint32(payload[4:8]))
			bitsPerSample := int(binary.LittleEndian.Uint16(payload[14:16]))
			if channels <= 0 || sampleRate <= 0 || bitsPerSample <= 0 || bitsPerSample%8 != 0 {
				return pcmWAVFormat{}, nil, false
			}
			fmtInfo = pcmWAVFormat{
				channels:      channels,
				sampleRate:    sampleRate,
				bitsPerSample: bitsPerSample,
			}
			hasFmt = true
		case "data":
			data = payload
			hasData = true
		}

		if hasFmt && hasData {
			return fmtInfo, data, true
		}
		// RIFF chunks are padded to an even byte boundary.
		offset = payloadStart + ((chunkSize + 1) &^ 1)
	}
	return pcmWAVFormat{}, nil, false
}

func pcmWAVHeader(channels, sampleRate, bitsPerSample int, dataBytes uint32) []byte {
	blockAlign := channels * (bitsPerSample / 8)
	byteRate := sampleRate * blockAlign
	h := make([]byte, 44)
	copy(h[0:], "RIFF")
	binary.LittleEndian.PutUint32(h[4:], 36+dataBytes)
	copy(h[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(h[16:], 16)
	binary.LittleEndian.PutUint16(h[20:], 1) // PCM
	binary.LittleEndian.PutUint16(h[22:], uint16(channels))
	binary.LittleEndian.PutUint32(h[24:], uint32(sampleRate))
	binary.LittleEndian.PutUint32(h[28:], uint32(byteRate))
	binary.LittleEndian.PutUint16(h[32:], uint16(blockAlign))
	binary.LittleEndian.PutUint16(h[34:], uint16(bitsPerSample))
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], dataBytes)
	return h
}
