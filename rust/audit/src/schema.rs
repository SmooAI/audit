//! Canonical audit event schema (Rust port of `@smooai/audit`).
//!
//! Mirrors the TypeScript `auditEventSchema` field-for-field and is verified
//! byte-for-byte against the shared parity corpus.
//!
//! TODO(audit-impl): finalize the field set against the parity corpus.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A single audit event — the shared shape every language SDK emits.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuditEvent {
    /// Stable unique id for this event (UUID).
    pub id: String,
    /// Organization the event belongs to — hash chains are per-org-per-day.
    pub org_id: String,
    /// RFC 3339 / ISO-8601 UTC timestamp.
    pub timestamp: String,
    /// Who performed the action.
    pub actor: String,
    /// What happened, e.g. `"record.delete"`.
    pub action: String,
    /// The thing acted upon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    /// Arbitrary structured context. Must serialize canonically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Map<String, Value>>,
    /// Hex SHA-256 of the previous event in this org/day chain (`""` for genesis).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_hash: Option<String>,
}
