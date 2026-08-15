---
"@smooai/audit": minor
---

Trace correlation: an emitted audit event now carries the W3C trace context of the
request that caused it, so a row in the audit store can be joined to a trace.

**The ids ride in the ENVELOPE, never inside the event.** The wire body is now
`{"event":<the sealed event>,"spanId":"…","traceId":"…"}`. The bytes under
`"event"` are exactly the bytes that were hashed — unchanged, byte-for-byte, with
or without a trace active — because `hashCurrent` covers canonical-JSON(event
minus `hashCurrent`) and any new event field would invalidate every stored chain
and every fixture in `spec/parity-corpus.json`. The corpus is untouched, and each
language asserts it inside an active span as well as outside one. Both ids are
OMITTED when there is no valid span: never `""`, never an all-zero id.

TypeScript: `AuditClient.emit(event, trace?)` captures the active context at
emit time behind an optional `@opentelemetry/api` peer dependency. Without it
installed (or without a registered SDK) it is a no-op, not a crash. `buildEnvelope`
/ `currentTraceContext` are exported for consumers on their own transport.

Rust: the same, behind a new optional `otel` cargo feature (off by default —
the crate does not link OpenTelemetry unless you ask for it). `AuditClient::emit`
uses the ambient span; `emit_with_trace` takes an explicit `TraceContext` that
wins per field. `TraceContext::current()` reads both context homes — a `tracing`
span via tracing-opentelemetry and an OTel-native one — because neither falls
back to the other.

Go: `AuditClient.Emit(ctx, event)` reads the span context already on the `ctx` it
takes (`trace.SpanContextFromContext(ctx).IsValid()` before touching the ids), via
the OpenTelemetry trace API only — no SDK, no exporter. Pinned to otel v1.35.0,
the newest release whose `go` directive (1.22.0) still builds on the Go 1.22 the
CI matrix pins; v1.36+ declare go 1.23.

Python: the ids come from the ambient span behind a guarded
`from opentelemetry import trace` import, exposed as the optional `otel` extra
(`pip install smooai-audit[otel]`). Without it installed, correlation is a no-op —
`opentelemetry-api` is never a hard dependency.

.NET: reads `Activity.Current` — the BCL type the OpenTelemetry .NET SDK itself
populates — so no new package reference. Non-W3C or unstarted activities report
nothing.
