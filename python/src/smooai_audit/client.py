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

try:  # OpenTelemetry is an OPTIONAL extra (``pip install smooai-audit[otel]``).
    from opentelemetry import trace as _otel_trace
except ImportError:  # pragma: no cover — exercised by the no-otel install path
    _otel_trace = None


def _trace_envelope() -> dict[str, str]:
    """Current W3C trace ids, or ``{}`` when otel is absent or no span is active.

    These ride in the ENVELOPE only — one level ABOVE the event, never inside it
    — so a trace context can never change an event's ``hashCurrent``. An invalid
    (all-zero) span context yields no keys at all rather than zeroed or empty ids.
    """
    if _otel_trace is None:
        return {}
    context = _otel_trace.get_current_span().get_span_context()
    if not context.is_valid:
        return {}
    return {"traceId": format(context.trace_id, "032x"), "spanId": format(context.span_id, "016x")}


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
        """Seal ``event`` (stamp ``hashCurrent`` if absent) and POST the canonical
        JSON envelope with ``Authorization: Bearer <token>``::

            {"event": {…the sealed event…}, "spanId": "…", "traceId": "…"}

        The bytes under ``event`` are what the hash covers; the active span's
        ids ride outside them (omitted entirely when there is no span). Swallows
        errors unless ``swallow_errors`` is False."""
        try:
            if not event.hash_current:
                event = event.model_copy(update={"hash_current": compute_event_hash(event)})
            envelope = {"event": event.model_dump(by_alias=True, exclude_unset=True, mode="json")} | _trace_envelope()
            body = canonical_json(envelope).encode("utf-8")
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
