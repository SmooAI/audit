import { z } from "zod";

/**
 * Smoo Audit — canonical event schema.
 *
 * The shared shape every language SDK emits and every consumer queries. This
 * TypeScript schema is the source of truth; the Python / Rust / Go / .NET ports
 * mirror it field-for-field and are verified byte-for-byte against the shared
 * parity corpus (`spec/parity-corpus.json`).
 *
 * The schema is GENERIC — zero customer/vertical content. `action` is an opaque
 * `namespace.verb` string (see {@link isNamespacedAction}); {@link AUDIT_ACTIONS}
 * is only a baseline of the actions every app shares, not a closed set.
 */

/** Who performed the action. */
export const auditActorTypeSchema = z.enum([
  "user",
  "agent",
  "system",
  "integration",
  "api_client",
]);
export type AuditActorType = z.infer<typeof auditActorTypeSchema>;

/** Outcome of the action. */
export const auditOutcomeSchema = z.enum(["success", "failure", "denied"]);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

/**
 * Resource the action was performed against (e.g. a CRM contact, an agent
 * config). `id` is the canonical identifier in the relevant table.
 */
export const auditResourceSchema = z.object({
  type: z.string(),
  id: z.string(),
});
export type AuditResource = z.infer<typeof auditResourceSchema>;

/**
 * Structural diff captured at write time. Either side may be omitted (on create
 * `before` is absent; on delete `after` is absent). Stored as opaque JSON.
 */
export const auditDiffSchema = z.object({
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
export type AuditDiff = z.infer<typeof auditDiffSchema>;

/**
 * The wire payload an emitter sends. The server enriches actor / request / hash
 * fields from the authenticated request context — clients NEVER set those.
 */
export const auditEventInputSchema = z.object({
  /** `namespace.verb` action string, e.g. `crm.contact_created`. Opaque to the serializer. */
  action: z.string(),
  resource: auditResourceSchema,
  /** Default 'success' if omitted. */
  outcome: auditOutcomeSchema.optional(),
  /** Human-readable reason (especially for 'failure' / 'denied'). */
  reason: z.string().optional(),
  sessionId: z.string().optional(),
  conversationId: z.string().optional(),
  diff: auditDiffSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AuditEventInput = z.infer<typeof auditEventInputSchema>;

/**
 * The full event shape as persisted / hashed. All identity + request fields are
 * present after server-side enrichment. `hashCurrent` is the SHA-256 of
 * canonical-JSON(this event minus `hashCurrent`); it is excluded from the hash
 * input and therefore optional on the pre-hash object fed to the serializer.
 */
export const auditEventSchema = z.object({
  /** ULID-like sortable identifier. */
  id: z.string(),
  organizationId: z.string(),
  actorType: auditActorTypeSchema,
  actorId: z.string(),
  actorEmail: z.string().optional(),
  action: z.string(),
  resource: auditResourceSchema,
  outcome: auditOutcomeSchema,
  reason: z.string().optional(),
  sessionId: z.string().optional(),
  conversationId: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  geoCountry: z.string().optional(),
  diff: auditDiffSchema.optional(),
  metadata: z.record(z.string(), z.unknown()),
  /** ISO 8601 UTC timestamp. */
  timestamp: z.string(),
  /** Previous event's hash in the per-org-per-day chain. Absent on the first event. */
  hashPrevious: z.string().optional(),
  /** SHA-256 of canonical-JSON(this event minus hashCurrent). Absent pre-seal. */
  hashCurrent: z.string().optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

/**
 * Baseline event-action constants covering the generic surface every app shares.
 * Emitters are NOT limited to this set — any consumer defines its own namespaced
 * actions (see {@link AuditEventInput.action}). The dashboard, alerts, and
 * out-of-the-box compliance reports pivot off these names, so keep them stable.
 */
export const AUDIT_ACTIONS = {
  // Identity
  USER_SIGNIN: "user.signin",
  USER_SIGNOUT: "user.signout",
  USER_PASSWORD_CHANGED: "user.password_changed",
  USER_INVITED: "user.invited",
  // Org
  ORG_CREATED: "org.created",
  ORG_MEMBER_ADDED: "org.member_added",
  ORG_MEMBER_REMOVED: "org.member_removed",
  ORG_ROLE_CHANGED: "org.role_changed",
  ORG_SUBSCRIPTION_CHANGED: "org.subscription_changed",
  ORG_PRODUCT_PURCHASED: "org.product_purchased",
  // Agent
  AGENT_CONFIG_CHANGED: "agent.config_changed",
  AGENT_KNOWLEDGE_DOC_ADDED: "agent.knowledge_doc_added",
  AGENT_KNOWLEDGE_DOC_REMOVED: "agent.knowledge_doc_removed",
  AGENT_ESCALATION_CREATED: "agent.escalation_created",
  AGENT_TOOL_FAILED: "agent.tool_failed",
  // CRM
  CRM_CONTACT_CREATED: "crm.contact_created",
  CRM_CONTACT_MERGED: "crm.contact_merged",
  CRM_CONTACT_DELETED: "crm.contact_deleted",
  // API auth
  API_KEY_MINTED: "api.key_minted",
  API_KEY_ROTATED: "api.key_rotated",
  API_KEY_REVOKED: "api.key_revoked",
  // Integrations
  INTEGRATION_CONNECTED: "integration.connected",
  INTEGRATION_DISCONNECTED: "integration.disconnected",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * Validates the `namespace.verb` action convention: a lowercase namespace and at
 * least one lowercase verb segment, dot-separated (e.g. `crm.contact_created`,
 * `google.gmail.message_sent`). Consumers emitting their own actions should
 * assert this at their trust boundary; the canonical serialization treats
 * `action` as an opaque string, so this is a convention check, not a hard schema
 * constraint.
 */
export function isNamespacedAction(action: string): boolean {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]+)+$/.test(action);
}
