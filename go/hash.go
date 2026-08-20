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

// VerifyFailureCode says why a chain failed to verify. These codes are the
// cross-language contract — every SDK returns the same code for the same
// corruption, asserted by chainFixtures in spec/parity-corpus.json.
type VerifyFailureCode string

const (
	// HashPreviousMismatch: an event's HashPrevious is not the prior event's
	// HashCurrent — the LINK is wrong: a reorder, a deletion, a truncated head,
	// a rewritten link.
	HashPreviousMismatch VerifyFailureCode = "hash_previous_mismatch"
	// HashCurrentMismatch: the event's own content no longer hashes to its
	// stored HashCurrent — the event BODY was edited after sealing.
	HashCurrentMismatch VerifyFailureCode = "hash_current_mismatch"
)

// ChainVerification is the verdict from VerifyChain. BrokenAt and Code are only
// meaningful when OK is false.
type ChainVerification struct {
	OK bool
	// BrokenAt is the index of the first event that failed.
	BrokenAt int
	// Code says why it failed.
	Code VerifyFailureCode
}

// VerifyChain verifies an ordered chain: it recomputes every HashCurrent and
// confirms each HashPrevious matches the prior event's HashCurrent.
//
// genesisPreviousHash is the hash the FIRST event must link to — pass the chain
// head you already have when verifying a slice that continues an existing chain.
// Pass "" only when events starts at the true beginning of the chain (first
// event of the org's day), where HashPrevious must be nil.
//
// What replay cannot see: removing events from the TAIL leaves a chain that
// still verifies — every remaining link is genuine. Detecting that needs an
// external anchor (a stored chain head, an expected count) compared against the
// last event's HashCurrent. OK means "nothing here was altered", not "nothing is
// missing"; the corpus pins this as an explicit fixture so the limit stays
// visible.
func VerifyChain(events []AuditEvent, genesisPreviousHash string) (ChainVerification, error) {
	previous := genesisPreviousHash
	for i, event := range events {
		stored := ""
		if event.HashPrevious != nil {
			stored = *event.HashPrevious
		}
		if stored != previous {
			return ChainVerification{BrokenAt: i, Code: HashPreviousMismatch}, nil
		}
		recomputed, err := ComputeEventHash(event)
		if err != nil {
			return ChainVerification{}, err
		}
		if event.HashCurrent != recomputed {
			return ChainVerification{BrokenAt: i, Code: HashCurrentMismatch}, nil
		}
		previous = recomputed
	}
	return ChainVerification{OK: true}, nil
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
