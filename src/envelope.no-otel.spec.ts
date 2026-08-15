import { expect, it, vi } from "vitest";
import { computeEventHash } from "./hash";

/**
 * `@opentelemetry/api` is an OPTIONAL peer dependency. Simulate it being absent —
 * the import rejects exactly as it does when the package is not installed — and
 * assert the client still emits: no trace ids, no crash, same hash.
 */
vi.mock("@opentelemetry/api", () => {
  throw new Error("Cannot find module '@opentelemetry/api'");
});

const { AuditClient } = await import("./client");
const { currentTraceContext } = await import("./envelope");

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

it("emits without trace ids when @opentelemetry/api is not installed", async () => {
  // Prove the simulated absence is actually in effect for this module registry —
  // otherwise this would pass for the wrong reason (merely no active span).
  await expect(import("@opentelemetry/api")).rejects.toThrow();

  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  const client = new AuditClient({
    endpoint: "https://audit.example/events",
    token: "t",
    fetchImpl,
  });

  await expect(client.emit(event)).resolves.toBeUndefined();

  expect(await currentTraceContext()).toEqual({});
  const body = fetchImpl.mock.calls[0]![1].body as string;
  const envelope = JSON.parse(body);
  expect("traceId" in envelope).toBe(false);
  expect("spanId" in envelope).toBe(false);
  expect(envelope.event.hashCurrent).toBe(computeEventHash(event));
});
