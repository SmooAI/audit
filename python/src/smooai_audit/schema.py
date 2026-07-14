"""Canonical audit event schema (Python port of @smooai/audit).

Mirrors the TypeScript ``auditEventSchema`` field-for-field. Verified
byte-for-byte against the shared parity corpus.

TODO(audit-impl): finalize the field set against the parity corpus.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class AuditEvent(BaseModel):
    """A single audit event — the shared shape every language SDK emits."""

    id: str
    org_id: str
    timestamp: str
    actor: str
    action: str
    resource: str | None = None
    metadata: dict[str, Any] | None = None
    previous_hash: str | None = None
