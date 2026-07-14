"""Canonical JSON serialization for audit events.

Reproduces JavaScript ``JSON.stringify`` semantics BYTE-FOR-BYTE (not "some
canonical JSON"), because the audit hash chain is
``hashCurrent = SHA-256(canonical-JSON(event minus hashCurrent))`` and a single
divergent byte breaks every downstream hash. See ``hash-chain.ts`` /
``canonical.rs`` for the sibling implementations this must match.

The three JS-vs-Python footguns handled here:

1. **String escaping** — JS escapes ``"`` and ``\\``, renders control chars
   U+0000–U+001F as ``\\b \\t \\n \\f \\r`` or ``\\uXXXX``, does NOT escape the
   forward slash, and emits all other chars (incl. non-ASCII) as literal UTF-8.
   ``json.dumps(s, ensure_ascii=False)`` matches this exactly, so we reuse it
   rather than hand-roll an escaper.
2. **Number formatting** — integers render plain; ``bool`` is a subclass of
   ``int`` in Python so it MUST be checked first; non-finite floats become
   ``null`` like ``JSON.stringify``.
3. **Key ordering** — JS ``Array.prototype.sort`` orders by UTF-16 code units,
   NOT Unicode code points. We sort by ``key.encode("utf-16-be")`` so an
   astral-plane key sorts the same as it would in V8. (Field names are ASCII,
   where the two orders agree, but the corpus mandates code-unit correctness.)
"""

from __future__ import annotations

import json
import math
from typing import Any

from pydantic import BaseModel


def _json_string(text: str) -> str:
    # json.dumps with these settings matches JSON.stringify's string escaping:
    # quote/backslash escaped, control chars as \b\t\n\f\r or \uXXXX, forward
    # slash NOT escaped, non-ASCII emitted as literal UTF-8.
    return json.dumps(text, ensure_ascii=False)


def _format_number(value: int | float) -> str:
    # bool is a subclass of int — callers must dispatch bool before reaching here.
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        return "null"  # JSON.stringify(NaN | Infinity) === "null"
    if value.is_integer():
        return str(int(value))  # JS has no int/float split: 5.0 → "5"
    # ponytail: repr() gives shortest round-trip like V8 for typical decimals;
    # exponent-form floats (e.g. 1e-7 → "1e-07" here vs "1e-7" in JS) can differ.
    # Audit metadata is integers/strings in practice; widen if a float appears.
    return repr(value)


def canonical_json(value: Any) -> str:
    """Serialize ``value`` to its canonical JSON string, byte-matching JS
    ``canonicalJsonStringify``: object keys sorted at every depth, array order
    preserved, no insignificant whitespace.

    Accepts raw JSON-compatible Python values (dict/list/str/int/float/bool/None)
    or a pydantic model (dumped to its camelCase wire dict first). A PRESENT
    ``None`` renders as ``"null"``; only keys ABSENT from the mapping disappear
    (the JS ``undefined`` rule — an absent optional was never in the dict)."""
    if isinstance(value, BaseModel):
        value = value.model_dump(by_alias=True, exclude_unset=True, mode="json")

    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return _format_number(value)
    if isinstance(value, str):
        return _json_string(value)
    if isinstance(value, list | tuple):
        items: list[Any] = list(value)
        return "[" + ",".join(canonical_json(item) for item in items) + "]"
    if isinstance(value, dict):
        obj: dict[str, Any] = value
        keys = sorted(obj.keys(), key=lambda k: str(k).encode("utf-16-be"))
        parts = (_json_string(str(k)) + ":" + canonical_json(obj[k]) for k in keys)
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"canonical_json cannot serialize value of type {type(value).__name__}")
