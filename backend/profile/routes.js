/**
 * Library › Profiles beyond the JSON editor (profile/editor.js), administrators only:
 *
 *   GET  /api/profiles/editable/:id/versions        the profile's versions, newest first, and its current marker
 *   GET  /api/profiles/editable/:id/versions/:n     one version with its text
 *   POST /api/profiles/editable/:id/revert          {version, baseHash}: that version again, as a new version
 *   POST /api/profiles/editable/:id/approve         clears AI-Drafted, so access profiles decide who sees it
 *   POST /api/profiles/editable/:id/remove          {baseHash}: removes the profile, with a backup (profile/remove.js)
 *   GET  /api/profiles/editable/:id/download        the profile file exactly as on disk, as `<id>.json`
 *   GET  /api/profiles/editable/:id/guide           the guide pack that applies to the profile, and its own fields over it
 *   GET  /api/profiles/guides                       every guide pack with its name, version and AI-Drafted state
 *   GET  /api/profiles/guides/:packId               one pack with its hash (an edit's base) and meta
 *   PUT  /api/profiles/guides/:packId               {pack, baseHash, draft?}: saves a guide pack as a new version
 *   GET  /api/profiles/guides/:packId/download      the pack as `<packId>.json`
 *   GET  /api/profiles/guides/:packId/versions      the pack's versions, newest first
 *   GET  /api/profiles/guides/:packId/versions/:n   one version with its pack
 *   POST /api/profiles/guides/:packId/revert        {version, baseHash}
 *   POST /api/profiles/guides/:packId/approve       clears AI-Drafted on the pack
 *   POST /api/profiles/guides/:packId/remove        {baseHash}: removes a pack no profile or family uses; its versions stay
 *   GET  /api/profiles/guide-bindings               the family map, profile bindings, variants and negatives, with their hash and meta
 *   PUT  /api/profiles/guide-bindings               {bindings, baseHash, draft?}: saves them as a new version
 *   GET  /api/profiles/guide-bindings/versions      their versions, newest first
 *   GET  /api/profiles/guide-bindings/versions/:n   one version with its bindings
 *   POST /api/profiles/guide-bindings/revert        {version, baseHash}
 *   POST /api/profiles/guide-bindings/approve       clears AI-Drafted on the bindings
 *   GET  /api/profiles/export                       the export bundle (zip) in the ai/ layout
 *   GET  /api/profiles/duplicates                   what Merge Duplicate Profiles would merge, and what it leaves
 *   POST /api/profiles/duplicates/merge             {hash}: merges that preview, with a backup (profile/merge.js)
 *   GET  /api/profiles/backends                     Radiance and ComfyUI profiles Combine Backends could make one
 *   POST /api/profiles/backends/combine             {hash, selections}: combines the picked pairs, with a backup (profile/backends.js)
 *
 * Every change is a new version; nothing is deleted. MCP's admin tools (mcp/admin.js) call these
 * same routes in process: their versions record chat as the origin, and a chat draft stays AI-Drafted.
 */
import { families as familyCatalogue } from "../family-catalogue.js";
import { directRoute } from "../domain/direct-route.ts";
import { adminRefusal, fromChat, requireAdmin } from "../route-access.js";
import { loraFamilyId } from "../../shared/profiles.ts";
import {
  approveEditableProfile,
  failure,
  profileRoute,
  readEditableProfile,
  revertEditableProfile,
} from "./editor.js";
import { writeExport } from "./export.js";
import { backendCandidates, combineBackends } from "./backends.js";
import { duplicateProfiles, mergeDuplicateProfiles } from "./merge.js";
import { removeProfile } from "./remove.js";

/**
 * `profiles()` and `guides()` give the profile/store.js stores; `objectInfo(kind)` ComfyUI's
 * object_info for revert's check; `exportOptions()` what writeExport needs besides the stores;
 * `onSaved(id)` runs after any change that affects who sees which profile; `accountName(account)`
 * names who made a change.
 */
export function registerProfileRoutes(
  app,
  {
    profiles,
    guides,
    objectInfo = async () => null,
    exportOptions = () => ({}),
    onSaved = () => {},
    accountName = () => "",
  },
) {
  const info = async (kind) => {
    try {
      return await objectInfo(kind);
    } catch {
      return null;
    }
  };
  app.use("/api/profiles", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const route = (method, path, handler) => profileRoute(app, method, path, handler);
  // A file the browser downloads.
  const download = (handler) => async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await handler(req, res);
    } catch (error) {
      const { status, payload } = failure(error);
      res.status(status).json(payload);
    }
  };
  const versionNumber = (value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1)
      throw Object.assign(new Error("Choose a version."), { status: 400 });
    return n;
  };
  const origin = (account) => (fromChat(account) ? "chat" : "studio");

  route("GET", "/api/profiles/editable/:id/versions", (_account, { params }) => {
    readEditableProfile(params.id);
    return { versions: profiles().versions(params.id), meta: profiles().meta(params.id) };
  });
  app.get(
    "/api/profiles/editable/:id/download",
    download((req, res) => {
      const { id, text } = readEditableProfile(req.params.id);
      res.attachment(`${id}.json`).type("application/json").send(text);
    }),
  );
  route("GET", "/api/profiles/editable/:id/versions/:n", (_account, { params }) => ({
    version: profiles().version(params.id, versionNumber(params.n)),
  }));
  route("POST", "/api/profiles/editable/:id/revert", async (account, { params, body }) => {
    const current = readEditableProfile(params.id);
    let kind = "image";
    try {
      kind = JSON.parse(current.text)?.studio?.kind || "image";
    } catch {
      /* The check reports it. */
    }
    const saved = revertEditableProfile(params.id, versionNumber(body?.version), {
      by: accountName(account),
      baseHash: String(body?.baseHash || ""),
      info: await info(kind),
      origin: origin(account),
    });
    await onSaved(params.id);
    return saved;
  });
  route("POST", "/api/profiles/editable/:id/approve", async (account, { params }) => {
    const meta = approveEditableProfile(params.id, { by: accountName(account) });
    await onSaved(params.id);
    return { meta };
  });
  route("POST", "/api/profiles/editable/:id/remove", async (account, { params, body }) => {
    const result = removeProfile(params.id, {
      baseHash: String(body?.baseHash || ""),
      by: accountName(account),
    });
    await onSaved(params.id);
    return result;
  });
  route("GET", "/api/profiles/editable/:id/guide", (_account, { params }) => {
    const current = readEditableProfile(params.id);
    let meta = {};
    try {
      meta = JSON.parse(current.text)?.studio || {};
    } catch {
      /* Unreadable: no guide. */
    }
    const profile = {
      id: `custom:${meta.id || params.id}`,
      family: String(meta.family || "custom"),
      kind: meta.kind === "video" ? "video" : "image",
    };
    // The profile's own prompting fields go over its pack's (mcp/prompting.js mergedPrompting).
    const own =
      meta.prompting && typeof meta.prompting === "object" && !Array.isArray(meta.prompting)
        ? { own: meta.prompting }
        : {};
    const resolved = guides().resolve(profile);
    if (!resolved) return { source: "none", profile, ...own };
    let pack = null;
    try {
      pack = guides().pack(resolved.packId);
    } catch {
      /* Seed only: shown read-only. */
    }
    return {
      ...resolved,
      profile,
      ...own,
      ...(pack ? { pack: pack.pack, hash: pack.hash, meta: pack.meta } : { readOnly: true }),
    };
  });
  route("GET", "/api/profiles/guides", () => {
    const store = guides().read() || {};
    // A guide is named by its pack's `name`, else the label of a family it guides, else its id.
    const familyLabel = (packId) =>
      Object.entries(store.families || {})
        .filter(([, kinds]) => Object.values(kinds || {}).includes(packId))
        .map(([family]) => familyCatalogue[loraFamilyId(family)]?.label)
        .find(Boolean);
    const packs = Object.keys(store.packs || {})
      .sort()
      .map((packId) => {
        const meta = store.meta?.[packId] || {};
        const name = String(store.packs[packId]?.name || "").trim();
        return {
          packId,
          name: name || familyLabel(packId) || packId,
          version: meta.version || 0,
          origin: meta.origin || "seed",
          aiDrafted: meta.aiDrafted === true,
          editedAt: meta.editedAt || "",
        };
      });
    return { packs };
  });
  route("GET", "/api/profiles/guides/:packId", (_account, { params }) =>
    guides().pack(params.packId),
  );
  app.get(
    "/api/profiles/guides/:packId/download",
    download((req, res) => {
      const { packId, pack } = guides().pack(req.params.packId);
      res
        .attachment(`${packId}.json`)
        .type("application/json")
        .send(`${JSON.stringify(pack, null, 2)}\n`);
    }),
  );
  route("PUT", "/api/profiles/guides/:packId", (account, { params, body }) => {
    let pack = body?.pack;
    if (typeof pack === "string") {
      try {
        pack = JSON.parse(pack);
      } catch (error) {
        throw Object.assign(new Error(`Not valid JSON: ${error.message}`), { status: 400 });
      }
    }
    const chat = fromChat(account);
    return guides().save(params.packId, pack, {
      by: accountName(account),
      origin: origin(account),
      aiDrafted: chat && body?.draft === true,
      baseHash: String(body?.baseHash || ""),
    });
  });
  route("GET", "/api/profiles/guides/:packId/versions", (_account, { params }) => {
    const current = guides().pack(params.packId);
    return { versions: guides().versions(params.packId), meta: current.meta, hash: current.hash };
  });
  route("GET", "/api/profiles/guides/:packId/versions/:n", (_account, { params }) => ({
    version: guides().version(params.packId, versionNumber(params.n)),
  }));
  route("POST", "/api/profiles/guides/:packId/revert", (account, { params, body }) =>
    guides().revert(params.packId, versionNumber(body?.version), {
      by: accountName(account),
      baseHash: String(body?.baseHash || ""),
      origin: origin(account),
    }),
  );
  route("POST", "/api/profiles/guides/:packId/remove", (account, { params, body }) =>
    guides().remove(params.packId, {
      by: accountName(account),
      origin: origin(account),
      baseHash: String(body?.baseHash || ""),
    }),
  );
  route("POST", "/api/profiles/guides/:packId/approve", (account, { params }) => {
    guides().pack(params.packId);
    return { meta: guides().approve(params.packId, { by: accountName(account) }) };
  });

  route("GET", "/api/profiles/guide-bindings", () => guides().bindings());
  route("PUT", "/api/profiles/guide-bindings", (account, { body }) =>
    guides().saveBindings(body?.bindings, {
      by: accountName(account),
      origin: origin(account),
      aiDrafted: fromChat(account) && body?.draft === true,
      baseHash: String(body?.baseHash || ""),
    }),
  );
  route("GET", "/api/profiles/guide-bindings/versions", () => {
    const { meta, hash } = guides().bindings();
    return { versions: guides().versions("_bindings"), meta, hash };
  });
  route("GET", "/api/profiles/guide-bindings/versions/:n", (_account, { params }) => ({
    version: guides().version("_bindings", versionNumber(params.n)),
  }));
  route("POST", "/api/profiles/guide-bindings/revert", (account, { body }) =>
    guides().revertBindings(versionNumber(body?.version), {
      by: accountName(account),
      baseHash: String(body?.baseHash || ""),
      origin: origin(account),
    }),
  );
  route("POST", "/api/profiles/guide-bindings/approve", (account) => ({
    meta: guides().approve("_bindings", { by: accountName(account) }),
  }));

  route("GET", "/api/profiles/duplicates", () => duplicateProfiles());
  route("POST", "/api/profiles/duplicates/merge", async (account, { body }) => {
    const result = mergeDuplicateProfiles({
      hash: String(body?.hash || ""),
      by: accountName(account),
    });
    for (const { from } of result.merged) await onSaved(from);
    return result;
  });

  route("GET", "/api/profiles/backends", () => backendCandidates());
  route("POST", "/api/profiles/backends/combine", async (account, { body }) => {
    const result = combineBackends({
      hash: String(body?.hash || ""),
      selections: body?.selections,
      by: accountName(account),
    });
    for (const { id, from } of result.combined)
      for (const changed of [id, ...from]) await onSaved(changed);
    return result;
  });

  // The bundle, named and with its counts (X-Studio-Export), which MCP's Export reports.
  directRoute(app, "GET", "/api/profiles/export", (account) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    try {
      const { name, archive, report } = writeExport({
        ...exportOptions(),
        profiles: profiles(),
        guides: guides(),
        by: accountName(account),
      });
      const counts = {
        profiles: report.profiles.length,
        guides: report.guides.length,
        unreviewed: report.unreviewed.profiles.length + report.unreviewed.guides.length,
      };
      return {
        status: 200,
        content: archive,
        mime: "application/zip",
        headers: {
          "content-disposition": `attachment; filename="${name}"`,
          "x-studio-export": JSON.stringify(counts),
        },
      };
    } catch (error) {
      return failure(error);
    }
  });
}
