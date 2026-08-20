---
"@smooai/audit": minor
---

Ship chain verification in all five languages, and prove it with corrupted-chain
corpus vectors.

`verifyChain` — the function that actually DETECTS a broken hash chain — existed
only in TypeScript. Python carried a docstring describing how one would verify;
Rust, Go, and .NET had nothing. A service in four of five languages could seal a
chain it could never audit, which makes "tamper-evident" a claim rather than a
capability.

- New: `verify_chain` (Python, Rust), `VerifyChain` (Go), `HashChain.Verify`
  (.NET). All five return the same verdict shape: `ok`, `brokenAt`, and a shared
  failure code — `hash_previous_mismatch` (the link is wrong) or
  `hash_current_mismatch` (the event body was edited after sealing).
- `verifyChain` gains an optional `genesisPreviousHash`, so a slice continuing an
  existing chain can be verified at all. Without it, only a first-of-day chain
  was verifiable. TypeScript additionally gains a `code` field alongside the
  existing human-readable `reason` (additive; `reason` is unchanged).
- `spec/parity-corpus.json` gains `chainFixtures`: 11 real chains, sealed by the
  builder and then genuinely tampered with, each with the verdict every language
  must return. All five suites load them. The corpus previously proved sealing
  only, which is what let the asymmetry hide.
- One fixture asserts the honest limit: deleting events from the TAIL of a chain
  still verifies. Replay cannot see it; catching it needs an external anchor.
