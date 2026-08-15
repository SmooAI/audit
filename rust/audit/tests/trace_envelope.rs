//! Trace correlation on the emit envelope (feature `otel`).
//!
//! The gap these guard: an audit event could not be tied to the request that
//! caused it — there was no trace id anywhere, in any language.
//!
//! The load-bearing test is [`parity_corpus_hashes_are_unchanged_inside_a_span`]:
//! the ids ride in the ENVELOPE, one level above the event, precisely so that
//! having a trace active cannot move a single hash. If it can, the change is
//! wrong and every stored chain is invalid.
#![cfg(feature = "otel")]

use opentelemetry::trace::{TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::trace::SdkTracerProvider;
use serde::Deserialize;
use serde_json::Value;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

use smooai_audit::{canonical_json, compute_event_hash, envelope_json, AuditEvent, TraceContext};

#[derive(Deserialize)]
struct Corpus {
    fixtures: Vec<Fixture>,
}

#[derive(Deserialize)]
struct Fixture {
    name: String,
    event: Value,
    #[serde(rename = "expectedCanonical")]
    expected_canonical: String,
    #[serde(rename = "expectedHash")]
    expected_hash: String,
}

fn corpus() -> Corpus {
    let raw = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/parity-corpus.json"));
    serde_json::from_str(raw).expect("parity corpus parses")
}

fn event() -> AuditEvent {
    serde_json::from_value(corpus().fixtures[0].event.clone()).expect("first fixture is an AuditEvent")
}

/// Run `f` inside the production shape: a `tracing` span picked up by a
/// tracing-opentelemetry layer — NOT an OTel-native span. `@smooai/fetch` shipped
/// the native form in a test first and it passed against an implementation that
/// read only `Context::current()`, which sees nothing in any real SmooAI service.
fn in_span<T>(f: impl FnOnce(&str, &str) -> T) -> T {
    let provider = SdkTracerProvider::builder().build();
    let tracer = provider.tracer("audit-envelope-test");
    let subscriber = tracing_subscriber::registry().with(tracing_opentelemetry::layer().with_tracer(tracer));
    let _sub = tracing::subscriber::set_default(subscriber);

    let span = tracing::info_span!("caller");
    let _entered = span.enter();
    let span_context = span.context().span().span_context().clone();
    assert!(span_context.is_valid(), "test setup: the span context must be valid");
    f(&span_context.trace_id().to_string(), &span_context.span_id().to_string())
}

#[test]
fn the_envelope_carries_the_active_span_ids() {
    let (body, trace_id, span_id) = in_span(|trace_id, span_id| (envelope_json(&event(), None).unwrap(), trace_id.to_string(), span_id.to_string()));

    let parsed: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(parsed["traceId"], Value::String(trace_id));
    assert_eq!(parsed["spanId"], Value::String(span_id));
    // Beside the event, never inside it.
    assert!(parsed["event"].get("traceId").is_none());
    assert!(parsed["event"].get("spanId").is_none());
}

#[test]
fn current_reads_the_active_span_and_nothing_outside_one() {
    assert_eq!(TraceContext::current(), TraceContext::default(), "no span → no ids");

    let captured = in_span(|trace_id, span_id| {
        let current = TraceContext::current();
        assert_eq!(current.trace_id.as_deref(), Some(trace_id));
        assert_eq!(current.span_id.as_deref(), Some(span_id));
        current
    });
    assert!(captured.trace_id.is_some());
}

/// The other context home: an OTel-NATIVE span, with no `tracing` span in sight.
/// `TraceContext::current()` reads both because neither falls back to the other —
/// a consumer on the plain OpenTelemetry API is as valid as a SmooAI service on
/// `tracing`.
#[test]
fn an_otel_native_span_is_read_too() {
    use opentelemetry::trace::Tracer as _;

    let provider = SdkTracerProvider::builder().build();
    let tracer = provider.tracer("audit-envelope-test");
    tracer.in_span("caller", |cx| {
        let expected = cx.span().span_context().clone();
        let current = TraceContext::current();
        assert_eq!(current.trace_id.as_deref(), Some(expected.trace_id().to_string().as_str()));
        assert_eq!(current.span_id.as_deref(), Some(expected.span_id().to_string().as_str()));
    });
}

#[test]
fn a_caller_supplied_context_wins_over_the_active_span() {
    let supplied = TraceContext {
        trace_id: Some("11111111111111111111111111111111".into()),
        span_id: Some("2222222222222222".into()),
    };
    let body = in_span(|_, _| envelope_json(&event(), Some(supplied.clone())).unwrap());

    let parsed: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(parsed["traceId"], Value::String(supplied.trace_id.unwrap()));
    assert_eq!(parsed["spanId"], Value::String(supplied.span_id.unwrap()));
}

/// The whole point. Every fixture must produce byte-exact canonical JSON and the
/// same hash with a trace context active as without one.
#[test]
fn parity_corpus_hashes_are_unchanged_inside_a_span() {
    in_span(|_, _| {
        for f in corpus().fixtures {
            assert_eq!(canonical_json(&f.event), f.expected_canonical, "canonical mismatch [{}]", f.name);
            assert_eq!(compute_event_hash(&f.event), f.expected_hash, "hash mismatch [{}]", f.name);

            let event: AuditEvent = serde_json::from_value(f.event.clone()).unwrap();
            assert_eq!(event.canonical(), f.expected_canonical, "schema canonical mismatch [{}]", f.name);
            assert_eq!(event.compute_hash(), f.expected_hash, "schema hash mismatch [{}]", f.name);

            // …and through the wire path. Asserted on the RAW bytes, not on a
            // deserialized `AuditEvent`: serde drops unknown fields, so a trace
            // id that leaked into the event would round-trip away and this test
            // would pass while the wire was wrong.
            let body = envelope_json(&event, None).unwrap();
            let parsed: Value = serde_json::from_str(&body).unwrap();
            let mut wire_event = parsed["event"].as_object().expect("event is an object").clone();
            let stamped = wire_event.remove("hashCurrent");
            let for_hash = Value::Object(wire_event);
            assert_eq!(canonical_json(&for_hash), f.expected_canonical, "envelope canonical mismatch [{}]", f.name);
            assert_eq!(compute_event_hash(&for_hash), f.expected_hash, "envelope hash mismatch [{}]", f.name);
            assert_eq!(stamped, Some(Value::String(f.expected_hash.clone())), "stamped hash mismatch [{}]", f.name);
            assert!(parsed.get("traceId").is_some(), "the span's id rides OUTSIDE the event [{}]", f.name);
        }
    });
}
