package llm

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// ImageGenConfig defines LLM API configuration for image generation (Gemini / Imagen).
type ImageGenConfig struct {
	BaseURL     string `json:"baseUrl"`     // e.g. https://generativelanguage.googleapis.com
	Model       string `json:"model"`       // e.g. gemini-2.5-flash-image, imagen-3.0-generate-002, imagen-4.0-generate-001
	APIKey      string `json:"apiKey"`      // required for Gemini
	AspectRatio string `json:"aspectRatio"` // e.g. 16:9, 1:1, 4:3, default: 16:9
	Resolution  string `json:"resolution"`  // e.g. 1024 (1K), 512 (512px), 2048 (2K), 4096 (4K)
}

func GenerateImage(prompt string, cfg ImageGenConfig) ([]byte, string, error) {
	data, mime, err := generateImageProvider(prompt, cfg)
	return data, mime, scrubKeyErr(err, cfg.APIKey)
}

func generateImageProvider(prompt string, cfg ImageGenConfig) ([]byte, string, error) {
	if cfg.APIKey == "" {
		return nil, "", errNotConfigured("Gemini API Keyが設定されていません")
	}
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" || strings.Contains(baseURL, "generativelanguage.googleapis.com") {
		// The image endpoints append /v1beta/... themselves, so a base URL borrowed from the text or vision
		// settings (e.g. https://generativelanguage.googleapis.com/v1beta) must be reduced to the host.
		baseURL = "https://generativelanguage.googleapis.com"
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = "gemini-3.1-flash-lite-image"
	}
	aspectRatio := cfg.AspectRatio
	if aspectRatio == "" {
		aspectRatio = "16:9"
	}

	// 1. If Imagen model is requested, use :predict endpoint
	if strings.HasPrefix(strings.ToLower(model), "imagen-") {
		return generateImagen(baseURL, model, prompt, cfg.APIKey)
	}

	// 2. If Gemini Nano Banana or interactions-based image model is requested, use /v1beta/interactions endpoint
	if isInteractionsImageModel(model) {
		return generateInteractionsImage(baseURL, model, prompt, aspectRatio, cfg.Resolution, cfg.APIKey)
	}

	// 3. Default: Gemini generateContent with responseModalities / responseFormat image
	return generateGeminiImage(baseURL, model, prompt, aspectRatio, cfg.Resolution, cfg.APIKey)
}

// isDedicatedImageModel validates whether the requested model is a dedicated image generation model.
func isDedicatedImageModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	if m == "" {
		return false
	}
	return strings.HasPrefix(m, "imagen-") || strings.HasSuffix(m, "-image") || strings.Contains(m, "banana")
}

func toGeminiImageSize(res string) string {
	switch strings.ToUpper(strings.TrimSpace(res)) {
	case "512", "512PX", "0.5K", "IMAGE_SIZE_FIVE_TWELVE":
		return "IMAGE_SIZE_FIVE_TWELVE"
	case "1024", "1K", "IMAGE_SIZE_ONE_K":
		return "IMAGE_SIZE_ONE_K"
	case "2048", "2K", "IMAGE_SIZE_TWO_K":
		return "IMAGE_SIZE_TWO_K"
	case "4096", "4K", "IMAGE_SIZE_FOUR_K":
		return "IMAGE_SIZE_FOUR_K"
	default:
		return ""
	}
}

func toGeminiAspectRatio(ar string) string {
	switch strings.TrimSpace(ar) {
	case "16:9", "16_9", "16x9", "ASPECT_RATIO_SIXTEEN_BY_NINE":
		return "ASPECT_RATIO_SIXTEEN_BY_NINE"
	case "1:1", "1_1", "1x1", "ASPECT_RATIO_ONE_BY_ONE":
		return "ASPECT_RATIO_ONE_BY_ONE"
	case "4:3", "4_3", "4x3", "ASPECT_RATIO_FOUR_BY_THREE":
		return "ASPECT_RATIO_FOUR_BY_THREE"
	case "3:4", "3_4", "3x4", "ASPECT_RATIO_THREE_BY_FOUR":
		return "ASPECT_RATIO_THREE_BY_FOUR"
	case "9:16", "9_16", "9x16", "ASPECT_RATIO_NINE_BY_SIXTEEN":
		return "ASPECT_RATIO_NINE_BY_SIXTEEN"
	case "2:3", "2_3", "2x3", "ASPECT_RATIO_TWO_BY_THREE":
		return "ASPECT_RATIO_TWO_BY_THREE"
	case "3:2", "3_2", "3x2", "ASPECT_RATIO_THREE_BY_TWO":
		return "ASPECT_RATIO_THREE_BY_TWO"
	case "21:9", "21_9", "21x9", "ASPECT_RATIO_TWENTY_ONE_BY_NINE":
		return "ASPECT_RATIO_TWENTY_ONE_BY_NINE"
	case "1:4", "ASPECT_RATIO_ONE_BY_FOUR":
		return "ASPECT_RATIO_ONE_BY_FOUR"
	case "4:1", "ASPECT_RATIO_FOUR_BY_ONE":
		return "ASPECT_RATIO_FOUR_BY_ONE"
	case "1:8", "ASPECT_RATIO_ONE_BY_EIGHT":
		return "ASPECT_RATIO_ONE_BY_EIGHT"
	case "8:1", "ASPECT_RATIO_EIGHT_BY_ONE":
		return "ASPECT_RATIO_EIGHT_BY_ONE"
	case "4:5", "ASPECT_RATIO_FOUR_BY_FIVE":
		return "ASPECT_RATIO_FOUR_BY_FIVE"
	case "5:4", "ASPECT_RATIO_FIVE_BY_FOUR":
		return "ASPECT_RATIO_FIVE_BY_FOUR"
	default:
		return "ASPECT_RATIO_SIXTEEN_BY_NINE"
	}
}

func generateGeminiImage(baseURL, model, prompt, aspectRatio, resolution, apiKey string) ([]byte, string, error) {
	url := fmt.Sprintf("%s/v1beta/models/%s:generateContent?key=%s", baseURL, strings.TrimPrefix(model, "models/"), apiKey)

	enumAR := toGeminiAspectRatio(aspectRatio)
	imageConfig := map[string]interface{}{}
	if enumAR != "" {
		imageConfig["aspectRatio"] = enumAR
	}
	normSize := toGeminiImageSize(resolution)
	// Note: Gemini 3.1 Flash Lite only supports 1K images; avoid adding imageSize for lite models.
	if normSize != "" && !strings.Contains(model, "flash-lite") {
		imageConfig["imageSize"] = normSize
	}

	payload := map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]interface{}{
					{"text": prompt},
				},
			},
		},
		"generationConfig": map[string]interface{}{
			"responseModalities": []string{"IMAGE", "TEXT"},
			"responseFormat": map[string]interface{}{
				"image": imageConfig,
			},
		},
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("Gemini Image API接続エラー: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))
		return nil, "", fmt.Errorf("Gemini Image APIエラー (%d) [モデル: %s]: %s", res.StatusCode, model, string(respBody))
	}

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text       string `json:"text"`
					InlineData *struct {
						MimeType string `json:"mimeType"`
						Data     string `json:"data"`
					} `json:"inlineData"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return nil, "", err
	}

	if len(result.Candidates) > 0 {
		for _, part := range result.Candidates[0].Content.Parts {
			if part.InlineData != nil && part.InlineData.Data != "" {
				mime := part.InlineData.MimeType
				if mime == "" {
					mime = "image/png"
				}
				dataStr := strings.TrimSpace(part.InlineData.Data)
				imgBytes, decErr := base64.StdEncoding.DecodeString(dataStr)
				if decErr != nil {
					return nil, "", fmt.Errorf("画像データのBase64デコードに失敗しました: %w", decErr)
				}
				return imgBytes, mime, nil
			}
		}
	}

	return nil, "", fmt.Errorf("Geminiから画像データが返されませんでした")
}

func generateImagen(baseURL, model, prompt, apiKey string) ([]byte, string, error) {
	url := fmt.Sprintf("%s/v1beta/models/%s:predict?key=%s", baseURL, strings.TrimPrefix(model, "models/"), apiKey)

	payload := map[string]interface{}{
		"instances": []map[string]interface{}{
			{"prompt": prompt},
		},
		"parameters": map[string]interface{}{
			"sampleCount": 1,
		},
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("Imagen API接続エラー: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))
		return nil, "", fmt.Errorf("Imagen APIエラー (%d) [モデル: %s]: %s", res.StatusCode, model, string(respBody))
	}

	var result struct {
		Predictions []struct {
			BytesBase64Encoded string `json:"bytesBase64Encoded"`
			MimeType           string `json:"mimeType"`
		} `json:"predictions"`
	}

	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return nil, "", err
	}

	if len(result.Predictions) > 0 && result.Predictions[0].BytesBase64Encoded != "" {
		mime := result.Predictions[0].MimeType
		if mime == "" {
			mime = "image/png"
		}
		dataStr := strings.TrimSpace(result.Predictions[0].BytesBase64Encoded)
		imgBytes, decErr := base64.StdEncoding.DecodeString(dataStr)
		if decErr != nil {
			return nil, "", fmt.Errorf("Imagen画像データのBase64デコードに失敗しました: %w", decErr)
		}
		return imgBytes, mime, nil
	}

	return nil, "", fmt.Errorf("Imagenから画像データが返されませんでした")
}

// isInteractionsImageModel checks whether the model should be routed to the Interactions API (/v1beta/interactions).
func isInteractionsImageModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	return strings.Contains(m, "banana") || strings.Contains(m, "interactions") ||
		m == "gemini-3.1-flash-image" || m == "gemini-3.1-flash-lite-image"
}

// toInteractionsAspectRatio formats aspect ratio into Interactions format (e.g. "16:9", "1:1", "4:3").
func toInteractionsAspectRatio(ar string) string {
	switch strings.TrimSpace(ar) {
	case "16:9", "16_9", "16x9", "ASPECT_RATIO_SIXTEEN_BY_NINE":
		return "16:9"
	case "1:1", "1_1", "1x1", "ASPECT_RATIO_ONE_BY_ONE":
		return "1:1"
	case "4:3", "4_3", "4x3", "ASPECT_RATIO_FOUR_BY_THREE":
		return "4:3"
	case "3:4", "3_4", "3x4", "ASPECT_RATIO_THREE_BY_FOUR":
		return "3:4"
	case "9:16", "9_16", "9x16", "ASPECT_RATIO_NINE_BY_SIXTEEN":
		return "9:16"
	case "2:3", "2_3", "2x3", "ASPECT_RATIO_TWO_BY_THREE":
		return "2:3"
	case "3:2", "3_2", "3x2", "ASPECT_RATIO_THREE_BY_TWO":
		return "3:2"
	case "21:9", "21_9", "21x9", "ASPECT_RATIO_TWENTY_ONE_BY_NINE":
		return "21:9"
	case "4:5", "ASPECT_RATIO_FOUR_BY_FIVE":
		return "4:5"
	case "5:4", "ASPECT_RATIO_FIVE_BY_FOUR":
		return "5:4"
	case "1:4", "ASPECT_RATIO_ONE_BY_FOUR":
		return "1:4"
	case "4:1", "ASPECT_RATIO_FOUR_BY_ONE":
		return "4:1"
	case "1:8", "ASPECT_RATIO_ONE_BY_EIGHT":
		return "1:8"
	case "8:1", "ASPECT_RATIO_EIGHT_BY_ONE":
		return "8:1"
	default:
		return "16:9"
	}
}

// toInteractionsImageSize formats resolution into Interactions format ("512", "1K", "2K", "4K").
func toInteractionsImageSize(res string) string {
	switch strings.ToUpper(strings.TrimSpace(res)) {
	case "512", "512PX", "0.5K", "IMAGE_SIZE_FIVE_TWELVE":
		return "512"
	case "1024", "1K", "IMAGE_SIZE_ONE_K":
		return "1K"
	case "2048", "2K", "IMAGE_SIZE_TWO_K":
		return "2K"
	case "4096", "4K", "IMAGE_SIZE_FOUR_K":
		return "4K"
	default:
		return "1K"
	}
}

func generateInteractionsImage(baseURL, model, prompt, aspectRatio, resolution, apiKey string) ([]byte, string, error) {
	url := fmt.Sprintf("%s/v1beta/interactions?key=%s", baseURL, apiKey)

	// Ensure model prefix has models/ if not provided
	modelID := strings.TrimSpace(model)
	if !strings.HasPrefix(modelID, "models/") {
		modelID = "models/" + modelID
	}

	aspect := toInteractionsAspectRatio(aspectRatio)
	imgSize := toInteractionsImageSize(resolution)

	lower := strings.ToLower(modelID)
	thinking := "minimal"
	if strings.Contains(lower, "banana") {
		thinking = "medium"
	}
	payload := map[string]interface{}{
		"model": modelID,
		"input": prompt,
		"generation_config": map[string]interface{}{
			"max_output_tokens": 65536,
			"thinking_level":    thinking,
			"image_config": map[string]interface{}{
				"aspect_ratio": aspect,
				"image_size":   imgSize,
			},
		},
		"response_modalities": []string{"image", "text"},
	}
	// The lite image model does not take the Google Search tool.
	if !strings.Contains(lower, "flash-lite") {
		payload["tools"] = []map[string]interface{}{{"type": "google_search"}}
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)

	res, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("Gemini Interactions API接続エラー: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))
		return nil, "", fmt.Errorf("Gemini Interactions APIエラー (%d) [モデル: %s]: %s", res.StatusCode, model, string(respBody))
	}

	var result struct {
		Status string `json:"status"`
		Steps  []struct {
			Type    string `json:"type"`
			Content []struct {
				Type     string `json:"type"`
				MimeType string `json:"mime_type"`
				Data     string `json:"data"`
			} `json:"content"`
		} `json:"steps"`
	}

	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return nil, "", err
	}

	for _, step := range result.Steps {
		for _, item := range step.Content {
			if item.Type == "image" && item.Data != "" {
				mime := item.MimeType
				if mime == "" {
					mime = "image/jpeg"
				}
				dataStr := strings.TrimSpace(item.Data)
				imgBytes, decErr := base64.StdEncoding.DecodeString(dataStr)
				if decErr != nil {
					return nil, "", fmt.Errorf("画像データのBase64デコードに失敗しました: %w", decErr)
				}
				return imgBytes, mime, nil
			}
		}
	}

	return nil, "", fmt.Errorf("Gemini Interactions APIから画像データが返されませんでした")
}

