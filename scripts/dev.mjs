// `npm run dev`: Vite serves the page, the HEISS server answers the API.
//
// `npm run dev -- --lan` (or `npm run dev:lan`, or the switch in Settings ›
// Connection, from the next start) opens both to the network.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listensBeyondThisComputer, readEnvFile, resolveLan } from "../server/lan.js";
import { recordExit, tailKeeper } from "../server/exit-record.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const shell = { ...process.env };
// Vite proxies the API, so to the server every request comes from 127.0.0.1.
// This token lets Vite say who is really asking (vite.config.ts), so a phone
// in dev LAN mode is another device, not this computer.
process.env.HEISS_DEV_PROXY_TOKEN = crypto.randomBytes(32).toString("base64url");

function viteHost() {
  const file = readEnvFile(root);
  const fileKeys = new Set([...file.keys].filter((key) => !(key in shell)));
  const { host } = resolveLan({ argv: args, env: { ...file.values, ...shell }, fileKeys });
  return listensBeyondThisComputer(host) ? "0.0.0.0" : "127.0.0.1";
}

let vite = null;
let server = null;
let stopping = false;
// The last lines each child printed to stderr, so a stop nobody asked for says why (exit-record.js).
const viteTail = tailKeeper();
const serverTail = tailKeeper();
function teeStderr(child, tail) {
  child.stderr?.on("data", (chunk) => { tail.push(chunk); process.stderr.write(chunk); });
}
const exitWords = (code, signal) => signal ? `was ended (${signal})` : `exited with code ${code}`;

function startVite(host) {
  const child = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--host", host, "--port", "5173"], { cwd: root, stdio: ["ignore", "inherit", "pipe"] });
  teeStderr(child, viteTail);
  vite = child;
  child.on("exit", (code, signal) => {
    if (stopping) return;
    // The page server stopping takes the studio with it: say so before stopping the rest.
    recordExit({ who: "vite", code, signal, reason: `The page server (Vite) ${exitWords(code, signal)}, so Studio stopped with it`, detail: viteTail.text() });
    console.error(`\n  Studio stopped: the page server (Vite) ${exitWords(code, signal)}. The reason is in data/logs/last-exit.json.\n`);
    shutdown(code ?? 1);
  });
}

function runServer() {
  return new Promise((resolve) => {
    // Neither child reads the console, so a console event reaches this launcher only.
    server = spawn(process.execPath, [path.join(root, "server", "index.js"), ...args], { cwd: root, stdio: ["ignore", "inherit", "pipe"] });
    teeStderr(server, serverTail);
    server.on("error", () => resolve(1));
    server.on("exit", (code, signal) => {
      server = null;
      // The server writes its own crash down; this catches what it couldn't (killed from outside).
      if (!stopping && code !== 0) {
        recordExit({ who: "server", code, signal, reason: `The server ${exitWords(code, signal)}`, detail: serverTail.text() });
        console.error(`\n  Studio stopped: the server ${exitWords(code, signal)}. The reason is in data/logs/last-exit.json.\n`);
      }
      resolve(code);
    });
  });
}

function shutdown(code = 0) {
  stopping = true;
  server?.kill("SIGTERM");
  vite?.kill("SIGTERM");
  process.exit(code);
}
// Stops someone meant: Ctrl+C, the launcher's stop, and on Windows the window closing or Ctrl+Break.
const meant = { SIGINT: "Stopped with Ctrl+C", SIGTERM: "Stopped", SIGHUP: "Its window was closed", SIGBREAK: "Stopped with Ctrl+Break" };
for (const signal of process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    recordExit({ who: "launcher", clean: true, signal, reason: meant[signal] });
    shutdown(130);
  });
}

startVite(viteHost());
shutdown((await runServer()) ?? 0);
