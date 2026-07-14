import type { AuditEvent } from "./schema";

/**
 * Compute the SHA-256 hash of a single audit event.
 *
 * The hash is taken over the canonical JSON of the event (see {@link canonicalJson})
 * with `previousHash` folded in, forming a per-org-per-day tamper-evident chain:
 * each event's hash covers the prior event's hash, so any retroactive edit breaks
 * every subsequent link.
 *
 * TODO(audit-impl): implement — sha256(previousHash || canonicalJson(event)) as
 * lowercase hex, matching the parity corpus. Use node:crypto (stdlib).
 */
export function computeEventHash(_event: AuditEvent): string {
  throw new Error("TODO(audit-impl): computeEventHash not implemented");
}

/**
 * Fold a sequence of events into a hash chain, returning each event stamped with
 * the `previousHash` it links to. `genesisHash` seeds the chain (default "").
 *
 * TODO(audit-impl): implement the chain fold over computeEventHash.
 */
export function buildHashChain(_events: AuditEvent[], _genesisHash = ""): AuditEvent[] {
  throw new Error("TODO(audit-impl): buildHashChain not implemented");
}
