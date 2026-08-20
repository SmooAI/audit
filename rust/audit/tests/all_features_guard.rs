//! Fails loudly when the feature-gated test files would be silently skipped.
//!
//! `tests/trace_envelope.rs` is `#![cfg(feature = "otel")]`, and `otel` is not a
//! default feature. Under a bare `cargo test` the whole file compiles to nothing
//! and cargo prints `running 0 tests ... test result: ok` — five real assertions
//! reporting as a pass. This guard turns that silence into a red test.

#[cfg(not(feature = "otel"))]
#[test]
fn otel_gated_tests_are_not_silently_skipped() {
    panic!(
        "tests/trace_envelope.rs is #![cfg(feature = \"otel\")] and the feature is off, so its 5 \
         tests reported \"0 passed; ok\" without running. Use `cargo test --all-features` (what \
         `pnpm rust:test` and CI run)."
    );
}

#[cfg(not(feature = "client"))]
#[test]
fn client_gated_tests_are_not_silently_skipped() {
    panic!(
        "tests/emit_retry.rs is #![cfg(feature = \"client\")] and the feature is off, so the emit \
         retry tests reported \"0 passed; ok\" without running. Use `cargo test --all-features`."
    );
}
