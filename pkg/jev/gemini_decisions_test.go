package jev

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// geminiDecisionSpy records every HTTP request sent to Gemini Decisions API and answers with reply.
type geminiDecisionSpy struct {
	urls        []string
	auths       []string
	googleKeys  []string
	requests    []GeminiDecisionRequest
	reply       func(GeminiDecisionRequest) (*http.Response, error)
}

func (s *geminiDecisionSpy) RoundTrip(r *http.Request) (*http.Response, error) {
	var req GeminiDecisionRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	s.urls = append(s.urls, r.URL.String())
	s.auths = append(s.auths, r.Header.Get("Authorization"))
	s.googleKeys = append(s.googleKeys, r.Header.Get("x-goog-api-key"))
	s.requests = append(s.requests, req)
	return s.reply(req)
}

func newGeminiSpyClient(t *testing.T, cfg ClientConfig, reply func(GeminiDecisionRequest) (*http.Response, error)) (*Client, *geminiDecisionSpy) {
	t.Helper()
	clearJevEnv(t)
	cfg.Timeout = 2 * time.Second
	client := NewClient(cfg)
	spy := &geminiDecisionSpy{reply: reply}
	client.httpClient.Transport = spy
	return client, spy
}

func TestGeminiDecision_TargetResolution(t *testing.T) {
	clearJevEnv(t)

	tests := []struct {
		name         string
		cfg          ClientConfig
		model        string
		wantEndpoint string
		wantKey      string
	}{
		{
			name: "Standard gemini-decision-1 with AIza key",
			cfg: ClientConfig{
				Model:     "gemini-decision-1",
				GeminiKey: "AIzaSyTest1234",
			},
			model:        "gemini-decision-1",
			wantEndpoint: DefaultGeminiDecisionsURL,
			wantKey:      "AIzaSyTest1234",
		},
		{
			name: "gemini-decision model with generic apiKey field",
			cfg: ClientConfig{
				Model:  "gemini-decision",
				APIKey: "AIzaSyTestApiKey",
			},
			model:        "gemini-decision",
			wantEndpoint: DefaultGeminiDecisionsURL,
			wantKey:      "AIzaSyTestApiKey",
		},
		{
			name: "Custom proxy endpoint ending in /decisions",
			cfg: ClientConfig{
				Endpoint:  "https://custom-proxy.internal/v1beta/decisions",
				Model:     "gemini-decision-1",
				GeminiKey: "AIzaSyCustomKey",
			},
			model:        "gemini-decision-1",
			wantEndpoint: "https://custom-proxy.internal/v1beta/decisions",
			wantKey:      "AIzaSyCustomKey",
		},
		{
			name: "OpenRouter key must NOT resolve to Gemini target",
			cfg: ClientConfig{
				Model:         "gemini-decision-1",
				OpenRouterKey: "sk-or-v1-test",
			},
			model:        "gemini-decision-1",
			wantEndpoint: "",
			wantKey:      "",
		},
		{
			name: "TypeSafe key must NOT resolve to Gemini target",
			cfg: ClientConfig{
				Model:       "gemini-decision-1",
				TypeSafeKey: "ts-key-1234",
			},
			model:        "gemini-decision-1",
			wantEndpoint: "",
			wantKey:      "",
		},
		{
			name: "OpenAI key must NOT resolve to Gemini target",
			cfg: ClientConfig{
				Model:     "gemini-decision-1",
				OpenAIKey: "sk-proj-test",
			},
			model:        "gemini-decision-1",
			wantEndpoint: "",
			wantKey:      "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := NewClient(tc.cfg)
			ep, k := c.geminiDecisionTarget(tc.model)
			if ep != tc.wantEndpoint {
				t.Errorf("endpoint = %q, want %q", ep, tc.wantEndpoint)
			}
			if k != tc.wantKey {
				t.Errorf("key = %q, want %q", k, tc.wantKey)
			}
		})
	}
}

func TestGeminiDecision_SystemOneMapping(t *testing.T) {
	req := SystemOneRequest{
		Model: "gemini-decision-1",
		State: map[string]interface{}{"note_excerpt": "Check out this commit"},
		Questions: map[string]SystemOneQuestion{
			"action": {
				Type:         QuestionChoice,
				Instructions: "Choose next action",
				Criteria: map[string]string{
					"git_status": "Run git status",
					"git_diff":   "Run git diff",
				},
			},
			"is_git": {
				Type:         QuestionNoul,
				Instructions: "Is this a git repository task?",
			},
			"urgency": {
				Type:         QuestionScore,
				Instructions: "Score urgency",
				Criteria:     []string{"low", "medium", "high"},
			},
		},
	}

	gReq := systemOneToGeminiDecisionRequest(req)
	if gReq.Model != "gemini-decision-1" {
		t.Errorf("model = %q, want gemini-decision-1", gReq.Model)
	}
	if len(gReq.Questions) != 3 {
		t.Fatalf("questions = %d, want 3", len(gReq.Questions))
	}

	// Verify GeminiDecisionResponse mapping back to SystemOneResponse
	gResp := GeminiDecisionResponse{
		ID:    "dec-123",
		Model: "gemini-decision-1",
		Answers: []GeminiDecisionAnswer{
			{
				Name:        "action",
				Type:        "choice",
				Choice:      "git_status",
				Confidence:  0.88,
				Probabilities: map[string]float64{
					"git_status": 0.88,
					"git_diff":   0.12,
				},
			},
			{
				Name:        "is_git",
				Type:        "predicate",
				Probability: 0.95,
			},
			{
				Name:       "urgency",
				Type:       "score",
				Score:      3.5,
				Confidence: 0.8,
			},
		},
	}

	soResp := geminiDecisionToSystemOneResponse(gResp)
	if soResp.Model != "gemini-decision-1" {
		t.Errorf("model = %q, want gemini-decision-1", soResp.Model)
	}
	if len(soResp.Answers) != 3 {
		t.Fatalf("answers = %d, want 3", len(soResp.Answers))
	}

	actAns := soResp.Answers["action"]
	if actAns.Type != QuestionChoice || actAns.Choice != "git_status" || actAns.Confidence != 0.88 {
		t.Errorf("action answer = %+v, unexpected", actAns)
	}

	gitAns := soResp.Answers["is_git"]
	if gitAns.Type != QuestionNoul || gitAns.Noul != 0.95 {
		t.Errorf("is_git answer = %+v, unexpected", gitAns)
	}

	urgAns := soResp.Answers["urgency"]
	if urgAns.Type != QuestionScore || urgAns.Score != 3.5 {
		t.Errorf("urgency answer = %+v, unexpected", urgAns)
	}
}

func TestGeminiDecision_CallAPI(t *testing.T) {
	client, spy := newGeminiSpyClient(t, ClientConfig{
		Model:     "gemini-decision-1",
		GeminiKey: "AIzaSyTestKey999",
	}, func(req GeminiDecisionRequest) (*http.Response, error) {
		respBody := GeminiDecisionResponse{
			ID:    "resp-xyz",
			Model: req.Model,
			Answers: []GeminiDecisionAnswer{
				{
					Name:        "next_action",
					Type:        "choice",
					Choice:      "opt_1",
					Confidence:  0.92,
					Probabilities: map[string]float64{"opt_1": 0.92, "opt_2": 0.08},
				},
			},
		}
		b, _ := json.Marshal(respBody)
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(string(b))),
			Header:     make(http.Header),
		}, nil
	})

	soResp, err := client.callGeminiDecisionAPI(context.Background(), DefaultGeminiDecisionsURL, "AIzaSyTestKey999", SystemOneRequest{
		Model: "gemini-decision-1",
		State: map[string]string{"note": "hello"},
		Questions: map[string]SystemOneQuestion{
			"next_action": {Type: QuestionChoice},
		},
	})
	if err != nil {
		t.Fatalf("callGeminiDecisionAPI failed: %v", err)
	}

	if len(spy.urls) != 1 || spy.urls[0] != DefaultGeminiDecisionsURL {
		t.Fatalf("unexpected spy url: %v", spy.urls)
	}
	if spy.googleKeys[0] != "AIzaSyTestKey999" {
		t.Errorf("x-goog-api-key = %q, want AIzaSyTestKey999", spy.googleKeys[0])
	}
	if soResp.Answers["next_action"].Choice != "opt_1" {
		t.Errorf("unexpected choice: %v", soResp.Answers["next_action"].Choice)
	}
}

func TestGeminiDecision_Predict(t *testing.T) {
	client, _ := newGeminiSpyClient(t, ClientConfig{
		Model:     "gemini-decision-1",
		GeminiKey: "AIzaSyTestPredictKey",
	}, func(req GeminiDecisionRequest) (*http.Response, error) {
		probs := make(map[string]float64)
		for _, q := range req.Questions {
			if q.Name == systemOneRankKey {
				for i, ch := range q.Choices {
					if i == 0 {
						probs[ch.Value] = 0.85
					} else {
						probs[ch.Value] = 0.15 / float64(len(q.Choices)-1)
					}
				}
			}
		}

		respBody := GeminiDecisionResponse{
			ID:    "predict-resp",
			Model: "gemini-decision-1",
			Answers: []GeminiDecisionAnswer{
				{
					Name:          systemOneRankKey,
					Type:          "choice",
					Choice:        "opt_0",
					Confidence:    0.85,
					Probabilities: probs,
				},
			},
		}
		b, _ := json.Marshal(respBody)
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(string(b))),
			Header:     make(http.Header),
		}, nil
	})

	resp, err := client.Predict(context.Background(), JevPredictRequest{
		BufferContext: "git commit -m 'feat: gemini decision'",
	})
	if err != nil {
		t.Fatalf("Predict returned error: %v", err)
	}
	if len(resp.Candidates) == 0 {
		t.Fatal("expected ranked candidates, got 0")
	}
	if resp.Candidates[0].Confidence != 0.85 {
		t.Errorf("expected top candidate confidence 0.85, got %f", resp.Candidates[0].Confidence)
	}
}
