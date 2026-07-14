//! Canonical audit event schema — Rust port of `@smooai/audit`'s `AuditEvent`.
//!
//! Mirrors the persisted TS shape field-for-field (camelCase on the wire) and is
//! verified byte-for-byte against `spec/parity-corpus.json`. Contains ZERO
//! customer content — `action` is an opaque, extensible `namespace.verb` string
//! (see [`is_namespaced_action`]); [`AUDIT_ACTIONS`] is only the stable baseline.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::canonical::canonical_json;
use crate::hash::compute_event_hash;

/// Who performed the action. Closed set, matching the TS `AuditActorType` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorType {
    User,
    Agent,
    System,
    Integration,
    ApiClient,
}

/// Outcome of the action. Closed set, matching the TS `AuditOutcome` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Success,
    Failure,
    Denied,
}

/// Resource the action was performed against (`type` + canonical `id`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditResource {
    #[serde(rename = "type")]
    pub type_: String,
    pub id: String,
}

/// Structural diff captured at write time. Either side may be absent (create →
/// no `before`, delete → `after` present and `null`). A *present* `null` is
/// rendered, not omitted — only absent (`None`) sides are dropped.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct AuditDiff {
    #[serde(default, deserialize_with = "deserialize_present", skip_serializing_if = "Option::is_none")]
    pub before: Option<Value>,
    #[serde(default, deserialize_with = "deserialize_present", skip_serializing_if = "Option::is_none")]
    pub after: Option<Value>,
}

/// Deserialize a *present* field into `Some(value)` — including a present JSON
/// `null` as `Some(Value::Null)`. serde's default `Option` handling collapses a
/// present `null` to `None`, which would drop a delete's `after: null`; combined
/// with `#[serde(default)]`, an *absent* field still yields `None`.
fn deserialize_present<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}

/// A single audit event — the shared shape every language SDK emits, as persisted
/// in queryable storage. Optional fields are omitted from the wire (and the hash
/// input) when `None`, matching the TS `skip if undefined` rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    /// ULID-like sortable identifier.
    pub id: String,
    /// Organization the event belongs to — hash chains are per-org-per-day.
    pub organization_id: String,
    pub actor_type: ActorType,
    pub actor_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_email: Option<String>,
    /// Opaque `namespace.verb` action string (extensible; see [`is_namespaced_action`]).
    pub action: String,
    pub resource: AuditResource,
    pub outcome: Outcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geo_country: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff: Option<AuditDiff>,
    /// Free-form structured context. Always present (may be empty).
    pub metadata: Map<String, Value>,
    /// ISO-8601 UTC timestamp.
    pub timestamp: String,
    /// Previous event's hash in the per-org-per-day chain. Absent on the first
    /// event of a chain (omitted, never `null`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash_previous: Option<String>,
    /// SHA-256 of canonical-JSON(this event minus `hashCurrent`). Excluded from
    /// the hash input; set by [`AuditEvent::sealed`] / the hash-chain builder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash_current: Option<String>,
}

impl AuditEvent {
    /// This event as a JSON object **without** `hashCurrent` — the exact input
    /// the hash is computed over.
    pub fn event_for_hash(&self) -> Value {
        let mut value = serde_json::to_value(self).expect("AuditEvent always serializes");
        if let Value::Object(map) = &mut value {
            map.remove("hashCurrent");
        }
        value
    }

    /// Canonical JSON of this event minus `hashCurrent` (the hashed bytes).
    pub fn canonical(&self) -> String {
        canonical_json(&self.event_for_hash())
    }

    /// Lowercase-hex SHA-256 of this event's canonical bytes.
    pub fn compute_hash(&self) -> String {
        compute_event_hash(&self.event_for_hash())
    }

    /// Return a copy with `hashCurrent` set to its computed hash.
    pub fn sealed(&self) -> Self {
        let mut sealed = self.clone();
        sealed.hash_current = Some(self.compute_hash());
        sealed
    }
}

/// Validates the `namespace.verb` action convention: a lowercase namespace and
/// at least one further lowercase (2+ char) segment, dot-separated (e.g.
/// `crm.contact_created`, `google.gmail.message_sent`). The canonical
/// serialization treats `action` as opaque, so this is a convention check for a
/// consumer's trust boundary, not a hard schema constraint. Equivalent to the TS
/// regex `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]+)+$`.
pub fn is_namespaced_action(action: &str) -> bool {
    let seg_ok = |seg: &str, min_len: usize| {
        seg.len() >= min_len
            && seg.starts_with(|c: char| c.is_ascii_lowercase())
            && seg.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    };
    let mut segments = action.split('.');
    // First segment: [a-z][a-z0-9_]* → 1+ chars.
    let Some(first) = segments.next() else {
        return false;
    };
    if !seg_ok(first, 1) {
        return false;
    }
    // At least one following segment, each [a-z][a-z0-9_]+ → 2+ chars.
    let mut had_tail = false;
    for seg in segments {
        had_tail = true;
        if !seg_ok(seg, 2) {
            return false;
        }
    }
    had_tail
}

/// Baseline event-action constants covering the generic surface every app shares.
/// Emitters are NOT limited to these — any consumer emits its own namespaced
/// actions. Dashboards / compliance reports pivot off these, so keep them stable.
pub mod actions {
    // Identity
    pub const USER_SIGNIN: &str = "user.signin";
    pub const USER_SIGNOUT: &str = "user.signout";
    pub const USER_PASSWORD_CHANGED: &str = "user.password_changed";
    pub const USER_INVITED: &str = "user.invited";
    // Org
    pub const ORG_CREATED: &str = "org.created";
    pub const ORG_MEMBER_ADDED: &str = "org.member_added";
    pub const ORG_MEMBER_REMOVED: &str = "org.member_removed";
    pub const ORG_ROLE_CHANGED: &str = "org.role_changed";
    pub const ORG_SUBSCRIPTION_CHANGED: &str = "org.subscription_changed";
    pub const ORG_PRODUCT_PURCHASED: &str = "org.product_purchased";
    // Agent
    pub const AGENT_CONFIG_CHANGED: &str = "agent.config_changed";
    pub const AGENT_KNOWLEDGE_DOC_ADDED: &str = "agent.knowledge_doc_added";
    pub const AGENT_KNOWLEDGE_DOC_REMOVED: &str = "agent.knowledge_doc_removed";
    pub const AGENT_ESCALATION_CREATED: &str = "agent.escalation_created";
    pub const AGENT_TOOL_FAILED: &str = "agent.tool_failed";
    // CRM
    pub const CRM_CONTACT_CREATED: &str = "crm.contact_created";
    pub const CRM_CONTACT_MERGED: &str = "crm.contact_merged";
    pub const CRM_CONTACT_DELETED: &str = "crm.contact_deleted";
    // API auth
    pub const API_KEY_MINTED: &str = "api.key_minted";
    pub const API_KEY_ROTATED: &str = "api.key_rotated";
    pub const API_KEY_REVOKED: &str = "api.key_revoked";
    // Integrations
    pub const INTEGRATION_CONNECTED: &str = "integration.connected";
    pub const INTEGRATION_DISCONNECTED: &str = "integration.disconnected";
}

/// Named export of the baseline actions (parity with the TS `AUDIT_ACTIONS`).
pub use actions as AUDIT_ACTIONS;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn namespaced_action_matches_ts_regex() {
        assert!(is_namespaced_action("crm.contact_created"));
        assert!(is_namespaced_action("google.gmail.message_sent"));
        assert!(is_namespaced_action(actions::INTEGRATION_CONNECTED));
        // Bad: no dot, uppercase, trailing/leading dot, 1-char tail, empty seg.
        assert!(!is_namespaced_action("noverb"));
        assert!(!is_namespaced_action("CRM.contact"));
        assert!(!is_namespaced_action("crm."));
        assert!(!is_namespaced_action(".crm"));
        assert!(!is_namespaced_action("a.b")); // tail must be 2+ chars
        assert!(!is_namespaced_action("crm..contact"));
    }
}
