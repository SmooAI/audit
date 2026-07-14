"""Audit emit client (Python port of ``@smooai/audit``).

Seals an event (computes its ``hashCurrent``) and POSTs the canonical JSON to a
configurable ingest endpoint with a Bearer token. Uses the standard library
(``urllib``) — no HTTP dependency — since a single fire-and-forget POST needs no
more. Like the TS emitter, errors are swallowed by default: audit logging must
never break the calling code path.
"""

from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

from .canonical import canonical_json
from .hash import compute_event_hash
from .schema import AuditEvent


@dataclass
class AuditClientOptions:
    """Configuration for :class:`AuditClient`."""

    endpoint: str
    """Ingest endpoint URL events are POSTed to."""
    token: str
    """Bearer token used to authenticate emit requests."""
    timeout: float = 10.0
    """Per-request timeout in seconds."""
    swallow_errors: bool = True
    """Swallow transport errors silently (default). Set False to raise."""
    on_error: Callable[[Exception], None] | None = None
    """Optional hook invoked with any swallowed error."""


class AuditClient:
    """Emits audit events to a configurable ingest endpoint over HTTPS."""

    def __init__(self, options: AuditClientOptions) -> None:
        self._options = options

    def emit(self, event: AuditEvent) -> None:
        """Seal ``event`` (stamp ``hashCurrent`` if absent) and POST its canonical
        JSON with ``Authorization: Bearer <token>``. Swallows errors unless
        ``swallow_errors`` is False."""
        try:
            if not event.hash_current:
                event = event.model_copy(update={"hash_current": compute_event_hash(event)})
            body = canonical_json(event).encode("utf-8")
            request = urllib.request.Request(
                self._options.endpoint,
                data=body,
                method="POST",
                headers={
                    "content-type": "application/json",
                    "authorization": f"Bearer {self._options.token}",
                },
            )
            with urllib.request.urlopen(request, timeout=self._options.timeout) as response:  # noqa: S310 — endpoint is caller-controlled config, not user input
                if response.status >= 400:
                    raise urllib.error.HTTPError(self._options.endpoint, response.status, "audit ingest failed", response.headers, None)
        except Exception as err:  # noqa: BLE001 — audit logging must never break the caller
            if not self._options.swallow_errors:
                raise
            if self._options.on_error is not None:
                self._options.on_error(err)
