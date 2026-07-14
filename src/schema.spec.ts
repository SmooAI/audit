import { describe, expect, it } from "vitest";
import { auditEventSchema } from "./schema";

describe("auditEventSchema", () => {
  it("accepts a well-formed event", () => {
    const event = {
      id: "11111111-1111-1111-1111-111111111111",
      orgId: "org_123",
      timestamp: "2026-07-14T00:00:00.000Z",
      actor: "user_abc",
      action: "record.delete",
      resource: "contact:xyz",
      metadata: { reason: "gdpr" },
      previousHash: "",
    };
    expect(auditEventSchema.parse(event)).toEqual(event);
  });

  it("rejects an event missing required fields", () => {
    expect(() => auditEventSchema.parse({ id: "x" })).toThrow();
  });
});
