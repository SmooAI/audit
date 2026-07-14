import pytest

from smooai_audit import AuditEvent, canonical_json


def test_audit_event_parses_well_formed() -> None:
    event = AuditEvent(
        id="11111111-1111-1111-1111-111111111111",
        org_id="org_123",
        timestamp="2026-07-14T00:00:00.000Z",
        actor="user_abc",
        action="record.delete",
        resource="contact:xyz",
        metadata={"reason": "gdpr"},
        previous_hash="",
    )
    assert event.action == "record.delete"


def test_audit_event_rejects_missing_required() -> None:
    with pytest.raises(Exception):
        AuditEvent(id="x")  # type: ignore[call-arg]


def test_canonical_json_is_stubbed() -> None:
    event = AuditEvent(
        id="1",
        org_id="o",
        timestamp="2026-07-14T00:00:00.000Z",
        actor="a",
        action="x",
    )
    with pytest.raises(NotImplementedError):
        canonical_json(event)
