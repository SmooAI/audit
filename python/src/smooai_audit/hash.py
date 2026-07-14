"""SHA-256 hash chain over audit events."""

from __future__ import annotations

from .schema import AuditEvent


def compute_event_hash(event: AuditEvent) -> str:
    """Return the lowercase hex SHA-256 of an event.

    Taken over ``canonical_json(event)`` with ``previous_hash`` folded in, forming
    a per-org-per-day tamper-evident chain.

    TODO(audit-impl): implement — sha256(previous_hash || canonical_json(event)).
    """
    raise NotImplementedError("TODO(audit-impl): compute_event_hash not implemented")


def build_hash_chain(events: list[AuditEvent], genesis_hash: str = "") -> list[AuditEvent]:
    """Fold events into a hash chain, stamping each with its ``previous_hash``.

    TODO(audit-impl): implement the chain fold over compute_event_hash.
    """
    raise NotImplementedError("TODO(audit-impl): build_hash_chain not implemented")
