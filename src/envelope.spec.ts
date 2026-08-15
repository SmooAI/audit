import { readFileSync } from "node:fs";
import { context, INVALID_SPAN_CONTEXT, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditClient } from "./client";
import { buildEnvelope, currentTraceContext, type AuditEnvelope } from "./envelope";
import { computeEventHash } from "./hash";

/**
 * Trace correlation on the emit envelope.
 *
 * The load-bearing assertion is the LAST describe block: attaching trace ids
 * must not move a single hash. They ride in the envelope, one level above the
 * event, precisely so the hash chain — and `spec/parity-corpus.json`, which is
 * the committed record of it — stays byte-identical.
 */

// `register()` installs the AsyncLocalStorage context manager, i.e. the shape a
// real service runs in. Without it `context.active()` never sees a span.
new NodeTracerProvider().register();

const tracer = trace.getTracer("audit-envelope-test");

const event = {
  id: "01HXXXXXXXXXXXXXXXXXXXXXXX",
  organizationId: "org-1",
  actorType: "user" as const,
  actorId: "user-1",
  action: "crm.contact_created",
  resource: { type: "crm.contact", id: "c-1" },
  outcome: "success" as const,
  metadata: {},
  timestamp: "2026-05-17T12:00:00.000Z",
};

interface Fixture {
  name: string;
  event: Record<string, unknown>;
  expectedCanonical: string;
  expectedHash: string;
}
const corpus = JSON.parse(
  readFileSync(new URL("../spec/parity-corpus.json", import.meta.url), "utf8"),
) as { fixtures: Fixture[] };

let bodies: string[] = [];

/** Emit through the real client and return the parsed wire envelope. */
async function emitAndCapture(trace?: {
  traceId?: string;
  spanId?: string;
}): Promise<AuditEnvelope> {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  const client = new AuditClient({
    endpoint: "https://audit.example/events",
    token: "t",
    fetchImpl,
  });
  await client.emit(event, trace);
  const body = fetchImpl.mock.calls[0]![1].body as string;
  bodies.push(body);
  return JSON.parse(body) as AuditEnvelope;
}

beforeEach(() => {
  bodies = [];
});

describe("trace ids on the envelope", () => {
  it("carries the active span's traceId and spanId", async () => {
    const { envelope, spanContext } = await tracer.startActiveSpan("caller", async (span) => {
      const envelope = await emitAndCapture();
      span.end();
      return { envelope, spanContext: span.spanContext() };
    });

    expect(envelope.traceId).toBe(spanContext.traceId);
    expect(envelope.spanId).toBe(spanContext.spanId);
    expect(envelope.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(envelope.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("omits both ids entirely when there is no active span", async () => {
    const envelope = await emitAndCapture();

    expect("traceId" in envelope).toBe(false);
    expect("spanId" in envelope).toBe(false);
    // Never an all-zero id and never an empty string — an unregistered SDK hands
    // you all-zeros, and storing that correlates every uncorrelated event to
    // itself. The sibling logger shipped exactly that bug.
    expect(bodies[0]).not.toContain("00000000");
    expect(bodies[0]).not.toContain('""');
  });

  it("omits both ids for an INVALID (all-zero) span context", async () => {
    const envelope = await context.with(
      trace.setSpanContext(context.active(), INVALID_SPAN_CONTEXT),
      () => emitAndCapture(),
    );

    expect("traceId" in envelope).toBe(false);
    expect(bodies[0]).not.toContain("00000000");
  });

  it("lets a caller-supplied trace context win over the ambient span", async () => {
    const supplied = { traceId: "11111111111111111111111111111111", spanId: "2222222222222222" };

    const envelope = await tracer.startActiveSpan("caller", async (span) => {
      const envelope = await emitAndCapture(supplied);
      span.end();
      return envelope;
    });

    expect(envelope.traceId).toBe(supplied.traceId);
    expect(envelope.spanId).toBe(supplied.spanId);
  });

  it("treats a caller-supplied empty string as absent", async () => {
    const envelope = await emitAndCapture({ traceId: "", spanId: "" });

    expect("traceId" in envelope).toBe(false);
    expect("spanId" in envelope).toBe(false);
  });

  it("reads no context outside a span and a valid one inside", async () => {
    expect(await currentTraceContext()).toEqual({});
    await tracer.startActiveSpan("caller", async (span) => {
      expect(await currentTraceContext()).toEqual({
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
      });
      span.end();
    });
  });
});

describe("the hash chain is untouched by trace context", () => {
  it("reproduces every parity-corpus hash byte-for-byte INSIDE an active span", async () => {
    await tracer.startActiveSpan("caller", async (span) => {
      // A trace context that leaked into the hashed object would break these the
      // same way an added event field would.
      for (const fixture of corpus.fixtures) {
        expect(computeEventHash(fixture.event as never)).toBe(fixture.expectedHash);
      }
      span.end();
    });
  });

  it("seals an event to the same hash with and without a span", async () => {
    const withoutSpan = await emitAndCapture();
    const withSpan = await tracer.startActiveSpan("caller", async (span) => {
      const envelope = await emitAndCapture();
      span.end();
      return envelope;
    });

    expect(withSpan.event.hashCurrent).toBe(withoutSpan.event.hashCurrent);
    expect(withSpan.event.hashCurrent).toBe(computeEventHash(event));
    // And the hashed bytes are the event's own — recomputing from what went over
    // the wire (envelope.event minus hashCurrent) reproduces the stamped hash,
    // which it could not if traceId/spanId had landed inside the event.
    const { hashCurrent, ...rest } = withSpan.event;
    expect(computeEventHash(rest as never)).toBe(hashCurrent);
  });

  it("puts the ids beside the event, never inside it", async () => {
    const envelope = await tracer.startActiveSpan("caller", async (span) => {
      const envelope = await emitAndCapture();
      span.end();
      return envelope;
    });

    expect(envelope.traceId).toBeDefined();
    expect(envelope.event).not.toHaveProperty("traceId");
    expect(envelope.event).not.toHaveProperty("spanId");
  });

  it("builds an envelope whose `event` bytes are the pre-envelope canonical bytes", async () => {
    const sealed = { ...event, hashCurrent: computeEventHash(event) };
    const envelope = await tracer.startActiveSpan("caller", async (span) => {
      const built = await buildEnvelope(sealed);
      span.end();
      return built;
    });

    expect(envelope.event).toBe(sealed);
  });
});
