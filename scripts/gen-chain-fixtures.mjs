#!/usr/bin/env node
/**
 * Regenerate the `chainFixtures` block of `spec/parity-corpus.json`.
 *
 *   pnpm tsdown && node scripts/gen-chain-fixtures.mjs
 *
 * The sealed chains are produced by the REAL TypeScript serializer (`dist/`),
 * never by hand: a hand-written hash is a hash nobody computed, and the whole
 * point of the corpus is that five independent implementations agree with one
 * that actually ran. Corruptions are applied to the sealed output, so each
 * fixture is a genuine tampered chain rather than a description of one.
 *
 * Only the `chainFixtures` block is rewritten — the existing `fixtures` array is
 * spliced around verbatim so regenerating never reformats it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { buildHashChain, verifyChain } from "../dist/index.mjs";

const root = process.cwd();
const corpusPath = resolve(root, "spec/parity-corpus.json");

const base = {
  organizationId: "org-1",
  actorType: "user",
  actorId: "user-1",
  resource: { type: "crm.contact", id: "c-1" },
  outcome: "success",
  metadata: {},
};

const seed = [
  {
    ...base,
    id: "01CHAIN0000000000000000001",
    action: "crm.contact_created",
    timestamp: "2026-05-17T12:00:00.000Z",
  },
  {
    ...base,
    id: "01CHAIN0000000000000000002",
    action: "crm.contact_updated",
    timestamp: "2026-05-17T12:00:01.000Z",
  },
  {
    ...base,
    id: "01CHAIN0000000000000000003",
    action: "crm.contact_merged",
    timestamp: "2026-05-17T12:00:02.000Z",
  },
  {
    ...base,
    id: "01CHAIN0000000000000000004",
    action: "crm.contact_deleted",
    timestamp: "2026-05-17T12:00:03.000Z",
  },
];

const GENESIS = "1111111111111111111111111111111111111111111111111111111111111111";

const clone = (value) => JSON.parse(JSON.stringify(value));
const intact = buildHashChain(clone(seed));
const continuation = buildHashChain(clone(seed), GENESIS);

/** Each case corrupts a freshly sealed copy, so cases can never bleed into each other. */
const cases = [
  {
    name: "intact_chain",
    description:
      "Control: a correctly sealed four-event chain starting at the beginning of the day. Must verify.",
    events: intact,
  },
  {
    name: "intact_continuation_chain",
    description:
      "A slice that continues an existing chain: the first event links to genesisPreviousHash rather than being first-of-day. Verifying it WITHOUT that seed must fail at index 0 — see unanchored_continuation_chain.",
    genesisPreviousHash: GENESIS,
    events: continuation,
  },
  {
    name: "unanchored_continuation_chain",
    description:
      "The same continuation slice verified with no genesisPreviousHash. The events are untouched, but a verifier that cannot be told the chain head reports a broken first link — which is why verify takes the seed.",
    events: continuation,
  },
  {
    name: "mutated_event_field",
    description:
      "actorId rewritten on event 1 after sealing. The stored hashCurrent no longer covers the content.",
    events: (() => {
      const c = clone(intact);
      c[1].actorId = "user-attacker";
      return c;
    })(),
  },
  {
    name: "tampered_timestamp",
    description:
      "Event 0's timestamp backdated after sealing — the classic 'this happened earlier than it did' edit.",
    events: (() => {
      const c = clone(intact);
      c[0].timestamp = "2026-05-17T11:59:00.000Z";
      return c;
    })(),
  },
  {
    name: "reordered_pair",
    description:
      "Events 1 and 2 swapped. Both events are individually authentic; only their ORDER is wrong, so the break shows up as a link mismatch, not a content mismatch.",
    events: (() => {
      const c = clone(intact);
      [c[1], c[2]] = [c[2], c[1]];
      return c;
    })(),
  },
  {
    name: "broken_hash_previous_link",
    description:
      "Event 2's hashPrevious overwritten with a plausible-looking 64-hex value; every event body is untouched.",
    events: (() => {
      const c = clone(intact);
      c[2].hashPrevious = "a".repeat(64);
      return c;
    })(),
  },
  {
    name: "deleted_middle_event",
    description: "Event 1 removed. Event 2 still points at the hash of the event that is gone.",
    events: (() => {
      const c = clone(intact);
      c.splice(1, 1);
      return c;
    })(),
  },
  {
    name: "truncated_chain_head_removed",
    description:
      "The first event dropped. The new first event carries a hashPrevious where a first-of-day event must have none.",
    events: clone(intact).slice(1),
  },
  {
    name: "truncated_chain_tail_removed",
    description:
      "The LAST event dropped. This chain still verifies — every remaining link is genuine, and replay alone cannot see a deletion at the tail. Detecting it requires an external anchor (a stored chain head or expected count). This fixture exists so that limit is asserted rather than assumed: ok:true here is the honest answer, not a gap in the verifier.",
    events: clone(intact).slice(0, -1),
  },
  {
    name: "empty_chain",
    description: "No events. Vacuously intact — a verifier must not treat empty as corrupt.",
    events: [],
  },
];

const chainFixtures = cases.map((c) => {
  const verdict = verifyChain(clone(c.events), c.genesisPreviousHash);
  const expected = verdict.ok
    ? { ok: true }
    : { ok: false, brokenAt: verdict.brokenAt, code: verdict.code };
  return {
    name: c.name,
    description: c.description,
    ...(c.genesisPreviousHash ? { genesisPreviousHash: c.genesisPreviousHash } : {}),
    events: c.events,
    expected,
  };
});

const comment =
  'Corrupted-chain vectors for verifyChain / verify_chain / VerifyChain / HashChain.Verify. Each `events` array is a REAL chain sealed by the TS builder and then tampered with; `expected` is the verdict every language must return — `ok`, plus `brokenAt` (index of the first bad link) and `code` when it fails. `code` is the cross-language contract: "hash_previous_mismatch" (the LINK is wrong — reorder, deletion, rewritten hashPrevious, missing head) or "hash_current_mismatch" (the event BODY was edited after sealing). `genesisPreviousHash`, when present, is the chain head the first event must link to. Regenerate with `pnpm tsdown && node scripts/gen-chain-fixtures.mjs` — never hand-edit an expected value.';

const rendered = JSON.stringify({ $chainComment: comment, chainFixtures }, null, 4)
  .replace(/^\{\n/, "")
  .replace(/\n\}$/, "");

const raw = readFileSync(corpusPath, "utf8");
const head = raw.replace(/,\n\s*"\$chainComment"[\s\S]*$/, "\n}").replace(/\n\}\s*$/, "");
writeFileSync(corpusPath, `${head},\n${rendered}\n}\n`);
console.log(`Wrote ${chainFixtures.length} chain fixtures to spec/parity-corpus.json`);
