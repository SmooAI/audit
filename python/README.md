# smooai-audit (Python)

Python port of [`@smooai/audit`](https://github.com/SmooAI/audit) — a polyglot
client SDK for tamper-evident, SQL-queryable audit logging: a canonical
`AuditEvent` schema, canonical JSON serialization, a per-org-per-day SHA-256 hash
chain, and an emit client. Verified byte-for-byte against a shared parity corpus.

> **Status:** complete — `canonical_json`, `compute_event_hash`, `build_hash_chain`,
> and `AuditClient.emit` are implemented and verified byte-for-byte against the
> shared parity corpus (`../spec/parity-corpus.json`), including envelope trace
> correlation (optional OTel via `pip install smooai-audit[otel]`).

## Install

```bash
uv add smooai-audit   # or: pip install smooai-audit
```

## Usage

```python
from smooai_audit import AuditClient, AuditClientOptions, AuditEvent, AuditResource

client = AuditClient(AuditClientOptions(endpoint=endpoint, token=token))
client.emit(
    AuditEvent(
        id="01HXXXXXXXXXXXXXXXXXXXXXXX",
        organization_id="org_123",
        actor_type="user",
        actor_id="user_abc",
        action="crm.contact_deleted",
        resource=AuditResource(type="crm.contact", id="c-42"),
        outcome="success",
        metadata={},
        timestamp="2026-07-14T00:00:00.000Z",
    )
)
```

## License

MIT © SmooAI
