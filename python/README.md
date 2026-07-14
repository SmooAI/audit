# smooai-audit (Python)

Python port of [`@smooai/audit`](https://github.com/SmooAI/audit) — a polyglot
client SDK for tamper-evident, SQL-queryable audit logging: a canonical
`AuditEvent` schema, canonical JSON serialization, a per-org-per-day SHA-256 hash
chain, and an emit client. Verified byte-for-byte against a shared parity corpus.

> **Status:** scaffold — `canonical_json`, `compute_event_hash`, and
> `AuditClient.emit` are stubbed (`TODO(audit-impl)`).

## Install

```bash
uv add smooai-audit   # or: pip install smooai-audit
```

## Usage

```python
from smooai_audit import AuditClient, AuditClientOptions, AuditEvent

client = AuditClient(AuditClientOptions(endpoint=endpoint, token=token))
client.emit(
    AuditEvent(
        id="...",
        org_id="org_123",
        timestamp="2026-07-14T00:00:00.000Z",
        actor="user_abc",
        action="record.delete",
    )
)
```

## License

MIT © SmooAI
