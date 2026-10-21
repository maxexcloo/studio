import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "studio-exit-"));
const { recordExit, startSession, tailKeeper } = await import("./exit-record.js");
const logs = path.join(process.env.STUDIO_DATA_DIR, "logs");
const reset = () => fs.rmSync(logs, { recursive: true, force: true });

test("a first start has nothing to tell", () => {
  reset();
  assert.equal(startSession({ now: 1000, bootedAt: 0 }), null);
});

test("a crash is told on the next start; a clean stop after it doesn't paper over it", () => {
  reset();
  startSession({ now: 1000, bootedAt: 0 });
  recordExit({ who: "vite", code: 1, reason: "The page server (Vite) exited with code 1", detail: "Error: EPERM" });
  recordExit({ who: "server", clean: true, code: 0, reason: "Stopped" });
  const told = startSession({ now: 5000, bootedAt: 0 });
  assert.equal(told.who, "vite");
  assert.equal(told.detail, "Error: EPERM");
  // Told once: the next run that stops cleanly has nothing to tell after it.
  recordExit({ who: "server", clean: true, code: 0, reason: "Stopped" });
  assert.equal(startSession({ now: 9000, bootedAt: 0 }), null);
});

test("a stop someone meant (Ctrl+C, closing the window, Restart) is not told", () => {
  reset();
  startSession({ now: 1000, bootedAt: 0 });
  recordExit({ who: "launcher", clean: true, signal: "SIGHUP", reason: "Its window was closed" });
  assert.equal(startSession({ now: 5000, bootedAt: 0 }), null);
});

test("no word after a run started: ended from outside, unless the computer has booted since", () => {
  reset();
  startSession({ now: 1000, bootedAt: 0 });
  const told = startSession({ now: 5000, bootedAt: 0 });
  assert.equal(told.who, "unknown");
  assert.equal(told.lastSeen, 1000);
  reset();
  startSession({ now: 1000, bootedAt: 0 });
  assert.equal(startSession({ now: 5000, bootedAt: 3000 }), null, "shut down or restarted with Studio running");
});

test("the tail keeps the last lines, without colour codes", () => {
  const tail = tailKeeper(2);
  tail.push("one\n\u001b[31mtwo\u001b[39m\nthr");
  tail.push("ee\n");
  assert.equal(tail.text(), "two\nthree");
});

test("a second copy that finds one running (exit 78) leaves that run's record alone", async () => {
  const { spawnSync } = await import("node:child_process");
  const crashLog = new URL("./crash-log.js", import.meta.url).href;
  const exitWith = (code) => spawnSync(process.execPath, ["--input-type=module", "-e", `const { installCrashLog } = await import(${JSON.stringify(crashLog)}); installCrashLog(); process.exit(${code});`], { env: { ...process.env }, encoding: "utf8" });
  reset();
  startSession({ now: Date.now() - 1000, bootedAt: 0 });
  assert.equal(exitWith(78).status, 78);
  assert.equal(fs.existsSync(path.join(logs, "last-exit.json")), false, "nothing written for the running copy");
  recordExit({ who: "server", clean: true, code: 0, reason: "Stopped" });
  assert.equal(startSession({ now: Date.now() + 1000, bootedAt: 0 }), null, "its clean stop is told as clean");
  // A real failure in a process of its own is still written down.
  assert.equal(exitWith(1).status, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(logs, "last-exit.json"), "utf8")).code, 1);
});

test("the record finds the data folder the way the server does, with the launcher's settings file filling gaps", async () => {
  const { exitRecordDataDir } = await import("./exit-record.js");
  const { currentDataDir, projectRoot } = await import("./data-root.js");
  assert.equal(exitRecordDataDir(process.env), currentDataDir());
  assert.equal(exitRecordDataDir({}, {}), path.join(projectRoot, "data"));
  assert.equal(exitRecordDataDir({}, { STUDIO_DATA_DIR: "/srv/from-file" }), path.resolve("/srv/from-file"));
  assert.equal(exitRecordDataDir({ STUDIO_DATA_DIR: "/srv/shell" }, { STUDIO_DATA_DIR: "/srv/from-file" }), path.resolve("/srv/shell"));
  // An old name in the shell still beats the file; an empty shell value does not hide it.
  assert.equal(exitRecordDataDir({ HEISS_DATA_DIR: "/srv/legacy" }, { STUDIO_DATA_DIR: "/srv/from-file" }), path.resolve("/srv/legacy"));
  assert.equal(exitRecordDataDir({ STUDIO_DATA_DIR: "" }, { STUDIO_DATA_DIR: "/srv/from-file" }), path.resolve("/srv/from-file"));
});

test("records are written whole and a told record stays gone", () => {
  reset();
  startSession({ now: 1000, bootedAt: 0 });
  recordExit({ who: "server", code: 1, reason: "Crashed" });
  recordExit({ who: "server", code: 1, reason: "Crashed again" });
  assert.equal(fs.readdirSync(logs).some((name) => name.includes(".tmp-")), false, "no temporary file is left behind");
  assert.equal(startSession({ now: 5000, bootedAt: 0 }).reason, "Crashed");
  assert.equal(fs.existsSync(path.join(logs, "last-exit.json")), false);
  assert.equal(fs.existsSync(path.join(logs, "last-exit.json.bak")), false, "its backup goes with it");
});
