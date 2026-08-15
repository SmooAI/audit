//! The wire envelope and the trace ids it carries.
//!
//! # Why the ids are HERE and not on the event
//!
//! `hashCurrent = SHA-256(canonical-JSON(event minus hashCurrent))`. Any field
//! added to [`AuditEvent`] changes every hash, invalidating every chain already
//! in a store and every fixture in `spec/parity-corpus.json`. So trace
//! correlation rides one level up, in the envelope:
//!
//! ```text
//! {"event":{…the exact hashed bytes…},"spanId":"…","traceId":"…"}
//! ```
//!
//! The bytes under `"event"` are byte-identical whether or not a trace is
//! active — which is what the parity gate asserts.

use serde_json::{Map, Value};

use crate::canonical::canonical_json;
use crate::error::AuditError;
use crate::schema::AuditEvent;

/// Trace correlation ids carried alongside an event.
///
/// Both are optional and are OMITTED — never `""`, never the all-zero
/// `00000000000000000000000000000000` id — when there is nothing real to
/// report. An all-zero id is what an unregistered tracer hands you, and storing
/// it is worse than storing nothing: it looks like a correlation id and joins
/// every uncorrelated event to itself.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TraceContext {
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
}

impl TraceContext {
    /// The active W3C trace context, or an empty one when there is none.
    ///
    /// Two guards, each for a reason:
    ///
    /// 1. **Optional feature.** With `otel` off this returns empty and the crate
    ///    does not link OpenTelemetry — an OSS audit SDK must not force it on
    ///    anyone.
    /// 2. **Valid span contexts only.** An unregistered `TracerProvider` yields
    ///    `INVALID_SPAN_CONTEXT` (all-zero ids); reporting those poisons the
    ///    audit trail with a correlation id that correlates nothing.
    #[cfg(feature = "otel")]
    pub fn current() -> Self {
        use opentelemetry::trace::TraceContextExt as _;
        use tracing_opentelemetry::OpenTelemetrySpanExt as _;

        // TWO context homes, and neither falls back to the other. Every SmooAI
        // Rust service carries its span as a `tracing` span picked up by a
        // tracing-opentelemetry layer, reachable ONLY through
        // `Span::current().context()`; `opentelemetry::Context::current()` sees
        // just OTel-native spans. Reading only the latter makes this a silent
        // no-op in production while passing a test that happens to create an
        // OTel-native span (the bug `@smooai/fetch` hit).
        let cx = tracing::Span::current().context();
        let cx = if cx.span().span_context().is_valid() {
            cx
        } else {
            opentelemetry::Context::current()
        };

        let span_context = cx.span().span_context().clone();
        if !span_context.is_valid() {
            return Self::default();
        }
        Self {
            trace_id: Some(span_context.trace_id().to_string()),
            span_id: Some(span_context.span_id().to_string()),
        }
    }

    /// No-op when the `otel` feature is off — the crate does not link OpenTelemetry.
    #[cfg(not(feature = "otel"))]
    pub fn current() -> Self {
        Self::default()
    }

    /// `self` wins over `other` per field; empty strings count as absent on both
    /// sides, so they can never reach the wire. Used to let a caller-supplied
    /// context override the ambient span.
    fn or(self, other: Self) -> Self {
        let pick = |a: Option<String>, b: Option<String>| a.filter(|s| !s.is_empty()).or(b.filter(|s| !s.is_empty()));
        Self {
            trace_id: pick(self.trace_id, other.trace_id),
            span_id: pick(self.span_id, other.span_id),
        }
    }
}

/// Canonical JSON of the envelope around `event` — the exact bytes POSTed to the
/// ingest endpoint. Seals `event` (stamping `hashCurrent`) and attaches the
/// active trace context, with `override_trace` winning per field.
pub fn envelope_json(event: &AuditEvent, override_trace: Option<TraceContext>) -> Result<String, AuditError> {
    let trace = override_trace.unwrap_or_default().or(TraceContext::current());

    let mut envelope = Map::new();
    envelope.insert("event".to_string(), serde_json::to_value(event.sealed())?);
    if let Some(trace_id) = trace.trace_id {
        envelope.insert("traceId".to_string(), Value::String(trace_id));
    }
    if let Some(span_id) = trace.span_id {
        envelope.insert("spanId".to_string(), Value::String(span_id));
    }
    Ok(canonical_json(&Value::Object(envelope)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{ActorType, AuditResource, Outcome};

    fn event() -> AuditEvent {
        AuditEvent {
            id: "01HXXXXXXXXXXXXXXXXXXXXXXX".into(),
            organization_id: "org-1".into(),
            actor_type: ActorType::User,
            actor_id: "user-1".into(),
            actor_email: None,
            action: "crm.contact_created".into(),
            resource: AuditResource {
                type_: "crm.contact".into(),
                id: "c-1".into(),
            },
            outcome: Outcome::Success,
            reason: None,
            session_id: None,
            conversation_id: None,
            ip_address: None,
            user_agent: None,
            geo_country: None,
            diff: None,
            metadata: Default::default(),
            timestamp: "2026-05-17T12:00:00.000Z".into(),
            hash_previous: None,
            hash_current: None,
        }
    }

    /// With no tracer registered (and, with the feature off, no OTel at all) the
    /// ids are absent — not all-zero, not empty.
    #[test]
    fn omits_ids_when_there_is_no_span() {
        let body = envelope_json(&event(), None).unwrap();
        assert!(!body.contains("traceId"), "no traceId key: {body}");
        assert!(!body.contains("spanId"), "no spanId key: {body}");
        assert!(!body.contains("00000000"), "never an all-zero id: {body}");
        assert!(!body.contains("\"\""), "never an empty string: {body}");
    }

    #[test]
    fn caller_supplied_ids_are_carried_beside_the_event() {
        let trace = TraceContext {
            trace_id: Some("11111111111111111111111111111111".into()),
            span_id: Some("2222222222222222".into()),
        };
        let body = envelope_json(&event(), Some(trace)).unwrap();
        assert!(body.contains("\"traceId\":\"11111111111111111111111111111111\""), "{body}");
        assert!(body.contains("\"spanId\":\"2222222222222222\""), "{body}");
        // Beside, never inside: the event object ends before the ids begin.
        let parsed: Value = serde_json::from_str(&body).unwrap();
        assert!(parsed["event"].get("traceId").is_none());
        assert!(parsed["event"].get("spanId").is_none());
    }

    #[test]
    fn caller_supplied_empty_strings_are_treated_as_absent() {
        let trace = TraceContext {
            trace_id: Some(String::new()),
            span_id: Some(String::new()),
        };
        let body = envelope_json(&event(), Some(trace)).unwrap();
        assert!(!body.contains("traceId"), "{body}");
        assert!(!body.contains("spanId"), "{body}");
    }

    /// The hashed bytes are the event's own: recomputing from what goes over the
    /// wire reproduces the stamped hash, which it could not if the trace ids had
    /// landed inside the event.
    #[test]
    fn the_hashed_bytes_are_unchanged_by_the_envelope() {
        let event = event();
        let trace = TraceContext {
            trace_id: Some("11111111111111111111111111111111".into()),
            span_id: Some("2222222222222222".into()),
        };
        let body = envelope_json(&event, Some(trace)).unwrap();
        let parsed: Value = serde_json::from_str(&body).unwrap();
        let round_tripped: AuditEvent = serde_json::from_value(parsed["event"].clone()).unwrap();
        assert_eq!(round_tripped.hash_current.as_deref(), Some(event.compute_hash().as_str()));
        assert_eq!(round_tripped.canonical(), event.canonical());
    }
}
