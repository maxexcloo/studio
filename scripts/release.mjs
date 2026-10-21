// Cuts a Studio release. See docs/guides/CONTRIBUTING.md, "Versions and releases".
//
//   npm run release -- minor          # 0.2.0 -> 0.3.0: new features (or a breaking change before 1.0)
//   npm run release -- patch          # 0.2.0 -> 0.2.1: fixes only
//   npm run release -- 1.0.0          # an exact version; 1.0.0 is the public release
//   npm run release -- minor --dry-run
//   npm run release -- minor --push   # also push main and the tag (publishes the GitHub release)
//
// It checks that main is clean and in sync with origin, that the version and
// tags agree, and that CHANGELOG.md has notes under Unreleased opened by a `> `
// summary line. Then it bumps package.json and the lockfile, dates the
// changelog section, commits "Release vX.Y.Z" and makes an annotated tag with
// the notes. It runs no test suites: pushing the tag runs
// .github/workflows/release.yml, which runs the full checks before it publishes
// the container image and the GitHub release.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changelogPath, cutRelease, section, summaryOf } from "./changelog.mjs";
import { releaseChanges } from './release-plan.mjs';
import { releaseIdentity } from '../server/release-identity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const bump = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
const push = args.includes("--push");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// npm is npm.cmd on Windows, which Node only runs through a shell.
const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { cwd: root, encoding: "utf8", stdio: options.quiet ? "pipe" : "inherit", shell: command === npm && process.platform === "win32", ...options });
const git = (...gitArgs) => run("git", gitArgs, { quiet: true }).trim();
const fail = (message) => { console.error(`\n✗ ${message}\n`); process.exit(1); };

const current = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const locked = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
if (locked.version !== current || locked.packages?.[""]?.version !== current) fail(`package-lock.json does not match package.json ${current}. Run npm install first.`);
const [major, minor, patch] = current.split(".").map(Number);

function nextVersion() {
  if (!bump) fail("Say which release: `npm run release -- minor`, `-- patch`, or an exact version like `-- 0.3.0`.");
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "major") {
    // 1.0.0 is the public announcement; it should never happen by accident.
    if (major === 0) fail("Before 1.0, breaking changes bump the minor version. For the public release, run `npm run release -- 1.0.0`.");
    return `${major + 1}.0.0`;
  }
  if (!/^\d+\.\d+\.\d+$/.test(bump)) fail(`"${bump}" is not patch, minor, major or a version like 0.3.0.`);
  const parts = bump.split(".").map(Number);
  const newer = parts[0] - major || parts[1] - minor || parts[2] - patch;
  if (newer <= 0) fail(`${bump} is not newer than the current ${current}.`);
  return bump;
}

const version = nextVersion();
const tag = `v${version}`;
console.log(`Releasing Studio ${current} -> ${version}${dryRun ? " (dry run)" : ""}`);

// Only ever release what is on origin/main, committed.
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("Releases are cut from main.");
if (releaseChanges(git("status", "--porcelain")).length) fail("The working tree has uncommitted changes. Commit or stash them first.");
if (git("tag", "--list", tag)) fail(`The tag ${tag} already exists.`);
if (!dryRun) run("git", ["fetch", "--quiet", "origin", "main", "--tags"]);
if (git("rev-list", "--count", "HEAD..origin/main") !== "0") fail("origin/main has commits this checkout lacks. Pull first.");
if (!git("tag", "--list", `v${current}`)) fail(`package.json is at ${current}, but the tag v${current} does not exist.`);
if (git("rev-list", "--count", `v${current}..HEAD`) === "0") fail(`main has nothing new since v${current}.`);

const repository = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(git('remote', 'get-url', 'origin'))?.[1];
if (repository !== releaseIdentity.repository) fail('origin does not match the configured fork release repository.');
if (dryRun && push) fail('--dry-run and --push cannot be combined.');

const changelog = fs.readFileSync(changelogPath, "utf8");
const notes = section(changelog, "Unreleased");
if (!notes) fail("CHANGELOG.md has nothing under Unreleased. Write the release notes first.");
if (!summaryOf(notes)) fail("The Unreleased notes must open with a `> ` summary line.");
const today = new Date().toISOString().slice(0, 10);
const nextChangelog = cutRelease(changelog, version, today);

if (dryRun) {
  console.log(`\nWould release ${tag} with these notes:\n\n${notes}\n`);
  process.exit(0);
}

run(npm, ["version", version, "--no-git-tag-version"], { quiet: true });
fs.writeFileSync(changelogPath, nextChangelog);
run("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
run("git", ["commit", "--quiet", "-m", `Release ${tag}`]);
run("git", ["tag", "--annotate", tag, "--cleanup=verbatim", "-m", `Studio ${tag}\n\n${notes}`]);
console.log(`\n✓ Committed "Release ${tag}" and tagged ${tag}.`);

if (push) {
  run("git", ["push", "--atomic", "origin", "main", tag]);
  console.log(`✓ Pushed. GitHub Actions now publishes the ${tag} image and release.`);
} else {
  console.log(`\nPush when ready (this publishes the GitHub release):\n\n  git push --atomic origin main ${tag}\n`);
}
