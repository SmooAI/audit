---
"@smooai/audit": minor
---

Give every language the same emit posture: retry with backoff, and never fail
silently.

- **Retry on transient failure in Python, Rust, Go, and .NET** — previously
  TypeScript only. Transport errors and HTTP 5xx are retried with exponential
  backoff; a 4xx is surfaced immediately. The retried POST carries the same
  canonical bytes, since ingest dedupes on the event hash. The defaults now live
  in `spec/parity-corpus.json`'s `retryPolicy` (3 attempts, 100 ms base,
  doubling) and every language's tests assert their client against it, rather
  than five copies of the same magic numbers.
- **BREAKING (Python): `swallow_errors` now defaults to `False`.** It defaulted
  to `True`, so a misconfigured endpoint or an expired token dropped every audit
  event and reported success — fail-open on the exact path that carries the
  record. Pass `swallow_errors=True` to keep the old behaviour; `on_error` now
  fires whether or not the error is swallowed. (The old docstring also claimed
  this matched the TypeScript client. It never did — TS has always thrown.)
- **New: `AuditClient.emit_async` in Python**, running the blocking `urllib`
  POST off the event loop via `asyncio.to_thread`.
- Rust's `AuditClientOptions` gains `max_retries` / `retry_backoff_ms` (both
  `Option`, `None` = the shared default) and an `AuditClientOptions::new`
  constructor. Go's `AuditClient` gains `MaxRetries` / `RetryBackoff` (zero =
  default). .NET's `AuditClientOptions` gains `MaxRetries` / `RetryBackoffMs`.
- Go's `Emit` stays synchronous on purpose — `go client.Emit(ctx, event)` is how
  Go does async — and now honours context cancellation between retries too.
