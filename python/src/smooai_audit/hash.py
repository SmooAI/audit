"""SHA-256 hash chain over audit events.

Each event's ``hash_current`` is ``SHA-256(canonical-JSON(event minus
hash_current))``; the chain links via ``hash_previous`` = the prior event's
``hash_current``. Verify by replaying: recompute every hash and confirm each
event's ``hash_previous`` equals the previous event's ``hash_current``.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import Any

from .canonical import canonical_json
from .schema import AuditEvent


def compute_event_hash(event: AuditEvent | Mapping[str, Any]) -> str:
    """Return the lowercase hex SHA-256 of ``event`` minus its own
    ``hashCurrent`` field. Accepts an :class:`AuditEvent` or a raw wire mapping
    (camelCase keys, as decoded from JSON)."""
    if isinstance(event, AuditEvent):
        payload: Any = event.model_dump(by_alias=True, exclude_unset=True, mode="json")
    else:
        payload = dict(event)
    payload.pop("hashCurrent", None)
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def build_hash_chain(events: list[AuditEvent], previous_hash: str | None = None) -> list[AuditEvent]:
    """Seal an ordered list of events into a chain: stamp each with its
    ``hash_previous`` (the prior event's ``hash_current``, or ``previous_hash``
    for the first) and its freshly computed ``hash_current``. Returns new sealed
    copies; inputs are not mutated."""
    sealed: list[AuditEvent] = []
    prev = previous_hash
    for event in events:
        # Omit hash_previous entirely on the first event of a chain (JS undefined,
        # not null) — only stamp it once there is a prior hash to link to.
        update: dict[str, Any] = {"hash_current": None}
        if prev is not None:
            update["hash_previous"] = prev
        with_prev = event.model_copy(update=update)
        current = compute_event_hash(with_prev)
        sealed.append(with_prev.model_copy(update={"hash_current": current}))
        prev = current
    return sealed
