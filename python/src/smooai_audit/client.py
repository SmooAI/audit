"""Audit emit client (Python port of @smooai/audit)."""

from __future__ import annotations

from dataclasses import dataclass

from .schema import AuditEvent


@dataclass
class AuditClientOptions:
    """Configuration for :class:`AuditClient`."""

    endpoint: str
    """Base URL of the audit ingest endpoint."""
    token: str
    """Bearer token used to authenticate emit requests."""


class AuditClient:
    """Emits audit events to a configurable ingest endpoint over HTTPS.

    TODO(audit-impl): implement ``emit`` — POST canonical_json(event) to the
    endpoint with ``Authorization: Bearer <token>``, retry/backoff, and surface
    transport errors.
    """

    def __init__(self, options: AuditClientOptions) -> None:
        self._options = options

    def emit(self, event: AuditEvent) -> None:
        _ = (self._options, event)
        raise NotImplementedError("TODO(audit-impl): AuditClient.emit not implemented")
