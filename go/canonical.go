package audit

import "errors"

// ErrNotImplemented is returned by stubbed functions pending the parity corpus.
//
// TODO(audit-impl): remove once the corresponding logic lands.
var ErrNotImplemented = errors.New("TODO(audit-impl): not implemented")

// CanonicalJSON serializes an audit event to its canonical JSON string.
//
// Must be byte-for-byte identical to every other language SDK: deterministic
// recursive key ordering, no insignificant whitespace, stable number/unicode
// formatting.
//
// TODO(audit-impl): implement against the shared parity corpus.
func CanonicalJSON(event Event) (string, error) {
	_ = event
	return "", ErrNotImplemented
}
