# smooai-audit (Go)

Go port of [`@smooai/audit`](https://github.com/SmooAI/audit) — a polyglot client
SDK for tamper-evident, SQL-queryable audit logging: a canonical `Event` schema,
canonical JSON serialization, a per-org-per-day SHA-256 hash chain, and an emit
client. Verified byte-for-byte against a shared parity corpus.

Canonical serialization, the SHA-256 hash chain, and the emit client are
verified byte-for-byte against the shared parity corpus
(`../spec/parity-corpus.json`) — all 5 language SDKs produce identical bytes.

## Install

```bash
go get github.com/SmooAI/audit/go
```

## Usage

```go
import audit "github.com/SmooAI/audit/go"

client := audit.NewClient(endpoint, token) // or &audit.AuditClient{Endpoint: endpoint, Token: token}
err := client.Emit(ctx, event)             // seals (hashes) the event, POSTs canonical JSON w/ Bearer
```

## License

MIT © SmooAI
