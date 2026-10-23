import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("release dry run reports a version without changing files, commits or tags", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  for (const file of [
    "scripts/changelog.mjs",
    "scripts/release.mjs",
    "server/release-identity.js",
    "server/release-identity.json",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(new URL(`../${file}`, import.meta.url), path.join(root, file));
  }
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module", version: "0.1.0" }),
  );
  fs.writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify({ version: "0.1.0", packages: { "": { version: "0.1.0" } } }),
  );
  fs.writeFileSync(
    path.join(root, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n> Persistent visual sessions\n\n- Keep generation history.\n\n## [0.1.0]\n\n> First release\n",
  );
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "Release Fixture");
  git("config", "user.email", "release@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("add", ".");
  git("commit", "--quiet", "-m", "Initial release");
  git("tag", "v0.1.0");
  fs.writeFileSync(path.join(root, "change.txt"), "Ready for release\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "Retain sessions");
  git("remote", "add", "origin", "https://github.com/maxexcloo/studio.git");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const originalHead = git("rev-parse", "HEAD");
  const originalFiles = git("ls-files")
    .split("\n")
    .map((file) => [file, fs.readFileSync(path.join(root, file))]);
  const output = execFileSync(process.execPath, ["scripts/release.mjs", "minor", "--dry-run"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(output, /Would release v0\.2\.0/);
  assert.match(output, /Persistent visual sessions/);
  assert.equal(git("rev-parse", "HEAD"), originalHead);
  assert.equal(git("tag", "--list"), "v0.1.0");
  assert.equal(git("status", "--porcelain"), "");
  for (const [file, bytes] of originalFiles)
    assert.deepEqual(fs.readFileSync(path.join(root, file)), bytes, file);
});
