package audit

// Event is a single audit event — the shared shape every language SDK emits.
// Mirrors the TypeScript auditEventSchema field-for-field and is verified
// byte-for-byte against the shared parity corpus.
//
// TODO(audit-impl): finalize the field set against the parity corpus.
type Event struct {
	// ID is a stable unique id for this event (UUID).
	ID string `json:"id"`
	// OrgID is the organization the event belongs to — hash chains are
	// per-org-per-day.
	OrgID string `json:"orgId"`
	// Timestamp is an RFC 3339 / ISO-8601 UTC timestamp.
	Timestamp string `json:"timestamp"`
	// Actor is who performed the action.
	Actor string `json:"actor"`
	// Action is what happened, e.g. "record.delete".
	Action string `json:"action"`
	// Resource is the thing acted upon.
	Resource *string `json:"resource,omitempty"`
	// Metadata is arbitrary structured context. Must serialize canonically.
	Metadata map[string]any `json:"metadata,omitempty"`
	// PreviousHash is the hex SHA-256 of the previous event in this org/day
	// chain ("" for genesis).
	PreviousHash *string `json:"previousHash,omitempty"`
}
