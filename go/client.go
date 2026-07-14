package audit

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// AuditClient emits audit events to a configurable ingest endpoint over HTTP.
// Zero external deps — stdlib net/http only.
type AuditClient struct {
	// Endpoint is the audit ingest URL events are POSTed to.
	Endpoint string
	// Token is the bearer token sent as "Authorization: Bearer <token>".
	// Optional — omitted when empty.
	Token string
	// HTTPClient overrides the HTTP client. Defaults to http.DefaultClient.
	HTTPClient *http.Client
}

// NewClient returns an AuditClient bound to the given endpoint + token.
func NewClient(endpoint, token string) *AuditClient {
	return &AuditClient{Endpoint: endpoint, Token: token}
}

// Emit seals the event into the hash chain (computes and attaches HashCurrent)
// and POSTs its canonical JSON to the ingest endpoint with the bearer token.
// The canonical bytes on the wire are the exact preimage-plus-hash the
// verifier replays, so every store agrees byte-for-byte.
func (c *AuditClient) Emit(ctx context.Context, event AuditEvent) error {
	hash, err := ComputeEventHash(event)
	if err != nil {
		return err
	}
	event.HashCurrent = hash

	generic, err := toGeneric(event)
	if err != nil {
		return err
	}
	body, err := CanonicalJSON(generic)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("audit: ingest failed: HTTP %d", resp.StatusCode)
	}
	return nil
}
