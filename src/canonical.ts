import type { AuditEvent } from "./schema";

/**
 * Serialize an audit event to its canonical JSON string.
 *
 * Canonical form must be byte-for-byte identical across every language SDK so
 * the hash chain is portable: deterministic key ordering, no insignificant
 * whitespace, stable number/unicode formatting.
 *
 * TODO(audit-impl): implement the canonical serializer against the shared parity
 * corpus (sorted keys recursively, UTF-8, no NaN/Infinity, minimal escaping).
 */
export function canonicalJson(_event: AuditEvent): string {
  throw new Error("TODO(audit-impl): canonicalJson not implemented");
}
