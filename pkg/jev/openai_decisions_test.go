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

// openAIDecisionSpy records every HTTP request sent to OpenAI Decisions API and answers with reply.
type openAIDecisionSpy struct {
	urls     []string
	auths    []string
	requests []OpenAIDecisionRequest
	reply    func(OpenAIDecisionRequest) (*http.Response, error)
}

func (s *openAIDecisionSpy) RoundTrip(r *http.Request) (*http.Response, error) {
	var req OpenAIDecisionRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	s.urls = append(s.urls, r.URL.String())
	s.auths = append(s.auths, r.Header.Get("Authorization"))
	s.requests = append(s.requests, req)
	return s.reply(req)
}

func newOpenAISpyClient(t *testing.T, cfg ClientConfig, reply func(OpenAIDecisionRequest) (*http.Response, error)) (*Client, *openAIDecisionSpy) {
	t.Helper()
	clearJevEnv(t)
	cfg.Timeout = 2 * time.Second
	client := NewClient(cfg)
	spy := &openAIDecisionSpy{reply: reply}
	client.httpClient.Transport = spy
	return client, spy
}

func TestOpenAIDecision_TargetResolution(t *testing.T) {
	clearJevEnv(t)

	tests := []struct {
		name         string
		cfg          ClientConfig
		model        string
		wantEndpoint string
		wantKey      string
	}{
		{
			name: "Standard gpt-6-luna with sk-proj key",
			cfg: ClientConfig{
				Model:     "gpt-6-luna",
				OpenAIKey: "sk-proj-test1234",
			},
			model:        "gpt-6-luna",
			wantEndpoint: DefaultOpenAIDecisionsURL,
			wantKey:      "sk-proj-test1234",
		},
		{
			name: "luna model with generic apiKey field",
			cfg: ClientConfig{
				Model:  "luna",
				APIKey: "sk-test1234",
			},
			model:        "luna",
			wantEndpoint: DefaultOpenAIDecisionsURL,
			wantKey:      "sk-test1234",
		},
		{
			name: "Custom proxy endpoint ending in /v1",
			cfg: ClientConfig{
				Endpoint:  "https://custom-proxy.internal/v1",
				Model:     "gpt-6-luna",
				OpenAIKey: "sk-proj-custom",
			},
			model:        "gpt-6-luna",
			wantEndpoint: "https://custom-proxy.internal/v1/decisions",
			wantKey:      "sk-proj-custom",
		},
		{
			name: "OpenRouter key must NOT resolve to OpenAI target",
			cfg: ClientConfig{
				Model:         "gpt-6-luna",
				OpenRouterKey: "sk-or-v1-test",
			},
			model:        "gpt-6-luna",
			wantEndpoint: "",
			wantKey:      "",
		},
		{
			name: "TypeSafe key must NOT resolve to OpenAI target",
			cfg: ClientConfig{
				Model:       "gpt-6-luna",
				TypeSafeKey: "ts-key-1234",
			},
			model:        "gpt-6-luna",
			wantEndpoint: "",
			wantKey:      "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := NewClient(tt.cfg)
			ep, k := c.openAIDecisionTarget(tt.model)
			if ep != tt.wantEndpoint {
				t.Errorf("got endpoint %q, want %q", ep, tt.wantEndpoint)
			}
			if k != tt.wantKey {
				t.Errorf("got key %q, want %q", k, tt.wantKey)
			}
		})
	}
}

func TestOpenAIDecision_RequestSerialization(t *testing.T) {
	req := SystemOneRequest{
		State: "Context string for evaluation",
		Model: "gpt-6-luna",
		Questions: map[string]SystemOneQuestion{
			"choice_q": {
				Type:         QuestionChoice,
				Instructions: "Choose the best match",
				Criteria: map[string]string{
					"opt_b": "Second option",
					"opt_a": "First option",
				},
			},
			"predicate_q": {
				Type:         QuestionNoul,
				Instructions: "Is this condition true?",
			},
			"score_q": {
				Type:         QuestionScore,
				Instructions: "Rate from 0 to 2",
				Criteria:     []string{"low", "medium", "high"},
			},
		},
	}

	oReq := systemOneToOpenAIDecisionRequest(req)

	if oReq.Model != "gpt-6-luna" {
		t.Errorf("got model %q, want gpt-6-luna", oReq.Model)
	}
	if oReq.Input != "Context string for evaluation" {
		t.Errorf("got input %v, want context string", oReq.Input)
	}
	if len(oReq.Questions) != 3 {
		t.Fatalf("got %d questions, want 3", len(oReq.Questions))
	}

	// Because keys are sorted alphabetically: choice_q, predicate_q, score_q
	q0 := oReq.Questions[0]
	if q0.Name != "choice_q" || q0.Type != "choice" || len(q0.Choices) != 2 {
		t.Errorf("unexpected q0: %+v", q0)
	}
	// Choices should also be sorted by value: opt_a, opt_b
	if q0.Choices[0].Value != "opt_a" || q0.Choices[1].Value != "opt_b" {
		t.Errorf("choices not sorted: %+v", q0.Choices)
	}

	q1 := oReq.Questions[1]
	if q1.Name != "predicate_q" || q1.Type != "predicate" {
		t.Errorf("unexpected q1: %+v", q1)
	}

	q2 := oReq.Questions[2]
	if q2.Name != "score_q" || q2.Type != "score" || len(q2.Levels) != 3 {
		t.Errorf("unexpected q2: %+v", q2)
	}
	if q2.Levels[0] != "low" || q2.Levels[2] != "high" {
		t.Errorf("unexpected levels in q2: %+v", q2.Levels)
	}
}

func TestOpenAIDecision_ResponseDeserialization(t *testing.T) {
	oResp := OpenAIDecisionResponse{
		ID:    "dec_123",
		Model: "gpt-6-luna",
		Answers: []OpenAIDecisionAnswer{
			{
				Name:        "pred_q",
				Type:        "predicate",
				Probability: 0.88,
			},
			{
				Name:        "choice_q",
				Type:        "choice",
				Choice:      "opt_a",
				Confidence:  0.92,
				Probabilities: map[string]float64{
					"opt_a": 0.92,
					"opt_b": 0.08,
				},
			},
			{
				Name:  "score_q",
				Type:  "score",
				Score: 1.75,
			},
		},
	}

	soResp := openAIDecisionToSystemOneResponse(oResp)

	if soResp.Model != "gpt-6-luna" {
		t.Errorf("got model %q, want gpt-6-luna", soResp.Model)
	}
	if len(soResp.Answers) != 3 {
		t.Fatalf("got %d answers, want 3", len(soResp.Answers))
	}

	predAns := soResp.Answers["pred_q"]
	if predAns.Type != QuestionNoul || predAns.Noul != 0.88 {
		t.Errorf("unexpected predAns: %+v", predAns)
	}

	choiceAns := soResp.Answers["choice_q"]
	if choiceAns.Type != QuestionChoice || choiceAns.Choice != "opt_a" || choiceAns.Confidence != 0.92 {
		t.Errorf("unexpected choiceAns: %+v", choiceAns)
	}
	if choiceAns.Probabilities["opt_a"] != 0.92 || choiceAns.Probabilities["opt_b"] != 0.08 {
		t.Errorf("unexpected probabilities in choiceAns: %+v", choiceAns.Probabilities)
	}

	scoreAns := soResp.Answers["score_q"]
	if scoreAns.Type != QuestionScore || scoreAns.Score != 1.75 {
		t.Errorf("unexpected scoreAns: %+v", scoreAns)
	}
}

func TestOpenAIDecision_PredictRankCandidates(t *testing.T) {
	cfg := ClientConfig{
		Model:     "gpt-6-luna",
		OpenAIKey: "sk-proj-test-key",
	}

	client, spy := newOpenAISpyClient(t, cfg, func(req OpenAIDecisionRequest) (*http.Response, error) {
		if req.Model != "gpt-6-luna" {
			t.Errorf("spy got unexpected model: %s", req.Model)
		}
		if len(req.Questions) != 1 || req.Questions[0].Name != systemOneRankKey {
			t.Errorf("spy got unexpected questions: %+v", req.Questions)
		}

		// Find the choice options
		choices := req.Questions[0].Choices
		probs := make(map[string]float64, len(choices))

		// Give the 2nd choice highest probability
		topVal := choices[1].Value
		probs[topVal] = 0.80
		rem := 0.20 / float64(len(choices)-1)
		for _, c := range choices {
			if c.Value != topVal {
				probs[c.Value] = rem
			}
		}

		respObj := OpenAIDecisionResponse{
			ID:    "dec_test",
			Model: "gpt-6-luna",
			Answers: []OpenAIDecisionAnswer{
				{
					Name:          systemOneRankKey,
					Type:          "choice",
					Choice:        topVal,
					Confidence:    0.80,
					Probabilities: probs,
				},
			},
		}
		bytes, _ := json.Marshal(respObj)
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(string(bytes))),
		}, nil
	})

	predictReq := JevPredictRequest{
		BufferContext: "git status and git diff to check what changed",
	}

	resp, err := client.Predict(context.Background(), predictReq)
	if err != nil {
		t.Fatalf("Predict returned error: %v", err)
	}

	if len(spy.requests) != 1 {
		t.Fatalf("expected 1 request to spy, got %d", len(spy.requests))
	}
	if spy.auths[0] != "Bearer sk-proj-test-key" {
		t.Errorf("expected Bearer sk-proj-test-key, got %s", spy.auths[0])
	}
	if spy.urls[0] != DefaultOpenAIDecisionsURL {
		t.Errorf("expected URL %s, got %s", DefaultOpenAIDecisionsURL, spy.urls[0])
	}

	if len(resp.Candidates) == 0 {
		t.Fatal("expected ranked candidates, got empty")
	}

	// Verify the top candidate has highest confidence (~0.80)
	if resp.Candidates[0].Confidence < 0.79 {
		t.Errorf("expected top candidate confidence ~0.80, got %f", resp.Candidates[0].Confidence)
	}
}

func TestOpenAIDecision_SystemOneDispatch(t *testing.T) {
	cfg := ClientConfig{
		Model:     "gpt-6-luna",
		OpenAIKey: "sk-proj-test-key",
	}

	client, spy := newOpenAISpyClient(t, cfg, func(req OpenAIDecisionRequest) (*http.Response, error) {
		respObj := OpenAIDecisionResponse{
			ID:    "dec_systemone",
			Model: "gpt-6-luna",
			Answers: []OpenAIDecisionAnswer{
				{
					Name:        "action_mode",
					Type:        "choice",
					Choice:      "direct_execution",
					Confidence:  0.95,
				},
				{
					Name:        "needs_llm",
					Type:        "predicate",
					Probability: 0.05,
				},
				{
					Name:  "risk_level",
					Type:  "score",
					Score: 0.1,
				},
			},
		}
		bytes, _ := json.Marshal(respObj)
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(string(bytes))),
		}, nil
	})

	router := NewAgentRouter(client, 0.85)
	plan, err := router.DispatchSystemOne(context.Background(), "git diff")
	if err != nil {
		t.Fatalf("DispatchSystemOne returned error: %v", err)
	}

	if len(spy.requests) != 1 {
		t.Fatalf("expected 1 request to spy, got %d", len(spy.requests))
	}

	if plan.ActionType != "direct" {
		t.Errorf("expected direct action type, got %s", plan.ActionType)
	}
	if plan.ShouldEscalate {
		t.Error("expected ShouldEscalate = false for direct execution")
	}
}

func TestOpenAIDecision_PrivacyContractNoNetwork(t *testing.T) {
	// When nothing is configured, no network request must be attempted.
	client := NewClient(ClientConfig{})
	client.httpClient.Transport = &failingRoundTripper{t: t}

	resp, err := client.Predict(context.Background(), JevPredictRequest{
		BufferContext: "some note text",
	})
	if err != nil {
		t.Fatalf("expected local fallback without error, got %v", err)
	}
	if len(resp.Candidates) == 0 {
		t.Error("expected local heuristic candidates, got empty")
	}
}
