package audit

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/otel/trace"
)

// Default retry behaviour, shared with every other language SDK. The numbers
// live in spec/parity-corpus.json's retryPolicy and are asserted there, so they
// cannot drift apart across the five implementations.
const (
	DefaultMaxRetries   = 3
	DefaultRetryBackoff = 100 * time.Millisecond
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
	// MaxRetries is the total number of attempts on a transient failure
	// (transport error or HTTP 5xx). Zero means DefaultMaxRetries.
	MaxRetries int
	// RetryBackoff is the base backoff, doubled on each retry. Zero means
	// DefaultRetryBackoff.
	RetryBackoff time.Duration
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
//
// Transient failures (transport errors and HTTP 5xx) are retried with
// exponential backoff; a 4xx is returned immediately, since it will say the same
// thing on the next attempt. An audit event that silently fails to emit is a
// hole in the record, so the error is always returned — never swallowed. Emit is
// synchronous by design: `go client.Emit(ctx, event)` is how Go does async, and
// ctx cancellation is honoured both in-flight and between retries.
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

	attempts := c.MaxRetries
	if attempts <= 0 {
		attempts = DefaultMaxRetries
	}
	backoff := c.RetryBackoff
	if backoff <= 0 {
		backoff = DefaultRetryBackoff
	}

	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			wait := backoff * (1 << (attempt - 1))
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
		}
		// The request is rebuilt each attempt because its body reader is
		// consumed, but from the SAME canonical bytes — ingest dedupes on the
		// event hash, so a retry must not send a different preimage.
		retryable, err := c.post(ctx, body)
		if err == nil {
			return nil
		}
		if !retryable {
			return err
		}
		lastErr = err
	}
	return lastErr
}

// post sends one attempt. The bool reports whether the failure is transient and
// therefore worth retrying: a 4xx will not succeed on a second try, so it is
// returned as final rather than burning the remaining attempts.
func (c *AuditClient) post(ctx context.Context, body string) (retryable bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, strings.NewReader(body))
	if err != nil {
		return false, err
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
		// A cancelled/expired context is the caller's decision, not a transient
		// blip — retrying it would just burn attempts against a dead deadline.
		if ctx.Err() != nil {
			return false, err
		}
		return true, err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode >= 500, fmt.Errorf("audit: ingest failed: HTTP %d", resp.StatusCode)
	}
	return false, nil
}
