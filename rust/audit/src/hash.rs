//! SHA-256 hash chain over audit events.

use crate::error::AuditError;
use crate::schema::AuditEvent;

/// Return the lowercase hex SHA-256 of an event.
///
/// Taken over `canonical_json(event)` with `previous_hash` folded in, forming a
/// per-org-per-day tamper-evident chain.
///
/// TODO(audit-impl): implement — sha256(previous_hash || canonical_json(event)).
pub fn compute_event_hash(_event: &AuditEvent) -> Result<String, AuditError> {
    Err(AuditError::NotImplemented("compute_event_hash"))
}

/// Fold events into a hash chain, stamping each with its `previous_hash`.
///
/// TODO(audit-impl): implement the chain fold over `compute_event_hash`.
pub fn build_hash_chain(_events: &[AuditEvent], _genesis_hash: &str) -> Result<Vec<AuditEvent>, AuditError> {
    Err(AuditError::NotImplemented("build_hash_chain"))
}
