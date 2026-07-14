package audit

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// ComputeEventHash returns the lowercase hex SHA-256 of an event's canonical
// JSON. The event is hashed WITHOUT its own HashCurrent (empty → omitted by
// json tag) and WITH HashPrevious already set to the chain head (or nil on the
// first event of a day) — the same input the TS computeEventHash feeds to the
// canonical serializer.
func ComputeEventHash(event AuditEvent) (string, error) {
	event.HashCurrent = "" // never include the current hash in its own preimage
	generic, err := toGeneric(event)
	if err != nil {
		return "", err
	}
	return hashGeneric(generic)
}

// BuildHashChain folds events into a per-org-per-day chain, stamping each event
// with its HashPrevious (the prior event's HashCurrent) and HashCurrent.
// genesisHash seeds the chain ("" for a fresh chain → first event's HashPrevious
// is omitted, not null). Returns sealed copies; the input slice is not mutated.
func BuildHashChain(events []AuditEvent, genesisHash string) ([]AuditEvent, error) {
	out := make([]AuditEvent, len(events))
	prev := genesisHash
	for i, e := range events {
		if prev == "" {
			e.HashPrevious = nil
		} else {
			p := prev
			e.HashPrevious = &p
		}
		hash, err := ComputeEventHash(e)
		if err != nil {
			return nil, err
		}
		e.HashCurrent = hash
		out[i] = e
		prev = hash
	}
	return out, nil
}

// hashGeneric canonicalizes a decoded JSON value and returns hex(SHA-256(bytes)).
func hashGeneric(v any) (string, error) {
	canonical, err := CanonicalJSON(v)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:]), nil
}

// toGeneric marshals a typed value to JSON then decodes it back into the generic
// value domain CanonicalJSON expects. Marshaling applies omitempty (absent
// optionals dropped, mirroring TS undefined-omission); UseNumber keeps numbers
// as source text so integer rendering matches JS.
func toGeneric(v any) (any, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var out any
	if err := dec.Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}
