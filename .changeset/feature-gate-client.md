---
"@smooai/audit": patch
---

Rust: feature-gate the HTTP `AuditClient` behind a default-on `client` feature (reqwest is now optional). Consumers that only need the schema + canonical JSON + hash chain — e.g. a service that publishes audit events onto its own transport such as NATS — can depend with `default-features = false` to drop the reqwest + async-runtime pull.
