#!/usr/bin/env node
/**
 * CI publish script that handles idempotent npm publishing.
 *
 * Runs the build, attempts changeset publish (which publishes to npm),
 * and gracefully handles the case where the version already exists on npm.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = process.cwd();

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root, ...opts });
}

function runSafe(cmd, opts = {}) {
  try {
    run(cmd, opts);
    return true;
  } catch {
    return false;
  }
}

// Step 1: Build
run("pnpm build");

// Step 2: Attempt changeset publish (npm)
// If the version already exists on npm, changeset publish will fail.
// We check for this case and proceed gracefully.
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const { name, version } = pkg;

let npmPublished = false;
try {
  // Check if this version already exists on npm
  const existing = execSync(`npm view ${name}@${version} version 2>/dev/null`, {
    encoding: "utf8",
    cwd: root,
  }).trim();

  if (existing === version) {
    console.log(`\n${name}@${version} already exists on npm, skipping publish.`);
    npmPublished = true;
  }
} catch {
  // Version doesn't exist yet, proceed with publish
}

if (!npmPublished) {
  if (!runSafe("pnpm changeset publish")) {
    // Check again if it was a "version already exists" error
    try {
      const existing = execSync(`npm view ${name}@${version} version 2>/dev/null`, {
        encoding: "utf8",
        cwd: root,
      }).trim();

      if (existing === version) {
        console.log(
          `\n${name}@${version} was published concurrently or already exists. Continuing.`,
        );
      } else {
        console.error("\nchangeset publish failed for an unknown reason.");
        process.exit(1);
      }
    } catch {
      console.error("\nchangeset publish failed and version is not on npm.");
      process.exit(1);
    }
  }
}

// NO version sync here. It used to run at this point, which mutated the CI
// workspace's manifests AFTER the release commit was already made — so every
// git tag shipped 0.0.0 constants. The sync now runs in the changesets
// `version` lifecycle, where the bumped manifests get committed. See
// scripts/sync-versions.mjs.
