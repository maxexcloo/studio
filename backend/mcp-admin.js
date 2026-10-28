// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MCP's admin tools (design §6): an administrator's chat manages the Library, downloads, the
 * catalogue, profiles, guides and accounts' groups through the same routes the UI uses
 * (library-routes.js, model-download-routes.js, profile-editor.js, profile-routes.js,
 * multi-user-auth.js), with the administrator's own credential, so the same validation, Undo and
 * versioning apply and every change records chat as its origin. Registered only for the admin
 * scope (mcp.js): an administrator's own MCP token, or a gateway-linked administrator while Chat
 * Gateway Admin Tools is on.
 *
 * Nothing irreversible is exposed: edits are new versions, Cancel only stops a download (its
 * partial file stays for Resume), an update keeps the old file until the new one verifies, Combine
 * Backends backs up the profiles it replaces, only an empty group can be deleted, and no tool
 * deletes a model file or touches a GPU.
 */
import { z } from "zod";
import { mcpJson } from "./mcp-media.js";
import { lineDiff } from "./line-diff.js";

export const adminToolNames = Object.freeze([
  "Library",
  "Lookup",
  "Import",
  "Imports",
  "Downloads",
  "Updates",
  "CatalogueEdit",
  "Profiles",
  "ProfileEdit",
  "CombineBackends",
  "Export",
  "Placement",
  "Accounts",
]);
export const adminInstructions =
  "Admin tools manage the Library, catalogue, profiles, guides and accounts' groups only when the user asks. Nothing downloads unless asked (Downloads start), edits are new versions with base_hash from Profiles get, only CombineBackends apply removes files (the profiles it combines, after a backup), and no tool touches GPUs.";

const kinds = ["lora", "checkpoint", "diffusion_model", "text_encoder", "vae", "clip_vision"];
const maxListed = 50;
const maxImportsListed = 25;
const maxWaitSeconds = 20;
const maxDiffLines = 400;
const busyImport = new Set(["resolving", "downloading"]);
const id = z.string().trim().min(1).max(200);
const key = z
  .string()
  .trim()
  .min(3)
  .max(400)
  .describe("A catalogue key: folder/file, such as loras/glow.safetensors.");
const pause = (milliseconds, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** RFC 7386 JSON merge patch: objects merge, null removes, anything else replaces. */
function mergePatch(target, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return structuredClone(patch);
  const result =
    target && typeof target === "object" && !Array.isArray(target) ? structuredClone(target) : {};
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) delete result[name];
    else result[name] = mergePatch(result[name], value);
  }
  return result;
}

/** A diff as text a chat can read: "- old", "+ new", "  same" and "… n unchanged lines". */
function diffText(before, after) {
  const { lines, added, removed } = lineDiff(before, after);
  const shown = lines
    .slice(0, maxDiffLines)
    .map((line) =>
      line.type === "skip"
        ? `… ${line.count} unchanged line${line.count === 1 ? "" : "s"}`
        : `${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "} ${line.text}`,
    );
  if (lines.length > maxDiffLines) shown.push(`… ${lines.length - maxDiffLines} more diff lines`);
  return { added, removed, diff: shown.join("\n") };
}

/** An import as chat sees it: its grade, reasons and every file with its status. */
function importView(record) {
  if (!record) return null;
  const files = (record.resources || []).map((resource) => ({
    name: resource.want?.file || resource.name,
    folder: resource.want?.folder || "",
    role: resource.role,
    status: resource.status,
    ...(resource.want?.bytes ? { bytes: resource.want.bytes } : {}),
    ...(resource.optional ? { optional: true } : {}),
    ...(resource.unavailable
      ? {
          unavailable: resource.unavailable.reason,
          note: resource.unavailable.note || resource.note || "",
        }
      : {}),
    ...(resource.downloadId ? { download_id: resource.downloadId } : {}),
    ...(resource.progress ? { progress: resource.progress } : {}),
    ...(resource.downloadError ? { error: resource.downloadError } : {}),
  }));
  const missing = files.filter(
    (file) =>
      !file.optional && ["missing", "unavailable", "unsupported", "conflict"].includes(file.status),
  );
  return {
    id: record.id,
    title: record.title || record.input?.url || "",
    kind: record.input?.kind,
    origin: record.origin || "ui",
    state: record.state,
    created_at: record.createdAt,
    ...(record.input?.url ? { url: record.input.url } : {}),
    grade: record.grade?.value || "partial",
    reasons: record.grade?.reasons || [],
    ...(record.grade?.missingFields?.length ? { missing_fields: record.grade.missingFields } : {}),
    missing: missing.map((file) => file.name),
    files,
    ...(record.baseModel ? { base_model: record.baseModel } : {}),
    ...(record.links && Object.keys(record.links).length ? { links: record.links } : {}),
    ...(record.results &&
    (record.results.catalogueKeys?.length ||
      record.results.profileId ||
      record.results.galleryItemId)
      ? { results: record.results }
      : {}),
    ...(record.warnings?.length ? { warnings: record.warnings } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

const importRow = (record) => {
  const view = importView(record);
  return {
    id: view.id,
    title: view.title,
    kind: view.kind,
    origin: view.origin,
    state: view.state,
    grade: view.grade,
    missing: view.missing.length,
    created_at: view.created_at,
  };
};

const itemFields = [
  "key",
  "title",
  "kind",
  "installed",
  "version",
  "baseModel",
  "families",
  "role",
  "triggers",
  "strength",
  "uncensored",
  "links",
  "origin",
  "source",
  "aiDrafted",
  "note",
  "update",
];
const itemView = (item, { full = false } = {}) => ({
  ...Object.fromEntries(
    itemFields
      .filter((field) => item[field] !== undefined && item[field] !== "")
      .map((field) => [field, item[field]]),
  ),
  ...(full && item.description ? { description: item.description } : {}),
});

const downloadFields = [
  "id",
  "file",
  "folder",
  "label",
  "status",
  "receivedBytes",
  "totalBytes",
  "error",
];
const downloadView = (entry) =>
  entry
    ? Object.fromEntries(
        downloadFields
          .filter((field) => entry[field] !== undefined && entry[field] !== "")
          .map((field) => [field, entry[field]]),
      )
    : null;

/**
 * Registers the admin tools. `tool` is mcp.js's helper; `media` its McpMedia (requests go out with
 * the owner's credential); `resolve(value)` turns a result ref into its job id; `signExport(name)`
 * signs a download link for an export bundle.
 */
export function registerAdminTools({ tool, server, media, owner, resolve, signExport }) {
  const api = (method, route, body, signal) =>
    media.request(method, route, body, owner, { signal });
  /** Image imports and update checks answer 404 on a Studio without them (an older release behind the gateway). */
  const later = (what) => (error) => {
    throw /HTTP 404\)/.test(error.message)
      ? new Error(`${what} aren’t available in this Studio yet.`)
      : error;
  };
  const dataUrl = (content, mime) =>
    `data:${mime};base64,${Buffer.from(content).toString("base64")}`;

  tool(
    server,
    "Library",
    "Library",
    "Search or read Studio’s LoRAs and models with provenance (source, origin, version, triggers, strength, links). view installed (default), catalogue (catalogued, installed or not) or updates (available updates). get with key returns one entry in full. Read-only.",
    {
      action: z.enum(["search", "get"]).default("search"),
      query: z.string().trim().max(200).optional(),
      key: key.optional(),
      kind: z.enum(kinds).optional(),
      view: z.enum(["installed", "catalogue", "updates"]).default("installed"),
      limit: z.number().int().min(1).max(maxListed).default(20),
    },
    async ({ action, query, key: wanted, kind, view, limit }, signal) => {
      const { items = [] } = await api("GET", "/api/library/items", undefined, signal);
      if (action === "get") {
        if (!wanted) throw new Error("Pass key (folder/file) to get one entry.");
        const item = items.find((entry) => entry.key === wanted);
        if (!item)
          throw new Error(
            `${wanted} isn’t installed or catalogued. Search with query to find its key.`,
          );
        return mcpJson({ item: itemView(item, { full: true }) });
      }
      let listed = items;
      if (view === "updates") {
        const updates = await api("GET", "/api/library/updates", undefined, signal).catch(
          later("Update checks"),
        );
        const available = new Set(
          Object.entries(updates.byEntry || {})
            .filter(([, update]) => update?.state === "available")
            .map(([name]) => name),
        );
        listed = items
          .filter((item) => available.has(item.key))
          .map((item) => ({ ...item, update: updates.byEntry[item.key] }));
      } else
        listed = items.filter((item) =>
          view === "installed" ? item.installed : Boolean(item.origin || item.source),
        );
      if (kind) listed = listed.filter((item) => item.kind === kind);
      const words = String(query || "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      if (words.length)
        listed = listed.filter((item) => {
          const text = [
            item.key,
            item.title,
            item.baseModel,
            ...(item.triggers || []),
            ...(item.families || []),
          ]
            .join(" ")
            .toLowerCase();
          return words.every((word) => text.includes(word));
        });
      return mcpJson({
        view,
        total: listed.length,
        items: listed.slice(0, limit).map((item) => itemView(item)),
      });
    },
    { readOnlyHint: true },
  );

  tool(
    server,
    "Lookup",
    "Look Up a Model",
    "Look up a Civitai model or Hugging Face link without importing it: its versions and files with availability (paid, early access and restricted files never download), licence, whether each file is installed and which profiles fit its base model. query searches Civitai instead. Read-only.",
    {
      url: z.string().trim().url().max(2000).optional(),
      query: z.string().trim().min(2).max(120).optional(),
    },
    async ({ url, query }, signal) => {
      if (Boolean(url) === Boolean(query)) throw new Error("Pass url or query, not both.");
      const { lookup } = await api(
        "POST",
        "/api/library/lookup",
        url ? { url } : { query },
        signal,
      );
      return mcpJson(lookup);
    },
    { readOnlyHint: true },
  );

  tool(
    server,
    "Import",
    "Import to Library",
    "Import into the Library, as Library › Import does, when the user asks: a Civitai image or model link or a Hugging Face link (url), an image from Upload (upload_id) or a result (job_id). Returns the import’s grade (exact, close, partial) with reasons and its missing files; it appears in Library › Import as from chat. Nothing downloads: call Downloads start for that. describe has the vision model describe an image without settings.",
    {
      url: z.string().trim().url().max(2000).optional(),
      upload_id: id.optional(),
      job_id: id.optional().describe("A result ref or job_id."),
      output_index: z.number().int().min(0).max(999).default(0),
      describe: z.boolean().default(false),
    },
    async ({ url, upload_id, job_id, output_index, describe }, signal) => {
      if ([url, upload_id, job_id].filter(Boolean).length !== 1)
        throw new Error("Pass one of url, upload_id or job_id.");
      if (url && describe) throw new Error("describe is for images: pass upload_id or job_id.");
      let record;
      if (url) ({ import: record } = await api("POST", "/api/library/imports", { url }, signal));
      else {
        let image;
        let name;
        if (upload_id) {
          media.own(owner, upload_id, "assets");
          const response = await media.response(
            "GET",
            `/api/reference-assets/${encodeURIComponent(upload_id)}/media`,
            undefined,
            owner,
            { signal },
          );
          image = dataUrl(
            await response.arrayBuffer(),
            String(response.headers.get("content-type") || "image/png").split(";")[0],
          );
          name = "chat-upload";
        } else {
          const jobId = resolve(job_id);
          const result = await media.download(owner, jobId, output_index);
          if (!["image/png", "image/jpeg", "image/webp"].includes(result.mime))
            throw new Error("Only images can be imported.");
          image = dataUrl(result.content, result.mime);
          name = `result-${jobId}`;
        }
        ({ import: record } = await api(
          "POST",
          "/api/library/imports/image",
          { image, name },
          signal,
        ).catch(later("Image imports")));
        if (describe && record?.id)
          ({ import: record } = await api(
            "POST",
            `/api/library/imports/${encodeURIComponent(record.id)}/describe`,
            {},
            signal,
          ).catch(later("Described imports")));
      }
      return mcpJson({
        import: importView(record),
        note: "Shown in Library › Import. Call Downloads start with this import_id to fetch the missing files when the user asks.",
      });
    },
  );

  tool(
    server,
    "Imports",
    "Library Imports",
    "Read Library › Import history (newest first, with grade and missing count), or one import by id with its files checked. wait_seconds (at most 20) waits once for a resolving or downloading import; never poll. Read-only.",
    {
      id: id.optional(),
      wait_seconds: z.number().int().min(0).max(maxWaitSeconds).default(0),
    },
    async ({ id: wanted, wait_seconds }, signal) => {
      if (!wanted) {
        const { imports = [] } = await api("GET", "/api/library/imports", undefined, signal);
        return mcpJson({
          total: imports.length,
          imports: imports.slice(0, maxImportsListed).map(importRow),
        });
      }
      const deadline = Date.now() + wait_seconds * 1000;
      let { import: record } = await api(
        "GET",
        `/api/library/imports/${encodeURIComponent(wanted)}`,
        undefined,
        signal,
      );
      while (busyImport.has(record?.state) && Date.now() < deadline && !signal?.aborted) {
        await pause(Math.min(2000, deadline - Date.now()), signal);
        ({ import: record } = await api(
          "GET",
          `/api/library/imports/${encodeURIComponent(wanted)}`,
          undefined,
          signal,
        ));
      }
      return mcpJson({ import: importView(record) });
    },
    { readOnlyHint: true },
  );

  tool(
    server,
    "Downloads",
    "Model Downloads",
    "Model downloads through the worker model API, only when asked. start with import_id queues the import’s missing files (indices picks files); start or retry with source queues a download id from Lookup, Imports or status. status lists running, queued and recent downloads (import_id narrows to its files). cancel stops one download; its partial file stays and start resumes it. Paid, early-access and restricted files never download.",
    {
      action: z.enum(["start", "status", "retry", "cancel"]),
      import_id: id.optional(),
      indices: z.array(z.number().int().min(0).max(999)).max(64).optional(),
      source: z
        .string()
        .trim()
        .min(1)
        .max(600)
        .optional()
        .describe(
          "A download id, such as civitai:<version>:<file> or hf:<repo>:<revision>:<path>.",
        ),
    },
    async ({ action, import_id, indices, source }, signal) => {
      const state = async () => {
        const current = await api("GET", "/api/models/downloads", undefined, signal);
        const all = [current.active, ...(current.queued || []), ...(current.recent || [])].filter(
          Boolean,
        );
        let ids = null;
        if (import_id) {
          const { import: record } = await api(
            "GET",
            `/api/library/imports/${encodeURIComponent(import_id)}`,
            undefined,
            signal,
          );
          ids = new Set(
            (record?.resources || []).map((resource) => resource.downloadId).filter(Boolean),
          );
        }
        const keep = (entry) => !ids || ids.has(entry.id);
        return {
          storage: current.backend,
          active: keep(current.active || {}) ? downloadView(current.active) : null,
          queued: (current.queued || []).filter(keep).map(downloadView),
          recent: (current.recent || []).filter(keep).slice(0, 12).map(downloadView),
          ...(ids && !all.some(keep) ? { note: "This import has no download yet." } : {}),
        };
      };
      if (action === "status") return mcpJson(await state());
      if (action === "cancel") {
        if (!source) throw new Error("Pass source: the download id to cancel (from status).");
        await api("POST", "/api/models/downloads/cancel", { id: source }, signal);
        return mcpJson({
          cancelled: source,
          note: "Stopped. Its partial file stays; start resumes it.",
          ...(await state()),
        });
      }
      if (import_id && !source) {
        const result = await api(
          "POST",
          `/api/library/imports/${encodeURIComponent(import_id)}/download`,
          indices ? { indices } : {},
          signal,
        );
        return mcpJson({
          queued: result.queued,
          ...(result.failures?.length ? { failures: result.failures } : {}),
          import: importView(result.import),
        });
      }
      if (!source)
        throw new Error("Pass import_id (its missing files) or source (one download id).");
      const result = await api("POST", "/api/models/downloads", { id: source }, signal);
      return mcpJson({
        download: downloadView(result.download),
        queued: (result.queued || []).map(downloadView),
      });
    },
  );

  tool(
    server,
    "Updates",
    "Library Updates",
    "Updates for catalogued LoRAs and models from Civitai or Hugging Face, only when asked. list shows the last check, check checks now (keys narrows it), apply downloads the new file of each key under its own name (alternative picks the free version offered). The old file stays until the new one verifies and nothing uses it. Never applies on its own.",
    {
      action: z.enum(["list", "check", "apply"]).default("list"),
      keys: z.array(key).max(50).optional(),
      alternative: z.boolean().default(false),
    },
    async ({ action, keys, alternative }, signal) => {
      const unavailable = later("Update checks");
      const summary = (state) => ({
        checked_at: state.checkedAt || null,
        available: state.available || 0,
        updates: Object.entries(state.byEntry || {})
          .filter(([, update]) => update?.state !== "current")
          .map(([name, update]) => ({ key: name, ...update }))
          .slice(0, maxListed),
      });
      if (action === "list")
        return mcpJson(
          summary(await api("GET", "/api/library/updates", undefined, signal).catch(unavailable)),
        );
      if (action === "check")
        return mcpJson(
          summary(
            await api("POST", "/api/library/updates/check", keys ? { keys } : {}, signal).catch(
              unavailable,
            ),
          ),
        );
      if (!keys?.length) throw new Error("Pass keys: the entries to update (from list).");
      const applied = [];
      for (const name of keys) {
        try {
          applied.push({
            key: name,
            ...(
              await api(
                "POST",
                "/api/library/updates/apply",
                { key: name, alternative },
                signal,
              ).catch(unavailable)
            ).applied,
          });
        } catch (error) {
          applied.push({ key: name, error: error.message });
        }
      }
      return mcpJson({ applied });
    },
  );

  const strength = z
    .object({
      default: z.number().finite().min(-5).max(5).optional(),
      min: z.number().finite().min(-5).max(5).optional(),
      max: z.number().finite().min(-5).max(5).optional(),
    })
    .strict();
  const links = z
    .object({
      civitaiCom: z.string().url().optional(),
      civitaiRed: z.string().url().optional(),
      hf: z.string().url().optional(),
    })
    .strict();
  tool(
    server,
    "CatalogueEdit",
    "Edit Catalogue Entry",
    "Change one catalogue entry when the user asks: title, triggers, strength {default, min, max}, uncensored, links or notes; null clears a field’s edit. Returns the new entry and the previous values; undo: true reverts its newest change. Recorded as from chat.",
    {
      key,
      patch: z
        .object({
          title: z.string().max(300).nullable().optional(),
          triggers: z.array(z.string().max(80)).max(30).nullable().optional(),
          strength: strength.nullable().optional(),
          uncensored: z.boolean().nullable().optional(),
          links: links.nullable().optional(),
          notes: z.string().max(500).nullable().optional(),
        })
        .strict()
        .optional(),
      undo: z.boolean().default(false),
    },
    async ({ key: target, patch, undo }, signal) => {
      if (undo === Boolean(patch))
        throw new Error(
          undo
            ? "Pass patch or undo, not both."
            : "Pass patch (the fields to change) or undo: true.",
        );
      if (undo)
        return mcpJson(await api("POST", "/api/library/catalogue/undo", { key: target }, signal));
      if (!Object.keys(patch).length) throw new Error("patch names no field to change.");
      const saved = await api("PATCH", "/api/library/catalogue", { key: target, patch }, signal);
      return mcpJson({
        key: saved.key,
        entry: saved.entry,
        previous: saved.previous,
        note: "CatalogueEdit with undo: true reverts this change.",
      });
    },
  );

  // Guide bindings are one versioned document, so they take no id.
  const baseOf = (target, name) =>
    target === "bindings"
      ? "/api/profiles/guide-bindings"
      : target === "guide"
        ? `/api/profiles/guides/${encodeURIComponent(name)}`
        : `/api/profiles/editable/${encodeURIComponent(name)}`;
  const versionsOf = async (target, name, signal) =>
    (await api("GET", `${baseOf(target, name)}/versions`, undefined, signal)).versions || [];
  const versionText = async (target, name, n, signal) => {
    const { version } = await api(
      "GET",
      `${baseOf(target, name)}/versions/${n}`,
      undefined,
      signal,
    );
    return target === "profile"
      ? version.text
      : `${JSON.stringify(target === "guide" ? version.pack : version.bindings, null, 2)}\n`;
  };
  const current = async (target, name, signal) => {
    const now = await api("GET", baseOf(target, name), undefined, signal);
    if (target === "profile")
      return { id: name, text: now.text, hash: now.hash, meta: now.version };
    const value = target === "guide" ? now.pack : now.bindings;
    return {
      id: name,
      text: `${JSON.stringify(value, null, 2)}\n`,
      value,
      hash: now.hash,
      meta: now.meta,
    };
  };
  const versionRow = ({ version, at, by, origin, aiDrafted, note }) => ({
    version,
    at,
    by,
    origin,
    ...(aiDrafted ? { aiDrafted: true } : {}),
    ...(note ? { note } : {}),
  });

  tool(
    server,
    "Profiles",
    "Profiles & Guides",
    "Read Studio’s model profiles and prompting guides. list lists them with version, origin and AI-Drafted state; get returns one’s text, hash (pass it as base_hash to ProfileEdit) and recent versions, or an older version with version; diff compares version (default: the one before) with the current text. target is profile (default), guide (a pack) or bindings: which pack, variant and mode each profile (custom:<id>) uses, the variants and each profile's negatives, one document without an id. Read-only.",
    {
      action: z.enum(["list", "get", "diff"]).default("list"),
      target: z.enum(["profile", "guide", "bindings"]).default("profile"),
      id: z.string().trim().min(1).max(120).optional(),
      version: z.number().int().min(1).optional(),
    },
    async ({ action, target, id: name, version }, signal) => {
      if (target === "bindings" && action === "list") action = "get";
      if (action === "list") {
        if (target === "guide")
          return mcpJson({
            guides: (await api("GET", "/api/profiles/guides", undefined, signal)).packs || [],
          });
        const { profiles = [] } = await api("GET", "/api/profiles/editable", undefined, signal);
        return mcpJson({
          profiles: profiles.map(
            ({
              id: profileId,
              name: label,
              kind,
              family,
              version: n,
              origin,
              aiDrafted,
              uncensored,
            }) => ({
              id: profileId,
              name: label,
              kind,
              family,
              version: n,
              origin,
              ...(aiDrafted ? { aiDrafted: true } : {}),
              ...(uncensored ? { uncensored: true } : {}),
            }),
          ),
        });
      }
      if (!name && target !== "bindings")
        throw new Error(`Pass id: the ${target} to ${action} (from list).`);
      const now = await current(target, name, signal);
      const versions = await versionsOf(target, name, signal);
      if (action === "get") {
        if (version)
          return mcpJson({
            target,
            id: name,
            version,
            text: await versionText(target, name, version, signal),
            current_hash: now.hash,
            note: "An older version: ProfileEdit revert restores it as a new version.",
          });
        return mcpJson({
          target,
          id: name,
          hash: now.hash,
          ...(now.meta ? { meta: now.meta } : {}),
          versions: versions.slice(0, 10).map(versionRow),
          text: now.text,
        });
      }
      const latest = versions[0]?.version || 0;
      const against = version || latest - 1;
      if (against < 1) throw new Error("There is no earlier version to compare with.");
      return mcpJson({
        target,
        id: name,
        from: against,
        to: latest || "current",
        ...diffText(await versionText(target, name, against, signal), now.text),
      });
    },
    { readOnlyHint: true },
  );

  tool(
    server,
    "ProfileEdit",
    "Edit Profile or Guide",
    'Change a profile, guide or the guide bindings when the user asks; every change is a new version recorded as from chat. edit saves text (the whole JSON) or patch (a JSON merge patch; null removes a key, so {"profiles": {"custom:<id>": null}} removes a profile\'s binding); draft saves the same way but marks it AI-Drafted, visible to administrators only until approved; approve clears AI-Drafted; revert restores version as a new version. edit, draft and revert need base_hash from Profiles get: a stale one is refused. Profiles are checked like Settings › Profiles; warnings come back. bindings takes no id.',
    {
      action: z.enum(["draft", "edit", "approve", "revert"]),
      target: z.enum(["profile", "guide", "bindings"]).default("profile"),
      id: z.string().trim().min(1).max(120).optional(),
      text: z.string().min(2).max(2000000).optional(),
      patch: z.record(z.string(), z.unknown()).optional(),
      base_hash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      version: z.number().int().min(1).optional(),
    },
    async ({ action, target, id: name, text, patch, base_hash, version }, signal) => {
      if (!name && target !== "bindings") throw new Error(`Pass id: the ${target} to change.`);
      const base = baseOf(target, name);
      const reply = (saved) =>
        mcpJson({
          target,
          id: name,
          hash: saved.hash,
          ...(saved.version || saved.meta ? { version: saved.version || saved.meta } : {}),
          ...(saved.warnings?.length ? { warnings: saved.warnings } : {}),
        });
      if (action === "approve") {
        const { meta } = await api("POST", `${base}/approve`, {}, signal);
        return mcpJson({ target, id: name, approved: true, meta });
      }
      if (!base_hash)
        throw new Error(
          "Pass base_hash: the hash from Profiles get, so a change made since is never overwritten.",
        );
      if (action === "revert") {
        if (!version) throw new Error("Pass version: the version to restore (from Profiles get).");
        return reply(await api("POST", `${base}/revert`, { version, baseHash: base_hash }, signal));
      }
      if (Boolean(text) === Boolean(patch))
        throw new Error("Pass text (the whole JSON) or patch (a JSON merge patch), not both.");
      const draft = action === "draft";
      if (target !== "profile") {
        let value;
        if (patch) {
          const now = await current(target, name, signal);
          if (now.hash !== base_hash)
            throw new Error(
              `This ${target === "guide" ? "guide" : "binding document"} changed since you read it. Call Profiles get again, then make the change.`,
            );
          value = mergePatch(now.value, patch);
        } else {
          try {
            value = JSON.parse(text);
          } catch (error) {
            throw new Error(`text is not valid JSON: ${error.message}`);
          }
        }
        const field = target === "guide" ? "pack" : "bindings";
        return reply(
          await api("PUT", base, { [field]: value, baseHash: base_hash, draft }, signal),
        );
      }
      let next = text;
      if (patch) {
        const now = await current("profile", name, signal);
        if (now.hash !== base_hash)
          throw new Error(
            "This profile changed since you read it. Call Profiles get again, then make the change.",
          );
        next = `${JSON.stringify(mergePatch(JSON.parse(now.text), patch), null, 2)}\n`;
      }
      return reply(await api("PUT", base, { text: next, baseHash: base_hash, draft }, signal));
    },
  );

  tool(
    server,
    "CombineBackends",
    "Combine Backends",
    "Combine a model’s Radiance and ComfyUI profiles into one, as Settings › Profiles › Combine Backends does, only when asked. preview lists the pairs it could combine with what differs, and a hash; apply combines selections (radiance and comfyui ids from one preview pair, optionally name and backend, the default backend, comfyui unless given) with that hash, backing up both profiles first. A stale hash is refused: preview again.",
    {
      action: z.enum(["preview", "apply"]).default("preview"),
      hash: z.string().trim().min(1).max(200).optional(),
      selections: z
        .array(
          z.object({
            radiance: id,
            comfyui: id,
            name: z.string().trim().min(1).max(200).optional(),
            backend: z.enum(["radiance", "comfyui"]).optional(),
          }),
        )
        .min(1)
        .optional(),
    },
    async ({ action, hash, selections }, signal) => {
      if (action === "preview")
        return mcpJson(await api("GET", "/api/profiles/backends", undefined, signal));
      if (!hash || !selections)
        throw new Error("Pass hash and selections from CombineBackends preview.");
      return mcpJson(
        await api("POST", "/api/profiles/backends/combine", { hash, selections }, signal),
      );
    },
  );

  tool(
    server,
    "Export",
    "Export Profiles",
    "Build the export bundle as a backup (profiles, guides, catalogue and EXPORT.json listing origins and unreviewed AI drafts), as Settings › Profiles › Export does, only when asked. Returns a signed download link valid for an hour.",
    {},
    async (_args, signal) => {
      const response = await media.response("GET", "/api/profiles/export", undefined, owner, {
        signal,
      });
      await response.arrayBuffer();
      const name =
        /filename="([^"]+)"/.exec(String(response.headers.get("content-disposition") || ""))?.[1] ||
        "";
      if (!name) throw new Error("Studio didn’t name the export bundle.");
      let report = {};
      try {
        report = JSON.parse(response.headers.get("x-studio-export") || "{}");
      } catch {
        /* Counts are optional. */
      }
      const link = signExport(name);
      return mcpJson({ file: name, link: link.url, expires_at: link.expiresAt, ...report });
    },
  );

  tool(
    server,
    "Placement",
    "Model Placement",
    "Where model files live: the worker’s inventory per folder, free space and whether it is writable (or the local folders); with key, where that one file sits. Read-only.",
    {
      key: key.optional(),
    },
    async ({ key: target }, signal) =>
      mcpJson(
        (
          await api(
            "GET",
            `/api/library/placement${target ? `?key=${encodeURIComponent(target)}` : ""}`,
            undefined,
            signal,
          )
        ).placement,
      ),
    { readOnlyHint: true },
  );

  tool(
    server,
    "Accounts",
    "Accounts & Groups",
    "Manage accounts' groups as Settings › Accounts does, only when asked. list returns accounts, groups, the default group and the profiles a group can grant; save_group creates or replaces a group (group: id, name, generationProfiles, allModels and features, each feature set explicitly since an unsaved one is off); set_default makes group_id the group new accounts start in (\"\" for none); delete_group removes an empty group that isn't the default; set_user moves an ordinary account (account_id) to group_id or sets disabled.",
    {
      action: z
        .enum(["list", "save_group", "set_default", "delete_group", "set_user"])
        .default("list"),
      group: z.record(z.string(), z.unknown()).optional(),
      group_id: z.string().trim().max(200).optional(),
      account_id: id.optional(),
      disabled: z.boolean().optional(),
    },
    async ({ action, group, group_id, account_id, disabled }, signal) => {
      if (action === "list") {
        const { gateway: _gateway, ...admin } = await api(
          "GET",
          "/api/accounts/admin",
          undefined,
          signal,
        );
        return mcpJson(admin);
      }
      if (action === "save_group") {
        if (!group) throw new Error("Pass group: the whole group to save.");
        return mcpJson(await api("POST", "/api/accounts/profiles", group, signal));
      }
      if (action === "set_default") {
        if (group_id === undefined) throw new Error('Pass group_id: the default group, or "".');
        const body = { accessProfileId: group_id };
        return mcpJson(await api("POST", "/api/accounts/default-profile", body, signal));
      }
      if (action === "delete_group") {
        if (!group_id) throw new Error("Pass group_id: the group to delete.");
        const route = `/api/accounts/profiles/${encodeURIComponent(group_id)}`;
        return mcpJson(await api("DELETE", route, undefined, signal));
      }
      if (!account_id) throw new Error("Pass account_id from Accounts list.");
      if (Boolean(group_id) === (disabled !== undefined))
        throw new Error("Pass one of group_id or disabled.");
      const route = `/api/accounts/users/${encodeURIComponent(account_id)}`;
      const body = group_id ? { accessProfileId: group_id } : { disabled };
      return mcpJson(await api("PATCH", route, body, signal));
    },
  );
}
