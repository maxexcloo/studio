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
 * Every change is a new version; nothing is deleted. MCP's admin tools (mcp-admin.js) call these
 * same routes: their versions record chat as the origin, and a chat draft stays AI-Drafted.
 */
import { families as familyCatalog } from "../family-catalog.js";
import { fromChat, requireAdmin } from "../route-access.js";
import { loraFamilyId } from "../../shared/profiles.ts";
import { approveEditableProfile, readEditableProfile, revertEditableProfile } from "./editor.js";
import { writeExport } from "./export.js";
import { backendCandidates, combineBackends } from "./backends.js";
import { duplicateProfiles, mergeDuplicateProfiles } from "./merge.js";
import { removeProfile } from "./remove.js";

const fail = (res, error) =>
  res.status(error.status || 400).json({
    ok: false,
    error: error.message,
    ...(error.checked ? { errors: error.checked.errors, warnings: error.checked.warnings } : {}),
  });

/**
 * `profiles()` and `guides()` give the profile/store.js stores; `objectInfo(kind)` ComfyUI's
 * object_info for revert's check; `exportOptions()` what writeExport needs besides the stores;
 * `onSaved(id)` runs after any change that affects who sees which profile.
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
  const route = (handler) => async (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (error) {
      fail(res, error);
    }
  };
  const versionNumber = (value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1)
      throw Object.assign(new Error("Choose a version."), { status: 400 });
    return n;
  };

  app.get(
    "/api/profiles/editable/:id/versions",
    route((req, res) => {
      readEditableProfile(req.params.id);
      res.json({
        ok: true,
        versions: profiles().versions(req.params.id),
        meta: profiles().meta(req.params.id),
      });
    }),
  );
  app.get(
    "/api/profiles/editable/:id/download",
    route((req, res) => {
      const { id, text } = readEditableProfile(req.params.id);
      res.attachment(`${id}.json`).type("application/json").send(text);
    }),
  );
  app.get(
    "/api/profiles/editable/:id/versions/:n",
    route((req, res) => {
      res.json({
        ok: true,
        version: profiles().version(req.params.id, versionNumber(req.params.n)),
      });
    }),
  );
  app.post(
    "/api/profiles/editable/:id/revert",
    route(async (req, res) => {
      const current = readEditableProfile(req.params.id);
      let kind = "image";
      try {
        kind = JSON.parse(current.text)?.studio?.kind || "image";
      } catch {
        /* The check reports it. */
      }
      const saved = revertEditableProfile(req.params.id, versionNumber(req.body?.version), {
        by: accountName(req),
        baseHash: String(req.body?.baseHash || ""),
        info: await info(kind),
        origin: fromChat(req) ? "chat" : "studio",
      });
      await onSaved(req.params.id);
      res.json({ ok: true, ...saved });
    }),
  );
  app.post(
    "/api/profiles/editable/:id/approve",
    route(async (req, res) => {
      const meta = approveEditableProfile(req.params.id, { by: accountName(req) });
      await onSaved(req.params.id);
      res.json({ ok: true, meta });
    }),
  );

  app.post(
    "/api/profiles/editable/:id/remove",
    route(async (req, res) => {
      const result = removeProfile(req.params.id, {
        baseHash: String(req.body?.baseHash || ""),
        by: accountName(req),
      });
      await onSaved(req.params.id);
      res.json({ ok: true, ...result });
    }),
  );
  app.get(
    "/api/profiles/editable/:id/guide",
    route((req, res) => {
      const current = readEditableProfile(req.params.id);
      let meta = {};
      try {
        meta = JSON.parse(current.text)?.studio || {};
      } catch {
        /* Unreadable: no guide. */
      }
      const profile = {
        id: `custom:${meta.id || req.params.id}`,
        family: String(meta.family || "custom"),
        kind: meta.kind === "video" ? "video" : "image",
      };
      // The profile's own prompting fields go over its pack's (mcp/prompting.js mergedPrompting).
      const own =
        meta.prompting && typeof meta.prompting === "object" && !Array.isArray(meta.prompting)
          ? { own: meta.prompting }
          : {};
      const resolved = guides().resolve(profile);
      if (!resolved) {
        res.json({ ok: true, source: "none", profile, ...own });
        return;
      }
      let pack = null;
      try {
        pack = guides().pack(resolved.packId);
      } catch {
        /* Seed only: shown read-only. */
      }
      res.json({
        ok: true,
        ...resolved,
        profile,
        ...own,
        ...(pack ? { pack: pack.pack, hash: pack.hash, meta: pack.meta } : { readOnly: true }),
      });
    }),
  );
  app.get(
    "/api/profiles/guides",
    route((_req, res) => {
      const store = guides().read() || {};
      // A guide is named by its pack's `name`, else the label of a family it guides, else its id.
      const familyLabel = (packId) =>
        Object.entries(store.families || {})
          .filter(([, kinds]) => Object.values(kinds || {}).includes(packId))
          .map(([family]) => familyCatalog[loraFamilyId(family)]?.label)
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
      res.json({ ok: true, packs });
    }),
  );
  app.get(
    "/api/profiles/guides/:packId",
    route((req, res) => {
      res.json({ ok: true, ...guides().pack(req.params.packId) });
    }),
  );
  app.get(
    "/api/profiles/guides/:packId/download",
    route((req, res) => {
      const { packId, pack } = guides().pack(req.params.packId);
      res
        .attachment(`${packId}.json`)
        .type("application/json")
        .send(`${JSON.stringify(pack, null, 2)}\n`);
    }),
  );
  app.put(
    "/api/profiles/guides/:packId",
    route((req, res) => {
      let pack = req.body?.pack;
      if (typeof pack === "string") {
        try {
          pack = JSON.parse(pack);
        } catch (error) {
          throw Object.assign(new Error(`Not valid JSON: ${error.message}`), { status: 400 });
        }
      }
      const chat = fromChat(req);
      const saved = guides().save(req.params.packId, pack, {
        by: accountName(req),
        origin: chat ? "chat" : "studio",
        aiDrafted: chat && req.body?.draft === true,
        baseHash: String(req.body?.baseHash || ""),
      });
      res.json({ ok: true, ...saved });
    }),
  );
  app.get(
    "/api/profiles/guides/:packId/versions",
    route((req, res) => {
      const current = guides().pack(req.params.packId);
      res.json({
        ok: true,
        versions: guides().versions(req.params.packId),
        meta: current.meta,
        hash: current.hash,
      });
    }),
  );
  app.get(
    "/api/profiles/guides/:packId/versions/:n",
    route((req, res) => {
      res.json({
        ok: true,
        version: guides().version(req.params.packId, versionNumber(req.params.n)),
      });
    }),
  );
  app.post(
    "/api/profiles/guides/:packId/revert",
    route((req, res) => {
      const saved = guides().revert(req.params.packId, versionNumber(req.body?.version), {
        by: accountName(req),
        baseHash: String(req.body?.baseHash || ""),
        origin: fromChat(req) ? "chat" : "studio",
      });
      res.json({ ok: true, ...saved });
    }),
  );
  app.post(
    "/api/profiles/guides/:packId/remove",
    route((req, res) => {
      res.json({
        ok: true,
        ...guides().remove(req.params.packId, {
          by: accountName(req),
          origin: fromChat(req) ? "chat" : "studio",
          baseHash: String(req.body?.baseHash || ""),
        }),
      });
    }),
  );
  app.post(
    "/api/profiles/guides/:packId/approve",
    route((req, res) => {
      guides().pack(req.params.packId);
      res.json({ ok: true, meta: guides().approve(req.params.packId, { by: accountName(req) }) });
    }),
  );

  app.get(
    "/api/profiles/guide-bindings",
    route((_req, res) => {
      res.json({ ok: true, ...guides().bindings() });
    }),
  );
  app.put(
    "/api/profiles/guide-bindings",
    route((req, res) => {
      const chat = fromChat(req);
      const saved = guides().saveBindings(req.body?.bindings, {
        by: accountName(req),
        origin: chat ? "chat" : "studio",
        aiDrafted: chat && req.body?.draft === true,
        baseHash: String(req.body?.baseHash || ""),
      });
      res.json({ ok: true, ...saved });
    }),
  );
  app.get(
    "/api/profiles/guide-bindings/versions",
    route((_req, res) => {
      const { meta, hash } = guides().bindings();
      res.json({ ok: true, versions: guides().versions("_bindings"), meta, hash });
    }),
  );
  app.get(
    "/api/profiles/guide-bindings/versions/:n",
    route((req, res) => {
      res.json({ ok: true, version: guides().version("_bindings", versionNumber(req.params.n)) });
    }),
  );
  app.post(
    "/api/profiles/guide-bindings/revert",
    route((req, res) => {
      const saved = guides().revertBindings(versionNumber(req.body?.version), {
        by: accountName(req),
        baseHash: String(req.body?.baseHash || ""),
        origin: fromChat(req) ? "chat" : "studio",
      });
      res.json({ ok: true, ...saved });
    }),
  );
  app.post(
    "/api/profiles/guide-bindings/approve",
    route((req, res) => {
      res.json({
        ok: true,
        meta: guides().approve("_bindings", { by: accountName(req) }),
      });
    }),
  );

  app.get(
    "/api/profiles/duplicates",
    route((_req, res) => {
      res.json({ ok: true, ...duplicateProfiles() });
    }),
  );
  app.post(
    "/api/profiles/duplicates/merge",
    route(async (req, res) => {
      const result = mergeDuplicateProfiles({
        hash: String(req.body?.hash || ""),
        by: accountName(req),
      });
      for (const { from } of result.merged) await onSaved(from);
      res.json({ ok: true, ...result });
    }),
  );

  app.get(
    "/api/profiles/backends",
    route((_req, res) => {
      res.json({ ok: true, ...backendCandidates() });
    }),
  );
  app.post(
    "/api/profiles/backends/combine",
    route(async (req, res) => {
      const result = combineBackends({
        hash: String(req.body?.hash || ""),
        selections: req.body?.selections,
        by: accountName(req),
      });
      for (const { id, from } of result.combined)
        for (const changed of [id, ...from]) await onSaved(changed);
      res.json({ ok: true, ...result });
    }),
  );

  app.get(
    "/api/profiles/export",
    route((req, res) => {
      const { name, archive, report } = writeExport({
        ...exportOptions(),
        profiles: profiles(),
        guides: guides(),
        by: accountName(req),
      });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
      res.setHeader(
        "X-Studio-Export",
        JSON.stringify({
          profiles: report.profiles.length,
          guides: report.guides.length,
          unreviewed: report.unreviewed.profiles.length + report.unreviewed.guides.length,
        }),
      );
      res.setHeader("Content-Length", String(archive.length));
      res.end(archive);
    }),
  );
}
