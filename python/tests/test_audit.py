"""Parity + behavior tests for the Python audit SDK.

The corpus tests are THE gate: every fixture in ``spec/parity-corpus.json`` must
canonicalize and hash byte-for-byte identically to the TS and Rust SDKs. If any
fixture fails, the hash chain is broken across stores — fix the serializer, never
the corpus.
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
from pathlib import Path
from typing import Any

import pytest

from smooai_audit import (
    AuditClient,
    AuditClientOptions,
    AuditEvent,
    build_hash_chain,
    canonical_json,
    compute_event_hash,
    is_namespaced_action,
    verify_chain,
)

_CORPUS_PATH = Path(__file__).resolve().parents[2] / "spec" / "parity-corpus.json"
_CORPUS: dict[str, Any] = json.loads(_CORPUS_PATH.read_text(encoding="utf-8"))
_FIXTURES: list[dict[str, Any]] = _CORPUS["fixtures"]
_FIXTURE_IDS = [f["name"] for f in _FIXTURES]
_CHAIN_FIXTURES: list[dict[str, Any]] = _CORPUS["chainFixtures"]
_RETRY_POLICY: dict[str, Any] = _CORPUS["retryPolicy"]
_CHAIN_IDS = [f["name"] for f in _CHAIN_FIXTURES]


@pytest.mark.parametrize("fixture", _FIXTURES, ids=_FIXTURE_IDS)
def test_corpus_canonical_matches_byte_for_byte(fixture: dict[str, Any]) -> None:
    assert canonical_json(fixture["event"]) == fixture["expectedCanonical"]


@pytest.mark.parametrize("fixture", _FIXTURES, ids=_FIXTURE_IDS)
def test_corpus_hash_matches(fixture: dict[str, Any]) -> None:
    assert compute_event_hash(fixture["event"]) == fixture["expectedHash"]


@pytest.mark.parametrize("fixture", _FIXTURES, ids=_FIXTURE_IDS)
def test_corpus_via_model_round_trip(fixture: dict[str, Any]) -> None:
    # Parsing the wire dict into the typed model and back must reproduce the same
    # canonical bytes + hash — proves the schema's aliases/optionality are right.
    event = AuditEvent.model_validate(fixture["event"])
    assert canonical_json(event) == fixture["expectedCanonical"]
    assert compute_event_hash(event) == fixture["expectedHash"]


# The corpus proved SEALING only — that a hash is reproducible in five languages.
# It said nothing about whether any of them can DETECT a broken chain, which is
# the property the word "tamper-evident" actually names. These are that half.
def test_chain_corpus_has_broken_fixtures() -> None:
    assert _CHAIN_FIXTURES, "chainFixtures missing from the corpus"
    assert any(not f["expected"]["ok"] for f in _CHAIN_FIXTURES), "no tampered chain to detect"


@pytest.mark.parametrize("fixture", _CHAIN_FIXTURES, ids=_CHAIN_IDS)
def test_chain_corpus_verdict_matches(fixture: dict[str, Any]) -> None:
    result = verify_chain(fixture["events"], fixture.get("genesisPreviousHash"))
    expected = fixture["expected"]
    assert result.ok == expected["ok"], fixture["description"]
    if not expected["ok"]:
        assert result.broken_at == expected["brokenAt"]
        assert result.code is not None
        assert result.code.value == expected["code"]


@pytest.mark.parametrize("fixture", _CHAIN_FIXTURES, ids=_CHAIN_IDS)
def test_chain_corpus_verdict_matches_via_model(fixture: dict[str, Any]) -> None:
    # Same verdict through the typed model, not just the raw wire dicts — proves
    # the pydantic aliases do not lose a chain field on the way in.
    events = [AuditEvent.model_validate(e) for e in fixture["events"]]
    result = verify_chain(events, fixture.get("genesisPreviousHash"))
    assert result.ok == fixture["expected"]["ok"], fixture["description"]


def test_canonical_sorts_keys_and_preserves_array_order() -> None:
    assert canonical_json({"b": 1, "a": [3, 1, 2]}) == '{"a":[3,1,2],"b":1}'


def test_canonical_present_null_is_rendered() -> None:
    assert canonical_json({"a": None}) == '{"a":null}'


def test_canonical_forward_slash_not_escaped_control_chars_are() -> None:
    assert canonical_json("a/b\tc") == '"a/b\\tc"'


def test_build_hash_chain_links_events() -> None:
    base = dict(
        organization_id="org-1",
        actor_type="user",
        actor_id="u-1",
        action="crm.contact_created",
        resource={"type": "crm.contact", "id": "c-1"},
        outcome="success",
        metadata={},
        timestamp="2026-05-17T12:00:00.000Z",
    )
    events = [AuditEvent(id="e-1", **base), AuditEvent(id="e-2", **base)]
    sealed = build_hash_chain(events)

    assert sealed[0].hash_previous is None  # first event: no link
    assert sealed[0].hash_current is not None
    assert sealed[1].hash_previous == sealed[0].hash_current  # chained
    # Recompute independently to prove the stamped hash is correct.
    assert compute_event_hash(sealed[1]) == sealed[1].hash_current


def test_is_namespaced_action() -> None:
    assert is_namespaced_action("crm.contact_created")
    assert is_namespaced_action("google.gmail.message_sent")
    assert not is_namespaced_action("nodot")
    assert not is_namespaced_action("Crm.contactCreated")


def _sample_event() -> AuditEvent:
    return AuditEvent(
        id="e-1",
        organization_id="org-1",
        actor_type="user",
        actor_id="u-1",
        action="crm.contact_created",
        resource={"type": "crm.contact", "id": "c-1"},
        outcome="success",
        metadata={},
        timestamp="2026-05-17T12:00:00.000Z",
    )


def _client(**overrides: Any) -> AuditClient:
    options: dict[str, Any] = dict(
        endpoint="http://127.0.0.1:1/audit",  # nothing listening → connection refused
        token="t",
        timeout=0.5,
        retry_backoff_ms=1,
    )
    options.update(overrides)
    return AuditClient(AuditClientOptions(**options))


def test_emit_raises_by_default() -> None:
    # This default USED to be swallow-on-failure, which meant a misconfigured
    # endpoint dropped every audit event and reported success. Fail-open on the
    # path that carries the record is the defect, not the feature.
    captured: list[Exception] = []
    with pytest.raises(Exception):  # noqa: B017, PT011 — any transport error qualifies
        _client(on_error=captured.append).emit(_sample_event())
    assert len(captured) == 1, "on_error must fire even when the error is re-raised"


def test_emit_can_opt_into_swallowing() -> None:
    captured: list[Exception] = []
    _client(swallow_errors=True, on_error=captured.append).emit(_sample_event())  # must not raise
    assert len(captured) == 1


def test_emit_retries_transport_errors_maxattempts_times() -> None:
    attempts = 0
    client = _client()

    def counting_post(_body: bytes) -> None:
        nonlocal attempts
        attempts += 1
        raise OSError("connection refused")

    client._post = counting_post  # pyright: ignore[reportAttributeAccessIssue] — narrow seam for counting attempts
    with pytest.raises(OSError, match="connection refused"):
        client.emit(_sample_event())
    assert attempts == _RETRY_POLICY["maxAttempts"]


def test_emit_fails_fast_on_4xx() -> None:
    attempts = 0
    client = _client()

    def failing_post(_body: bytes) -> None:
        nonlocal attempts
        attempts += 1
        raise urllib.error.HTTPError("http://x", 400, "bad request", None, None)  # pyright: ignore[reportArgumentType]

    client._post = failing_post  # pyright: ignore[reportAttributeAccessIssue] — narrow seam for counting attempts
    with pytest.raises(urllib.error.HTTPError):
        client.emit(_sample_event())
    assert attempts == 1, "a 4xx will say the same thing on the next attempt"


def test_client_defaults_match_the_shared_retry_policy() -> None:
    # Five hand-written implementations of the same numbers are five chances to
    # drift. The corpus is the one place they are written down.
    options = AuditClientOptions(endpoint="http://x", token="t")
    assert options.max_retries == _RETRY_POLICY["maxAttempts"]
    assert options.retry_backoff_ms == _RETRY_POLICY["baseBackoffMs"]
    assert _RETRY_POLICY["backoffMultiplier"] == 2


def test_emit_async_runs_emit_off_the_loop() -> None:
    captured: list[Exception] = []
    client = _client(swallow_errors=True, on_error=captured.append)
    asyncio.run(client.emit_async(_sample_event()))
    assert len(captured) == 1


# --- Envelope trace correlation -------------------------------------------------
# traceId/spanId ride OUTSIDE the hashed event, so an active span must never move
# a hash. otel is an optional extra: skip if it is not installed.

_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
_SPAN_ID = "00f067aa0ba902b7"


class _FakeResponse:
    status = 202
    headers: dict[str, str] = {}  # noqa: RUF012 — test stub

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *_: object) -> None:
        return None


def _emit_capture(monkeypatch: pytest.MonkeyPatch, event: AuditEvent) -> dict[str, Any]:
    """Emit ``event`` through a stubbed transport and return the decoded body."""
    captured: dict[str, Any] = {}

    def fake_urlopen(request: Any, timeout: float = 0) -> _FakeResponse:  # noqa: ARG001
        captured.update(json.loads(request.data.decode("utf-8")))
        return _FakeResponse()

    monkeypatch.setattr("smooai_audit.client.urllib.request.urlopen", fake_urlopen)
    client = AuditClient(AuditClientOptions(endpoint="http://audit.test/ingest", token="t", swallow_errors=False))
    client.emit(event)
    return captured


def _active_span() -> Any:
    """A valid non-recording span from the otel API alone (no SDK/exporter)."""
    trace = pytest.importorskip("opentelemetry.trace")
    span_context = trace.SpanContext(
        trace_id=int(_TRACE_ID, 16),
        span_id=int(_SPAN_ID, 16),
        is_remote=False,
        trace_flags=trace.TraceFlags(trace.TraceFlags.SAMPLED),
    )
    return trace.use_span(trace.NonRecordingSpan(span_context), end_on_exit=False)


def _sample_event() -> AuditEvent:
    return AuditEvent(
        id="e-1",
        organization_id="org-1",
        actor_type="user",
        actor_id="u-1",
        action="crm.contact_created",
        resource={"type": "crm.contact", "id": "c-1"},
        outcome="success",
        metadata={},
        timestamp="2026-05-17T12:00:00.000Z",
    )


def test_envelope_carries_trace_ids_when_span_active(monkeypatch: pytest.MonkeyPatch) -> None:
    with _active_span():
        body = _emit_capture(monkeypatch, _sample_event())
    assert body["traceId"] == _TRACE_ID
    assert body["spanId"] == _SPAN_ID


def test_envelope_omits_trace_ids_without_span(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _emit_capture(monkeypatch, _sample_event())
    assert "traceId" not in body  # omitted entirely — never all-zero, never ""
    assert "spanId" not in body


@pytest.mark.parametrize("fixture", _FIXTURES, ids=_FIXTURE_IDS)
def test_corpus_hash_unchanged_under_active_span(monkeypatch: pytest.MonkeyPatch, fixture: dict[str, Any]) -> None:
    """The hash-chain regression gate: every corpus fixture must seal to its
    committed hash — and the envelope minus the trace ids must be the committed
    canonical bytes — whether or not a span is active."""
    event = AuditEvent.model_validate(fixture["event"])

    without_span = _emit_capture(monkeypatch, event)
    with _active_span():
        with_span = _emit_capture(monkeypatch, event)

    for body in (without_span, with_span):
        sealed = body["event"]
        assert sealed["hashCurrent"] == fixture["expectedHash"]
        preimage = {k: v for k, v in sealed.items() if k != "hashCurrent"}
        assert canonical_json(preimage) == fixture["expectedCanonical"]

    assert with_span["traceId"] == _TRACE_ID
    assert "traceId" not in without_span
