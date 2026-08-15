# @smooai/audit

**A polyglot client SDK for tamper-evident, SQL-queryable audit logging.**

`@smooai/audit` gives every service — in any language — one shared way to emit
audit events that are:

- **Canonical** — a single `AuditEvent` schema, serialized to byte-identical
  canonical JSON regardless of language, so events are comparable and hashable
  everywhere.
- **Tamper-evident** — each event is chained into a per-org-per-day **SHA-256
  hash chain**: every event's hash covers the previous event's hash, so any
  retroactive edit or deletion breaks every subsequent link.
- **SQL-queryable** — events land in a structured store you can query with plain
  SQL.

It ships as a native package for five languages — **TypeScript, Python, Rust,
Go, and .NET** — with identical semantics. All implementations are verified
**byte-for-byte against a shared parity corpus**, so a hash computed in Go
matches one computed in Rust or TypeScript for the same event.

> **Status:** all five language implementations are complete and verified
> byte-for-byte against the shared parity corpus (`spec/parity-corpus.json`).

## The shared surface

Every language exposes the same four things:

| Concept                                              | What it does                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AuditEvent`                                         | The canonical event schema (`id`, `organizationId`, `timestamp`, `actorType`, `actorId`, `action`, `resource?`, `metadata?`, `hashPrevious?`, `hashCurrent?`). |
| `canonicalJson(event)`                               | Deterministic, byte-identical JSON serialization.                                                                      |
| `computeEventHash(event)` / `buildHashChain(events)` | The per-org-per-day SHA-256 hash chain.                                                                                |
| `AuditClient` / `emit(event)`                        | POSTs an event to a configurable ingest endpoint with a bearer token.                                                  |

## The wire envelope

`emit` POSTs the canonical JSON of an **envelope**, not the bare event:

```json
{ "event": { "…the sealed event…": "…" }, "spanId": "00f067aa0ba902b7", "traceId": "4bf92f3577b34da6a3ce929d0e0e4736" }
```

`traceId` / `spanId` are the W3C trace context captured at emit time, so an audit
row can be joined back to the request that caused it. They live in the envelope,
one level ABOVE the event, and never inside it: the hash chain covers
canonical-JSON(event minus `hashCurrent`), so a field added to the event would
change every hash and invalidate every chain already in a store. The bytes under
`"event"` are byte-identical with or without a trace active — every language
asserts the parity corpus inside an active span as well as outside one.

Both ids are omitted entirely when there is no valid span — never an empty string,
never the all-zero `00000000000000000000000000000000` id an unregistered SDK hands
you. OpenTelemetry is optional everywhere (TypeScript: an optional
`@opentelemetry/api` peer dependency; Rust: the `otel` cargo feature, off by
default; Python: the `otel` extra — `pip install smooai-audit[otel]` — behind a
guarded import; Go: the otel trace API only, no SDK, reading the span context off
the `ctx` you already pass to `Emit`; .NET: `Activity.Current` from the BCL, so no
new package at all), and with it absent the client behaves exactly as it did before.

## Install

**TypeScript / Node**

```bash
pnpm add @smooai/audit
```

**Python**

```bash
uv add smooai-audit   # or: pip install smooai-audit
```

**Rust**

```bash
cargo add smooai-audit
```

**Go**

```bash
go get github.com/SmooAI/audit/go
```

**.NET**

```bash
dotnet add package SmooAI.Audit
```

## Usage

**TypeScript**

```ts
import { AuditClient, type AuditEvent } from "@smooai/audit";

const client = new AuditClient({
  endpoint: process.env.AUDIT_ENDPOINT!,
  token: process.env.AUDIT_TOKEN!,
});

const event: AuditEvent = {
  id: crypto.randomUUID(),
  orgId: "org_123",
  timestamp: new Date().toISOString(),
  actor: "user_abc",
  action: "record.delete",
  resource: "contact:xyz",
  metadata: { reason: "gdpr" },
};

await client.emit(event);
```

**Python**

```python
from smooai_audit import AuditClient, AuditClientOptions, AuditEvent

client = AuditClient(AuditClientOptions(endpoint=endpoint, token=token))
client.emit(AuditEvent(id=..., org_id="org_123", timestamp=..., actor="user_abc", action="record.delete"))
```

**Rust**

```rust
use smooai_audit::{AuditClient, AuditClientOptions, AuditEvent};

let client = AuditClient::new(AuditClientOptions { endpoint, token });
client.emit(&event)?;
```

**Go**

```go
import audit "github.com/SmooAI/audit/go"

client := audit.NewClient(audit.ClientOptions{Endpoint: endpoint, Token: token})
err := client.Emit(event)
```

**.NET**

```csharp
using SmooAI.Audit;

var client = new AuditClient(new AuditClientOptions { Endpoint = endpoint, Token = token });
await client.EmitAsync(evt);
```

## Cross-language parity

Audit trails are only trustworthy if a hash means the same thing everywhere. The
canonical serializer and hash chain are held to a **shared parity corpus**: a set
of fixed input events with expected canonical JSON and expected hashes. Every
language's test suite runs the corpus and asserts byte-for-byte equality, so a
chain written by a Go service verifies cleanly in a Rust or TypeScript reader.

## Development

This is a single repo housing all five language implementations. See
[`CLAUDE.md`](./CLAUDE.md) / [`AGENTS.md`](./AGENTS.md) for build, test, and
release commands. The short version:

```bash
pnpm install
pnpm check-all   # typecheck + lint + test + build across all languages
```

## License

[MIT](./LICENSE) © SmooAI
