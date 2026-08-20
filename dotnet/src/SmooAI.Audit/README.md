# SmooAI.Audit

[![NuGet](https://img.shields.io/nuget/v/SmooAI.Audit.svg)](https://www.nuget.org/packages/SmooAI.Audit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

.NET port of [`@smooai/audit`](https://github.com/SmooAI/audit) — a polyglot
client SDK for tamper-evident, SQL-queryable audit logging: a canonical
`AuditEvent` schema, canonical JSON serialization, a per-org-per-day SHA-256 hash
chain, and an emit client. Wire-compatible with the TypeScript, Python, Rust, and
Go ports and verified byte-for-byte against a shared parity corpus.

> **Status:** complete — `Canonical.ToCanonicalJson`, `HashChain.ComputeEventHash`,
> `HashChain.Build`, and `AuditClient.EmitAsync` are implemented and verified
> byte-for-byte against the shared parity corpus (`spec/parity-corpus.json`),
> including envelope trace correlation (`Activity.Current`, no extra package).

## Install

```bash
dotnet add package SmooAI.Audit
```

## Usage

```csharp
using System.Text.Json.Nodes;
using SmooAI.Audit;

var client = new AuditClient(new AuditClientOptions { Endpoint = endpoint, Token = token });
await client.EmitAsync(new AuditEvent
{
    Id = "01HXXXXXXXXXXXXXXXXXXXXXXX",
    OrganizationId = "org_123",
    ActorType = "user",
    ActorId = "user_abc",
    Action = "crm.contact_deleted",
    Resource = new AuditResource { Type = "crm.contact", Id = "c-42" },
    Outcome = "success",
    Metadata = new JsonObject(),
    Timestamp = DateTimeOffset.UtcNow.ToString("O"),
});
```

## License

MIT © SmooAI
