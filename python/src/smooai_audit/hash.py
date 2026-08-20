"""SHA-256 hash chain over audit events.

Each event's ``hash_current`` is ``SHA-256(canonical-JSON(event minus
hash_current))``; the chain links via ``hash_previous`` = the prior event's
``hash_current``. :func:`verify_chain` replays that: recompute every hash and
confirm each event's ``hash_previous`` equals the previous event's
``hash_current``.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import Enum
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


class VerifyFailureCode(str, Enum):
    """Why a chain failed to verify.

    These codes are the cross-language contract — every SDK returns the same code
    for the same corruption, asserted by ``chainFixtures`` in
    ``spec/parity-corpus.json``.
    """

    HASH_PREVIOUS_MISMATCH = "hash_previous_mismatch"
    """An event's ``hash_previous`` is not the prior event's ``hash_current`` —
    the LINK is wrong: a reorder, a deletion, a truncated head, a rewritten link."""

    HASH_CURRENT_MISMATCH = "hash_current_mismatch"
    """The event's own content no longer hashes to its stored ``hash_current`` —
    the event BODY was edited after sealing."""


@dataclass(frozen=True)
class ChainVerification:
    """The verdict from :func:`verify_chain`. Falsy when the chain is broken."""

    ok: bool
    broken_at: int | None = None
    """Index of the first event that failed. ``None`` when ``ok``."""
    code: VerifyFailureCode | None = None
    """Why it failed. ``None`` when ``ok``."""

    def __bool__(self) -> bool:
        return self.ok


def _chain_field(event: AuditEvent | Mapping[str, Any], attr: str, wire_key: str) -> str | None:
    """Read a chain field from either a typed event or a raw wire mapping."""
    if isinstance(event, AuditEvent):
        return getattr(event, attr)
    value = event.get(wire_key)
    return value if isinstance(value, str) else None


def verify_chain(
    events: Sequence[AuditEvent | Mapping[str, Any]],
    genesis_previous_hash: str | None = None,
) -> ChainVerification:
    """Verify an ordered chain: recompute every ``hash_current`` and confirm each
    ``hash_previous`` matches the prior event's ``hash_current``.

    ``genesis_previous_hash`` is the hash the FIRST event must link to — pass the
    chain head you already have when verifying a slice that continues an existing
    chain. Leave it ``None`` only when ``events`` starts at the true beginning of
    the chain (first event of the org's day), where ``hash_previous`` must be
    absent.

    **What replay cannot see:** removing events from the TAIL leaves a chain that
    still verifies — every remaining link is genuine. Detecting that needs an
    external anchor (a stored chain head, an expected count) compared against the
    last event's ``hash_current``. An ``ok`` verdict means "nothing here was
    altered", not "nothing is missing"; the corpus pins this as an explicit
    fixture so the limit stays visible.
    """
    previous = genesis_previous_hash
    for index, event in enumerate(events):
        if _chain_field(event, "hash_previous", "hashPrevious") != previous:
            return ChainVerification(ok=False, broken_at=index, code=VerifyFailureCode.HASH_PREVIOUS_MISMATCH)
        recomputed = compute_event_hash(event)
        if _chain_field(event, "hash_current", "hashCurrent") != recomputed:
            return ChainVerification(ok=False, broken_at=index, code=VerifyFailureCode.HASH_CURRENT_MISMATCH)
        previous = recomputed
    return ChainVerification(ok=True)
