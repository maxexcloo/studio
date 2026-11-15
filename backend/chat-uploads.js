// Runs beside LibreChat with its images folder mounted and sends each image a person attaches in chat
// to Studio's /mcp/uploads as that person's Upload. LibreChat saves those as <user id>/<file id>__<name>;
// its avatars and tool outputs are named otherwise. Images already there when it starts are left alone;
// `--backfill` sends those once instead (`--backfill --dry-run` only counts them) and exits.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// A file this recent may still be being written.
const settleMs = 2000;

export function chatUploads({ folder, url, key, fetch = globalThis.fetch }) {
  // Files sent, refused or present at start; a failed send stays out and is tried again.
  const done = new Set();
  const files = async () => {
    const found = [];
    for (const user of await fs.readdir(folder, { withFileTypes: true })) {
      if (!user.isDirectory()) continue;
      for (const name of await fs.readdir(path.join(folder, user.name)))
        if (name.includes("__")) found.push({ user: user.name, name });
    }
    return found;
  };
  const send = (user, name, body) =>
    fetch(`${url}/uploads?name=${encodeURIComponent(name.slice(name.indexOf("__") + 2))}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/octet-stream",
        "x-ai-user-id": user,
      },
      body,
    });
  return {
    async skipExisting() {
      for (const file of await files()) done.add(`${file.user}/${file.name}`);
    },
    async scan(now = Date.now()) {
      for (const { user, name } of await files()) {
        const id = `${user}/${name}`;
        const file = path.join(folder, user, name);
        if (done.has(id)) continue;
        try {
          if (now - (await fs.stat(file)).mtimeMs < settleMs) continue;
          const response = await send(user, name, await fs.readFile(file));
          // A refusal (an unlinked person, not an image) won't change on a retry.
          if (response.ok || response.status < 500) done.add(id);
          if (!response.ok) console.warn(`${id}: ${response.status} ${await response.text()}`);
        } catch (error) {
          console.warn(`${id}: ${error.message}`);
        }
      }
    },
    // Each person's existing chat images, sent one at a time `pauseMs` apart; Studio keeps one Upload per
    // image, so a second run adds nothing. An empty body asks only whether the person is linked.
    async backfill({ dryRun = false, pauseMs = 0 } = {}) {
      const people = new Map();
      for (const { user, name } of await files()) {
        if (!people.has(user)) people.set(user, []);
        people.get(user).push(name);
      }
      const report = [];
      for (const [user, names] of people) {
        const row = { user, images: names.length, bytes: 0, sent: 0, failed: 0 };
        for (const name of names) row.bytes += (await fs.stat(path.join(folder, user, name))).size;
        const probe = await send(user, "__", Buffer.alloc(0));
        row.linked = probe.status !== 403;
        report.push(row);
        if (dryRun || !row.linked) continue;
        for (const name of names) {
          const response = await send(user, name, await fs.readFile(path.join(folder, user, name)));
          if (response.ok) row.sent++;
          else {
            row.failed++;
            console.warn(`${user}/${name}: ${response.status} ${await response.text()}`);
          }
          await new Promise((resolve) => setTimeout(resolve, pauseMs));
        }
      }
      return report;
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const setting = (name) => {
    if (!process.env[name]) throw new Error(`Set ${name}.`);
    return process.env[name];
  };
  const uploads = chatUploads({
    folder: setting("STUDIO_CHAT_IMAGES_DIR"),
    url: setting("STUDIO_MCP_URL"),
    key: setting("STUDIO_MCP_API_KEY"),
  });
  if (process.argv.includes("--backfill")) {
    const report = await uploads.backfill({
      dryRun: process.argv.includes("--dry-run"),
      pauseMs: 1000,
    });
    console.table(report);
    process.exit();
  }
  await uploads.skipExisting();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await uploads.scan();
  }
}
