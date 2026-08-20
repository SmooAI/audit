# Repository Guidelines

## Project Structure & Module Organization

`@smooai/audit` is a polyglot client SDK for tamper-evident, SQL-queryable audit logging, implemented natively in five languages that must stay byte-for-byte in parity:

- `src/` — TypeScript sources (`schema.ts`, `canonical.ts`, `hash.ts`, `client.ts`), Vitest specs beside them as `*.spec.ts`. Build artifacts emit to `dist/`.
- `python/` — Python package `smooai_audit` (uv + poethepoet), tests under `python/tests/`.
- `rust/audit/` — Rust crate `smooai-audit`.
- `go/` — Go module `github.com/SmooAI/audit/go`.
- `dotnet/` — .NET package `SmooAI.Audit` (+ xUnit tests).
- `scripts/` — release helpers (`sync-versions.mjs`, `ci-publish.mjs`).

Every language exposes the same surface: an `AuditEvent` schema, `canonicalJson`, `computeEventHash` / `buildHashChain`, and an `AuditClient`/`emit`.

## Build, Test, and Development Commands

- `pnpm install` — install dependencies (pnpm 10+, Node 20+).
- `pnpm build` — build all languages.
- `pnpm test` — run the full test matrix (TS + Python + Rust + Go; .NET via CI/`dotnet test`).
- `pnpm typecheck` / `pnpm lint` / `pnpm format` — cross-language.
- `pnpm check-all` — full CI parity before a release.

## Coding Style & Naming Conventions

TypeScript uses oxlint + oxfmt (4-space indent, 160-char lines, trailing commas). Python follows Ruff + BasedPyright. Rust follows `cargo fmt` + `cargo clippy -D warnings`. Go follows `gofmt` + `go vet`. .NET enables nullable and treats warnings as errors. Keep the public surface aligned across languages — a rename in one is a rename in all.

## Parity Is the Contract

Canonicalization and hashing MUST be identical across languages. Any change to `canonicalJson` or the hash chain must update the shared parity corpus and pass in TypeScript, Python, Rust, Go, and .NET. All five implementations are complete and assert byte-for-byte against `spec/parity-corpus.json`.

## Testing Guidelines

Write or update tests beside their subjects (`*.spec.ts`, `python/tests/test_*.py`, `#[test]` in Rust, `*_test.go`, xUnit `*Tests.cs`) whenever behavior changes. Run `pnpm test` and `pnpm typecheck` before pushing.

## Commit & Pull Request Guidelines

Prefix commits/branches with the Jira ticket (`SMOODEV-XX`) and explain the rationale. Add a changeset for SDK changes. Each PR should list validation commands and call out any change to the canonical/hash behavior (which is a breaking, cross-language change) in bold.
