---
"@smooai/audit": patch
---

Fix version sync so released artifacts carry the version they were released as.

`version:sync` ran *after* `changeset publish`, mutating the manifests in the CI
workspace where nothing ever committed them. Every git tag therefore shipped
`0.0.0` in `python/pyproject.toml`, `rust/audit/Cargo.toml`, `go/version.go`
(`audit.Version`), and `SmooAI.Audit.csproj` while npm, PyPI, crates.io, and
NuGet all showed 0.2.0 — and `cargo publish --allow-dirty` existed only to
tolerate the resulting dirty tree.

The sync now runs in the changesets `version` lifecycle, so the bumped manifests
are committed with the release. A new `pnpm version:check` fails CI on any drift,
including a `go.mod` module path whose `/vN` suffix disagrees with the major.
`cargo publish` is now `--locked`.
