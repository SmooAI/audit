package audit

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	"go.opentelemetry.io/otel/trace"
)

// AuditClient emits audit events to a configurable ingest endpoint over HTTP.
// Transport is stdlib net/http; the only dependency is the OpenTelemetry trace
// API (no SDK), used to read the ambient span for envelope trace correlation.
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
// and POSTs the canonical JSON envelope to the ingest endpoint with the bearer
// token:
//
//	{"event":{…the sealed event…},"spanId":"…","traceId":"…"}
//
// The bytes under "event" are the exact preimage-plus-hash the verifier
// replays, so every store agrees byte-for-byte; the trace ids ride outside them.
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
	// Trace correlation lives in the ENVELOPE, one level ABOVE the event, never
	// inside it: the hash above is computed from the event alone, so an active
	// span cannot move a single bit of it. The bytes under "event" are identical
	// whether or not a trace is active. With no valid span context both fields
	// are omitted entirely — never an all-zero id, never an empty string.
	envelope := map[string]any{"event": generic}
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		envelope["traceId"] = sc.TraceID().String()
		envelope["spanId"] = sc.SpanID().String()
	}
	body, err := CanonicalJSON(envelope)
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
