// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Profiles beyond the JSON editor (profile-editor.js), administrators only:
 *
 *   GET  /api/profiles/editable/:id/versions        the profile's versions, newest first, and its current marker
 *   GET  /api/profiles/editable/:id/versions/:n     one version with its text
 *   POST /api/profiles/editable/:id/revert          {version, baseHash}: that version again, as a new version
 *   POST /api/profiles/editable/:id/approve         clears AI-Drafted, so access profiles decide who sees it
 *   GET  /api/profiles/editable/:id/guide           the guide pack that applies to the profile, or its own guidance
 *   PUT  /api/profiles/guides/:packId               {pack, baseHash}: saves a guide pack as a new version
 *   GET  /api/profiles/guides/:packId/versions      the pack's versions, newest first
 *   GET  /api/profiles/guides/:packId/versions/:n   one version with its pack
 *   POST /api/profiles/guides/:packId/revert        {version, baseHash}
 *   POST /api/profiles/guides/:packId/approve       clears AI-Drafted on the pack
 *   GET  /api/profiles/export                       the export bundle (zip) in the ai/profiles/ layout
 *
 * Every change is a new version; nothing is deleted.
 */
import { requireAdmin } from './route-access.js';
import { approveEditableProfile, readEditableProfile, revertEditableProfile } from './profile-editor.js';
import { profileBlock } from './profile-block.js';
import { writeExport } from './profile-export.js';

const fail = (res, error) => res.status(error.status || 400).json({ ok: false, error: error.message, ...(error.checked ? { errors: error.checked.errors, warnings: error.checked.warnings } : {}) });

/**
 * `profiles()` and `guides()` give the profile-store.js stores; `objectInfo(kind)` ComfyUI's
 * object_info for revert's check; `exportOptions()` what writeExport needs besides the stores;
 * `onSaved(id)` runs after any change that affects who sees which profile.
 */
export function registerProfileRoutes(app, { profiles, guides, objectInfo = async () => null, exportOptions = () => ({}), onSaved = () => {}, accountName = () => '' }) {
  const info = async (kind) => { try { return await objectInfo(kind); } catch { return null; } };
  const route = (handler) => async (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    try { await handler(req, res); } catch (error) { fail(res, error); }
  };
  const versionNumber = (value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) throw Object.assign(new Error('Choose a version.'), { status: 400 });
    return n;
  };

  app.get('/api/profiles/editable/:id/versions', route((req, res) => {
    readEditableProfile(req.params.id);
    res.json({ ok: true, versions: profiles().versions(req.params.id), meta: profiles().meta(req.params.id) });
  }));
  app.get('/api/profiles/editable/:id/versions/:n', route((req, res) => {
    res.json({ ok: true, version: profiles().version(req.params.id, versionNumber(req.params.n)) });
  }));
  app.post('/api/profiles/editable/:id/revert', route(async (req, res) => {
    const current = readEditableProfile(req.params.id);
    let kind = 'image';
    try { kind = profileBlock(JSON.parse(current.text))?.kind || 'image'; } catch { /* The check reports it. */ }
    const saved = revertEditableProfile(req.params.id, versionNumber(req.body?.version), { by: accountName(req), baseHash: String(req.body?.baseHash || ''), info: await info(kind) });
    await onSaved(req.params.id);
    res.json({ ok: true, ...saved });
  }));
  app.post('/api/profiles/editable/:id/approve', route(async (req, res) => {
    const meta = approveEditableProfile(req.params.id, { by: accountName(req) });
    await onSaved(req.params.id);
    res.json({ ok: true, meta });
  }));

  app.get('/api/profiles/editable/:id/guide', route((req, res) => {
    const current = readEditableProfile(req.params.id);
    let meta = {};
    try { meta = profileBlock(JSON.parse(current.text)) || {}; } catch { /* Unreadable: no guide. */ }
    const profile = { id: `custom:${meta.id || req.params.id}`, family: String(meta.family || 'custom'), kind: meta.kind === 'video' ? 'video' : 'image' };
    // Guidance in the profile's own JSON wins over any pack (mcp-prompting.js).
    if (meta.prompting && typeof meta.prompting === 'object' && !Array.isArray(meta.prompting)) {
      res.json({ ok: true, source: 'owned', profile, owned: meta.prompting });
      return;
    }
    const resolved = guides().resolve(profile);
    if (!resolved) { res.json({ ok: true, source: 'none', profile }); return; }
    let pack = null;
    try { pack = guides().pack(resolved.packId); } catch { /* Seed only: shown read-only. */ }
    res.json({ ok: true, ...resolved, profile, ...(pack ? { pack: pack.pack, hash: pack.hash, meta: pack.meta } : { readOnly: true }) });
  }));
  app.put('/api/profiles/guides/:packId', route((req, res) => {
    let pack = req.body?.pack;
    if (typeof pack === 'string') {
      try { pack = JSON.parse(pack); } catch (error) { throw Object.assign(new Error(`Not valid JSON: ${error.message}`), { status: 400 }); }
    }
    const saved = guides().save(req.params.packId, pack, { by: accountName(req), origin: 'studio', baseHash: String(req.body?.baseHash || '') });
    res.json({ ok: true, ...saved });
  }));
  app.get('/api/profiles/guides/:packId/versions', route((req, res) => {
    const current = guides().pack(req.params.packId);
    res.json({ ok: true, versions: guides().versions(req.params.packId), meta: current.meta, hash: current.hash });
  }));
  app.get('/api/profiles/guides/:packId/versions/:n', route((req, res) => {
    res.json({ ok: true, version: guides().version(req.params.packId, versionNumber(req.params.n)) });
  }));
  app.post('/api/profiles/guides/:packId/revert', route((req, res) => {
    const saved = guides().revert(req.params.packId, versionNumber(req.body?.version), { by: accountName(req), baseHash: String(req.body?.baseHash || '') });
    res.json({ ok: true, ...saved });
  }));
  app.post('/api/profiles/guides/:packId/approve', route((req, res) => {
    guides().pack(req.params.packId);
    res.json({ ok: true, meta: guides().approve(req.params.packId, { by: accountName(req) }) });
  }));

  app.get('/api/profiles/export', route((req, res) => {
    const { name, archive, report } = writeExport({ ...exportOptions(), profiles: profiles(), guides: guides(), by: accountName(req) });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('X-Studio-Export', JSON.stringify({ profiles: report.profiles.length, guides: report.guides.length, unreviewed: report.unreviewed.profiles.length + report.unreviewed.guides.length }));
    res.setHeader('Content-Length', String(archive.length));
    res.end(archive);
  }));
}
