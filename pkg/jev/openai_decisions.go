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

// Official OpenAI Decisions API constants
const (
	DefaultOpenAIDecisionsURL = "https://api.openai.com/v1/decisions"
	DefaultOpenAIDecisionModel = "gpt-6-luna"
)

// OpenAIDecisionChoice represents an option in a choice-type question.
type OpenAIDecisionChoice struct {
	Value       string `json:"value"`
	Description string `json:"description,omitempty"`
}

// OpenAIDecisionQuestion represents a single structured question for the Decisions API.
type OpenAIDecisionQuestion struct {
	Name         string                 `json:"name"`
	Type         string                 `json:"type"` // "choice", "predicate", "score"
	Instructions string                 `json:"instructions"`
	Choices      []OpenAIDecisionChoice `json:"choices,omitempty"`
	Levels       []string               `json:"levels,omitempty"`
}

// OpenAIDecisionRequest represents the payload for POST /v1/decisions.
type OpenAIDecisionRequest struct {
	Model     string                   `json:"model"`
	Input     interface{}              `json:"input"`
	Questions []OpenAIDecisionQuestion `json:"questions"`
}

// OpenAIDecisionAnswer represents the answer for a single question from /v1/decisions.
type OpenAIDecisionAnswer struct {
	Name          string             `json:"name"`
	Type          string             `json:"type"` // "choice", "predicate", "score", "refusal"
	Choice        string             `json:"choice,omitempty"`
	Probability   float64            `json:"probability,omitempty"` // For predicate
	Score         float64            `json:"score,omitempty"`       // For score
	Confidence    float64            `json:"confidence,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
	Refusal       string             `json:"refusal,omitempty"`
}

// OpenAIDecisionResponse is the response body returned by the Decisions API.
type OpenAIDecisionResponse struct {
	ID      string                 `json:"id,omitempty"`
	Model   string                 `json:"model,omitempty"`
	Answers []OpenAIDecisionAnswer `json:"answers"`
	Usage   struct {
		InputTokens  int `json:"input_tokens,omitempty"`
		OutputTokens int `json:"output_tokens,omitempty"`
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// isOpenAIDecisionModel reports whether model names an OpenAI decision model (e.g. "gpt-6-luna", "luna").
func isOpenAIDecisionModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	m = strings.TrimPrefix(m, "openai/")
	return strings.HasPrefix(m, "gpt-6-luna") ||
		strings.Contains(m, "luna") ||
		strings.HasPrefix(m, "decision")
}

// isOpenAIEndpoint reports whether endpoint points to OpenAI's API.
func isOpenAIEndpoint(endpoint string) bool {
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
	if host == "api.openai.com" || strings.HasSuffix(host, ".openai.com") {
		return true
	}
	return strings.HasSuffix(strings.ToLower(strings.TrimRight(u.Path, "/")), "/v1/decisions")
}

// looksLikeOpenAIKey reports whether key has an OpenAI secret key shape (sk-proj-... or sk-..., but not sk-or-...).
func looksLikeOpenAIKey(key string) bool {
	k := strings.TrimSpace(key)
	if strings.HasPrefix(k, "sk-or-") {
		return false
	}
	return strings.HasPrefix(k, "sk-proj-") || strings.HasPrefix(k, "sk-")
}

// openAIDecisionsURL builds the full endpoint URL for /v1/decisions from a base URL or endpoint.
func openAIDecisionsURL(endpoint string) string {
	e := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if e == "" {
		return DefaultOpenAIDecisionsURL
	}
	if !strings.Contains(e, "://") {
		e = "https://" + e
	}
	lower := strings.ToLower(e)
	if strings.HasSuffix(lower, "/v1/decisions") {
		return e
	}
	if strings.HasSuffix(lower, "/v1") {
		return e + "/decisions"
	}
	return e + "/v1/decisions"
}

// openAIDecisionTarget resolves the endpoint and API key when configured for OpenAI Decisions,
// or ("", "") if not configured for OpenAI.
func (c *Client) openAIDecisionTarget(model string) (endpoint, key string) {
	ep := strings.TrimSpace(c.cfg.Endpoint)
	k := c.getOpenAIKey()

	// 1. Explicit OpenAI endpoint with a valid key
	if isOpenAIEndpoint(ep) {
		if k != "" {
			return openAIDecisionsURL(ep), k
		}
	}

	// 2. Explicit OpenAI Decision model (e.g. gpt-6-luna) with an OpenAI-shaped key
	if isOpenAIDecisionModel(model) && k != "" {
		if ep == "" || isOpenAIEndpoint(ep) || (!isOpenRouterEndpoint(ep) && !isTypeSafeEndpoint(ep)) {
			return openAIDecisionsURL(ep), k
		}
	}

	// 3. OpenAI key configured and endpoint points to OpenAI, even if model is blank
	if looksLikeOpenAIKey(k) && isOpenAIEndpoint(ep) {
		return openAIDecisionsURL(ep), k
	}

	return "", ""
}

func (c *Client) getOpenAIKey() string {
	if c.cfg.OpenAIKey != "" {
		return c.cfg.OpenAIKey
	}
	if looksLikeOpenAIKey(c.cfg.APIKey) {
		return c.cfg.APIKey
	}
	if c.cfg.AllowGenericEnvKeys {
		return os.Getenv("OPENAI_API_KEY")
	}
	return ""
}

// systemOneToOpenAIDecisionRequest maps a generic SystemOneRequest to OpenAI's /v1/decisions format.
func systemOneToOpenAIDecisionRequest(req SystemOneRequest) OpenAIDecisionRequest {
	model := req.Model
	if model == "" || !isOpenAIDecisionModel(model) {
		model = DefaultOpenAIDecisionModel
	}

	// Sort question keys for deterministic order
	qKeys := make([]string, 0, len(req.Questions))
	for k := range req.Questions {
		qKeys = append(qKeys, k)
	}
	sort.Strings(qKeys)

	questions := make([]OpenAIDecisionQuestion, 0, len(qKeys))
	for _, qID := range qKeys {
		sq := req.Questions[qID]
		q := OpenAIDecisionQuestion{
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
				choices := make([]OpenAIDecisionChoice, 0, len(cVals))
				for _, v := range cVals {
					choices = append(choices, OpenAIDecisionChoice{
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
				choices := make([]OpenAIDecisionChoice, 0, len(cVals))
				for _, v := range cVals {
					desc, _ := criteriaMapI[v].(string)
					choices = append(choices, OpenAIDecisionChoice{
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

	return OpenAIDecisionRequest{
		Model:     model,
		Input:     req.State,
		Questions: questions,
	}
}

// openAIDecisionToSystemOneResponse maps an OpenAI Decisions API response back to a SystemOneResponse.
func openAIDecisionToSystemOneResponse(oResp OpenAIDecisionResponse) *SystemOneResponse {
	answers := make(map[string]SystemOneAnswer, len(oResp.Answers))

	for _, a := range oResp.Answers {
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
		Model:   oResp.Model,
		Answers: answers,
		Usage: SystemOneUsage{
			InputTokens:  oResp.Usage.InputTokens,
			OutputTokens: oResp.Usage.OutputTokens,
		},
	}
}

// callOpenAIDecisionAPI executes a request against the OpenAI Decisions API.
func (c *Client) callOpenAIDecisionAPI(ctx context.Context, endpoint, apiKey string, req SystemOneRequest) (*SystemOneResponse, error) {
	oReq := systemOneToOpenAIDecisionRequest(req)
	payloadBytes, err := json.Marshal(oReq)
	if err != nil {
		return nil, fmt.Errorf("openai decisions: failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(payloadBytes))
	if err != nil {
		return nil, fmt.Errorf("openai decisions: failed to create http request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("openai decisions: request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("openai decisions: failed to read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openai decisions: api returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var oResp OpenAIDecisionResponse
	if err := json.Unmarshal(bodyBytes, &oResp); err != nil {
		return nil, fmt.Errorf("openai decisions: failed to unmarshal response: %w", err)
	}

	if oResp.Error != nil && oResp.Error.Message != "" {
		return nil, fmt.Errorf("openai decisions error: %s", oResp.Error.Message)
	}

	return openAIDecisionToSystemOneResponse(oResp), nil
}

// predictOpenAIDecision ranks local candidates using OpenAI Decisions API (e.g. gpt-6-luna).
func (c *Client) predictOpenAIDecision(ctx context.Context, endpoint, apiKey string, req JevPredictRequest) (*JevPredictResponse, error) {
	if strings.TrimSpace(req.BufferContext) == "" {
		return nil, errors.New("openai decisions: empty note excerpt, nothing to rank")
	}

	pool := c.localCandidatePool(req)
	options := make([]string, len(pool))
	criteria := make(map[string]string, len(pool))
	for i, cand := range pool {
		options[i] = systemOneOptionKey(i, cand)
		criteria[options[i]] = cand.Description + " - " + cand.Command
	}

	model := c.cfg.Model
	if model == "" || !isOpenAIDecisionModel(model) {
		model = DefaultOpenAIDecisionModel
	}

	resp, err := c.callOpenAIDecisionAPI(ctx, endpoint, apiKey, SystemOneRequest{
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
		return nil, errors.New("openai decisions: no usable choice answer")
	}
	if ans.Confidence < systemOneMinConfidence && len(ans.Probabilities) == 0 && ans.Choice == "" {
		return nil, errors.New("openai decisions: answer too uncertain to reorder candidates")
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
