package audit

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"go.opentelemetry.io/otel/trace"
)

// corpus mirrors ../spec/parity-corpus.json — the single committed cross-language
// source of truth. Each fixture's decoded `event` must canonicalize to the exact
// `expectedCanonical` bytes and hash to `expectedHash`.
type corpus struct {
	Fixtures []struct {
		Name              string          `json:"name"`
		Description       string          `json:"description"`
		Event             json.RawMessage `json:"event"`
		ExpectedCanonical string          `json:"expectedCanonical"`
		ExpectedHash      string          `json:"expectedHash"`
	} `json:"fixtures"`
	// ChainFixtures are REAL chains sealed by the TS builder and then tampered
	// with. `Expected` is the verdict every language must return — this is the
	// half of the corpus that proves DETECTION rather than sealing.
	ChainFixtures []struct {
		Name                string        `json:"name"`
		Description         string        `json:"description"`
		GenesisPreviousHash string        `json:"genesisPreviousHash"`
		Events              []AuditEvent  `json:"events"`
		Expected            expectedChain `json:"expected"`
	} `json:"chainFixtures"`
}

type expectedChain struct {
	OK       bool              `json:"ok"`
	BrokenAt int               `json:"brokenAt"`
	Code     VerifyFailureCode `json:"code"`
}

func loadCorpus(t *testing.T) corpus {
	t.Helper()
	path := filepath.Join("..", "spec", "parity-corpus.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read corpus %s: %v", path, err)
	}
	var c corpus
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatalf("parse corpus: %v", err)
	}
	if len(c.Fixtures) == 0 {
		t.Fatal("corpus has no fixtures")
	}
	return c
}

// decodeEvent decodes raw event JSON into the generic value domain CanonicalJSON
// operates on. UseNumber keeps numbers as source text; present nulls survive as
// nil (and thus render), absent fields simply never appear.
func decodeEvent(t *testing.T, raw json.RawMessage) any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("decode event: %v", err)
	}
	return v
}

func TestParityCorpus(t *testing.T) {
	c := loadCorpus(t)
	for _, f := range c.Fixtures {
		t.Run(f.Name, func(t *testing.T) {
			v := decodeEvent(t, f.Event)

			got, err := CanonicalJSON(v)
			if err != nil {
				t.Fatalf("CanonicalJSON: %v", err)
			}
			if got != f.ExpectedCanonical {
				t.Fatalf("canonical mismatch\n got: %s\nwant: %s", got, f.ExpectedCanonical)
			}

			sum := sha256.Sum256([]byte(got))
			gotHash := hex.EncodeToString(sum[:])
			if gotHash != f.ExpectedHash {
				t.Fatalf("hash mismatch\n got: %s\nwant: %s", gotHash, f.ExpectedHash)
			}
		})
	}
}

// TestComputeEventHashMatchesCorpus verifies the typed AuditEvent path produces
// the same hash as the raw-JSON path, proving the struct + json tags round-trip
// through toGeneric to identical canonical bytes. Only fixtures the typed struct
// can represent losslessly are checked: metadata-with-array and explicit-null
// diffs would need any/omitempty to distinguish absent from present-null, which
// the raw path (the actual parity gate, TestParityCorpus) already covers.
func TestComputeEventHashMatchesCorpus(t *testing.T) {
	typedFixtures := map[string]bool{
		"minimal_first_of_day":           true,
		"chained_with_hash_previous":     true,
		"denied_outcome_with_reason":     true,
		"vertical_app_ops_with_integers": true,
	}
	for _, f := range loadCorpus(t).Fixtures {
		if !typedFixtures[f.Name] {
			continue
		}
		t.Run(f.Name, func(t *testing.T) {
			var ev AuditEvent
			if err := json.Unmarshal(f.Event, &ev); err != nil {
				t.Fatalf("unmarshal into AuditEvent: %v", err)
			}
			got, err := ComputeEventHash(ev)
			if err != nil {
				t.Fatalf("ComputeEventHash: %v", err)
			}
			if got != f.ExpectedHash {
				t.Fatalf("typed-path hash mismatch\n got: %s\nwant: %s", got, f.ExpectedHash)
			}
		})
	}
}

// TestBuildHashChainLinks verifies HashPrevious threading: genesis omitted, then
// each event's HashPrevious equals the prior HashCurrent.
func TestBuildHashChainLinks(t *testing.T) {
	events := []AuditEvent{
		{ID: "1", OrganizationID: "org-1", ActorType: ActorSystem, ActorID: "sys", Action: "user.signin", Resource: AuditResource{Type: "user", ID: "u1"}, Outcome: OutcomeSuccess, Metadata: map[string]any{}, Timestamp: "2026-07-14T00:00:00.000Z"},
		{ID: "2", OrganizationID: "org-1", ActorType: ActorSystem, ActorID: "sys", Action: "user.signout", Resource: AuditResource{Type: "user", ID: "u1"}, Outcome: OutcomeSuccess, Metadata: map[string]any{}, Timestamp: "2026-07-14T00:00:01.000Z"},
	}
	chain, err := BuildHashChain(events, "")
	if err != nil {
		t.Fatalf("BuildHashChain: %v", err)
	}
	if chain[0].HashPrevious != nil {
		t.Fatalf("genesis HashPrevious must be nil, got %q", *chain[0].HashPrevious)
	}
	if chain[0].HashCurrent == "" {
		t.Fatal("chain[0] HashCurrent not set")
	}
	if chain[1].HashPrevious == nil || *chain[1].HashPrevious != chain[0].HashCurrent {
		t.Fatal("chain[1] HashPrevious must equal chain[0] HashCurrent")
	}
}

func TestIsNamespacedAction(t *testing.T) {
	ok := []string{"crm.contact_created", "google.gmail.message_sent", "fieldops.task_submitted"}
	bad := []string{"nodot", "Crm.Contact", "crm.", ".verb", "crm..verb"}
	for _, a := range ok {
		if !IsNamespacedAction(a) {
			t.Errorf("expected %q to be a valid namespaced action", a)
		}
	}
	for _, a := range bad {
		if IsNamespacedAction(a) {
			t.Errorf("expected %q to be rejected", a)
		}
	}
}

// TestEmitPostsCanonicalBytes verifies Emit seals the event and POSTs its
// canonical JSON with the bearer token.
func TestEmitPostsCanonicalBytes(t *testing.T) {
	var gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	ev := AuditEvent{
		ID: "1", OrganizationID: "org-1", ActorType: ActorSystem, ActorID: "sys",
		Action: "user.signin", Resource: AuditResource{Type: "user", ID: "u1"},
		Outcome: OutcomeSuccess, Metadata: map[string]any{}, Timestamp: "2026-07-14T00:00:00.000Z",
	}
	client := NewClient(srv.URL, "tok-123")
	if err := client.Emit(context.Background(), ev); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if gotAuth != "Bearer tok-123" {
		t.Fatalf("Authorization = %q, want Bearer tok-123", gotAuth)
	}
	// Body must be the envelope whose "event" is the sealed event's canonical
	// JSON (includes hashCurrent), and that hashCurrent must equal
	// ComputeEventHash of the pre-seal event.
	hash, _ := ComputeEventHash(ev)
	var decoded map[string]any
	if err := json.Unmarshal([]byte(gotBody), &decoded); err != nil {
		t.Fatalf("emitted body not JSON: %v", err)
	}
	sealed, ok := decoded["event"].(map[string]any)
	if !ok {
		t.Fatalf("envelope has no event object: %v", decoded)
	}
	if sealed["hashCurrent"] != hash {
		t.Fatalf("emitted hashCurrent = %v, want %s", sealed["hashCurrent"], hash)
	}
}

// tracedContext returns a context carrying a valid, non-recording W3C span
// context — the otel API alone, no SDK, so the test has no exporter to wire up.
func tracedContext(traceID, spanID string) context.Context {
	tid, err := trace.TraceIDFromHex(traceID)
	if err != nil {
		panic(err)
	}
	sid, err := trace.SpanIDFromHex(spanID)
	if err != nil {
		panic(err)
	}
	sc := trace.NewSpanContext(trace.SpanContextConfig{TraceID: tid, SpanID: sid, TraceFlags: trace.FlagsSampled})
	return trace.ContextWithSpanContext(context.Background(), sc)
}

// captureEmit runs Emit against a throwaway server and returns the decoded body.
func captureEmit(t *testing.T, ctx context.Context, ev AuditEvent) map[string]any {
	t.Helper()
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()
	if err := NewClient(srv.URL, "tok").Emit(ctx, ev); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(body), &decoded); err != nil {
		t.Fatalf("emitted body not JSON: %v", err)
	}
	return decoded
}

func sampleEvent() AuditEvent {
	return AuditEvent{
		ID: "1", OrganizationID: "org-1", ActorType: ActorSystem, ActorID: "sys",
		Action: "user.signin", Resource: AuditResource{Type: "user", ID: "u1"},
		Outcome: OutcomeSuccess, Metadata: map[string]any{}, Timestamp: "2026-07-14T00:00:00.000Z",
	}
}

// TestEmitEnvelopeCarriesTraceContext: with an active span the envelope carries
// the W3C ids.
func TestEmitEnvelopeCarriesTraceContext(t *testing.T) {
	ctx := tracedContext("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7")
	decoded := captureEmit(t, ctx, sampleEvent())
	if decoded["traceId"] != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Fatalf("traceId = %v, want 4bf92f3577b34da6a3ce929d0e0e4736", decoded["traceId"])
	}
	if decoded["spanId"] != "00f067aa0ba902b7" {
		t.Fatalf("spanId = %v, want 00f067aa0ba902b7", decoded["spanId"])
	}
}

// TestEmitOmitsTraceContextWithoutSpan: no span → the keys are ABSENT, not
// zeroed and not empty.
func TestEmitOmitsTraceContextWithoutSpan(t *testing.T) {
	decoded := captureEmit(t, context.Background(), sampleEvent())
	if _, ok := decoded["traceId"]; ok {
		t.Fatalf("traceId must be omitted without a span, got %v", decoded["traceId"])
	}
	if _, ok := decoded["spanId"]; ok {
		t.Fatalf("spanId must be omitted without a span, got %v", decoded["spanId"])
	}
}

// TestEmitHashUnchangedByTraceContext is the hash-chain regression gate: every
// typed corpus fixture must seal to its committed expectedHash whether or not a
// span is active, and the envelope minus the trace ids must be the byte-exact
// canonical preimage-plus-hash the verifier replays.
func TestEmitHashUnchangedByTraceContext(t *testing.T) {
	typedFixtures := map[string]bool{
		"minimal_first_of_day":           true,
		"chained_with_hash_previous":     true,
		"denied_outcome_with_reason":     true,
		"vertical_app_ops_with_integers": true,
	}
	traced := tracedContext("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7")
	for _, f := range loadCorpus(t).Fixtures {
		if !typedFixtures[f.Name] {
			continue
		}
		t.Run(f.Name, func(t *testing.T) {
			var ev AuditEvent
			if err := json.Unmarshal(f.Event, &ev); err != nil {
				t.Fatalf("unmarshal into AuditEvent: %v", err)
			}
			for _, tc := range []struct {
				name string
				ctx  context.Context
			}{{"no_span", context.Background()}, {"active_span", traced}} {
				t.Run(tc.name, func(t *testing.T) {
					decoded := captureEmit(t, tc.ctx, ev)
					sealed, ok := decoded["event"].(map[string]any)
					if !ok {
						t.Fatalf("envelope has no event object: %v", decoded)
					}
					if sealed["hashCurrent"] != f.ExpectedHash {
						t.Fatalf("hashCurrent = %v, want %s", sealed["hashCurrent"], f.ExpectedHash)
					}
					// The event minus its own hash must be the committed
					// canonical bytes — trace ids live outside it.
					delete(sealed, "hashCurrent")
					reencoded, err := json.Marshal(sealed)
					if err != nil {
						t.Fatalf("marshal: %v", err)
					}
					preimage := decodeEvent(t, reencoded)
					got, err := CanonicalJSON(preimage)
					if err != nil {
						t.Fatalf("CanonicalJSON: %v", err)
					}
					if got != f.ExpectedCanonical {
						t.Fatalf("canonical mismatch\n got: %s\nwant: %s", got, f.ExpectedCanonical)
					}
				})
			}
		})
	}
}

// TestChainCorpus is the detection gate. The fixture corpus above proves only
// that a hash is reproducible in five languages; it says nothing about whether
// any of them can SPOT a broken chain, which is the property "tamper-evident"
// actually names.
func TestChainCorpus(t *testing.T) {
	c := loadCorpus(t)
	if len(c.ChainFixtures) == 0 {
		t.Fatal("chainFixtures missing from the corpus")
	}
	sawBroken := false
	for _, f := range c.ChainFixtures {
		if !f.Expected.OK {
			sawBroken = true
		}
		t.Run(f.Name, func(t *testing.T) {
			got, err := VerifyChain(f.Events, f.GenesisPreviousHash)
			if err != nil {
				t.Fatalf("VerifyChain: %v", err)
			}
			if got.OK != f.Expected.OK {
				t.Fatalf("ok mismatch: got %v want %v — %s", got.OK, f.Expected.OK, f.Description)
			}
			if f.Expected.OK {
				return
			}
			if got.BrokenAt != f.Expected.BrokenAt {
				t.Fatalf("brokenAt mismatch: got %d want %d", got.BrokenAt, f.Expected.BrokenAt)
			}
			if got.Code != f.Expected.Code {
				t.Fatalf("code mismatch: got %q want %q", got.Code, f.Expected.Code)
			}
		})
	}
	if !sawBroken {
		t.Fatal("no tampered chain to detect — the corpus would prove nothing about verification")
	}
}
