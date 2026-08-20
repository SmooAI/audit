import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical";
import { buildHashChain, computeEventHash, verifyChain } from "./hash";
import type { AuditEvent } from "./schema";

interface Fixture {
  name: string;
  description: string;
  event: Record<string, unknown>;
  expectedCanonical: string;
  expectedHash: string;
}

interface ChainFixture {
  name: string;
  description: string;
  genesisPreviousHash?: string;
  events: AuditEvent[];
  expected: { ok: true } | { ok: false; brokenAt: number; code: string };
}

const corpus = JSON.parse(
  readFileSync(new URL("../spec/parity-corpus.json", import.meta.url), "utf8"),
) as { fixtures: Fixture[]; chainFixtures: ChainFixture[] };

describe("parity corpus (spec/parity-corpus.json)", () => {
  it("has fixtures to check", () => {
    expect(corpus.fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of corpus.fixtures) {
    describe(fixture.name, () => {
      it("serializes byte-for-byte to expectedCanonical", () => {
        expect(canonicalJson(fixture.event)).toBe(fixture.expectedCanonical);
      });

      it("hashes to expectedHash", () => {
        expect(computeEventHash(fixture.event as never)).toBe(fixture.expectedHash);
      });
    });
  }
});

describe("hash chain", () => {
  it("links hashPrevious to the prior hashCurrent and verifies", () => {
    const base = {
      organizationId: "org-1",
      actorType: "user" as const,
      actorId: "user-1",
      resource: { type: "crm.contact", id: "c-1" },
      outcome: "success" as const,
      metadata: {},
    };
    const chain = buildHashChain([
      { ...base, id: "e1", action: "crm.contact_created", timestamp: "2026-05-17T12:00:00.000Z" },
      { ...base, id: "e2", action: "crm.contact_merged", timestamp: "2026-05-17T12:00:01.000Z" },
      { ...base, id: "e3", action: "crm.contact_deleted", timestamp: "2026-05-17T12:00:02.000Z" },
    ]);

    expect(chain[0]!.hashPrevious).toBeUndefined();
    expect(chain[1]!.hashPrevious).toBe(chain[0]!.hashCurrent);
    expect(chain[2]!.hashPrevious).toBe(chain[1]!.hashCurrent);
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  it("detects tampering", () => {
    const chain = buildHashChain([
      {
        id: "e1",
        organizationId: "org-1",
        actorType: "user",
        actorId: "u",
        action: "a.b",
        resource: { type: "t", id: "i" },
        outcome: "success",
        metadata: {},
        timestamp: "2026-05-17T12:00:00.000Z",
      },
      {
        id: "e2",
        organizationId: "org-1",
        actorType: "user",
        actorId: "u",
        action: "a.c",
        resource: { type: "t", id: "i" },
        outcome: "success",
        metadata: {},
        timestamp: "2026-05-17T12:00:01.000Z",
      },
    ]);
    chain[0]!.action = "a.tampered";
    const result = verifyChain(chain);
    expect(result.ok).toBe(false);
  });
});

// The corpus proved SEALING only — that a hash is reproducible in five
// languages. It said nothing about whether any of them can DETECT a broken
// chain, which is the property the word "tamper-evident" actually names. These
// fixtures are the detection half.
describe("chain corpus (spec/parity-corpus.json → chainFixtures)", () => {
  it("has chain fixtures, including at least one that must be detected as broken", () => {
    expect(corpus.chainFixtures.length).toBeGreaterThan(0);
    expect(corpus.chainFixtures.some((f) => !f.expected.ok)).toBe(true);
  });

  for (const fixture of corpus.chainFixtures) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      const result = verifyChain(fixture.events, fixture.genesisPreviousHash);
      expect(result.ok).toBe(fixture.expected.ok);
      if (!fixture.expected.ok) {
        if (result.ok) throw new Error("unreachable: asserted above");
        expect(result.brokenAt).toBe(fixture.expected.brokenAt);
        expect(result.code).toBe(fixture.expected.code);
      }
    });
  }
});
