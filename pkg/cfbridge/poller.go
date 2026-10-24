package cfbridge

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Config configures one running Poller.
type Config struct {
	Endpoint        string
	Token           string
	IntervalSeconds int
	// OnMemos is called when new memos are received. Return error if saving failed.
	// Only memos that were successfully processed will be deleted from Cloudflare.
	OnMemos func([]Memo) error
	// OnStatus reports lifecycle/error changes ("connected", "error", "fetching", etc.).
	OnStatus func(status, message string)
}

const (
	minIntervalSeconds = 10
	maxIntervalSeconds = 600
	defaultInterval    = 30 * time.Second
)

func clampInterval(seconds int) time.Duration {
	if seconds <= 0 {
		return defaultInterval
	}
	if seconds < minIntervalSeconds {
		seconds = minIntervalSeconds
	}
	if seconds > maxIntervalSeconds {
		seconds = maxIntervalSeconds
	}
	return time.Duration(seconds) * time.Second
}

// Poller runs periodic background polling of the Cloudflare bridge.
type Poller struct {
	cfg    Config
	client *Client
	cancel context.CancelFunc
	wg     sync.WaitGroup
	pollCh chan struct{}
}

// NewPoller creates a Poller with the given configuration.
func NewPoller(cfg Config) *Poller {
	return &Poller{
		cfg:    cfg,
		client: New(cfg.Endpoint, cfg.Token),
		pollCh: make(chan struct{}, 1),
	}
}

// Start begins background polling on its own goroutine. Safe to call once.
func (p *Poller) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	p.cancel = cancel
	p.wg.Add(1)
	go p.run(ctx)
}

// Stop gracefully shuts down the poller and waits for any active poll to complete.
func (p *Poller) Stop() {
	if p.cancel != nil {
		p.cancel()
		p.wg.Wait()
		p.cancel = nil
	}
}

// PollNow signals the poller to fetch immediately (e.g., when the app window is focused).
func (p *Poller) PollNow() {
	select {
	case p.pollCh <- struct{}{}:
	default:
	}
}

func (p *Poller) run(ctx context.Context) {
	defer p.wg.Done()

	interval := clampInterval(p.cfg.IntervalSeconds)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Initial poll on startup
	p.pollOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.pollOnce(ctx)
		case <-p.pollCh:
			p.pollOnce(ctx)
		}
	}
}

func (p *Poller) pollOnce(ctx context.Context) {
	pollCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	memos, err := p.client.FetchMemos(pollCtx)
	if err != nil {
		if p.cfg.OnStatus != nil {
			p.cfg.OnStatus("error", fmt.Sprintf("Cloudflare fetch error: %v", err))
		}
		return
	}

	if len(memos) == 0 {
		if p.cfg.OnStatus != nil {
			p.cfg.OnStatus("connected", "Idle (no new memos)")
		}
		return
	}

	if p.cfg.OnStatus != nil {
		p.cfg.OnStatus("fetching", fmt.Sprintf("Received %d memo(s)", len(memos)))
	}

	if p.cfg.OnMemos != nil {
		if err := p.cfg.OnMemos(memos); err != nil {
			if p.cfg.OnStatus != nil {
				p.cfg.OnStatus("error", fmt.Sprintf("Failed processing memos: %v", err))
			}
			return
		}
	}

	// Delete processed memos from Cloudflare
	ids := make([]string, len(memos))
	for i, m := range memos {
		ids[i] = m.ID
	}

	// Delete processed memos from Cloudflare using detached context so shutdown doesn't abort wipe
	delCtx, delCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer delCancel()
	_, _ = p.client.DeleteMemos(delCtx, ids)

	if p.cfg.OnStatus != nil {
		p.cfg.OnStatus("connected", fmt.Sprintf("Ingested and deleted %d memo(s)", len(memos)))
	}
}
