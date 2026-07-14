//! Canonical JSON serialization for audit events.

use crate::error::AuditError;
use crate::schema::AuditEvent;

/// Serialize an audit event to its canonical JSON string.
///
/// Must be byte-for-byte identical to every other language SDK: deterministic
/// recursive key ordering, no insignificant whitespace, stable number/unicode
/// formatting.
///
/// TODO(audit-impl): implement against the shared parity corpus.
pub fn canonical_json(_event: &AuditEvent) -> Result<String, AuditError> {
    Err(AuditError::NotImplemented("canonical_json"))
}
