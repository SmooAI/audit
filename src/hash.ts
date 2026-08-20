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
 * Why a chain failed to verify. These codes are the cross-language contract —
 * every SDK returns the same code for the same corruption, and
 * `spec/parity-corpus.json`'s `chainFixtures` assert it.
 */
export type VerifyFailureCode =
  /** An event's `hashPrevious` is not the prior event's `hashCurrent` — the link
   * itself is wrong: a reorder, a deletion, a truncated head, a rewritten link. */
  | "hash_previous_mismatch"
  /** The event's own content no longer hashes to its stored `hashCurrent` — the
   * event body was edited after sealing. */
  | "hash_current_mismatch";

export type ChainVerification =
  | { ok: true }
  | { ok: false; brokenAt: number; code: VerifyFailureCode; reason: string };

/**
 * Verify an ordered chain: recompute every `hashCurrent` and confirm each
 * `hashPrevious` matches the prior event's `hashCurrent`. Returns the index of
 * the first event that fails, or `{ ok: true }` if the chain is intact.
 *
 * `genesisPreviousHash` is the hash the FIRST event must link to — pass the
 * chain head you already have when verifying a slice that continues an existing
 * chain. Omit it only when `events` starts at the true beginning of the chain
 * (first event of the org's day), where `hashPrevious` must be absent.
 *
 * **What replay cannot see:** removing events from the TAIL leaves a chain that
 * still verifies — every remaining link is genuine. Detecting that needs an
 * external anchor (a stored chain head, an expected count) compared against the
 * last event's `hashCurrent`. Verifying `{ ok: true }` means "nothing here was
 * altered", not "nothing is missing". `spec/parity-corpus.json` pins this as an
 * explicit fixture so the limit stays visible instead of being mistaken for
 * coverage.
 */
export function verifyChain(events: AuditEvent[], genesisPreviousHash?: string): ChainVerification {
  let previousHash = genesisPreviousHash;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.hashPrevious !== previousHash) {
      return {
        ok: false,
        brokenAt: i,
        code: "hash_previous_mismatch",
        reason: "hashPrevious does not match previous event",
      };
    }
    const recomputed = computeEventHash(event);
    if (recomputed !== event.hashCurrent) {
      return {
        ok: false,
        brokenAt: i,
        code: "hash_current_mismatch",
        reason: "hashCurrent recomputation does not match stored value",
      };
    }
    previousHash = event.hashCurrent;
  }
  return { ok: true };
}
