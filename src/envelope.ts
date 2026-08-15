import { canonicalJson } from "./canonical";
import type { SealedAuditEvent } from "./client";

/**
 * Trace correlation ids carried alongside an event.
 *
 * Both fields are optional and are OMITTED — never emitted as `""` or as the
 * all-zero `00000000000000000000000000000000` id — when there is nothing real to
 * report. An all-zero id is what an unregistered SDK hands you, and writing it
 * into the store is worse than writing nothing: it looks like a correlation id
 * and joins every other unreported event to itself.
 */
export interface TraceContext {
  traceId?: string;
  spanId?: string;
}

/**
 * The wire payload: the sealed event PLUS transport-only correlation ids.
 *
 * `traceId` / `spanId` live HERE, one level above the event, and never inside
 * it. The hash chain covers canonical-JSON(event minus `hashCurrent`), so any
 * field added to the event changes every hash and invalidates every stored
 * chain and the parity corpus. The envelope is outside that boundary: the bytes
 * of `envelope.event` are the exact bytes that were hashed, whether or not a
 * trace was active.
 */
export interface AuditEnvelope {
  event: SealedAuditEvent;
  traceId?: string;
  spanId?: string;
}

/**
 * Cached, best-effort handle on `@opentelemetry/api`.
 *
 * The package is an OPTIONAL peer dependency: an OSS audit SDK must not force
 * OpenTelemetry on anyone. When it is absent the import rejects, this resolves
 * `null`, and correlation becomes a no-op — no crash, no behaviour change.
 * Mirrors `@smooai/fetch`'s `injectTraceContext`.
 */
let otelApi: Promise<typeof import("@opentelemetry/api") | null> | undefined;

/**
 * Read the active W3C trace context, or an empty context when there is none.
 *
 * Two guards, each for a reason:
 *
 * 1. **Optional dependency.** No `@opentelemetry/api` installed → `{}`.
 * 2. **Valid span contexts only.** No registered SDK / no active span yields
 *    either no span context at all or `INVALID_SPAN_CONTEXT` (all-zero ids).
 *    Reporting the latter poisons the audit trail with a correlation id that
 *    correlates nothing — the sibling logger shipped exactly that bug.
 */
export async function currentTraceContext(): Promise<TraceContext> {
  otelApi ??= import("@opentelemetry/api").catch(() => null);
  const otel = await otelApi;
  if (!otel) return {};

  const spanContext = otel.trace.getSpanContext(otel.context.active());
  if (!spanContext || !otel.isSpanContextValid(spanContext)) return {};
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

/**
 * Build the wire envelope for an already-sealed event. `override` wins over the
 * ambient span per field — a caller that knows the trace (a queue consumer
 * replaying a producer's context, say) is more authoritative than whatever span
 * happens to be active at emit time. Empty strings count as "not supplied" on
 * both sides, so they can never reach the wire.
 */
export async function buildEnvelope(
  event: SealedAuditEvent,
  override?: TraceContext,
): Promise<AuditEnvelope> {
  const ambient = await currentTraceContext();
  return {
    event,
    // `||` (not `??`) on purpose: it collapses "" to the next candidate and
    // finally to undefined, which `canonicalJson` drops entirely.
    traceId: override?.traceId || ambient.traceId || undefined,
    spanId: override?.spanId || ambient.spanId || undefined,
  };
}

/** Canonical JSON of the envelope — the exact bytes POSTed to the ingest endpoint. */
export function envelopeJson(envelope: AuditEnvelope): string {
  return canonicalJson(envelope);
}
