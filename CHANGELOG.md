# @smooai/audit

## 0.3.0

### Minor Changes

- a6a0293: Ship chain verification in all five languages, and prove it with corrupted-chain
  corpus vectors.

  `verifyChain` — the function that actually DETECTS a broken hash chain — existed
  only in TypeScript. Python carried a docstring describing how one would verify;
  Rust, Go, and .NET had nothing. A service in four of five languages could seal a
  chain it could never audit, which makes "tamper-evident" a claim rather than a
  capability.

  - New: `verify_chain` (Python, Rust), `VerifyChain` (Go), `HashChain.Verify`
    (.NET). All five return the same verdict shape: `ok`, `brokenAt`, and a shared
    failure code — `hash_previous_mismatch` (the link is wrong) or
    `hash_current_mismatch` (the event body was edited after sealing).
  - `verifyChain` gains an optional `genesisPreviousHash`, so a slice continuing an
    existing chain can be verified at all. Without it, only a first-of-day chain
    was verifiable. TypeScript additionally gains a `code` field alongside the
    existing human-readable `reason` (additive; `reason` is unchanged).
  - `spec/parity-corpus.json` gains `chainFixtures`: 11 real chains, sealed by the
    builder and then genuinely tampered with, each with the verdict every language
    must return. All five suites load them. The corpus previously proved sealing
    only, which is what let the asymmetry hide.
  - One fixture asserts the honest limit: deleting events from the TAIL of a chain
    still verifies. Replay cannot see it; catching it needs an external anchor.

## 0.2.1

### Patch Changes

- 60bc0dc: Fix version sync so released artifacts carry the version they were released as.

  `version:sync` ran _after_ `changeset publish`, mutating the manifests in the CI
  workspace where nothing ever committed them. Every git tag therefore shipped
  `0.0.0` in `python/pyproject.toml`, `rust/audit/Cargo.toml`, `go/version.go`
  (`audit.Version`), and `SmooAI.Audit.csproj` while npm, PyPI, crates.io, and
  NuGet all showed 0.2.0 — and `cargo publish --allow-dirty` existed only to
  tolerate the resulting dirty tree.

  The sync now runs in the changesets `version` lifecycle, so the bumped manifests
  are committed with the release. A new `pnpm version:check` fails CI on any drift,
  including a `go.mod` module path whose `/vN` suffix disagrees with the major.
  `cargo publish` is now `--locked`.

## 0.2.0

### Minor Changes

- f05a9ab: Trace correlation: an emitted audit event now carries the W3C trace context of the
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

## 0.1.1

### Patch Changes

- 50f514b: Rust: feature-gate the HTTP `AuditClient` behind a default-on `client` feature (reqwest is now optional). Consumers that only need the schema + canonical JSON + hash chain — e.g. a service that publishes audit events onto its own transport such as NATS — can depend with `default-features = false` to drop the reqwest + async-runtime pull.

## 0.1.0

### Minor Changes

- df7c377: Initial scaffold of `@smooai/audit` — a polyglot client SDK (TypeScript, Python, Rust, Go, .NET) for tamper-evident, SQL-queryable audit logging. Ships the intended public surface: a canonical `AuditEvent` schema, `canonicalJson`, a per-org-per-day SHA-256 hash chain (`computeEventHash` / `buildHashChain`), and an `AuditClient` emit client. Implementations are stubbed (`TODO(audit-impl)`) pending the shared parity corpus.
