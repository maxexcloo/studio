// Runs beside LibreChat with its images folder mounted and sends each image a person attaches in chat
// to Studio's /mcp/uploads as that person's Upload. LibreChat saves those as <user id>/<file id>__<name>;
// its avatars and tool outputs are named otherwise. Images already there when it starts are left alone.
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
          const response = await fetch(
            `${url}/uploads?name=${encodeURIComponent(name.slice(name.indexOf("__") + 2))}`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${key}`,
                "content-type": "application/octet-stream",
                "x-ai-user-id": user,
              },
              body: await fs.readFile(file),
            },
          );
          // A refusal (an unlinked person, not an image) won't change on a retry.
          if (response.ok || response.status < 500) done.add(id);
          if (!response.ok) console.warn(`${id}: ${response.status} ${await response.text()}`);
        } catch (error) {
          console.warn(`${id}: ${error.message}`);
        }
      }
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
  await uploads.skipExisting();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await uploads.scan();
  }
}
