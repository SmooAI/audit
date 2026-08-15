import { buildEnvelope, envelopeJson, type TraceContext } from "./envelope";
import { computeEventHash } from "./hash";
import type { AuditEvent } from "./schema";

export interface AuditClientOptions {
  /** Base URL of the audit ingest endpoint (events are POSTed here). */
  endpoint: string;
  /** Bearer token used to authenticate emit requests. */
  token: string;
  /** Custom fetch impl (defaults to globalThis.fetch). Handy for tests. */
  fetchImpl?: typeof fetch;
  /** Max attempts on transient failure (network error / HTTP 5xx). Default 3. */
  maxRetries?: number;
  /** Base backoff in ms; doubles each retry. Default 100. */
  retryBackoffMs?: number;
}

/** Sealed event actually put on the wire — `hashCurrent` is stamped by the client. */
export type SealedAuditEvent = Omit<AuditEvent, "hashCurrent"> & { hashCurrent: string };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Client that emits audit events to a configurable ingest endpoint over HTTPS
 * with a bearer token. It stamps each event's `hashCurrent` (the canonical-JSON
 * SHA-256) and POSTs the canonical JSON of an {@link AuditEnvelope} —
 * `{"event":<the sealed event>,"spanId":…,"traceId":…}`. The bytes under
 * `"event"` are exactly what every language SDK produces for that event, so the
 * server can persist them without re-serializing, and the trace ids ride
 * OUTSIDE them so they cannot perturb a single hash.
 *
 * Retries transient failures (network errors and HTTP 5xx) with exponential
 * backoff; 4xx responses are surfaced immediately (they will not succeed on
 * retry).
 */
export class AuditClient {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  constructor(options: AuditClientOptions) {
    this.endpoint = options.endpoint;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 100;
  }

  /**
   * Seal `event` with its `hashCurrent` and POST the canonical JSON of its
   * envelope to the ingest endpoint. Resolves on 2xx; throws on non-transient
   * (4xx) responses and after retries are exhausted on transient failures.
   *
   * The active W3C trace context is captured here, at emit time, and carried in
   * the envelope so an event can be tied back to the request that caused it.
   * `trace` overrides the ambient span; both are omitted when there is nothing
   * valid to report.
   */
  async emit(event: Omit<AuditEvent, "hashCurrent">, trace?: TraceContext): Promise<void> {
    const hashCurrent = computeEventHash(event);
    const sealed: SealedAuditEvent = { ...event, hashCurrent };
    // Built once, outside the retry loop: a retried POST must carry the SAME
    // bytes, since the ingest endpoint dedupes on the event's hash.
    const body = envelopeJson(await buildEnvelope(sealed, trace));
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.token}`,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(this.retryBackoffMs * 2 ** (attempt - 1));
      try {
        const res = await this.fetchImpl(this.endpoint, { method: "POST", headers, body });
        if (res.ok) return;
        // 4xx will not succeed on retry — fail fast. 5xx is transient.
        if (res.status < 500) {
          throw new Error(`audit ingest failed: HTTP ${res.status}`);
        }
        lastError = new Error(`audit ingest failed: HTTP ${res.status}`);
      } catch (err) {
        // A thrown 4xx above must not be retried.
        if (err instanceof Error && /HTTP 4\d\d/.test(err.message)) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`audit ingest failed: ${String(lastError)}`);
  }
}
