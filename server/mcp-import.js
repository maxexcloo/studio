// SPDX-License-Identifier: AGPL-3.0-only
// Offline legacy Studio MCP ownership import; see mcp.LICENSE.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { writeJsonFile } from "./json-store.js";
import { mcpOwner } from "./mcp-media.js";

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
export const mcpImportSupported = () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 23 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13);
};

/** Run with both the bridge and destination studio stopped. Never starts either service. */
export async function importMcpOwnership({ database, dataDir, studio, environment = process.env }) {
  if (!["primary", "secondary"].includes(studio))
    throw new Error("Choose exactly one studio: primary or secondary.");
  if (!database || !dataDir)
    throw new Error("Supply the legacy database and destination data directory.");
  const signingKey = environment.MCP_SIGNING_KEY;
  const providerKey = environment.STUDIO_MCP_API_KEY;
  if (!signingKey || !providerKey)
    throw new Error("Set MCP_SIGNING_KEY and this studio’s STUDIO_MCP_API_KEY in the environment.");
  if (!mcpImportSupported())
    throw new Error("The offline ownership importer requires Node 22.13 or newer.");
  const file = path.join(dataDir, "mcp-ownership.json");
  let original = null;
  let state;
  try {
    original = fs.readFileSync(file, "utf8");
    state = JSON.parse(original);
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(
        "The destination ownership file is unreadable or invalid; nothing was changed.",
      );
    state = {
      version: 1,
      signingKey: crypto.randomBytes(32).toString("base64url"),
      jobs: {},
      assets: {},
    };
  }
  if (
    state.version !== 1 ||
    !object(state.jobs) ||
    !object(state.assets) ||
    typeof state.signingKey !== "string" ||
    !state.signingKey
  )
    throw new Error("The destination ownership file is invalid; nothing was changed.");
  const { DatabaseSync } = await import("node:sqlite");
  let legacy;
  let rows;
  try {
    legacy = new DatabaseSync(database, { readOnly: true });
    rows = legacy.prepare("SELECT id, owner FROM jobs WHERE studio = ?").all(studio);
  } catch {
    throw new Error(
      "The legacy ownership database is unreadable or has an unexpected schema; nothing was changed.",
    );
  } finally {
    legacy?.close();
  }
  const expectedProvider = studio === "primary" ? "litellm:heiss" : "litellm:heiss-secondary";
  let imported = 0;
  let unchanged = 0;
  for (const row of rows) {
    if (
      typeof row.id !== "string" ||
      !row.id ||
      row.id.length > 200 ||
      typeof row.owner !== "string"
    )
      throw new Error("A legacy ownership record is invalid; nothing was changed.");
    let owner;
    if (row.owner === expectedProvider) owner = mcpOwner(signingKey, "", providerKey);
    else if (row.owner.startsWith("openwebui:")) {
      const user = row.owner.slice("openwebui:".length);
      if (!user || user.length > 256 || /[\x00-\x1f\x7f]/.test(user))
        throw new Error("A legacy forwarded owner is invalid; nothing was changed.");
      owner = mcpOwner(signingKey, user, providerKey);
    } else
      throw new Error("An unknown legacy owner was found for this studio; nothing was changed.");
    if (Object.hasOwn(state.jobs, row.id)) {
      if (state.jobs[row.id] !== owner)
        throw new Error("A destination job has conflicting ownership; nothing was changed.");
      unchanged++;
    } else {
      Object.defineProperty(state.jobs, row.id, {
        configurable: true,
        enumerable: true,
        value: owner,
        writable: true,
      });
      imported++;
    }
  }
  if (imported) {
    // Detect changes since preflight; the studio must remain stopped throughout the import.
    let current = null;
    try {
      current = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "The destination ownership file changed or became unreadable; nothing was changed.",
        );
    }
    if (current !== original)
      throw new Error(
        "The destination ownership file changed during preflight; nothing was changed.",
      );
    writeJsonFile(file, state, { mode: 0o600 });
  }
  return { imported, unchanged, studio };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        database: { type: "string" },
        "data-dir": { type: "string" },
        help: { type: "boolean", short: "h" },
        studio: { type: "string" },
      },
    });
    if (values.help)
      console.log(
        "With both services stopped, run: node server/mcp-import.js --data-dir <studio-data> --database <legacy-jobs.sqlite> --studio <primary|secondary>\nSet MCP_SIGNING_KEY and the destination STUDIO_MCP_API_KEY through the environment. No secret values are accepted as arguments.",
      );
    else {
      const result = await importMcpOwnership({
        database: values.database,
        dataDir: values["data-dir"],
        studio: values.studio,
      });
      console.log(
        `Imported ${result.imported} job ownership records; ${result.unchanged} already present.`,
      );
    }
  } catch (error) {
    // Parsing errors can reflect arguments; do not echo untrusted CLI values or secret-bearing paths.
    console.error(
      error?.code?.startsWith("ERR_PARSE_ARGS")
        ? "Invalid arguments. Run with --help for the supported options."
        : error.code
          ? "The ownership import failed. Check source and destination access."
          : error.message,
    );
    process.exitCode = 1;
  }
}
