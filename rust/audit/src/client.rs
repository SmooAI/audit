//! Audit emit client (Rust port of `@smooai/audit`).
//!
//! Seals an event (computes `hashCurrent`) and POSTs its canonical JSON to the
//! ingest endpoint with `Authorization: Bearer <token>`.

use crate::envelope::{envelope_json, TraceContext};
use crate::error::AuditError;
use crate::schema::AuditEvent;

/// Default retry behaviour, shared with every other language SDK. The numbers
/// live in `spec/parity-corpus.json`'s `retryPolicy` and are asserted there, so
/// they cannot drift apart across the five implementations.
pub const DEFAULT_MAX_RETRIES: usize = 3;
/// Base backoff in milliseconds; doubles on each retry.
pub const DEFAULT_RETRY_BACKOFF_MS: u64 = 100;

/// Configuration for [`AuditClient`].
#[derive(Debug, Clone)]
pub struct AuditClientOptions {
    /// Full URL of the audit ingest endpoint.
    pub endpoint: String,
    /// Bearer token used to authenticate emit requests.
    pub token: String,
    /// Total attempts on a transient failure (transport error or HTTP 5xx).
    /// `None` uses [`DEFAULT_MAX_RETRIES`].
    pub max_retries: Option<usize>,
    /// Base backoff in ms, doubled on each retry. `None` uses
    /// [`DEFAULT_RETRY_BACKOFF_MS`].
    pub retry_backoff_ms: Option<u64>,
}

impl AuditClientOptions {
    /// Options for `endpoint` + `token` with the shared default retry policy.
    pub fn new(endpoint: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            token: token.into(),
            max_retries: None,
            retry_backoff_ms: None,
        }
    }
}

/// Emits audit events to a configurable ingest endpoint over HTTPS.
#[derive(Debug, Clone)]
pub struct AuditClient {
    endpoint: String,
    token: String,
    http: reqwest::Client,
    max_retries: usize,
    retry_backoff_ms: u64,
}

impl AuditClient {
    /// Create a client bound to the given endpoint + token.
    pub fn new(options: AuditClientOptions) -> Self {
        Self {
            endpoint: options.endpoint,
            token: options.token,
            http: reqwest::Client::new(),
            max_retries: options.max_retries.unwrap_or(DEFAULT_MAX_RETRIES),
            retry_backoff_ms: options.retry_backoff_ms.unwrap_or(DEFAULT_RETRY_BACKOFF_MS),
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
        // Built once, outside the retry loop: a retried POST must carry the SAME
        // bytes, since ingest dedupes on the event's hash.
        let body = envelope_json(event, trace)?;

        let mut last_error: Option<AuditError> = None;
        for attempt in 0..self.max_retries {
            if attempt > 0 {
                let wait = self.retry_backoff_ms * (1u64 << (attempt - 1));
                tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
            }
            match self.post(&body).await {
                Ok(()) => return Ok(()),
                // A 4xx will say the same thing on the next attempt, so surface
                // it now rather than burning the remaining attempts.
                Err(error) if !is_transient(&error) => return Err(error),
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.expect("max_retries >= 1 leaves an error behind"))
    }

    async fn post(&self, body: &str) -> Result<(), AuditError> {
        let response = self
            .http
            .post(&self.endpoint)
            .header("content-type", "application/json")
            .bearer_auth(&self.token)
            .body(body.to_owned())
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

/// Retry only what a retry can fix: the request never reached a verdict, or the
/// server said it could not answer right now.
fn is_transient(error: &AuditError) -> bool {
    match error {
        AuditError::Status { status } => *status >= 500,
        _ => true,
    }
}
