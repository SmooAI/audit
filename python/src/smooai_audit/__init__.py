"""Python client SDK for tamper-evident, SQL-queryable audit logging."""

from .canonical import canonical_json
from .client import AuditClient, AuditClientOptions
from .hash import build_hash_chain, compute_event_hash
from .schema import AuditEvent

__all__ = [
    "AuditClient",
    "AuditClientOptions",
    "AuditEvent",
    "build_hash_chain",
    "canonical_json",
    "compute_event_hash",
]
