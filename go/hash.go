package audit

// ComputeEventHash returns the lowercase hex SHA-256 of an event.
//
// Taken over CanonicalJSON(event) with PreviousHash folded in, forming a
// per-org-per-day tamper-evident chain.
//
// TODO(audit-impl): implement — sha256(previousHash || CanonicalJSON(event)).
func ComputeEventHash(event Event) (string, error) {
	_ = event
	return "", ErrNotImplemented
}

// BuildHashChain folds events into a hash chain, stamping each with its
// PreviousHash. genesisHash seeds the chain ("" for a fresh chain).
//
// TODO(audit-impl): implement the chain fold over ComputeEventHash.
func BuildHashChain(events []Event, genesisHash string) ([]Event, error) {
	_ = events
	_ = genesisHash
	return nil, ErrNotImplemented
}
