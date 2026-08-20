"""Python client SDK for tamper-evident, SQL-queryable audit logging."""

from .canonical import canonical_json
from .client import AuditClient, AuditClientOptions
from .hash import (
    ChainVerification,
    VerifyFailureCode,
    build_hash_chain,
    compute_event_hash,
    verify_chain,
)
from .schema import (
    AUDIT_ACTIONS,
    AuditActorType,
    AuditDiff,
    AuditEvent,
    AuditOutcome,
    AuditResource,
    is_namespaced_action,
)

__all__ = [
    "AUDIT_ACTIONS",
    "AuditActorType",
    "AuditClient",
    "AuditClientOptions",
    "AuditDiff",
    "AuditEvent",
    "AuditOutcome",
    "AuditResource",
    "ChainVerification",
    "VerifyFailureCode",
    "build_hash_chain",
    "canonical_json",
    "compute_event_hash",
    "is_namespaced_action",
    "verify_chain",
]
