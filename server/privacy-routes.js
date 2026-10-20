import { ownerIdForRequest } from './account-ownership.js';
import { dropSnapshots } from "./data-snapshot.js";
import { comfyOutputDir } from './comfy.js';
import { clientOf } from './access.js';
import { limitedCheck } from './access-routes.js';
import { stripMetadata } from './metadata-strip.js';
import { addGalleryItems, writeGalleryNow, filterVisibleGallery, gallery, hideGalleryItems, migrateLegacyPrompts, removeGalleryItems, cleanupGalleryState, galleryRevisionValue, sortGallery } from './gallery-store.js';
import { forgetItemThumbnails, forgetLegacyHiddenThumbnails, resizeInMemory } from './thumbnails.js';
import { forgetPrompts, promptKey } from './prompt-history.js';
import { forgetItemVideoPreviews, forgetPrivateVideoPreviews, getPrivateVideoPreview, sendVideoPoster } from './video-previews.js';
import { sendMediaBuffer } from './media-response.js';
import { jobs } from './jobs.js';
import { DEFAULT_COOLDOWN_MINUTES } from './gallery-bundles.js';
import { addDevicePasskey, addPasskey, changePassword, issueChallenge, unlockWithDevicePasskey, clearUnlockCookie, encryptionKeyFromRequest, erasePrivacy, isPrivacyEnabled, passkeyUnlockOptions, privacyStatusFor, removePasskey, setupPrivacy, setUnlockCookie, unlockWithPasskey, unlockWithPassword } from './privacy.js';
import { compactVaultBundles, dissolveVaultBundle, eraseVault, retireVault, exportVaultBackup, hideItems, patchVaultItem, readVaultAsset, setVaultBundleCover, unhideItems, vaultAssetsForExport, vaultBundlePendingSummary, vaultConfigured, vaultItems, vaultRevision } from './vault.js';
import { forgetComfyRun } from './hidden-traces.js';
import { adoptHiddenRuns, forgetHiddenRunKeys } from './hidden-runs.js';
import { exportFilename, sendGalleryExport } from './gallery-export.js';
import { autoDetectOutputDir } from './output-folder.js';
import { requireHiddenKey, requireLocal, requireThisComputer } from "./route-access.js";

/** What Hidden needs from this computer before it can keep anything: where ComfyUI saves. */
async function hiddenReadiness() {
  const outputDir = comfyOutputDir || await autoDetectOutputDir().catch(() => "");
  return { outputDir: Boolean(outputDir), outputPath: outputDir || "" };
}

/**
 * Images hidden before hiding cleaned up after itself left cached thumbnails
 * behind; the first unlock after the update finds and removes them, once.
 */
let oldHiddenThumbnailsChecked = false;
function forgetOldHiddenThumbnails(key) {
  if (oldHiddenThumbnailsChecked) return;
  oldHiddenThumbnailsChecked = true;
  try {
    const names = vaultItems(key, { bundles: false }).flatMap((item) => [item.outputName, item.upscale?.outputName]);
    const removed = forgetLegacyHiddenThumbnails(names);
    if (removed) console.log(`[Studio] Removed ${removed} thumbnail${removed === 1 ? "" : "s"} left behind by images hidden before.`);
  } catch {
    oldHiddenThumbnailsChecked = false;
  }
}

async function privacyPayload(req, key = encryptionKeyFromRequest(req)) {
  const status = privacyStatusFor(req);
  const unlocked = Boolean(key);
  if (unlocked) {
    migrateLegacyPrompts(key);
    forgetOldHiddenThumbnails(key);
    // What Hidden runs made after Studio lost track of them joins Hidden now.
    try { adoptHiddenRuns(key); } catch { /* the next unlocked request tries again */ }
  }
  return {
    ...status,
    unlocked,
    // Nothing about what Hidden holds is shared with a locked browser, not even whether it is empty.
    vault: { unlocked, revision: unlocked ? vaultRevision() : 0 },
    readiness: await hiddenReadiness(),
    // Another device, signed in with the studio password; Hidden itself still opens with its own.
    remote: !clientOf(req).thisComputer
  };
}

function sessionSeconds(req) {
  const value = Number(req.body?.sessionSeconds || 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}


export function registerPrivacyStatusRoute(app) {
  app.get("/api/privacy/status", async (req, res) => {
    res.json(await privacyPayload(req));
  });
}

export function registerPrivacyRoutes(app) {
  app.post("/api/privacy/setup", async (req, res) => {
    if (!requireThisComputer(req, res)) return;
    try {
      // Creating the password does not need ComfyUI; hiding images later does, to
      // remove its copies, and says so then.
      // A Hidden left without its key ring can never be opened again; keep it aside rather than build on it.
      if (!isPrivacyEnabled() && vaultConfigured()) { retireVault(); forgetPrivateVideoPreviews(); }
      const key = await setupPrivacy(req.body?.password || "");
      setUnlockCookie(res, key, sessionSeconds(req), req);
      res.json({ ok: true, ...(await privacyPayload(req, key)), enabled: true, unlocked: true });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/privacy/unlock", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const key = await limitedCheck(req, res, () => unlockWithPassword(req.body?.password || ""), "That password is incorrect.");
    if (!key) return;
    setUnlockCookie(res, key, sessionSeconds(req), req);
    res.json({ ok: true, ...(await privacyPayload(req, key)), enabled: true, unlocked: true });
  });

  app.get("/api/privacy/passkeys/options", (req, res) => {
    if (!requireLocal(req, res)) return;
    res.json({ ok: true, passkeys: passkeyUnlockOptions(), challenge: issueChallenge() });
  });

  app.post("/api/privacy/passkeys/unlock", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const key = await limitedCheck(req, res, async () => (req.body?.secret
      ? unlockWithDevicePasskey(req.body, String(req.headers.origin || ""))
      : unlockWithPasskey(String(req.body?.id || ""), String(req.body?.prf || ""))), "This passkey isn’t set up for Hidden. Use your password.");
    if (!key) return;
    setUnlockCookie(res, key, sessionSeconds(req), req);
    res.json({ ok: true, ...(await privacyPayload(req, key)), enabled: true, unlocked: true });
  });

  app.post("/api/privacy/passkeys", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const key = requireHiddenKey(req, res);
    if (!key) return;
    try {
      if (req.body?.mode === "device") {
        const { passkey, secret } = addDevicePasskey(key, req.body || {});
        res.json({ ok: true, passkey, secret, ...(await privacyPayload(req, key)) });
        return;
      }
      const passkey = addPasskey(key, req.body || {});
      res.json({ ok: true, passkey, ...(await privacyPayload(req, key)) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/privacy/passkeys/:id", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const key = requireHiddenKey(req, res);
    if (!key) return;
    removePasskey(String(req.params.id || ""));
    res.json({ ok: true, ...(await privacyPayload(req, key)) });
  });

  app.post("/api/privacy/password", async (req, res) => {
    if (!requireThisComputer(req, res)) return;
    const key = requireHiddenKey(req, res);
    if (!key) return;
    try {
      await changePassword(key, req.body?.password || "");
      res.json({ ok: true, ...(await privacyPayload(req, key)) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/privacy/lock", (req, res) => {
    if (!requireLocal(req, res)) return;
    clearUnlockCookie(res);
    res.json({ ok: true, enabled: isPrivacyEnabled(), unlocked: false, passkeys: privacyStatusFor({ headers: {} }).passkeys, vault: { unlocked: false, revision: 0 } });
  });

  /** Forgot the password: the only way back is to start over, and everything in Hidden goes. */
  app.post("/api/privacy/erase", (req, res) => {
    if (!requireThisComputer(req, res)) return;
    if (req.body?.confirm !== "erase") {
      res.status(400).json({ ok: false, error: "Confirm erasing Hidden first." });
      return;
    }
    // Runs still rendering would otherwise seal their results with a key that no longer exists.
    for (const [id, job] of jobs) {
      if (!job.privateVault || job.terminalAt) continue;
      jobs.set(id, { ...job, status: "canceling", vaultKey: null });
    }
    eraseVault();
    erasePrivacy();
    forgetPrivateVideoPreviews();
    forgetHiddenRunKeys();
    // Copies taken before an update may still hold Hidden's older records.
    try { dropSnapshots(); } catch { /* held open (Windows); they go within 14 days anyway */ }
    clearUnlockCookie(res);
    res.json({ ok: true, enabled: false, unlocked: false, passkeys: [], vault: { unlocked: false, revision: 0 } });
  });

  /* ---------------------------------------------------------------- Hidden */

  function hiddenPage(req, key) {
    const type = String(req.query.type || "");
    const includeFailed = req.query.includeFailed !== "0";
    const bundlesEnabled = req.query.bundles !== "0";
    // Runs that ComfyUI is still rendering live in memory until they are sealed.
    const running = gallery.filter((item) => item.privateVault && item.status !== "canceled");
    const items = sortGallery([...running, ...vaultItems(key, { bundles: bundlesEnabled })]).filter((item) => {
      if (type && item.type !== type) return false;
      if (!includeFailed && item.status === "error") return false;
      return true;
    });
    return { items, revision: Math.max(vaultRevision(), running.length ? galleryRevisionValue() : 0), totalApprox: items.length, hasMore: false, nextCursor: "" };
  }

  app.get("/api/hidden/gallery", (req, res) => {
    const key = requireHiddenKey(req, res);
    if (!key) return;
    cleanupGalleryState(jobs);
    try { adoptHiddenRuns(key); } catch { /* tried again with the next page */ }
    try {
      const page = hiddenPage(req, key);
      if (Number(req.query.since || 0) && Number(req.query.since) === page.revision) {
        res.json({ unchanged: true, revision: page.revision });
        return;
      }
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.json(page);
    } catch {
      res.status(500).json({ ok: false, error: "Can’t open Hidden with this key." });
    }
  });

  app.post("/api/hidden/hide", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const key = requireHiddenKey(req, res);
    if (!key) return;
    const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
    const items = filterVisibleGallery(gallery).filter((item) => item.status === "done" && (ids.has(item.id) || ids.has(item.url)));
    if (items.some((item) => item.library)) {
      res.status(400).json({ ok: false, error: "Images from an added folder stay in that folder, so they can’t move into Hidden." });
      return;
    }
    if (!items.length) {
      res.status(404).json({ ok: false, error: "Those images are no longer in the gallery." });
      return;
    }
    if (items.some((item) => item.upscale?.status === "running")) {
      res.status(409).json({ ok: false, error: "Wait for the upscale to finish, then hide it." });
      return;
    }
    try {
      const result = await hideItems(key, items);
      // A marker keeps them from coming back out of ComfyUI's history if a copy stayed behind.
      hideGalleryItems(result.movedFrom || []);
      removeGalleryItems(result.movedFrom || []);
      // Nothing of them stays in the open: the gallery's copy of their prompts (and its
      // backup), their cached thumbnails, the prompt history, and what ComfyUI kept of them.
      writeGalleryNow();
      writeGalleryNow();
      // A prompt that now only belongs to Hidden leaves the prompt history too.
      const stillShown = new Set(filterVisibleGallery(gallery).map((item) => promptKey(item.prompt)));
      forgetPrompts((result.movedFrom || []).map((item) => item.prompt || ""), stillShown);
      const negativesStillShown = new Set(filterVisibleGallery(gallery).map((item) => promptKey(item.negative)));
      forgetPrompts((result.movedFrom || []).map((item) => item.negative || ""), negativesStillShown, "negative");
      for (const item of result.movedFrom || []) {
        await forgetItemThumbnails(item).catch(() => 0);
        await forgetItemVideoPreviews(item).catch(() => 0);
      }
      await forgetComfyRun({ promptIds: result.promptIds, inputNames: result.inputNames });
      res.json({ ok: true, moved: result.moved.length, ids: (result.movedFrom || []).map((item) => item.id), hiddenIds: result.moved.map((item) => item.id), failed: result.failed, leftBehind: result.leftBehind, revision: galleryRevisionValue() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/hidden/unhide", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const key = requireHiddenKey(req, res);
    if (!key) return;
    try {
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String);
      const restored = await unhideItems(key, ids, ownerIdForRequest(req));
      for (const id of ids) forgetPrivateVideoPreviews(id);
      addGalleryItems(restored);
      res.json({ ok: true, restored: restored.length, revision: galleryRevisionValue() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/hidden/export", (req, res) => {
    const key = requireHiddenKey(req, res);
    if (!key) return;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename("hidden", "zip")}"`);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    sendGalleryExport(res, vaultAssetsForExport(key), { gallery: false });
  });
}

export function registerVaultBundleRoutes(app) {
  function vaultBundleOptions(source = {}) {
    return {
      mode: source.mode === "job" ? "job" : "smart",
      cooldownMinutes: Math.max(0, Math.min(1440, Number(source.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES)))
    };
  }

  app.get("/api/vault/bundles", (req, res) => {
    // Locked means no info at all - not even a run count - so there is nothing
    // else to compute here without the key.
    const result = vaultBundlePendingSummary(req, vaultBundleOptions(req.query));
    if (result.locked) return res.json({ locked: true, pending: { runs: 0, items: 0, itemIds: [] } });
    res.json({ locked: false, pending: result.pending, ...vaultBundleOptions(req.query) });
  });

  app.post("/api/vault/bundles/compact", (req, res) => {
    if (!requireLocal(req, res)) return;
    try {
      res.json({ ok: true, ...compactVaultBundles(req, vaultBundleOptions(req.body || {})) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/vault/bundles/:id/cover", (req, res) => {
    if (!requireLocal(req, res)) return;
    try {
      res.json(setVaultBundleCover(req, String(req.params.id), String(req.body?.itemId || "")));
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/vault/bundles/:id", (req, res) => {
    if (!requireLocal(req, res)) return;
    try {
      res.json(dissolveVaultBundle(req, String(req.params.id)));
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}

export function registerVaultMediaRoutes(app) {
  function hiddenDownloadName(asset, variant) {
    const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/webm": ".webm" }[asset.mime] || "";
    const stem = String(asset.item.prompt || asset.name || "hidden").replace(/\s+/g, " ").trim().slice(0, 48).replace(/[^\w .-]+/g, "").trim() || "hidden";
    return `${stem}${variant === "upscale" ? " upscaled" : ""}${ext}`;
  }

  app.get("/api/vault/media/:id", (req, res) => {
    const variant = req.query.variant === "upscale" ? "upscale" : "original";
    const asset = readVaultAsset(req, req.params.id, variant);
    if (!asset) {
      res.status(404).json({ ok: false, error: "Hidden is locked, or this item is gone." });
      return;
    }
    res.setHeader("Content-Type", asset.mime || "application/octet-stream");
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    const name = encodeURIComponent(hiddenDownloadName(asset, variant));
    res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${name}`);
    // Shared without its settings: the prompt and workflow inside the file stay in Hidden.
    const bytes = req.query.clean === "1" ? stripMetadata(asset.buffer).buffer : asset.buffer;
    if (asset.mime?.startsWith('video/')) sendMediaBuffer(req, res, bytes, asset.mime);
    else res.send(bytes);
  });

  app.get('/api/vault/video-preview/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const asset = readVaultAsset(req, req.params.id, 'original');
    if (!asset || asset.item.type !== 'video') { res.status(404).end(); return; }
    try {
      const preview = await getPrivateVideoPreview(asset.buffer, req.params.id);
      if (req.query.poster === '1') await sendVideoPoster(req, res, preview);
      else sendMediaBuffer(req, res, preview);
    }
    catch { if (!res.headersSent) res.status(503).end(); }
  });

  app.get("/api/vault/thumbnail/:id", async (req, res) => {
    const asset = readVaultAsset(req, req.params.id, req.query.variant === "upscale" ? "upscale" : "original");
    if (!asset) {
      res.status(404).end();
      return;
    }
    // Resized in memory only, from the already-decrypted buffer this request holds —
    // never written to disk, so no plaintext derivative of a vault item persists.
    const resized = await resizeInMemory(asset.buffer, asset.mime);
    res.setHeader("Content-Type", resized ? "image/webp" : (asset.mime || "application/octet-stream"));
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.send(resized || asset.buffer);
  });

  app.get("/api/vault/export", (req, res) => {
    const backup = exportVaultBackup(encryptionKeyFromRequest(req));
    if (!backup) {
      res.status(401).json({ ok: false, error: "Unlock Hidden before backing it up." });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename("hidden", "backup")}"`);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.send(backup);
  });
}

export function registerHiddenFavoriteRoute(app) {
  // A Hidden image keeps its star inside Hidden's encrypted list.
  app.post("/api/hidden/favorite", (req, res) => {
    const key = requireHiddenKey(req, res);
    if (!key) return;
    const favorite = Boolean(req.body?.favorite);
    const items = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 500)
      .map((id) => patchVaultItem(key, id, (item) => (favorite ? { favorite: true } : { favorite: undefined })))
      .filter(Boolean);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json({ ok: true, items, revision: vaultRevision() });
  });
}
