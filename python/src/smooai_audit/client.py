"""Audit emit client (Python port of ``@smooai/audit``).

Seals an event (computes its ``hashCurrent``) and POSTs the canonical JSON to a
configurable ingest endpoint with a Bearer token. Uses the standard library
(``urllib``) — no HTTP dependency.

Transient failures (transport errors and HTTP 5xx) are retried with exponential
backoff on the schedule every language SDK shares; see ``retryPolicy`` in
``spec/parity-corpus.json``. Failures that survive the retries are **raised**.
"""

from __future__ import annotations

import asyncio
import time
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
    max_retries: int = 3
    """Total attempts on transient failure (transport error / HTTP 5xx)."""
    retry_backoff_ms: int = 100
    """Base backoff in ms; doubles each retry."""
    swallow_errors: bool = False
    """Re-raise emit failures (default).

    This defaults to False on purpose. It used to default to True, which meant
    the path carrying the audit record failed **silently**: a misconfigured
    endpoint or an expired token dropped every event and reported success, and
    the gap was invisible until someone went looking for a trail that was never
    written. If you want the old fire-and-forget posture, opt into it — and pass
    ``on_error`` so the failure lands somewhere.
    """
    on_error: Callable[[Exception], None] | None = None
    """Hook invoked with the final error, whether or not it is swallowed."""


def _is_transient(error: Exception) -> bool:
    """Retry only what a retry can fix: the request never reached a verdict, or
    the server said it could not answer right now. A 4xx will say the same thing
    on the next attempt, so surfacing it immediately is the correct answer."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code >= 500
    return True


class AuditClient:
    """Emits audit events to a configurable ingest endpoint over HTTPS."""

    def __init__(self, options: AuditClientOptions) -> None:
        self._options = options

    def emit(self, event: AuditEvent) -> None:
        """Seal ``event`` (stamp ``hashCurrent`` if absent) and POST the canonical
        JSON envelope with ``Authorization: Bearer <token>``::

            {"event": {…the sealed event…}, "spanId": "…", "traceId": "…"}

        The bytes under ``event`` are what the hash covers; the active span's ids
        ride outside them (omitted entirely when there is no span).

        Retries transport errors and HTTP 5xx with exponential backoff; 4xx is
        raised immediately. Raises the final error unless ``swallow_errors`` is
        True, in which case ``on_error`` is the only thing that sees it.
        """
        options = self._options
        try:
            if not event.hash_current:
                event = event.model_copy(update={"hash_current": compute_event_hash(event)})
            envelope = {"event": event.model_dump(by_alias=True, exclude_unset=True, mode="json")} | _trace_envelope()
            # Built once, outside the retry loop: a retried POST must carry the
            # SAME bytes, since ingest dedupes on the event's hash.
            body = canonical_json(envelope).encode("utf-8")

            last_error: Exception | None = None
            for attempt in range(options.max_retries):
                if attempt > 0:
                    time.sleep(options.retry_backoff_ms * (2 ** (attempt - 1)) / 1000)
                try:
                    self._post(body)
                    return
                except Exception as err:  # noqa: BLE001 — classified immediately below
                    if not _is_transient(err):
                        raise
                    last_error = err
            raise last_error if last_error is not None else RuntimeError("audit ingest failed")
        except Exception as err:  # noqa: BLE001 — audit emission must be observable, not invisible
            if options.on_error is not None:
                options.on_error(err)
            if not options.swallow_errors:
                raise

    async def emit_async(self, event: AuditEvent) -> None:
        """:meth:`emit` off the event loop.

        ``urllib`` is blocking and this SDK deliberately has no HTTP dependency,
        so the thread executor is the honest way to keep an async caller from
        stalling on a POST — not a second transport to keep in parity.
        """
        await asyncio.to_thread(self.emit, event)

    def _post(self, body: bytes) -> None:
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
