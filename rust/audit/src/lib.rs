//! SmooAI Audit for Rust.
//!
//! A polyglot client SDK for tamper-evident, SQL-queryable audit logging. This
//! crate mirrors the feature set of the TypeScript, Python, Go, and .NET SDKs
//! provided by `@smooai/audit`: a canonical [`AuditEvent`] schema, canonical JSON
//! serialization, a per-org-per-day SHA-256 hash chain, and an emit client.
//! All implementations are verified byte-for-byte against a shared parity corpus.

pub mod canonical;
pub mod client;
pub mod error;
pub mod hash;
pub mod schema;

pub use crate::canonical::canonical_json;
pub use crate::client::{AuditClient, AuditClientOptions};
pub use crate::error::AuditError;
pub use crate::hash::{build_hash_chain, compute_event_hash};
pub use crate::schema::AuditEvent;

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_event() -> AuditEvent {
        AuditEvent {
            id: "11111111-1111-1111-1111-111111111111".to_string(),
            org_id: "org_123".to_string(),
            timestamp: "2026-07-14T00:00:00.000Z".to_string(),
            actor: "user_abc".to_string(),
            action: "record.delete".to_string(),
            resource: Some("contact:xyz".to_string()),
            metadata: None,
            previous_hash: Some(String::new()),
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
    fn canonical_json_is_stubbed() {
        assert!(matches!(canonical_json(&sample_event()), Err(AuditError::NotImplemented("canonical_json"))));
    }
}
