package jev

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
)

// Official Google Gemini Decisions API constants
const (
	DefaultGeminiDecisionsURL  = "https://generativelanguage.googleapis.com/v1beta/decisions"
	DefaultGeminiDecisionModel = "gemini-decision-1"
)

// GeminiDecisionChoice represents an option in a choice-type question.
type GeminiDecisionChoice struct {
	Value       string `json:"value"`
	Description string `json:"description,omitempty"`
}

// GeminiDecisionQuestion represents a single structured question for the Gemini Decisions API.
type GeminiDecisionQuestion struct {
	Name         string                 `json:"name"`
	Type         string                 `json:"type"` // "choice", "predicate", "score"
	Instructions string                 `json:"instructions"`
	Choices      []GeminiDecisionChoice `json:"choices,omitempty"`
	Levels       []string               `json:"levels,omitempty"`
}

// GeminiDecisionRequest represents the payload for POST /v1beta/decisions.
type GeminiDecisionRequest struct {
	Model     string                   `json:"model"`
	Input     interface{}              `json:"input"`
	Questions []GeminiDecisionQuestion `json:"questions"`
}

// GeminiDecisionAnswer represents the answer for a single question from Gemini Decisions API.
type GeminiDecisionAnswer struct {
	Name          string             `json:"name"`
	Type          string             `json:"type"` // "choice", "predicate", "score", "refusal"
	Choice        string             `json:"choice,omitempty"`
	Probability   float64            `json:"probability,omitempty"` // For predicate
	Score         float64            `json:"score,omitempty"`       // For score
	Confidence    float64            `json:"confidence,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
	Refusal       string             `json:"refusal,omitempty"`
}

// GeminiDecisionResponse is the response body returned by the Gemini Decisions API.
type GeminiDecisionResponse struct {
	ID      string                 `json:"id,omitempty"`
	Model   string                 `json:"model,omitempty"`
	Answers []GeminiDecisionAnswer `json:"answers"`
	Usage   struct {
		InputTokens  int `json:"input_tokens,omitempty"`
		OutputTokens int `json:"output_tokens,omitempty"`
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
		Code    int    `json:"code,omitempty"`
	} `json:"error,omitempty"`
}

// isGeminiDecisionModel reports whether model names a Gemini decision model (e.g. "gemini-decision-1", "gemini-decision").
func isGeminiDecisionModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	m = strings.TrimPrefix(m, "google/")
	m = strings.TrimPrefix(m, "models/")
	return strings.HasPrefix(m, "gemini-decision") ||
		strings.Contains(m, "gemini-decision")
}

// isGeminiEndpoint reports whether endpoint points to Google Generative Language API or custom Gemini decision proxy.
func isGeminiEndpoint(endpoint string) bool {
	e := strings.TrimSpace(endpoint)
	if e == "" {
		return false
	}
	if !strings.Contains(e, "://") {
		e = "https://" + e
	}
	u, err := url.Parse(e)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "generativelanguage.googleapis.com" || strings.HasSuffix(host, ".googleapis.com") {
		return true
	}
	return strings.HasSuffix(strings.ToLower(strings.TrimRight(u.Path, "/")), "/decisions")
}

// looksLikeGeminiKey reports whether key has a Google / Gemini secret key shape (typically AIzaSy...).
func looksLikeGeminiKey(key string) bool {
	k := strings.TrimSpace(key)
	if strings.HasPrefix(k, "sk-") {
		return false
	}
	return strings.HasPrefix(k, "AIza")
}

// geminiDecisionsURL builds the full endpoint URL for /decisions from a base URL or endpoint.
func geminiDecisionsURL(endpoint string) string {
	e := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if e == "" {
		return DefaultGeminiDecisionsURL
	}
	if !strings.Contains(e, "://") {
		e = "https://" + e
	}
	lower := strings.ToLower(e)
	if strings.HasSuffix(lower, "/decisions") {
		return e
	}
	if strings.HasSuffix(lower, "/v1beta") || strings.HasSuffix(lower, "/v1") {
		return e + "/decisions"
	}
	return e + "/v1beta/decisions"
}

// geminiDecisionTarget resolves the endpoint and API key when configured for Gemini Decisions,
// or ("", "") if not configured for Gemini.
func (c *Client) geminiDecisionTarget(model string) (endpoint, key string) {
	ep := strings.TrimSpace(c.cfg.Endpoint)
	k := c.getGeminiKey()

	// 1. Explicit Gemini endpoint with a valid key
	if isGeminiEndpoint(ep) {
		if k != "" {
			return geminiDecisionsURL(ep), k
		}
	}

	// 2. Explicit Gemini Decision model (or default model) with a Gemini-compatible key
	if isGeminiDecisionModel(model) && k != "" {
		if ep == "" || isGeminiEndpoint(ep) || (!isOpenRouterEndpoint(ep) && !isTypeSafeEndpoint(ep) && !isOpenAIEndpoint(ep)) {
			return geminiDecisionsURL(ep), k
		}
	}

	// 3. Gemini key configured and endpoint points to Gemini, or empty endpoint
	if looksLikeGeminiKey(k) && (ep == "" || isGeminiEndpoint(ep)) {
		return geminiDecisionsURL(ep), k
	}

	return "", ""
}

func (c *Client) getGeminiKey() string {
	if c.cfg.GeminiKey != "" {
		return c.cfg.GeminiKey
	}
	if looksLikeGeminiKey(c.cfg.APIKey) {
		return c.cfg.APIKey
	}
	if c.cfg.AllowGenericEnvKeys {
		if k := os.Getenv("GEMINI_API_KEY"); k != "" {
			return k
		}
		if k := os.Getenv("GOOGLE_API_KEY"); k != "" {
			return k
		}
	}
	return ""
}

// systemOneToGeminiDecisionRequest maps a generic SystemOneRequest to Gemini's decisions format.
func systemOneToGeminiDecisionRequest(req SystemOneRequest) GeminiDecisionRequest {
	model := req.Model
	if model == "" || !isGeminiDecisionModel(model) {
		model = DefaultGeminiDecisionModel
	}

	// Sort question keys for deterministic order
	qKeys := make([]string, 0, len(req.Questions))
	for k := range req.Questions {
		qKeys = append(qKeys, k)
	}
	sort.Strings(qKeys)

	questions := make([]GeminiDecisionQuestion, 0, len(qKeys))
	for _, qID := range qKeys {
		sq := req.Questions[qID]
		q := GeminiDecisionQuestion{
			Name: qID,
		}

		if str, ok := sq.Instructions.(string); ok {
			q.Instructions = str
		} else if sq.Instructions != nil {
			bytes, _ := json.Marshal(sq.Instructions)
			q.Instructions = string(bytes)
		}

		switch sq.Type {
		case QuestionChoice:
			q.Type = "choice"
			if criteriaMap, ok := sq.Criteria.(map[string]string); ok {
				// Sort choice values for deterministic order
				cVals := make([]string, 0, len(criteriaMap))
				for v := range criteriaMap {
					cVals = append(cVals, v)
				}
				sort.Strings(cVals)
				choices := make([]GeminiDecisionChoice, 0, len(cVals))
				for _, v := range cVals {
					choices = append(choices, GeminiDecisionChoice{
						Value:       v,
						Description: criteriaMap[v],
					})
				}
				q.Choices = choices
			} else if criteriaMapI, ok := sq.Criteria.(map[string]interface{}); ok {
				cVals := make([]string, 0, len(criteriaMapI))
				for v := range criteriaMapI {
					cVals = append(cVals, v)
				}
				sort.Strings(cVals)
				choices := make([]GeminiDecisionChoice, 0, len(cVals))
				for _, v := range cVals {
					desc, _ := criteriaMapI[v].(string)
					choices = append(choices, GeminiDecisionChoice{
						Value:       v,
						Description: desc,
					})
				}
				q.Choices = choices
			}
		case QuestionNoul:
			q.Type = "predicate"
		case QuestionScore:
			q.Type = "score"
			if levels, ok := sq.Criteria.([]string); ok {
				q.Levels = levels
			} else if levelsI, ok := sq.Criteria.([]interface{}); ok {
				levels := make([]string, 0, len(levelsI))
				for _, item := range levelsI {
					if str, ok := item.(string); ok {
						levels = append(levels, str)
					}
				}
				q.Levels = levels
			}
		default:
			q.Type = string(sq.Type)
		}

		questions = append(questions, q)
	}

	return GeminiDecisionRequest{
		Model:     model,
		Input:     req.State,
		Questions: questions,
	}
}

// geminiDecisionToSystemOneResponse maps a Gemini Decisions API response back to a SystemOneResponse.
func geminiDecisionToSystemOneResponse(gResp GeminiDecisionResponse) *SystemOneResponse {
	answers := make(map[string]SystemOneAnswer, len(gResp.Answers))

	for _, a := range gResp.Answers {
		sa := SystemOneAnswer{
			Probabilities: a.Probabilities,
			Confidence:    a.Confidence,
		}

		switch a.Type {
		case "choice":
			sa.Type = QuestionChoice
			sa.Choice = a.Choice
			// If probabilities are provided but confidence is 0, estimate confidence from the max probability
			if sa.Confidence <= 0 && len(a.Probabilities) > 0 {
				var maxP float64
				for _, p := range a.Probabilities {
					if p > maxP {
						maxP = p
					}
				}
				n := float64(len(a.Probabilities))
				if n > 1 {
					sa.Confidence = (n*maxP - 1) / (n - 1)
					if sa.Confidence < 0 {
						sa.Confidence = 0
					}
				} else {
					sa.Confidence = maxP
				}
			} else if sa.Confidence <= 0 && a.Choice != "" {
				sa.Confidence = 0.99
			}
		case "predicate":
			sa.Type = QuestionNoul
			sa.Noul = a.Probability
		case "score":
			sa.Type = QuestionScore
			sa.Score = a.Score
			if sa.Confidence <= 0 {
				sa.Confidence = 0.9
			}
		default:
			sa.Type = SystemOneQuestionType(a.Type)
		}

		answers[a.Name] = sa
	}

	return &SystemOneResponse{
		Model:   gResp.Model,
		Answers: answers,
		Usage: SystemOneUsage{
			InputTokens:  gResp.Usage.InputTokens,
			OutputTokens: gResp.Usage.OutputTokens,
		},
	}
}

// callGeminiDecisionAPI executes a request against the Gemini Decisions API.
func (c *Client) callGeminiDecisionAPI(ctx context.Context, endpoint, apiKey string, req SystemOneRequest) (*SystemOneResponse, error) {
	gReq := systemOneToGeminiDecisionRequest(req)
	payloadBytes, err := json.Marshal(gReq)
	if err != nil {
		return nil, fmt.Errorf("gemini decisions: failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(payloadBytes))
	if err != nil {
		return nil, fmt.Errorf("gemini decisions: failed to create http request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", apiKey)
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gemini decisions: request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("gemini decisions: failed to read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gemini decisions: api returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var gResp GeminiDecisionResponse
	if err := json.Unmarshal(bodyBytes, &gResp); err != nil {
		return nil, fmt.Errorf("gemini decisions: failed to unmarshal response: %w", err)
	}

	if gResp.Error != nil && gResp.Error.Message != "" {
		return nil, fmt.Errorf("gemini decisions error: %s", gResp.Error.Message)
	}

	return geminiDecisionToSystemOneResponse(gResp), nil
}

// predictGeminiDecision ranks local candidates using Gemini Decisions API (gemini-decision-1).
func (c *Client) predictGeminiDecision(ctx context.Context, endpoint, apiKey string, req JevPredictRequest) (*JevPredictResponse, error) {
	if strings.TrimSpace(req.BufferContext) == "" {
		return nil, errors.New("gemini decisions: empty note excerpt, nothing to rank")
	}

	pool := c.localCandidatePool(req)
	options := make([]string, len(pool))
	criteria := make(map[string]string, len(pool))
	for i, cand := range pool {
		options[i] = systemOneOptionKey(i, cand)
		criteria[options[i]] = cand.Description + " - " + cand.Command
	}

	model := c.cfg.Model
	if model == "" || !isGeminiDecisionModel(model) {
		model = DefaultGeminiDecisionModel
	}

	resp, err := c.callGeminiDecisionAPI(ctx, endpoint, apiKey, SystemOneRequest{
		State: map[string]string{"note_excerpt": req.BufferContext},
		Model: model,
		Questions: map[string]SystemOneQuestion{
			systemOneRankKey: {
				Type:         QuestionChoice,
				Instructions: systemOneRankInstructions,
				Criteria:     criteria,
			},
		},
	})
	if err != nil {
		return nil, err
	}

	ans, ok := resp.Answers[systemOneRankKey]
	if !ok || ans.Type != QuestionChoice {
		return nil, errors.New("gemini decisions: no usable choice answer")
	}
	if ans.Confidence < systemOneMinConfidence && len(ans.Probabilities) == 0 && ans.Choice == "" {
		return nil, errors.New("gemini decisions: answer too uncertain to reorder candidates")
	}

	ranked := make([]Candidate, len(pool))
	for i, cand := range pool {
		if prob, ok := ans.Probabilities[options[i]]; ok {
			cand.Confidence = prob
		} else if ans.Choice == options[i] {
			cand.Confidence = 0.99
		} else {
			cand.Confidence = 0.01
		}
		ranked[i] = cand
	}

	// Stable sort: options with higher confidence rank first
	sort.SliceStable(ranked, func(a, b int) bool { return ranked[a].Confidence > ranked[b].Confidence })

	return &JevPredictResponse{Candidates: ranked, RawGrammar: req.GrammarSchema}, nil
}
