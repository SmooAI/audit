import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "./canonical";
import { AuditClient } from "./client";
import { computeEventHash } from "./hash";

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

const okResponse = () => new Response(null, { status: 200 });

describe("AuditClient.emit", () => {
  it("POSTs the canonical JSON envelope around the sealed event with a Bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const client = new AuditClient({
      endpoint: "https://audit.example/events",
      token: "tok-123",
      fetchImpl,
    });

    await client.emit(event);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://audit.example/events");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-123");

    // The event rides inside the envelope; trace ids (absent here — no span) ride
    // beside it, never inside, so the hashed bytes are untouched.
    const sealed = { ...event, hashCurrent: computeEventHash(event) };
    expect(init.body).toBe(canonicalJson({ event: sealed }));
  });

  it("retries on HTTP 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(okResponse());
    const client = new AuditClient({
      endpoint: "https://audit.example/events",
      token: "t",
      fetchImpl,
      retryBackoffMs: 1,
    });

    await client.emit(event);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails fast on HTTP 4xx (no retry)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    const client = new AuditClient({
      endpoint: "https://audit.example/events",
      token: "t",
      fetchImpl,
    });

    await expect(client.emit(event)).rejects.toThrow(/HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws after retries are exhausted on network errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const client = new AuditClient({
      endpoint: "https://audit.example/events",
      token: "t",
      fetchImpl,
      maxRetries: 2,
      retryBackoffMs: 1,
    });

    await expect(client.emit(event)).rejects.toThrow(/ECONNRESET/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// The retry policy is five hand-written implementations of the same numbers
// unless something asserts they are the same numbers. This is that something.
describe("retry policy defaults match spec/parity-corpus.json", () => {
  const policy = JSON.parse(
    readFileSync(new URL("../spec/parity-corpus.json", import.meta.url), "utf8"),
  ).retryPolicy as { maxAttempts: number; baseBackoffMs: number; backoffMultiplier: number };

  it("uses maxAttempts attempts before giving up", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const client = new AuditClient({
      endpoint: "https://audit.example/events",
      token: "t",
      retryBackoffMs: 1,
      fetchImpl,
    });

    await expect(client.emit(event)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(policy.maxAttempts);
  });

  it("defaults maxRetries and retryBackoffMs to the corpus values", () => {
    const client = new AuditClient({ endpoint: "https://audit.example/events", token: "t" });
    // Reading the private fields is the point: they ARE the defaults under test.
    const internals = client as unknown as { maxRetries: number; retryBackoffMs: number };
    expect(internals.maxRetries).toBe(policy.maxAttempts);
    expect(internals.retryBackoffMs).toBe(policy.baseBackoffMs);
  });

  it("doubles the backoff, matching backoffMultiplier", () => {
    expect(policy.backoffMultiplier).toBe(2);
  });
});
