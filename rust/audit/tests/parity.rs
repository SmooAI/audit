//! Cross-language parity gate — every fixture in `spec/parity-corpus.json` must
//! produce byte-exact `expectedCanonical` and `expectedHash`, both from the raw
//! event Value AND through the [`AuditEvent`] schema round-trip. This is the same
//! corpus the TS / Python / Go / .NET SDKs assert against; a divergence here
//! means the hash chain is broken across stores — investigate the serializer,
//! NEVER edit the corpus.

use serde::Deserialize;
use smooai_audit::{canonical_json, compute_event_hash, verify_chain, AuditEvent, ChainVerification, VerifyFailureCode};

#[derive(Deserialize)]
struct Corpus {
    fixtures: Vec<Fixture>,
    #[serde(rename = "chainFixtures")]
    chain_fixtures: Vec<ChainFixture>,
}

#[derive(Deserialize)]
struct ChainFixture {
    name: String,
    description: String,
    #[serde(rename = "genesisPreviousHash")]
    genesis_previous_hash: Option<String>,
    events: Vec<AuditEvent>,
    expected: ExpectedVerdict,
}

#[derive(Deserialize)]
struct ExpectedVerdict {
    ok: bool,
    #[serde(rename = "brokenAt")]
    broken_at: Option<usize>,
    code: Option<VerifyFailureCode>,
}

#[derive(Deserialize)]
struct Fixture {
    name: String,
    event: serde_json::Value,
    #[serde(rename = "expectedCanonical")]
    expected_canonical: String,
    #[serde(rename = "expectedHash")]
    expected_hash: String,
}

fn corpus() -> Corpus {
    // Read at compile time relative to the crate manifest so the test runs from
    // any cwd. CARGO_MANIFEST_DIR = rust/audit → ../../spec = repo/spec.
    let raw = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/parity-corpus.json"));
    serde_json::from_str(raw).expect("parity corpus parses")
}

#[test]
fn raw_value_canonical_and_hash_match() {
    for f in corpus().fixtures {
        let canonical = canonical_json(&f.event);
        assert_eq!(canonical, f.expected_canonical, "canonical mismatch [{}]", f.name);
        assert_eq!(compute_event_hash(&f.event), f.expected_hash, "hash mismatch [{}]", f.name);
    }
}

#[test]
fn schema_roundtrip_canonical_and_hash_match() {
    for f in corpus().fixtures {
        // Deserialize the fixture into the typed schema, then hash via the schema
        // path — proves the struct field set + serde renames are byte-faithful.
        let event: AuditEvent = serde_json::from_value(f.event.clone()).unwrap_or_else(|e| panic!("fixture {} deserializes: {e}", f.name));
        assert_eq!(event.canonical(), f.expected_canonical, "schema canonical mismatch [{}]", f.name);
        assert_eq!(event.compute_hash(), f.expected_hash, "schema hash mismatch [{}]", f.name);
    }
}

// The corpus above proves SEALING only — that a hash is reproducible in five
// languages. It says nothing about whether any of them can DETECT a broken
// chain, which is the property the word "tamper-evident" actually names. The
// `chainFixtures` below are that half: real chains, really tampered with, each
// with the verdict every language must return.

#[test]
fn chain_corpus_has_broken_fixtures() {
    let corpus = corpus();
    assert!(!corpus.chain_fixtures.is_empty(), "chainFixtures missing from the corpus");
    assert!(
        corpus.chain_fixtures.iter().any(|f| !f.expected.ok),
        "no tampered chain to detect — the corpus would prove nothing about verification"
    );
}

#[test]
fn chain_corpus_verdicts_match() {
    for f in corpus().chain_fixtures {
        let verdict = verify_chain(&f.events, f.genesis_previous_hash.as_deref());
        match (&verdict, f.expected.ok) {
            (ChainVerification::Ok, true) => {}
            (ChainVerification::Broken { broken_at, code }, false) => {
                assert_eq!(Some(*broken_at), f.expected.broken_at, "brokenAt mismatch [{}]", f.name);
                assert_eq!(Some(*code), f.expected.code, "code mismatch [{}]", f.name);
            }
            _ => panic!(
                "verdict mismatch [{}]: got {verdict:?}, expected ok={} — {}",
                f.name, f.expected.ok, f.description
            ),
        }
    }
}
