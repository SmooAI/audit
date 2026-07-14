"""Canonical JSON serialization for audit events."""

from __future__ import annotations

from .schema import AuditEvent


def canonical_json(event: AuditEvent) -> str:
    """Serialize an audit event to its canonical JSON string.

    Must be byte-for-byte identical to every other language SDK: deterministic
    recursive key ordering, no insignificant whitespace, stable number/unicode
    formatting.

    TODO(audit-impl): implement against the shared parity corpus.
    """
    raise NotImplementedError("TODO(audit-impl): canonical_json not implemented")
