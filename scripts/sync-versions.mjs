#!/usr/bin/env node
/**
 * Propagate `package.json`'s version to every other version-bearing manifest.
 *
 * Two modes, one table — so the writer and the checker can never disagree:
 *   node scripts/sync-versions.mjs           rewrite the manifests
 *   node scripts/sync-versions.mjs --check   assert they already match, exit 1 if not
 *
 * The sync runs in the changesets `version` lifecycle (see package.json), NOT
 * after publish. Running it after publish mutated the CI workspace without ever
 * committing it, so every git tag shipped `0.0.0` constants while the registries
 * showed the real number — and `cargo publish --allow-dirty` existed only to
 * paper over the resulting dirty tree. `--check` in CI is what keeps it fixed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const check = process.argv.includes("--check");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;

if (!version) {
  console.error("Unable to read version from package.json");
  process.exit(1);
}

/** A manifest is described once: how to find its version, and how to rewrite it. */
const simple = (path, pattern, label) => ({
  path,
  read: (content) => content.match(pattern)?.[2] ?? null,
  write: (content) => {
    if (!pattern.test(content)) throw new Error(`${label} not found in ${path}`);
    return content.replace(pattern, `$1${version}$3`);
  },
});

const manifests = [
  simple("python/pyproject.toml", /^(version\s*=\s*")([^"]+)(")/m, "Version line"),
  // The lock carries the editable self-reference; left stale it breaks
  // `uv sync --locked` (poe install-dev) the moment pyproject moves.
  simple(
    "python/uv.lock",
    /(name = "smooai-audit"\nversion = ")([^"]+)(")/,
    "smooai-audit version block",
  ),
  simple("rust/audit/Cargo.toml", /^(version\s*=\s*")([^"]+)(")/m, "Version line"),
  simple(
    "rust/audit/Cargo.lock",
    /(name\s*=\s*"smooai-audit"\s*\nversion\s*=\s*")([^"]+)(")/,
    "Version block",
  ),
  simple("go/version.go", /(const Version = ")([^"]+)(")/, "Version line"),
  simple(
    "dotnet/src/SmooAI.Audit/SmooAI.Audit.csproj",
    /(<Version>)([^<]+)(<\/Version>)/,
    "<Version> element",
  ),
];

/**
 * Go's module path carries the major version once it reaches 2 (`…/go/v2`), and
 * a mismatch resolves to nothing at all on proxy.golang.org — the failure mode
 * that has bitten fetch, file, and logger. At v0/v1 the suffix must be ABSENT,
 * which is why this is a check rather than a rewrite: bumping to v2 is a
 * deliberate edit of `module` plus every import, not something a sync script
 * should do behind your back.
 */
function checkGoModulePath() {
  const path = "go/go.mod";
  const content = readFileSync(resolve(root, path), "utf8");
  const modulePath = content.match(/^module\s+(\S+)/m)?.[1];
  if (!modulePath) throw new Error(`module line not found in ${path}`);

  const major = Number(version.split(".")[0]);
  const suffix = modulePath.match(/\/v(\d+)$/)?.[1];

  if (major >= 2) {
    if (suffix !== String(major)) {
      return `${path}: module is "${modulePath}" but package.json is v${version} — Go requires a "/v${major}" module-path suffix for major >= 2, or "go get" resolves nothing`;
    }
  } else if (suffix !== undefined) {
    return `${path}: module is "${modulePath}" but package.json is v${version} — a "/v${suffix}" suffix is only valid for major >= 2`;
  }
  return null;
}

if (check) {
  const problems = [];
  for (const { path, read } of manifests) {
    const found = read(readFileSync(resolve(root, path), "utf8"));
    if (found !== version) {
      problems.push(`${path}: found ${found ?? "<no version>"}, expected ${version}`);
    }
  }
  const goProblem = checkGoModulePath();
  if (goProblem) problems.push(goProblem);

  if (problems.length > 0) {
    console.error(`Version drift against package.json (${version}):\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error(`\nRun \`pnpm version:sync\` and commit the result.`);
    process.exit(1);
  }
  console.log(`All manifests are at ${version}.`);
} else {
  for (const { path, write } of manifests) {
    const absolutePath = resolve(root, path);
    const content = readFileSync(absolutePath, "utf8");
    const next = write(content);
    if (next !== content) {
      writeFileSync(absolutePath, next);
      console.log(`Updated version in ${path}`);
    }
  }
  const goProblem = checkGoModulePath();
  if (goProblem) {
    console.error(`\n${goProblem}`);
    process.exit(1);
  }
}
