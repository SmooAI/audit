import { z } from "zod";

/**
 * Canonical audit event schema — the shared shape every language SDK emits and
 * every consumer queries. This schema is the source of truth for the TypeScript
 * SDK; the Python / Rust / Go / .NET ports mirror it field-for-field and are
 * verified byte-for-byte against a shared parity corpus.
 *
 * TODO(audit-impl): finalize the field set against the parity corpus. The fields
 * below are a scaffold of the intended surface, not the frozen schema.
 */
export const auditEventSchema = z.object({
  /** Stable unique id for this event (UUID). */
  id: z.string(),
  /** Organization the event belongs to — hash chains are per-org-per-day. */
  orgId: z.string(),
  /** RFC 3339 / ISO-8601 UTC timestamp. */
  timestamp: z.string(),
  /** Who performed the action (user id, service id, "system", ...). */
  actor: z.string(),
  /** What happened, e.g. "user.login", "record.delete". */
  action: z.string(),
  /** The thing acted upon, e.g. "contact:abc123". */
  resource: z.string().nullable().optional(),
  /** Arbitrary structured context. Must serialize canonically. */
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Hex SHA-256 of the previous event in this org/day chain ("" for genesis). */
  previousHash: z.string().optional(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
