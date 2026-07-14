# @smooai/audit

## 0.1.0

### Minor Changes

- df7c377: Initial scaffold of `@smooai/audit` — a polyglot client SDK (TypeScript, Python, Rust, Go, .NET) for tamper-evident, SQL-queryable audit logging. Ships the intended public surface: a canonical `AuditEvent` schema, `canonicalJson`, a per-org-per-day SHA-256 hash chain (`computeEventHash` / `buildHashChain`), and an `AuditClient` emit client. Implementations are stubbed (`TODO(audit-impl)`) pending the shared parity corpus.
