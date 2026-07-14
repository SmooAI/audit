//! Cross-language parity gate — every fixture in `spec/parity-corpus.json` must
//! produce byte-exact `expectedCanonical` and `expectedHash`, both from the raw
//! event Value AND through the [`AuditEvent`] schema round-trip. This is the same
//! corpus the TS / Python / Go / .NET SDKs assert against; a divergence here
//! means the hash chain is broken across stores — investigate the serializer,
//! NEVER edit the corpus.

use serde::Deserialize;
use smooai_audit::{canonical_json, compute_event_hash, AuditEvent};

#[derive(Deserialize)]
struct Corpus {
    fixtures: Vec<Fixture>,
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
