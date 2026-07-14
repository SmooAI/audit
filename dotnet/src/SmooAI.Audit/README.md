# SmooAI.Audit

[![NuGet](https://img.shields.io/nuget/v/SmooAI.Audit.svg)](https://www.nuget.org/packages/SmooAI.Audit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

.NET port of [`@smooai/audit`](https://github.com/SmooAI/audit) — a polyglot
client SDK for tamper-evident, SQL-queryable audit logging: a canonical
`AuditEvent` schema, canonical JSON serialization, a per-org-per-day SHA-256 hash
chain, and an emit client. Wire-compatible with the TypeScript, Python, Rust, and
Go ports and verified byte-for-byte against a shared parity corpus.

> **Status:** scaffold — `Canonical.ToCanonicalJson`, `HashChain.ComputeEventHash`,
> and `AuditClient.EmitAsync` are stubbed (`TODO(audit-impl)`).

## Install

```bash
dotnet add package SmooAI.Audit
```

## Usage

```csharp
using SmooAI.Audit;

var client = new AuditClient(new AuditClientOptions { Endpoint = endpoint, Token = token });
await client.EmitAsync(new AuditEvent
{
    Id = Guid.NewGuid().ToString(),
    OrgId = "org_123",
    Timestamp = DateTimeOffset.UtcNow.ToString("O"),
    Actor = "user_abc",
    Action = "record.delete",
});
```

## License

MIT © SmooAI
