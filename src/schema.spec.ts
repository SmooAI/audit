import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, auditEventSchema, isNamespacedAction } from "./schema";

describe("auditEventSchema", () => {
  it("accepts a well-formed event", () => {
    const event = {
      id: "01HXXXXXXXXXXXXXXXXXXXXXXX",
      organizationId: "org-1",
      actorType: "user" as const,
      actorId: "user-1",
      action: AUDIT_ACTIONS.CRM_CONTACT_CREATED,
      resource: { type: "crm.contact", id: "c-1" },
      outcome: "success" as const,
      metadata: { reason: "gdpr" },
      timestamp: "2026-07-14T00:00:00.000Z",
    };
    expect(auditEventSchema.parse(event)).toEqual(event);
  });

  it("rejects an event missing required fields", () => {
    expect(() => auditEventSchema.parse({ id: "x" })).toThrow();
  });

  it("rejects an invalid actorType", () => {
    expect(() =>
      auditEventSchema.parse({
        id: "x",
        organizationId: "org-1",
        actorType: "robot",
        actorId: "a",
        action: "x.y",
        resource: { type: "t", id: "i" },
        outcome: "success",
        metadata: {},
        timestamp: "2026-07-14T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("isNamespacedAction", () => {
  it("accepts namespaced actions", () => {
    expect(isNamespacedAction("crm.contact_created")).toBe(true);
    expect(isNamespacedAction("google.gmail.message_sent")).toBe(true);
  });

  it("rejects non-namespaced or malformed actions", () => {
    expect(isNamespacedAction("login")).toBe(false);
    expect(isNamespacedAction("CRM.contact")).toBe(false);
    expect(isNamespacedAction("crm.")).toBe(false);
  });
});
