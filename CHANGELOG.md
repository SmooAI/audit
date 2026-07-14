# @smooai/audit

## 0.1.1

### Patch Changes

- 50f514b: Rust: feature-gate the HTTP `AuditClient` behind a default-on `client` feature (reqwest is now optional). Consumers that only need the schema + canonical JSON + hash chain — e.g. a service that publishes audit events onto its own transport such as NATS — can depend with `default-features = false` to drop the reqwest + async-runtime pull.

## 0.1.0

### Minor Changes

- df7c377: Initial scaffold of `@smooai/audit` — a polyglot client SDK (TypeScript, Python, Rust, Go, .NET) for tamper-evident, SQL-queryable audit logging. Ships the intended public surface: a canonical `AuditEvent` schema, `canonicalJson`, a per-org-per-day SHA-256 hash chain (`computeEventHash` / `buildHashChain`), and an `AuditClient` emit client. Implementations are stubbed (`TODO(audit-impl)`) pending the shared parity corpus.
