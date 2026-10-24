// Package cfbridge polls Cloudflare Workers for quick-capture memos sent from mobile devices
// and ingests them into syki::sok. Once fetched, memos are deleted from Cloudflare immediately.
package cfbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Memo represents one mobile capture item returned from GET /api/memos.
type Memo struct {
	ID               string `json:"id"`
	Device           string `json:"device"`
	ClientTime       string `json:"client_time"`
	ServerTime       string `json:"server_time"`
	Geo              string `json:"geo"`
	ContentType      string `json:"content_type"`
	TextContent      string `json:"text_content"`
	Filename         string `json:"filename"`
	FileMime         string `json:"file_mime"`
	AttachmentBase64 string `json:"attachment_base64"`
	CreatedAt        int64  `json:"created_at"`
}

// Client interacts with the Cloudflare Worker bridge API.
type Client struct {
	Endpoint   string
	Token      string
	HTTPClient *http.Client
}

// New creates a Client configured with sane timeouts.
func New(endpoint, token string) *Client {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	return &Client{
		Endpoint:   endpoint,
		Token:      strings.TrimSpace(token),
		HTTPClient: &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *Client) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	url := c.Endpoint + path
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "syki-cf-bridge (https://github.com/youshinh/syki-sok)")
	return c.HTTPClient.Do(req)
}

// Verify checks whether the endpoint and auth token are valid.
func (c *Client) Verify(ctx context.Context) error {
	resp, err := c.do(ctx, "GET", "/api/memos", nil)
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("authentication failed: invalid Bearer token")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	return nil
}

// FetchMemos retrieves all pending memos from the Cloudflare Worker.
func (c *Client) FetchMemos(ctx context.Context) ([]Memo, error) {
	resp, err := c.do(ctx, "GET", "/api/memos", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch memos failed (%d): %s", resp.StatusCode, string(body))
	}

	var res struct {
		OK    bool   `json:"ok"`
		Memos []Memo `json:"memos"`
		Error string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, fmt.Errorf("decoding response failed: %w", err)
	}
	if !res.OK && res.Error != "" {
		return nil, fmt.Errorf("server error: %s", res.Error)
	}
	return res.Memos, nil
}

// DeleteMemos requests immediate deletion of fetched memos from Cloudflare.
func (c *Client) DeleteMemos(ctx context.Context, ids []string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}

	payload, err := json.Marshal(map[string][]string{"ids": ids})
	if err != nil {
		return 0, err
	}

	resp, err := c.do(ctx, "DELETE", "/api/memos", bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("delete memos failed (%d): %s", resp.StatusCode, string(body))
	}

	var res struct {
		OK      bool `json:"ok"`
		Deleted int  `json:"deleted"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&res)
	return res.Deleted, nil
}
