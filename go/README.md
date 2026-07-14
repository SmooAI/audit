# smooai-audit (Go)

Go port of [`@smooai/audit`](https://github.com/SmooAI/audit) — a polyglot client
SDK for tamper-evident, SQL-queryable audit logging: a canonical `Event` schema,
canonical JSON serialization, a per-org-per-day SHA-256 hash chain, and an emit
client. Verified byte-for-byte against a shared parity corpus.

> **Status:** scaffold — `CanonicalJSON`, `ComputeEventHash`, and `Client.Emit`
> are stubbed (return `ErrNotImplemented`, `TODO(audit-impl)`).

## Install

```bash
go get github.com/SmooAI/audit/go
```

## Usage

```go
import audit "github.com/SmooAI/audit/go"

client := audit.NewClient(audit.ClientOptions{Endpoint: endpoint, Token: token})
err := client.Emit(event)
```

## License

MIT © SmooAI
