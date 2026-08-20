# smooai-audit (Rust)

Rust port of [`@smooai/audit`](https://github.com/SmooAI/audit) — a polyglot
client SDK for tamper-evident, SQL-queryable audit logging: a canonical
`AuditEvent` schema, canonical JSON serialization, a per-org-per-day SHA-256 hash
chain, and an emit client. Verified byte-for-byte against a shared parity corpus.

> **Status:** complete — `canonical_json`, `compute_event_hash`, `build_hash_chain`,
> and `AuditClient::emit` are implemented and verified byte-for-byte against the
> shared parity corpus (`../../spec/parity-corpus.json`), including envelope trace
> correlation (the `otel` cargo feature, off by default).

## Install

```bash
cargo add smooai-audit
```

## Usage

```rust
use smooai_audit::{AuditClient, AuditClientOptions, AuditEvent};

let client = AuditClient::new(AuditClientOptions {
    endpoint: endpoint.to_string(),
    token: token.to_string(),
});
client.emit(&event).await?; // or emit_with_trace(&event, Some(trace))
```

## License

MIT © SmooAI
