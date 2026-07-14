//! Audit emit client (Rust port of `@smooai/audit`).
//!
//! Seals an event (computes `hashCurrent`) and POSTs its canonical JSON to the
//! ingest endpoint with `Authorization: Bearer <token>`.

use crate::canonical::canonical_json;
use crate::error::AuditError;
use crate::schema::AuditEvent;

/// Configuration for [`AuditClient`].
#[derive(Debug, Clone)]
pub struct AuditClientOptions {
    /// Full URL of the audit ingest endpoint.
    pub endpoint: String,
    /// Bearer token used to authenticate emit requests.
    pub token: String,
}

/// Emits audit events to a configurable ingest endpoint over HTTPS.
#[derive(Debug, Clone)]
pub struct AuditClient {
    endpoint: String,
    token: String,
    http: reqwest::Client,
}

impl AuditClient {
    /// Create a client bound to the given endpoint + token.
    pub fn new(options: AuditClientOptions) -> Self {
        Self {
            endpoint: options.endpoint,
            token: options.token,
            http: reqwest::Client::new(),
        }
    }

    /// Seal `event` (compute its `hashCurrent`) and POST its canonical JSON to
    /// the ingest endpoint. Returns [`AuditError::Status`] on a non-2xx response.
    pub async fn emit(&self, event: &AuditEvent) -> Result<(), AuditError> {
        // Send the sealed event's canonical bytes, NOT a re-serialization — the
        // wire body must be the exact canonical form so the chain is replayable.
        let body = canonical_json(&serde_json::to_value(event.sealed())?);
        let response = self
            .http
            .post(&self.endpoint)
            .header("content-type", "application/json")
            .bearer_auth(&self.token)
            .body(body)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(AuditError::Status {
                status: response.status().as_u16(),
            });
        }
        Ok(())
    }
}
