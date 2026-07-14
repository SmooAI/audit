//! SmooAI Audit for Rust.
//!
//! A polyglot client SDK for tamper-evident, SQL-queryable audit logging. This
//! crate mirrors the TypeScript, Python, Go, and .NET SDKs of `@smooai/audit`: a
//! canonical [`AuditEvent`] schema, canonical JSON serialization, a
//! per-org-per-day SHA-256 hash chain, and an emit [`AuditClient`]. Every
//! implementation is verified byte-for-byte against the shared parity corpus
//! (`spec/parity-corpus.json`).

pub mod canonical;
#[cfg(feature = "client")]
pub mod client;
pub mod error;
pub mod hash;
pub mod schema;

pub use crate::canonical::canonical_json;
#[cfg(feature = "client")]
pub use crate::client::{AuditClient, AuditClientOptions};
pub use crate::error::AuditError;
pub use crate::hash::{build_hash_chain, compute_event_hash};
pub use crate::schema::{actions, is_namespaced_action, ActorType, AuditDiff, AuditEvent, AuditResource, Outcome, AUDIT_ACTIONS};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;

    fn sample_event() -> AuditEvent {
        AuditEvent {
            id: "01HXXXXXXXXXXXXXXXXXXXXXXX".into(),
            organization_id: "org-1".into(),
            actor_type: ActorType::User,
            actor_id: "user-1".into(),
            actor_email: None,
            action: schema::actions::CRM_CONTACT_CREATED.into(),
            resource: AuditResource {
                type_: "crm.contact".into(),
                id: "c-1".into(),
            },
            outcome: Outcome::Success,
            reason: None,
            session_id: None,
            conversation_id: None,
            ip_address: None,
            user_agent: None,
            geo_country: None,
            diff: None,
            metadata: Map::new(),
            timestamp: "2026-05-17T12:00:00.000Z".into(),
            hash_previous: None,
            hash_current: None,
        }
    }

    #[test]
    fn event_roundtrips_through_serde() {
        let event = sample_event();
        let json = serde_json::to_string(&event).unwrap();
        let parsed: AuditEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(event, parsed);
    }

    #[test]
    fn sealed_sets_hash_current_and_excludes_it_from_the_hash() {
        let event = sample_event();
        let sealed = event.sealed();
        assert_eq!(sealed.hash_current.as_deref(), Some(event.compute_hash().as_str()));
        // Sealing must not change the hashed bytes (hashCurrent is excluded).
        assert_eq!(sealed.compute_hash(), event.compute_hash());
    }
}
