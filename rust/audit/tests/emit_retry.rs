//! Emit retry behaviour, held to the SAME numbers as every other language SDK.
//!
//! An audit event that silently fails to emit is a hole in the record, so the
//! client retries what a retry can fix — a transport error or a 5xx — and only
//! that. The defaults live in `spec/parity-corpus.json`'s `retryPolicy`; five
//! hand-written implementations of the same three numbers are five chances to
//! drift, so they are asserted against the corpus rather than restated here.

#![cfg(feature = "client")]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde::Deserialize;
use smooai_audit::{AuditClient, AuditClientOptions, AuditEvent, DEFAULT_MAX_RETRIES, DEFAULT_RETRY_BACKOFF_MS};

#[derive(Deserialize)]
struct Corpus {
    #[serde(rename = "retryPolicy")]
    retry_policy: RetryPolicy,
}

#[derive(Deserialize)]
struct RetryPolicy {
    #[serde(rename = "maxAttempts")]
    max_attempts: usize,
    #[serde(rename = "baseBackoffMs")]
    base_backoff_ms: u64,
    #[serde(rename = "backoffMultiplier")]
    backoff_multiplier: u32,
}

fn policy() -> RetryPolicy {
    let raw = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/parity-corpus.json"));
    serde_json::from_str::<Corpus>(raw).expect("parity corpus parses").retry_policy
}

fn sample_event() -> AuditEvent {
    serde_json::from_value(serde_json::json!({
        "id": "01HXXXXXXXXXXXXXXXXXXXXXXX",
        "organizationId": "org-1",
        "actorType": "user",
        "actorId": "user-1",
        "action": "crm.contact_created",
        "resource": { "type": "crm.contact", "id": "c-1" },
        "outcome": "success",
        "metadata": {},
        "timestamp": "2026-05-17T12:00:00.000Z"
    }))
    .expect("sample event deserializes")
}

#[test]
fn defaults_match_the_shared_retry_policy() {
    let policy = policy();
    assert_eq!(DEFAULT_MAX_RETRIES, policy.max_attempts, "maxAttempts drifted from the corpus");
    assert_eq!(DEFAULT_RETRY_BACKOFF_MS, policy.base_backoff_ms, "baseBackoffMs drifted from the corpus");
    assert_eq!(policy.backoff_multiplier, 2, "this client doubles the backoff");
}

#[test]
fn options_new_uses_the_defaults() {
    let options = AuditClientOptions::new("https://audit.example/events", "t");
    assert_eq!(options.max_retries, None);
    assert_eq!(options.retry_backoff_ms, None);
}

/// A one-shot HTTP server that answers every request with `status` and counts hits.
fn serve(status: u16, hits: Arc<AtomicUsize>) -> String {
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let address = listener.local_addr().expect("addr");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            hits.fetch_add(1, Ordering::SeqCst);
            let mut buffer = [0u8; 4096];
            let _ = stream.read(&mut buffer);
            let _ = write!(stream, "HTTP/1.1 {status} X\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
            let _ = stream.flush();
        }
    });
    format!("http://{address}/events")
}

#[tokio::test]
async fn server_errors_are_retried_up_to_max_attempts() {
    let hits = Arc::new(AtomicUsize::new(0));
    let endpoint = serve(500, Arc::clone(&hits));
    let client = AuditClient::new(AuditClientOptions {
        retry_backoff_ms: Some(1),
        ..AuditClientOptions::new(endpoint, "t")
    });

    let error = client.emit(&sample_event()).await.expect_err("500 must surface, never be swallowed");
    assert!(error.to_string().contains("500"), "unexpected error: {error}");
    assert_eq!(hits.load(Ordering::SeqCst), policy().max_attempts);
}

#[tokio::test]
async fn client_errors_fail_fast() {
    let hits = Arc::new(AtomicUsize::new(0));
    let endpoint = serve(400, Arc::clone(&hits));
    let client = AuditClient::new(AuditClientOptions {
        retry_backoff_ms: Some(1),
        ..AuditClientOptions::new(endpoint, "t")
    });

    client.emit(&sample_event()).await.expect_err("400 must surface");
    assert_eq!(hits.load(Ordering::SeqCst), 1, "a 4xx will say the same thing on the next attempt");
}
