//! Audit emit client (Rust port of `@smooai/audit`).

use crate::error::AuditError;
use crate::schema::AuditEvent;

/// Configuration for [`AuditClient`].
#[derive(Debug, Clone)]
pub struct AuditClientOptions {
    /// Base URL of the audit ingest endpoint.
    pub endpoint: String,
    /// Bearer token used to authenticate emit requests.
    pub token: String,
}

/// Emits audit events to a configurable ingest endpoint over HTTPS.
///
/// TODO(audit-impl): implement `emit` — POST canonical_json(event) to the
/// endpoint with `Authorization: Bearer <token>`, retry/backoff, and surface
/// transport errors.
#[derive(Debug, Clone)]
pub struct AuditClient {
    options: AuditClientOptions,
}

impl AuditClient {
    /// Create a client bound to the given endpoint + token.
    pub fn new(options: AuditClientOptions) -> Self {
        Self { options }
    }

    /// Emit a single audit event.
    ///
    /// TODO(audit-impl): implement the HTTP POST.
    pub fn emit(&self, _event: &AuditEvent) -> Result<(), AuditError> {
        let _ = &self.options;
        Err(AuditError::NotImplemented("AuditClient::emit"))
    }
}
