# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Use Context7 MCP server for up-to-date library documentation.**

## Project Overview

`@smooai/audit` is a polyglot client SDK for tamper-evident, SQL-queryable audit logging. It provides one shared surface — a canonical `AuditEvent` schema, canonical JSON serialization, a per-org-per-day SHA-256 hash chain, and an emit client — implemented natively in five languages and verified byte-for-byte against a shared parity corpus.

### Languages & Toolchains

- **TypeScript** — pnpm, tsdown
- **Python** — uv, poethepoet
- **Rust** — cargo (crate `smooai-audit` at `rust/audit/`)
- **Go** — go mod (`github.com/SmooAI/audit/go`)
- **.NET** — dotnet (`SmooAI.Audit`)

> **Byte-for-byte parity is the whole point.** The canonical serializer and hash chain must produce identical output in every language. Any change to canonicalization or hashing MUST update the shared parity corpus and pass in all five languages.

---

## 1. Build, Test, and Development Commands

### TypeScript

```bash
pnpm install          # Install dependencies
pnpm build            # Build all languages (tsdown + python + rust + go)
pnpm test             # Vitest + python + rust + go tests
pnpm typecheck        # tsc + per-language typecheck
pnpm lint             # oxlint + per-language lint
pnpm format           # Auto-format all languages
pnpm check-all        # Full CI parity across all languages
```

### Python

```bash
cd python && uv sync --group dev
poe lint | poe format | poe typecheck | poe test | poe build
```

Or from root: `pnpm python:{lint,format,typecheck,test,build}`.

### Rust

```bash
cd rust/audit && cargo test | cargo clippy | cargo fmt
```

Or from root: `pnpm rust:{build,test,lint,fmt}`.

### Go

```bash
cd go && go test ./... | go vet ./...
```

Or from root: `pnpm go:{build,test,lint,fmt}`.

### .NET

```bash
cd dotnet
dotnet restore SmooAI.Audit.sln
dotnet build SmooAI.Audit.sln -c Release --no-restore
dotnet test SmooAI.Audit.sln -c Release --no-build --nologo
```

---

## 2. Git Workflow — Worktrees

All work happens from `~/dev/smooai/`. The main worktree is at `~/dev/smooai/audit/` and ALWAYS stays on `main`. **Never do feature work directly on main** — create a worktree:

```bash
cd ~/dev/smooai/audit
git worktree add ../audit-SMOODEV-XX-short-desc -b SMOODEV-XX-short-desc main
cd ../audit-SMOODEV-XX-short-desc && pnpm install && (cd python && uv sync)
```

Branch/commit prefix: `SMOODEV-XX`. Explain **why**, not just what.

### Merging to main

```bash
cd ~/dev/smooai/audit
git checkout main && git pull --rebase
git merge SMOODEV-XX-short-desc --no-ff && git push
git worktree remove ~/dev/smooai/audit-SMOODEV-XX-short-desc && git branch -d SMOODEV-XX-short-desc
```

---

## 3. Coding Style

- TypeScript: oxlint + oxfmt, 4-space indentation, trailing commas
- Python: Ruff lint + format, BasedPyright type checking
- Rust: `cargo fmt` + `cargo clippy -D warnings`
- Go: `gofmt` + `go vet`
- .NET: nullable + `TreatWarningsAsErrors`
- Run `pnpm format` before committing

---

## 4. Testing Guidelines

- **TypeScript**: Vitest, colocated as `*.spec.ts`
- **Python**: pytest via `poe test`
- **Rust**: `cargo test`
- **Go**: `go test`
- **.NET**: `dotnet test` (xUnit)
- Every batch of work MUST include unit tests. The parity corpus is the source of truth for canonicalization/hashing behavior.

---

## 5. Changesets & Versioning

Always add a changeset when the SDK changes — one version tracks all languages. `scripts/sync-versions.mjs` propagates the `package.json` version into the Python, Rust, Go, and .NET manifests at release.

```bash
pnpm changeset
```

---

## 6. CI / GitHub Actions

- **pr-checks.yml** — typecheck, lint, test, build (all languages) on every PR.
- **release.yml** — Changesets version/publish to npm, PyPI, crates.io, Go tag, and NuGet.
- **publish-nuget.yml** — NuGet publish on `dotnet-v*` tags.

CI must be green before merging.

---

## 7. Pre-Push Checklist

1. `pnpm check-all` passes
2. `.NET`: `dotnet build` + `dotnet test` pass
3. Changeset added if needed
4. All changes committed and pushed
