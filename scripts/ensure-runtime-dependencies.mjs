import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Before `npm run dev` (the predev scripts): restores missing packages in a
// source checkout. The container image installs its own with `npm ci`.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));

// npm's own script when npm started this, so it runs with this Node; else npm from the PATH.
function runNpm(args, options) {
  const cli = process.env.npm_execpath;
  if (cli && /npm-cli\.[cm]?js$/.test(cli) && existsSync(cli)) return execFileSync(process.execPath, [cli, ...args], options);
  return execFileSync("npm", args, { ...options, shell: process.platform === "win32" });
}
const installed = (name) => existsSync(path.join(projectRoot, "node_modules", name, "package.json"));

const needed = [...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.devDependencies || {})];
const missing = needed.filter((name) => !installed(name));
if (missing.length) {
  console.warn(`Missing dependencies (${missing.join(", ")}). Restoring them with npm install...`);
  runNpm(["install", "--no-audit", "--no-fund"], { cwd: projectRoot, stdio: "inherit" });
}

// The video encoder for grid previews (ffmpeg-static) is an optional package:
// its binary is downloaded when it installs, and if that download fails
// (offline, a firewall) npm leaves it out without a word. So put the binary
// back if only it is missing, or install the package again, at most once a
// day so a computer without internet doesn't wait at every start. A system
// ffmpeg makes it moot.
const encoderBinary = path.join(projectRoot, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const encoderWanted = Boolean(packageJson.optionalDependencies?.["ffmpeg-static"] || packageJson.dependencies?.["ffmpeg-static"]);
const systemEncoder = () => {
  if (process.env.STUDIO_FFMPEG_PATH || process.env.HEISS_FFMPEG_PATH) return true;
  try { return spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000, windowsHide: true }).status === 0; } catch { return false; }
};
const encoderStamp = path.join(projectRoot, "node_modules", ".studio-encoder-attempt");
const triedToday = () => { try { return Date.now() - statSync(encoderStamp).mtimeMs < 24 * 60 * 60 * 1000; } catch { return false; } };
if (encoderWanted && !existsSync(encoderBinary) && !systemEncoder() && !triedToday()) {
  try { writeFileSync(encoderStamp, new Date().toISOString()); } catch { /* no node_modules yet: npm makes it */ }
  try {
    if (installed("ffmpeg-static")) runNpm(["rebuild", "ffmpeg-static", "--no-audit", "--no-fund"], { cwd: projectRoot, stdio: "inherit" });
    else {
      console.warn("The video preview encoder is missing. Installing it...");
      runNpm(["install", "--no-audit", "--no-fund"], { cwd: projectRoot, stdio: "inherit" });
    }
  } catch (error) {
    console.warn(`Could not install the video preview encoder (${error.message}). Videos still open; grid tiles show a placeholder. It's tried again tomorrow, or install ffmpeg yourself.`);
  }
  if (!existsSync(encoderBinary)) console.warn("No video preview encoder yet. Videos still open; grid tiles show a placeholder until it's installed (or ffmpeg is on the PATH).");
}
