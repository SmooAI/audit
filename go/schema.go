package audit

import "regexp"

// AuditActorType identifies who performed an action.
type AuditActorType string

const (
	ActorUser        AuditActorType = "user"
	ActorAgent       AuditActorType = "agent"
	ActorSystem      AuditActorType = "system"
	ActorIntegration AuditActorType = "integration"
	ActorAPIClient   AuditActorType = "api_client"
)

// AuditOutcome is the result of an action.
type AuditOutcome string

const (
	OutcomeSuccess AuditOutcome = "success"
	OutcomeFailure AuditOutcome = "failure"
	OutcomeDenied  AuditOutcome = "denied"
)

// AuditResource is the thing an action was performed against. The Type is a
// namespaced kind (e.g. "crm.contact"); the ID is its canonical identifier.
type AuditResource struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// AuditDiff is a structural diff captured at write time. Either side may be
// absent (omitted on create/delete); a *present* null (e.g. After on a delete)
// is meaningful and is serialized as JSON null, never dropped.
type AuditDiff struct {
	Before any `json:"before,omitempty"`
	After  any `json:"after,omitempty"`
}

// AuditEvent is the canonical audit event — the shared shape every language SDK
// serializes. It carries ZERO customer content by design: only identity,
// resource references, outcome, and namespaced action + metadata the emitter
// supplies. Field names and json tags are part of the cross-language hash
// contract and are verified byte-for-byte against ../spec/parity-corpus.json.
//
// Optional fields use omitempty so an absent field is dropped before
// canonicalization (matching the TS "undefined → omitted" rule). The event fed
// to ComputeEventHash is this struct with HashCurrent empty (thus omitted).
type AuditEvent struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organizationId"`
	ActorType      AuditActorType `json:"actorType"`
	ActorID        string         `json:"actorId"`
	ActorEmail     string         `json:"actorEmail,omitempty"`
	Action         string         `json:"action"`
	Resource       AuditResource  `json:"resource"`
	Outcome        AuditOutcome   `json:"outcome"`
	Reason         string         `json:"reason,omitempty"`
	SessionID      string         `json:"sessionId,omitempty"`
	ConversationID string         `json:"conversationId,omitempty"`
	IPAddress      string         `json:"ipAddress,omitempty"`
	UserAgent      string         `json:"userAgent,omitempty"`
	GeoCountry     string         `json:"geoCountry,omitempty"`
	Diff           *AuditDiff     `json:"diff,omitempty"`
	Metadata       map[string]any `json:"metadata"`
	Timestamp      string         `json:"timestamp"`
	// HashPrevious links this event to the prior one in its per-org-per-day
	// chain. Absent (nil) on the first event of a chain — not null.
	HashPrevious *string `json:"hashPrevious,omitempty"`
	// HashCurrent is SHA-256 of canonical-JSON(this event minus HashCurrent).
	// Empty (thus omitted) while computing the hash; set afterward.
	HashCurrent string `json:"hashCurrent,omitempty"`
}

// Baseline event actions — the generic surface every app shares. Emitters are
// NOT limited to these: any consumer defines its own namespaced actions
// ("billing.invoice_voided", "fieldops.task_submitted", …) and emits them
// directly; canonicalization treats Action as an opaque string. These baseline
// names stay stable because dashboards/alerts/reports pivot off them.
const (
	ActionUserSignin           = "user.signin"
	ActionUserSignout          = "user.signout"
	ActionUserPasswordChanged  = "user.password_changed"
	ActionUserInvited          = "user.invited"
	ActionOrgCreated           = "org.created"
	ActionOrgMemberAdded       = "org.member_added"
	ActionOrgMemberRemoved     = "org.member_removed"
	ActionOrgRoleChanged       = "org.role_changed"
	ActionOrgSubscriptionChgd  = "org.subscription_changed"
	ActionOrgProductPurchased  = "org.product_purchased"
	ActionAgentConfigChanged   = "agent.config_changed"
	ActionAgentKnowledgeAdded  = "agent.knowledge_doc_added"
	ActionAgentKnowledgeRemvd  = "agent.knowledge_doc_removed"
	ActionAgentEscalationMade  = "agent.escalation_created"
	ActionAgentToolFailed      = "agent.tool_failed"
	ActionCRMContactCreated    = "crm.contact_created"
	ActionCRMContactMerged     = "crm.contact_merged"
	ActionCRMContactDeleted    = "crm.contact_deleted"
	ActionAPIKeyMinted         = "api.key_minted"
	ActionAPIKeyRotated        = "api.key_rotated"
	ActionAPIKeyRevoked        = "api.key_revoked"
	ActionIntegrationConnected = "integration.connected"
	ActionIntegrationDisconn   = "integration.disconnected"
)

var namespacedActionRe = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]+)+$`)

// IsNamespacedAction validates the "namespace.verb" action convention (a
// lowercase namespace and at least one lowercase verb segment, dot-separated,
// e.g. "crm.contact_created", "google.gmail.message_sent"). Assert this at your
// trust boundary; canonicalization itself treats Action as an opaque string, so
// this is a convention check, not a hard schema constraint.
func IsNamespacedAction(action string) bool {
	return namespacedActionRe.MatchString(action)
}
