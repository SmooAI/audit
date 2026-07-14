//! Error type for the audit SDK.

use thiserror::Error;

/// Errors surfaced by the audit SDK.
#[derive(Debug, Error)]
pub enum AuditError {
    /// The ingest endpoint returned a non-2xx status.
    #[error("audit ingest returned HTTP {status}")]
    Status {
        /// The HTTP status code returned by the ingest endpoint.
        status: u16,
    },
    /// The HTTP request itself failed (connect, TLS, timeout, …).
    #[error("audit ingest transport error: {0}")]
    Transport(#[from] reqwest::Error),
    /// The event could not be serialized to JSON.
    #[error("audit event serialization error: {0}")]
    Serialize(#[from] serde_json::Error),
}
