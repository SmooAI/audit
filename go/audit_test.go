package audit

import (
	"encoding/json"
	"errors"
	"testing"
)

func sampleEvent() Event {
	resource := "contact:xyz"
	prev := ""
	return Event{
		ID:           "11111111-1111-1111-1111-111111111111",
		OrgID:        "org_123",
		Timestamp:    "2026-07-14T00:00:00.000Z",
		Actor:        "user_abc",
		Action:       "record.delete",
		Resource:     &resource,
		Metadata:     map[string]any{"reason": "gdpr"},
		PreviousHash: &prev,
	}
}

func TestEventRoundtripsThroughJSON(t *testing.T) {
	event := sampleEvent()
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var parsed Event
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed.Action != event.Action {
		t.Fatalf("got action %q, want %q", parsed.Action, event.Action)
	}
}

func TestCanonicalJSONIsStubbed(t *testing.T) {
	if _, err := CanonicalJSON(sampleEvent()); !errors.Is(err, ErrNotImplemented) {
		t.Fatalf("expected ErrNotImplemented, got %v", err)
	}
}
