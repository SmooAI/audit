//! Audit emit client (Rust port of `@smooai/audit`).
//!
//! Seals an event (computes `hashCurrent`) and POSTs its canonical JSON to the
//! ingest endpoint with `Authorization: Bearer <token>`.

use crate::envelope::{envelope_json, TraceContext};
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

    /// Seal `event` (compute its `hashCurrent`) and POST its canonical JSON
    /// envelope to the ingest endpoint, carrying the active W3C trace context so
    /// the event can be tied back to the request that caused it. Returns
    /// [`AuditError::Status`] on a non-2xx response.
    pub async fn emit(&self, event: &AuditEvent) -> Result<(), AuditError> {
        self.emit_with_trace(event, None).await
    }

    /// [`AuditClient::emit`] with an explicit trace context, which wins over the
    /// ambient span per field — a caller that knows the trace (a queue consumer
    /// replaying a producer's context, say) is more authoritative than whatever
    /// span happens to be active at emit time.
    pub async fn emit_with_trace(&self, event: &AuditEvent, trace: Option<TraceContext>) -> Result<(), AuditError> {
        // Send the sealed event's canonical bytes under `event`, NOT a
        // re-serialization — the wire body must be the exact canonical form so
        // the chain is replayable. Trace ids ride BESIDE it, never inside, so
        // they cannot perturb a hash.
        let body = envelope_json(event, trace)?;
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
