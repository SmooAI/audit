#!/usr/bin/env node

/**
 * Reports which of the five registries already carry package.json's version.
 *
 * The release used to gate PyPI, crates.io, the Go tag and NuGet on
 * `steps.changesets.outputs.published == 'true'` — on npm having published in
 * THAT run. Two ways that fails open, both observed on 2026-08-20:
 *
 *   1. npm succeeds, a later step fails. The retry finds nothing new to publish
 *      on npm, so `published` is false, so all four skip: a GREEN run that
 *      published nothing, leaving four ports stranded indefinitely. This is how
 *      smooai-logger 4.5.2 reached npm and PyPI and no other registry.
 *   2. `@changesets/cli` 3.x renamed its publish output line from `🦋 New tag:`
 *      to `◇ Successfully published:`. changesets/action@v1 derives `published`
 *      by PARSING that stdout, so a cosmetic string change in another tool
 *      silently switches every non-npm publish off while the run stays green.
 *      A dependency bump did exactly this to smooai-config.
 *
 * Gating each registry on what that registry actually has removes both: the gate
 * no longer depends on parsing another tool's output, and a retry publishes
 * exactly what is missing.
 *
 * npm is the source of truth for "is this version released". The other four
 * never run ahead of it, so a version bumped on main but not yet published
 * can't leak out to PyPI while npm still shows the previous release.
 *
 * Usage:
 *   node scripts/check-registries.mjs               # human-readable report
 *   node scripts/check-registries.mjs --github      # also write GITHUB_OUTPUT flags
 *   node scripts/check-registries.mjs --expect-npm  # wait for npm's index to catch up first
 *   node scripts/check-registries.mjs --assert      # exit 1 if npm has it and others don't
 */

import { execFileSync } from "child_process";
import { appendFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")).version;

const ok = async (url) => {
  try {
    // A User-Agent is required: crates.io rejects requests without one.
    const response = await fetch(url, { headers: { "User-Agent": "smooai-release-check" } });
    return response.ok;
  } catch {
    return false;
  }
};

const goTagExists = () => {
  try {
    const out = execFileSync("git", ["ls-remote", "--tags", "origin", `refs/tags/go/v${version}`], {
      cwd: rootDir,
      encoding: "utf8",
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
};

/**
 * Registries the --assert guard holds strictly. NuGet is deliberately absent: its
 * index takes minutes to tens of minutes to show a package that has already been
 * accepted ("Your package was pushed"), so asserting on it would redden a release
 * that succeeded — and a guard that cries wolf gets deleted. NuGet keeps its own
 * protection: `dotnet nuget push` exits non-zero on a real failure, and with the
 * per-registry gate it is skipped only when the version is genuinely already there.
 * Its state is still reported below, just not enforced.
 */
const ASSERTED = ["npm", "pypi", "crates", "go"];

const registries = {
  npm: () => ok(`https://registry.npmjs.org/@smooai/audit/${version}`),
  pypi: () => ok(`https://pypi.org/pypi/smooai-audit/${version}/json`),
  crates: () => ok(`https://crates.io/api/v1/crates/smooai-audit/${version}`),
  nuget: () =>
    ok(
      `https://api.nuget.org/v3-flatcontainer/smooai.audit/${version}/smooai.audit.${version}.nupkg`,
    ),
  go: async () => goTagExists(),
};

const probe = async () =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(registries).map(async ([name, check]) => [name, await check()]),
    ),
  );

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Registry indexes lag their upload by seconds to a couple of minutes. Reading
 * "missing" during that window would skip the very publish this run just earned,
 * and then report success — the same silent no-op, moved one step later.
 */
const until = async (satisfied, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let result = await probe();
  while (!satisfied(result) && Date.now() < deadline) {
    await sleep(10_000);
    result = await probe();
  }
  return result;
};

const expectNpm = process.argv.includes("--expect-npm");
const assert = process.argv.includes("--assert");

let present;
if (expectNpm) {
  present = await until((r) => r.npm, 120_000);
} else if (assert) {
  present = await until((r) => !r.npm || ASSERTED.every((name) => r[name]), 300_000);
} else {
  present = await probe();
}

console.log(`@smooai/audit ${version}:`);
for (const [name, has] of Object.entries(present)) {
  console.log(`  ${has ? "✓" : "·"} ${name.padEnd(7)} ${has ? "published" : "missing"}`);
}

// --expect-npm is passed only when changesets reported a successful npm publish.
// Still reading "missing" after the wait means the PROBE is wrong, not that npm is
// empty — and every downstream gate is `!has && present.npm`, so a false npm
// reading would switch all four publishes off and let the run go green having
// shipped nothing. That is the same fail-open this script exists to remove, so
// fail instead of guessing.
if (expectNpm && !present.npm) {
  console.error(
    `\n✗ changesets reported publishing ${version}, but npm still does not show it after 2 minutes.`,
  );
  console.error(`  Refusing to continue: the other four registries are gated on this reading.`);
  process.exit(1);
}

if (process.argv.includes("--github") && process.env.GITHUB_OUTPUT) {
  const lines = Object.entries(present).map(
    ([name, has]) => `${name}_missing=${!has && present.npm}`,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\nnpm_published=${present.npm}\n`);
}

if (assert) {
  // Only meaningful once npm carries the version — before that, nothing is
  // "stranded", the release simply hasn't happened.
  const stranded = present.npm ? ASSERTED.filter((name) => !present[name]) : [];
  if (stranded.length > 0) {
    console.error(`\n✗ npm published ${version} but ${stranded.join(", ")} did not.`);
    console.error(
      `  Those ports are still shipping the previous release. Re-run this workflow — each`,
    );
    console.error(
      `  publish step is gated on its own registry, so a retry ships exactly what is missing.`,
    );
    process.exit(1);
  }
}
