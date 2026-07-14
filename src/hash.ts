import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical";
import type { AuditEvent } from "./schema";

/**
 * Compute the tamper-evident hash for a single event.
 *
 * `hashCurrent` = lowercase-hex SHA-256 over the canonical JSON of the event with
 * its own `hashCurrent` field removed. The chain links via `hashPrevious` = the
 * prior event's `hashCurrent`, so any retroactive edit breaks every later link.
 * Uses node:crypto (stdlib) — no external dependency.
 */
export function computeEventHash(event: Omit<AuditEvent, "hashCurrent"> | AuditEvent): string {
  const { hashCurrent: _drop, ...rest } = event as AuditEvent;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

/**
 * Fold an ordered sequence of events into a hash chain, returning each event
 * stamped with the `hashPrevious` it links to and its computed `hashCurrent`.
 * `genesisPreviousHash` seeds the first event's `hashPrevious` (default:
 * omitted, i.e. first-of-chain).
 */
export function buildHashChain(
  events: Array<Omit<AuditEvent, "hashCurrent" | "hashPrevious">>,
  genesisPreviousHash?: string,
): AuditEvent[] {
  const chain: AuditEvent[] = [];
  let previousHash = genesisPreviousHash;
  for (const event of events) {
    const withPrev = { ...event, hashPrevious: previousHash } as Omit<AuditEvent, "hashCurrent">;
    const hashCurrent = computeEventHash(withPrev);
    const sealed = { ...withPrev, hashCurrent } as AuditEvent;
    chain.push(sealed);
    previousHash = hashCurrent;
  }
  return chain;
}

/**
 * Verify an ordered chain: recompute every `hashCurrent` and confirm each
 * `hashPrevious` matches the prior event's `hashCurrent`. Returns the index of
 * the first event that fails, or `{ ok: true }` if the chain is intact.
 */
export function verifyChain(
  events: AuditEvent[],
): { ok: true } | { ok: false; brokenAt: number; reason: string } {
  let previousHash: string | undefined;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.hashPrevious !== previousHash) {
      return { ok: false, brokenAt: i, reason: "hashPrevious does not match previous event" };
    }
    const recomputed = computeEventHash(event);
    if (recomputed !== event.hashCurrent) {
      return {
        ok: false,
        brokenAt: i,
        reason: "hashCurrent recomputation does not match stored value",
      };
    }
    previousHash = event.hashCurrent;
  }
  return { ok: true };
}
