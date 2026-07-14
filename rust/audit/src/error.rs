//! Error type for the audit SDK.

use thiserror::Error;

/// Errors surfaced by the audit SDK.
#[derive(Debug, Error)]
pub enum AuditError {
    /// A stubbed function that has not been implemented yet.
    ///
    /// TODO(audit-impl): remove once the corresponding logic lands.
    #[error("TODO(audit-impl): {0} not implemented")]
    NotImplemented(&'static str),
}
